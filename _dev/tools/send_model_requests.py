"""Sends scripted model API requests through the recording proxy (record_model_traffic.py), for the
model capture recordings no agent makes: a cache write then a read, an unknown model, a call recorded
raw. From the repository root:

    python3 -I _dev/tools/send_model_requests.py --proxy http://127.0.0.1:9850 \\
        _dev/tools/model_requests/<provider>/<case>.json

A request file is a JSON object:

    {
      "requests": [
        {
          "method": "POST",                 # optional, POST by default
          "path": "/v1/messages",           # the path under the provider, with its query
          "headers": {...},                 # the request's headers
          "body": {...}                     # its JSON body, or a string sent as it is
        }
      ]
    }

In a header value, "${env:NAME}" becomes the environment variable NAME, so a key never sits in the
file. A streamed response is read to its end. Each reply's status and a line of its body are printed;
nothing from a credential ever is.
"""

import argparse
import http.client
import json
import os
import re
import sys
from urllib.parse import urlsplit

ENV = re.compile(r"\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--proxy", required=True, help="the recording proxy's address")
    parser.add_argument("file", help="the request file")
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as file:
        plan = json.load(file)
    proxy = urlsplit(args.proxy)

    for index, item in enumerate(plan["requests"]):
        headers = {name: ENV.sub(lambda match: os.environ[match.group(1)], value) for name, value in item.get("headers", {}).items()}
        body = item.get("body")
        data = body.encode("utf-8") if isinstance(body, str) else (json.dumps(body).encode("utf-8") if body is not None else None)
        connection = http.client.HTTPConnection(proxy.hostname, proxy.port or 80, timeout=600)
        connection.request(item.get("method", "POST"), item["path"], body=data, headers=headers)
        response = connection.getresponse()
        chunks = []
        try:
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    break
                chunks.append(chunk)
        except http.client.IncompleteRead as error:
            chunks.append(error.partial)
            print("  the reply broke before it ended", flush=True)
        connection.close()
        text = b"".join(chunks).decode("utf-8", errors="replace")
        print(f"{index + 1}. {item.get('method', 'POST')} {item['path'].split('?')[0]}: {response.status} {summary(text)}", flush=True)


def summary(text):
    line = text.strip().splitlines()[-1] if text.strip() else ""
    return line[:160]


if __name__ == "__main__":
    main()
