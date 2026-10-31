"""Records the traffic between an agent and a model provider as a HAR 1.2 file, for the model capture
suite under conformance/model_capture/.

A reverse proxy on 127.0.0.1 that relays each exchange to the provider's origin and back unchanged,
streams passed on as they arrive. Each exchange is written as the provider answered it, with the
request's headers except the connection's own, Host and Content-Length, and the response's
Content-Type. Every credential is replaced before it is written: the value of a header or a URL
parameter that carries one becomes RECORDED-CREDENTIAL, its name kept, so the capture suite can send
the request through the model proxy and see the name removed again. It shares no code with Spectra.
From the repository root:

    python3 -I _dev/tools/record_model_traffic.py --port 9850 \\
        --provider https://generativelanguage.googleapis.com \\
        --har conformance/test_data/model_capture/v0_1/<entry>/<conversation>.har

Point the agent's base-URL variable at http://127.0.0.1:<port>: GOOGLE_GEMINI_BASE_URL for Google's
SDKs, GEMINI_API_BASE or ANTHROPIC_API_BASE for LiteLLM, ANTHROPIC_BASE_URL for Anthropic's SDK.
LiteLLM's gemini/ route sends its calls under /models/… without the API version, so give it the
version with --provider, such as https://generativelanguage.googleapis.com/v1beta; the recording
keeps the provider's full URL. Stop with Ctrl-C, or SIGTERM, once the conversation is over. The HAR
file is rewritten after every exchange.
"""

import argparse
import gzip
import http.client
import json
import os
import re
import signal
import ssl
import sys
import threading
import time
import zlib
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PLACEHOLDER = "RECORDED-CREDENTIAL"

# The request headers that carry a credential: by name, and by a name that contains one of the words.
CREDENTIAL_HEADERS = {"authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "api-key", "cookie"}
CREDENTIAL_PARAMETERS = {"key", "api_key", "access_token"}
CREDENTIAL_NAME = re.compile(r"key|token|secret|auth|password|cookie", re.IGNORECASE)

# Headers that belong to one connection (RFC 9110, section 7.6.1), which a proxy does not pass on.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"}

# The request headers left out of the recording, besides the connection's own.
NOT_RECORDED = HOP_BY_HOP | {"host", "content-length"}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="the port to listen on, on 127.0.0.1")
    parser.add_argument("--provider", required=True, help="the provider's origin, with a path prefix when the client leaves one out")
    parser.add_argument("--har", required=True, help="the HAR file to write")
    args = parser.parse_args()

    provider = urlsplit(args.provider)
    if provider.scheme not in ("http", "https"):
        sys.exit("--provider must start with http:// or https://.")
    recorder = Recorder(args.har)

    class Handler(ProxyHandler):
        pass

    Handler.provider = provider
    Handler.recorder = recorder

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, stop)
    print(f"Recording {args.provider} at http://127.0.0.1:{args.port} into {args.har}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print(f"Wrote {len(recorder.entries)} exchanges to {args.har}", flush=True)


def stop(*_):
    """Ends the server the way Ctrl-C does."""
    raise KeyboardInterrupt


class Recorder:
    """Holds the exchanges, in the order their requests arrived."""

    def __init__(self, path):
        self.path = path
        self.entries = []
        self.lock = threading.Lock()

    def add(self, started, entry):
        with self.lock:
            self.entries.append((started, entry))
            self.entries.sort(key=lambda pair: pair[0])
            log = {
                "log": {
                    "version": "1.2",
                    "creator": {"name": "record_model_traffic.py", "version": "1"},
                    "entries": [entry for _, entry in self.entries],
                }
            }
            os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
            temporary = f"{self.path}.tmp"
            with open(temporary, "w", encoding="utf-8") as file:
                json.dump(log, file, indent=2, ensure_ascii=False)
                file.write("\n")
            os.replace(temporary, self.path)


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    provider = None
    recorder = None

    def do_GET(self):
        self.exchange()

    def do_POST(self):
        self.exchange()

    def do_PUT(self):
        self.exchange()

    def do_DELETE(self):
        self.exchange()

    def log_message(self, format, *args):
        sys.stderr.write(f"{self.command} {without_credentials(self.path)} {args[1] if len(args) > 1 else ''}\n")

    def exchange(self):
        started = time.time()
        started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        body = self.read_request_body()
        target_path = (self.provider.path.rstrip("/") + self.path) if self.provider.path.rstrip("/") else self.path

        if self.provider.scheme == "https":
            upstream = http.client.HTTPSConnection(self.provider.hostname, self.provider.port, timeout=600, context=ssl_context())
        else:
            upstream = http.client.HTTPConnection(self.provider.hostname, self.provider.port, timeout=600)
        headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP | {"host"}}
        headers["Host"] = self.provider.netloc
        upstream.request(self.command, target_path, body=body if body else None, headers=headers)
        reply = upstream.getresponse()
        waited = time.time()
        raw, broken_off = self.relay(reply)
        upstream.close()
        finished = time.time()

        text = decode(raw, reply.getheader("content-encoding"))
        entry = {
            "startedDateTime": started_at,
            "time": round((finished - started) * 1000, 3),
            "request": {
                "method": self.command,
                "url": without_credentials(f"{self.provider.scheme}://{self.provider.netloc}{target_path}"),
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": recorded_request_headers(self.headers.items()),
                "queryString": [],
                "headersSize": -1,
                "bodySize": len(body),
            },
            "response": {
                "status": reply.status,
                "statusText": reply.reason,
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": [{"name": name, "value": value} for name, value in reply.getheaders() if name.lower() == "content-type"],
                "content": {
                    "size": len(text.encode("utf-8")),
                    "mimeType": reply.getheader("content-type", ""),
                    "text": text,
                },
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": -1,
            },
            "cache": {},
            "timings": {
                "send": 0,
                "wait": round((waited - started) * 1000, 3),
                "receive": round((finished - waited) * 1000, 3),
            },
        }
        if broken_off:
            entry["response"]["_brokenOff"] = True
        if body:
            entry["request"]["postData"] = {
                "mimeType": self.headers.get("content-type", ""),
                "text": decode(body, self.headers.get("content-encoding")),
            }
        self.recorder.add(started, entry)

    def read_request_body(self):
        if self.headers.get("transfer-encoding", "").lower() == "chunked":
            chunks = []
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip(), 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.readline()
            return b"".join(chunks)
        length = int(self.headers.get("content-length", "0") or "0")
        return self.rfile.read(length) if length else b""

    def relay(self, reply):
        """Passes the reply on as it arrives, chunked when its length is unknown; returns its bytes and
        whether the provider's connection broke before it ended, which the agent then sees too. A
        client that leaves before the end, as one that stops reading at a stream's last chunk does,
        is let go, and the provider's reply is still read to its end, so the recording is whole."""
        length = reply.getheader("content-length")
        self.send_response_only(reply.status, reply.reason)
        for name, value in reply.getheaders():
            if name.lower() not in HOP_BY_HOP and name.lower() != "content-length":
                self.send_header(name, value)
        if length is not None:
            self.send_header("Content-Length", length)
        else:
            self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        received = []
        broken_off = False
        client_gone = False
        while True:
            try:
                chunk = reply.read1(65536)
            except (http.client.IncompleteRead, ConnectionError) as error:
                chunk = getattr(error, "partial", b"")
                broken_off = True
            if chunk:
                received.append(chunk)
                if not client_gone:
                    try:
                        if length is not None:
                            self.wfile.write(chunk)
                        else:
                            self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        client_gone = True
            if broken_off or not chunk:
                break
        if length is not None and sum(len(chunk) for chunk in received) < int(length):
            broken_off = True
        if broken_off or client_gone:
            self.close_connection = True
        elif length is None:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        return b"".join(received), broken_off


def ssl_context():
    """The TLS context for the provider: the CA bundle SSL_CERT_FILE names, else certifi's when it is
    installed, else the interpreter's default, which a python.org build on macOS lacks until its
    "Install Certificates.command" has been run."""
    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile is None:
        try:
            import certifi

            cafile = certifi.where()
        except ImportError:
            cafile = None
    return ssl.create_default_context(cafile=cafile)


def is_credential_header(name):
    return name.lower() in CREDENTIAL_HEADERS or CREDENTIAL_NAME.search(name) is not None


def is_credential_parameter(name):
    return name.lower() in CREDENTIAL_PARAMETERS or CREDENTIAL_NAME.search(name) is not None


def recorded_request_headers(headers):
    return [
        {"name": name.lower(), "value": PLACEHOLDER if is_credential_header(name) else value}
        for name, value in headers
        if name.lower() not in NOT_RECORDED
    ]


def without_credentials(url):
    """The URL or path with each credential parameter's value replaced, its name kept."""
    path, _, query = url.partition("?")
    if not query:
        return url
    pairs = []
    for pair in query.split("&"):
        name, equals, _ = pair.partition("=")
        pairs.append(f"{name}={PLACEHOLDER}" if equals and is_credential_parameter(name) else pair)
    return f"{path}?{'&'.join(pairs)}"


def decode(raw, encoding):
    encoding = (encoding or "identity").strip().lower()
    if encoding in ("gzip", "x-gzip"):
        raw = gzip.decompress(raw)
    elif encoding == "deflate":
        raw = zlib.decompress(raw)
    elif encoding not in ("identity", ""):
        sys.exit(f"The recording proxy cannot decode the content encoding {encoding}.")
    return raw.decode("utf-8")


if __name__ == "__main__":
    main()
