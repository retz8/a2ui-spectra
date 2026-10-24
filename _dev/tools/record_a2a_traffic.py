"""Records the traffic between an A2A host and an A2A agent as a HAR 1.2 file, for the A2A capture
suite under conformance/a2a_capture/.

A reverse proxy on 127.0.0.1 that relays each exchange to the agent and back unchanged, except the
card it serves, whose JSON-RPC endpoints point back at the proxy so the host's calls come through it.
Each exchange is written as the agent answered it, the card unrewritten, with only the headers the
replay needs. It shares no code with Spectra. From the repository root:

    python3 -I _dev/tools/record_a2a_traffic.py --port 10002 --agent http://127.0.0.1:10012 \\
        --har conformance/test_data/a2a_capture/v0_1/<entry>/<conversation>.har

Stop it with Ctrl-C, or SIGTERM, once the conversation is over. The HAR file is rewritten after every exchange.
"""

import argparse
import gzip
import http.client
import json
import os
import re
import signal
import sys
import threading
import time
import zlib
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

# The headers the replay reads. Everything else, credentials above all, stays out of the file.
KEPT_HEADERS = {"content-type", "accept", "a2a-version", "x-a2a-extensions", "a2a-extensions"}

# Headers that belong to one connection (RFC 9110, section 7.6.1), which a proxy does not pass on.
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

CARD_PATHS = {"/.well-known/agent-card.json", "/.well-known/agent.json"}

ORIGIN = re.compile(r"^https?://[^/]+")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="the port to listen on, on 127.0.0.1")
    parser.add_argument("--agent", required=True, help="the agent's base URL")
    parser.add_argument("--har", required=True, help="the HAR file to write")
    args = parser.parse_args()

    agent = urlsplit(args.agent)
    if agent.scheme != "http":
        sys.exit("The recording proxy reaches agents over plain HTTP only.")
    recorder = Recorder(args.har)
    origin = f"http://127.0.0.1:{args.port}"

    class Handler(ProxyHandler):
        pass

    Handler.agent = agent
    Handler.origin = origin
    Handler.recorder = recorder

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, stop)
    print(f"Recording {args.agent} at {origin} into {args.har}", flush=True)
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
    """Holds the conversation's exchanges, in the order their requests arrived."""

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
                    "creator": {"name": "record_a2a_traffic.py", "version": "1"},
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
    agent = None
    origin = None
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
        sys.stderr.write(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}\n")

    def exchange(self):
        started = time.time()
        started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        body = self.read_request_body()

        upstream = http.client.HTTPConnection(self.agent.hostname, self.agent.port or 80, timeout=600)
        headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP | {"host"}}
        headers["Host"] = self.agent.netloc
        upstream.request(self.command, self.path, body=body if body else None, headers=headers)
        reply = upstream.getresponse()
        waited = time.time()

        is_card = self.command == "GET" and urlsplit(self.path).path in CARD_PATHS
        raw, broken_off = (self.relay_card(reply), False) if is_card else self.relay(reply)
        upstream.close()
        finished = time.time()

        text = decode(raw, reply.getheader("content-encoding"))
        request_headers = kept(self.headers.items())
        entry = {
            "startedDateTime": started_at,
            "time": round((finished - started) * 1000, 3),
            "request": {
                "method": self.command,
                "url": f"{self.agent.scheme}://{self.agent.netloc}{self.path}",
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": request_headers,
                "queryString": [],
                "headersSize": -1,
                "bodySize": len(body),
            },
            "response": {
                "status": reply.status,
                "statusText": reply.reason,
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": kept(reply.getheaders()),
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
        whether its connection broke before it ended, which the host then sees too."""
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
        while True:
            try:
                chunk = reply.read1(65536)
            except (http.client.IncompleteRead, ConnectionError) as error:
                chunk = getattr(error, "partial", b"")
                broken_off = True
            if chunk:
                received.append(chunk)
                if length is not None:
                    self.wfile.write(chunk)
                else:
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            if broken_off or not chunk:
                break
        if length is not None and sum(len(chunk) for chunk in received) < int(length):
            broken_off = True
        if broken_off:
            self.close_connection = True
        elif length is None:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        return b"".join(received), broken_off

    def relay_card(self, reply):
        """Passes the card on with its JSON-RPC endpoints pointed at the proxy; returns it as received."""
        raw = reply.read()
        card = None
        if 200 <= reply.status <= 299:
            try:
                card = json.loads(decode(raw, reply.getheader("content-encoding")))
            except ValueError:
                card = None
        if isinstance(card, dict):
            out = json.dumps(point_at(card, self.origin)).encode("utf-8")
            skipped = HOP_BY_HOP | {"content-length", "content-encoding"}
        else:
            out = raw
            skipped = HOP_BY_HOP | {"content-length"}
        self.send_response_only(reply.status, reply.reason)
        for name, value in reply.getheaders():
            if name.lower() not in skipped:
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
        self.wfile.flush()
        return raw


def point_at(card, origin):
    """The card with the origin of each JSON-RPC endpoint replaced, its path kept."""
    card = json.loads(json.dumps(card))
    preferred = card.get("preferredTransport", "JSONRPC")
    if isinstance(card.get("url"), str) and preferred.upper() in ("JSONRPC", "JSON-RPC"):
        card["url"] = ORIGIN.sub(origin, card["url"])
    for key, binding in (("additionalInterfaces", "transport"), ("supportedInterfaces", "protocolBinding")):
        for interface in card.get(key) or []:
            if (
                isinstance(interface, dict)
                and str(interface.get(binding, "")).upper() in ("JSONRPC", "JSON-RPC")
                and isinstance(interface.get("url"), str)
            ):
                interface["url"] = ORIGIN.sub(origin, interface["url"])
    return card


def kept(headers):
    return [{"name": name, "value": value} for name, value in headers if name.lower() in KEPT_HEADERS]


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
