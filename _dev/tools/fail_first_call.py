"""Answers the first POST with a 503 and relays every other request to a provider, so that an agent's
model SDK retries one call inside one of its spans, for the receiver capture suite's case of a span
with several exchanges.

A reverse proxy on 127.0.0.1: the first POST it receives is answered `503` with a Gemini-shaped
`UNAVAILABLE` error body and not forwarded; every request after it is relayed to the provider's origin
and back unchanged, a streamed reply passed on as it arrives. It shares no code with Spectra. From the
repository root:

    uv run --no-project --with certifi python3 -I _dev/tools/fail_first_call.py --port 9852 \\
        --provider https://generativelanguage.googleapis.com

certifi, when installed, gives the provider's TLS check its CA bundle, for a Python with none of its
own.

Start Spectra with the provider's base-URL variable pointed at it, such as
`GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:9852`, so that the model proxy forwards there. Stop with
Ctrl-C, or SIGTERM.
"""

import argparse
import http.client
import json
import signal
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

try:
    import certifi
except ImportError:
    certifi = None

# Headers that belong to one connection (RFC 9110, section 7.6.1), which a proxy does not pass on.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"}

UNAVAILABLE = json.dumps({"error": {"code": 503, "message": "The model is overloaded. Please try again later.", "status": "UNAVAILABLE"}}).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="the port to listen on, on 127.0.0.1")
    parser.add_argument("--provider", required=True, help="the provider's origin")
    args = parser.parse_args()
    provider = urlsplit(args.provider)
    failed = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def relay(self):
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length)
            if self.command == "POST" and not failed.is_set():
                failed.set()
                self.send_response(503)
                self.send_header("content-type", "application/json; charset=UTF-8")
                self.send_header("content-length", str(len(UNAVAILABLE)))
                self.end_headers()
                self.wfile.write(UNAVAILABLE)
                return
            headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP | {"host", "content-length"}}
            headers["host"] = provider.netloc
            if provider.scheme == "https":
                connection = http.client.HTTPSConnection(provider.hostname, provider.port or 443, context=ssl.create_default_context(cafile=certifi.where() if certifi else None), timeout=120)
            else:
                connection = http.client.HTTPConnection(provider.hostname, provider.port or 80, timeout=120)
            connection.request(self.command, self.path, body=body if body else None, headers=headers)
            reply = connection.getresponse()
            self.send_response(reply.status)
            for name, value in reply.getheaders():
                if name.lower() not in HOP_BY_HOP | {"content-length"}:
                    self.send_header(name, value)
            self.send_header("transfer-encoding", "chunked")
            self.end_headers()
            while True:
                chunk = reply.read1(65536)
                if not chunk:
                    break
                self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            connection.close()

        do_GET = relay
        do_POST = relay

        def log_message(self, format, *values):
            sys.stderr.write(f"fail_first_call: {self.command} {urlsplit(self.path).path} {values[1] if len(values) > 1 else ''}\n")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(f"Failing the first POST, then relaying to {args.provider}, on http://127.0.0.1:{args.port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
