"""Sends one recorded conversation's requests to an A2A agent, for the agents no roster host reaches.

Fetches the agent's card, then sends each request of the request file in order to the card's JSON-RPC
endpoint, through the recording proxy (record_a2a_traffic.py) when --agent is the proxy's address.
From the repository root:

    python3 -I _dev/tools/send_a2a_requests.py --agent http://127.0.0.1:10002 \\
        _dev/tools/a2a_requests/<entry>/<conversation>.json

A request file is a JSON object:

    {
      "card": {"headers": {...}},           # optional headers for the card fetch
      "endpoint": "/a2a",                   # optional: the JSON-RPC path, for a card that lists none
      "requests": [
        {
          "headers": {...},                 # the request's headers
          "body": {...},                    # its JSON-RPC request
          "whileOpen": {"headers": {...}, "body": {...}},
                                            # optional: sent once the stream's first event arrives
          "pauseBefore": 6                  # optional: seconds to wait before sending it
        }
      ]
    }

In a body, the strings "${contextId}" and "${taskId}" become the conversation's context id and task
id, taken from the replies so far. In a header value, "${env:NAME}" becomes the environment variable
NAME, so a token never sits in the file.
"""

import argparse
import http.client
import json
import os
import re
import sys
import time
from urllib.parse import urlsplit

PLACEHOLDER = re.compile(r"\$\{(contextId|taskId)\}")
ENV = re.compile(r"\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True, help="the agent's base URL, or the recording proxy's")
    parser.add_argument("file", help="the request file")
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as file:
        plan = json.load(file)
    agent = args.agent.rstrip("/")
    ids = {}

    card_headers = headers_of(plan.get("card", {}))
    status, _, card_text = request("GET", f"{agent}/.well-known/agent-card.json", card_headers, None)
    if status != 200:
        sys.exit(f"The card fetch answered {status}.")
    endpoint = jsonrpc_endpoint(json.loads(card_text)) or (agent + plan["endpoint"] if "endpoint" in plan else None)
    if endpoint is None:
        sys.exit("The card lists no JSON-RPC interface, and the request file names no endpoint.")
    print(f"card: {status}, JSON-RPC at {endpoint}", flush=True)

    for index, item in enumerate(plan["requests"]):
        time.sleep(item.get("pauseBefore", 0))
        body = fill(item["body"], ids)
        while_open = item.get("whileOpen")

        def on_first_event(event):
            if while_open is None:
                return
            take_ids(event, ids)
            cancel = fill(while_open["body"], ids)
            status, _, text = request("POST", endpoint, headers_of(while_open), cancel)
            print(f"  while open, {cancel.get('method')}: {status} {text[:200]}", flush=True)

        status, content_type, text = request("POST", endpoint, headers_of(item), body, on_first_event)
        print(f"{index + 1}. {body.get('method')}: {status} {content_type}", flush=True)
        for reply in replies(content_type, text):
            take_ids(reply, ids)
            print(f"   {summary(reply)}", flush=True)


def headers_of(item):
    return {name: ENV.sub(lambda match: os.environ[match.group(1)], value) for name, value in item.get("headers", {}).items()}


def fill(body, ids):
    def replace(value):
        if isinstance(value, str):
            match = PLACEHOLDER.fullmatch(value)
            if match:
                if match.group(1) not in ids:
                    sys.exit(f"No {match.group(1)} is known yet for {value}.")
                return ids[match.group(1)]
            return value
        if isinstance(value, list):
            return [replace(item) for item in value]
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        return value

    return replace(body)


def request(method, url, headers, body, on_first_event=None):
    """One exchange. A server-sent event stream is read to its end, calling on_first_event once."""
    target = urlsplit(url)
    connection = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=600)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    connection.request(method, target.path or "/", body=data, headers=headers)
    response = connection.getresponse()
    content_type = response.getheader("content-type", "")
    if not content_type.startswith("text/event-stream"):
        try:
            raw = response.read()
        except http.client.IncompleteRead as error:
            raw = error.partial
            print("  the connection broke before the reply ended", flush=True)
        connection.close()
        return response.status, content_type, raw.decode("utf-8")

    lines = []
    data_lines = []
    told = False
    while True:
        try:
            line = response.readline()
        except http.client.IncompleteRead:
            print("  the stream broke before it ended", flush=True)
            break
        if not line:
            break
        decoded = line.decode("utf-8")
        lines.append(decoded)
        stripped = decoded.rstrip("\r\n")
        if stripped.startswith("data:"):
            data_lines.append(stripped[5:].lstrip(" "))
        elif stripped == "" and data_lines:
            if not told and on_first_event is not None:
                told = True
                on_first_event(json.loads("\n".join(data_lines)))
            data_lines = []
    connection.close()
    return response.status, content_type, "".join(lines)


def replies(content_type, text):
    if not content_type.startswith("text/event-stream"):
        try:
            return [json.loads(text)]
        except ValueError:
            return []
    events, data_lines = [], []
    for line in text.splitlines():
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
        elif line == "" and data_lines:
            events.append(json.loads("\n".join(data_lines)))
            data_lines = []
    if data_lines:
        events.append(json.loads("\n".join(data_lines)))
    return events


def take_ids(reply, ids):
    """Notes the context id and task id a JSON-RPC response carries, in A2A 0.3's or A2A 1.0's shape."""
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict):
        return
    wrapper = next((key for key in ("task", "statusUpdate", "artifactUpdate", "message") if isinstance(result.get(key), dict)), None)
    inner = result[wrapper] if wrapper else result
    is_task = wrapper == "task" or inner.get("kind") == "task"
    task_id = inner.get("id") if is_task else inner.get("taskId")
    if isinstance(inner.get("contextId"), str):
        ids["contextId"] = inner["contextId"]
    if isinstance(task_id, str):
        ids["taskId"] = task_id


def summary(reply):
    if not isinstance(reply, dict):
        return repr(reply)[:200]
    if "error" in reply:
        return f"error {json.dumps(reply['error'])[:200]}"
    result = reply.get("result")
    if not isinstance(result, dict):
        return repr(result)[:200]
    for key in ("task", "statusUpdate", "artifactUpdate", "message"):
        if isinstance(result.get(key), dict):
            return f"{key} {state_of(result[key])}"
    return f"{result.get('kind')} {state_of(result)}"


def state_of(value):
    status = value.get("status")
    return status.get("state", "") if isinstance(status, dict) else ""


def jsonrpc_endpoint(card):
    for interface in card.get("supportedInterfaces") or []:
        if str(interface.get("protocolBinding", "")).upper() in ("JSONRPC", "JSON-RPC"):
            return interface["url"]
    if isinstance(card.get("url"), str) and str(card.get("preferredTransport", "JSONRPC")).upper() in ("JSONRPC", "JSON-RPC"):
        return card["url"]
    for interface in card.get("additionalInterfaces") or []:
        if str(interface.get("transport", "")).upper() in ("JSONRPC", "JSON-RPC"):
            return interface["url"]
    return None


if __name__ == "__main__":
    main()
