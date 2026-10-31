"""Records the OTLP/HTTP exports an agent sends, as OTLP/JSON, for the receiver capture suite under
conformance/receiver_capture/.

An OTLP/HTTP proxy on 127.0.0.1 that passes each export request on to the receiver unchanged and
answers with the receiver's reply. Each request to /v1/traces or /v1/logs is written as OTLP/JSON,
decoded from protobuf with the opentelemetry-proto package and protobuf's JSON mapping, then with
every trace and span id turned from base64 into hex, as OTLP/JSON has them; a JSON request is
written as it came. A request to /v1/metrics is passed on and not written. No header is written.
It shares no code with Spectra. From the repository root:

    uv run --no-project --with opentelemetry-proto==1.42.1 \\
        python3 -I _dev/tools/record_otlp_exports.py --port 9851 \\
        --receiver http://127.0.0.1:9823 \\
        --out conformance/test_data/receiver_capture/v0_1/<case>/exports.json

Under `a2ui-spectra run`, put the proxy in front of Spectra's receiver from the agent's own
command, which runs after Spectra sets its variables: `-- env
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:9851 <command>`. The file is a JSON list of the
requests in arrival order, each `{"path", "receivedTimeUnixNano", "body"}`, rewritten after every
request. Stop with Ctrl-C, or SIGTERM, once the agent has flushed its exports.
"""

import argparse
import base64
import gzip
import http.client
import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

# Headers that belong to one connection (RFC 9110, section 7.6.1), which a proxy does not pass on.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"}

SIGNALS = {"/v1/traces": ExportTraceServiceRequest, "/v1/logs": ExportLogsServiceRequest}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, required=True, help="the port to listen on, on 127.0.0.1")
    parser.add_argument("--receiver", required=True, help="the receiver's origin, such as http://127.0.0.1:9823")
    parser.add_argument("--out", required=True, help="the JSON file to write")
    args = parser.parse_args()

    receiver = urlsplit(args.receiver)
    recorded = []
    lock = threading.Lock()

    def write():
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        temporary = f"{args.out}.tmp"
        with open(temporary, "w", encoding="utf-8") as file:
            json.dump(recorded, file, indent=2, ensure_ascii=False)
            file.write("\n")
        os.replace(temporary, args.out)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self):
            received = time.time_ns()
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length)
            path = urlsplit(self.path).path
            headers = {name: value for name, value in self.headers.items() if name.lower() not in HOP_BY_HOP | {"host", "content-length"}}
            connection = http.client.HTTPConnection(receiver.hostname, receiver.port, timeout=30)
            connection.request("POST", self.path, body=raw, headers=headers)
            reply = connection.getresponse()
            body = reply.read()
            self.send_response(reply.status)
            for name, value in reply.getheaders():
                if name.lower() not in HOP_BY_HOP | {"content-length"}:
                    self.send_header(name, value)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            connection.close()
            if path in SIGNALS:
                with lock:
                    recorded.append({"path": path, "receivedTimeUnixNano": str(received), "body": otlp_json(path, raw, self.headers)})
                    write()

        def log_message(self, format, *values):
            sys.stderr.write(f"record_otlp_exports: {self.command} {self.path} {values[1] if len(values) > 1 else ''}\n")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    print(f"Recording OTLP exports on http://127.0.0.1:{args.port}, passed on to {args.receiver}, into {args.out}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    with lock:
        write()


def otlp_json(path, raw, headers):
    """One export request as OTLP/JSON."""
    if "gzip" in (headers.get("content-encoding") or "").lower():
        raw = gzip.decompress(raw)
    if (headers.get("content-type") or "").split(";")[0].strip().lower() == "application/json":
        return json.loads(raw)
    message = SIGNALS[path]()
    message.ParseFromString(raw)
    return hex_ids(MessageToDict(message, use_integers_for_enums=True))


ID_FIELDS = {"traceId", "spanId", "parentSpanId"}


def hex_ids(value):
    """Every trace and span id in protobuf's JSON mapping, base64, as the hex OTLP/JSON requires."""
    if isinstance(value, dict):
        return {key: base64.b64decode(item).hex() if key in ID_FIELDS and isinstance(item, str) else hex_ids(item) for key, item in value.items()}
    if isinstance(value, list):
        return [hex_ids(item) for item in value]
    return value


if __name__ == "__main__":
    main()
