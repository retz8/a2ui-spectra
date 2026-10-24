"""Writes the expected record of each A2A capture recording: the turn record v0.1 file the A2A adapter
must write from a HAR file of A2A traffic, by the rules of _dev/docs/spec/task-2.2-a2a-adapter.md.

It shares no code with the adapter. Trace ids, span ids, times and the writer's version are stand-ins,
which the A2A capture suite's comparison skips. From the repository root:

    python3 -I _dev/tools/write_a2a_capture_records.py conformance/test_data/a2a_capture/v0_1/*/*.har

Each <conversation>.har gets its expected record beside it, as <conversation>.json.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

WRITER_NAME = "a2ui-spectra"
WRITER_VERSION = "0.0.0"

TURN_METHODS = {
    "message/send": "0.3",
    "message/stream": "0.3",
    "SendMessage": "1.0",
    "SendStreamingMessage": "1.0",
}

CARD_PATHS = ("/.well-known/agent-card.json", "/.well-known/agent.json")

A2UI_MIME_TYPES = {"application/a2ui+json", "application/json+a2ui"}

A2UI_EXTENSION = re.compile(r"^https?://a2ui\.org/a2a-extension/a2ui/(v\d+(?:\.\d+)*)/?$")

# A2A 1.0's task states, in A2A 0.3's spelling.
V10_STATES = {
    "TASK_STATE_UNSPECIFIED": "unknown",
    "TASK_STATE_SUBMITTED": "submitted",
    "TASK_STATE_WORKING": "working",
    "TASK_STATE_COMPLETED": "completed",
    "TASK_STATE_FAILED": "failed",
    "TASK_STATE_CANCELED": "canceled",
    "TASK_STATE_INPUT_REQUIRED": "input-required",
    "TASK_STATE_REJECTED": "rejected",
    "TASK_STATE_AUTH_REQUIRED": "auth-required",
}

# The turn's outcome from the last task state it saw (the 2.2 spec's decision on the outcome).
OUTCOMES = {
    "completed": "completed",
    "input-required": "waiting_for_input",
    "auth-required": "waiting_for_input",
    "canceled": "cancelled",
    "failed": "failed",
    "rejected": "failed",
    "submitted": "failed",
    "working": "failed",
    "unknown": "failed",
}

# The stand-in clock: 2026-10-24T00:00:00Z.
T0 = 1792800000 * 10**9


def main():
    for name in sys.argv[1:]:
        har = Path(name)
        record = expected_record(json.loads(har.read_text(encoding="utf-8")), har.stem)
        out = har.with_suffix(".json")
        out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{out}: {len(record['turns'])} turns")


def expected_record(har, label):
    entries = har["log"]["entries"]
    agent_name = card_name(entries)
    turns = []
    for entry in entries:
        request = entry["request"]
        if request["method"] != "POST":
            continue
        body = parse_json(request.get("postData", {}).get("text"))
        if not (isinstance(body, dict) and body.get("jsonrpc") == "2.0" and body.get("method") in TURN_METHODS):
            continue
        turns.append(Turn(body, entry["response"], agent_name, f"{label}:{len(turns)}", len(turns)).events())
    return {"version": "v0.1", "turns": [{"events": events} for events in turns]}


def card_name(entries):
    for entry in entries:
        request, response = entry["request"], entry["response"]
        path = re.sub(r"^https?://[^/]+", "", request["url"]).split("?")[0]
        if request["method"] == "GET" and path in CARD_PATHS and 200 <= response["status"] <= 299:
            card = parse_json(response["content"].get("text"))
            if isinstance(card, dict) and isinstance(card.get("name"), str):
                return card["name"]
    return None


class Turn:
    def __init__(self, body, response, agent_name, label, index):
        self.version = TURN_METHODS[body["method"]]
        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        self.message = params.get("message") if isinstance(params.get("message"), dict) else {}
        self.response = response
        self.agent_name = agent_name
        self.label = label
        self.start_ms = index * 1000
        self.a2ui_versions = []
        self.state = None
        self.saw_message = False
        self.error = None
        self.conversation_id = self.message.get("contextId") if isinstance(self.message.get("contextId"), str) else None
        self.span_count = 0

    def events(self):
        trace = digest(f"trace:{self.label}", 32)
        turn_span = self.span()
        wire = [self.wire_input(trace, turn_span)]

        status = self.response["status"]
        if not 200 <= status <= 299:
            self.fail(f"HTTP {status}{' ' + self.response['statusText'] if self.response.get('statusText') else ''}")
        header_versions = extension_versions(header(self.response, "x-a2a-extensions") or header(self.response, "a2a-extensions"))
        text = self.response["content"].get("text", "")
        if (header(self.response, "content-type") or "").lower().startswith("text/event-stream"):
            deliveries = [parse_json(data) if parse_json(data) is not None else data for data in sse_data(text)]
        else:
            parsed = parse_json(text)
            deliveries = [parsed if parsed is not None else text]
        for delivery in deliveries:
            wire.append(self.wire_output(trace, turn_span, delivery))
        if self.response.get("_brokenOff"):
            self.fail("The connection to the agent broke before the reply ended.")

        outcome = self.outcome()
        offered = list(self.capabilities.keys()) if self.capabilities else []
        version = (
            self.a2ui_versions[0]
            if self.a2ui_versions
            else only(header_versions) or only(offered)
        )
        attributes = {
            "a2ui.event.kind": "turn",
            "gen_ai.operation.name": "invoke_agent",
        }
        if self.agent_name is not None:
            attributes["gen_ai.agent.name"] = self.agent_name
        if self.conversation_id is not None:
            attributes["gen_ai.conversation.id"] = self.conversation_id
        attributes["a2ui.turn.outcome"] = outcome
        if version is not None:
            attributes["a2ui.turn.protocol_version"] = version
        attributes["a2ui.turn.capture_paths"] = ["wire"]
        attributes["a2ui.turn.writer.name"] = WRITER_NAME
        attributes["a2ui.turn.writer.version"] = WRITER_VERSION
        status_field = {"code": 2} if outcome == "failed" else {"code": 1}
        if outcome == "failed" and self.error is not None:
            status_field["message"] = self.error
        turn = {
            "traceId": trace,
            "spanId": turn_span,
            "name": "invoke_agent" if self.agent_name is None else f"invoke_agent {self.agent_name}",
            "kind": 3,
            "startTimeUnixNano": ns(self.start_ms),
            "endTimeUnixNano": ns(self.start_ms + len(wire) + 1),
            "attributes": attributes,
            "status": status_field,
        }
        return [turn, *wire]

    def span(self):
        self.span_count += 1
        return digest(f"span:{self.label}:{self.span_count}", 16)

    def point(self, trace, parent, name, attributes):
        return {
            "traceId": trace,
            "spanId": self.span(),
            "parentSpanId": parent,
            "name": name,
            "kind": 1,
            "startTimeUnixNano": ns(self.start_ms + self.span_count - 1),
            "attributes": attributes,
        }

    def wire_input(self, trace, parent):
        parts = [self.part(part) for part in as_list(self.message.get("parts"))]
        metadata = self.message.get("metadata") if isinstance(self.message.get("metadata"), dict) else None
        self.capabilities = None
        data_model = None
        rest = None
        if metadata is not None:
            rest = dict(metadata)
            for key in ("a2uiClientCapabilities", "a2uiRendererCapabilities"):
                if isinstance(rest.get(key), dict):
                    self.capabilities = {**(self.capabilities or {}), **rest.pop(key)}
            models = [key for key in ("a2uiClientDataModel", "a2uiRendererDataModel") if isinstance(rest.get(key), dict)]
            if models:
                chosen = next((key for key in models if self.a2ui_versions and rest[key].get("version") == self.a2ui_versions[0]), models[0])
                data_model = rest.pop(chosen)
        attributes = {"a2ui.event.kind": "wire_input", "a2ui.wire.message": {"role": "user", "parts": parts}}
        if data_model is not None:
            attributes["a2ui.wire.data_model"] = data_model
        if self.capabilities is not None:
            attributes["a2ui.wire.capabilities"] = self.capabilities
        if rest:
            attributes["a2ui.wire.metadata"] = rest
        return self.point(trace, parent, "wire_input", attributes)

    def wire_output(self, trace, parent, delivery):
        parts, metadata = [], None
        if isinstance(delivery, dict) and "error" in delivery:
            error = delivery["error"]
            self.fail(error["message"] if isinstance(error, dict) and isinstance(error.get("message"), str) else "JSON-RPC error")
        elif isinstance(delivery, dict) and "result" in delivery:
            reply = read_reply(delivery["result"], self.version)
            if reply is not None:
                parts, metadata = self.follow(reply)
        attributes = {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [self.part(part) for part in parts]},
        }
        if metadata is not None:
            attributes["a2ui.wire.metadata"] = metadata
        return self.point(trace, parent, "wire_output", attributes)

    def follow(self, reply):
        """Notes the reply's state and conversation; returns the parts the agent authored and their carrier's metadata."""
        kind = reply["kind"]
        value = reply["value"]
        if kind == "message":
            self.saw_message = True
            self.note_conversation(value.get("contextId"))
            if value.get("role") in ("user", "ROLE_USER"):
                return [], None
            return as_list(value.get("parts")), metadata_of(value)
        status = value.get("status") if isinstance(value.get("status"), dict) else {}
        self.note_conversation(value.get("contextId"))
        if kind in ("task", "status-update"):
            state = read_state(status.get("state"), self.version)
            if state is not None:
                self.state = state
        if kind == "status-update":
            message = status.get("message")
            if not isinstance(message, dict) or message.get("role") in ("user", "ROLE_USER"):
                return [], None
            return as_list(message.get("parts")), metadata_of(message)
        if kind == "artifact-update":
            artifact = value.get("artifact") if isinstance(value.get("artifact"), dict) else {}
            return as_list(artifact.get("parts")), metadata_of(artifact)
        # A task: its history after this turn's request message, then its status message, then its artifacts.
        history = [message for message in as_list(value.get("history")) if isinstance(message, dict)]
        request_id = self.message.get("messageId")
        after = next((index + 1 for index, message in enumerate(history) if request_id is not None and message.get("messageId") == request_id), 0)
        messages = history[after:]
        status_message = status.get("message")
        if isinstance(status_message, dict) and not any(same_message(message, status_message) for message in messages):
            messages.append(status_message)
        parts = [part for message in messages if message.get("role") not in ("user", "ROLE_USER") for part in as_list(message.get("parts"))]
        for artifact in as_list(value.get("artifacts")):
            if isinstance(artifact, dict):
                parts.extend(as_list(artifact.get("parts")))
        return parts, metadata_of(value)

    def note_conversation(self, context_id):
        if self.conversation_id is None and isinstance(context_id, str):
            self.conversation_id = context_id

    def fail(self, message):
        if self.error is None:
            self.error = message

    def outcome(self):
        if self.error is not None:
            return "failed"
        if self.state is not None:
            return OUTCOMES[self.state]
        return "completed" if self.saw_message else "failed"

    def part(self, part):
        """One A2A part as a turn record part (the 2.2 spec's decision on parts)."""
        if not isinstance(part, dict):
            return {"type": "unknown", "content": part}
        metadata = part.get("metadata") if isinstance(part.get("metadata"), dict) else None
        if self.version == "0.3":
            kind = part.get("kind")
            if kind == "text":
                return with_extras({"type": "text", "content": part.get("text")}, metadata)
            if kind == "file":
                file = part.get("file") if isinstance(part.get("file"), dict) else {}
                return file_part(part, file.get("bytes"), file.get("uri"), file.get("mimeType"), file.get("name"), metadata)
            if kind == "data":
                return self.data_part(part.get("data"), part.get("mimeType"), metadata, None)
            return {"type": kind if isinstance(kind, str) else "unknown", "content": part}
        if "text" in part:
            return with_extras({"type": "text", "content": part["text"]}, metadata, mime_type=part.get("mediaType"))
        if "raw" in part or "url" in part:
            return file_part(part, part.get("raw"), part.get("url"), part.get("mediaType"), part.get("filename"), metadata)
        if "data" in part:
            return self.data_part(part["data"], part.get("mediaType"), metadata, part.get("filename"))
        return {"type": "unknown", "content": part}

    def data_part(self, data, part_mime_type, metadata, name):
        in_metadata = is_a2ui_mime_type(metadata.get("mimeType")) if metadata else False
        if is_a2ui_mime_type(part_mime_type) or in_metadata:
            messages = data if isinstance(data, list) else [data]
            self.a2ui_versions.extend(
                message["version"] for message in messages if isinstance(message, dict) and isinstance(message.get("version"), str)
            )
            rest = {key: value for key, value in metadata.items() if key != "mimeType"} if in_metadata else metadata
            return with_extras({"type": "a2ui", "content": data}, rest, name)
        return with_extras({"type": "data", "content": data}, metadata, name, part_mime_type)


def file_part(part, data, uri, mime_type, name, metadata):
    mime_type = mime_type if isinstance(mime_type, str) else None
    top = mime_type.split("/")[0].strip().lower() if mime_type else None
    modality = top if top in ("image", "video", "audio") else "document"
    if isinstance(data, str):
        result = {"type": "blob", "modality": modality}
        if mime_type:
            result["mime_type"] = mime_type
        result["content"] = data
        return with_extras(result, metadata, name)
    if isinstance(uri, str):
        result = {"type": "uri", "modality": modality}
        if mime_type:
            result["mime_type"] = mime_type
        result["uri"] = uri
        return with_extras(result, metadata, name)
    return {"type": "unknown", "content": part}


def with_extras(result, metadata, name=None, mime_type=None):
    if isinstance(mime_type, str) and "mime_type" not in result:
        result["mime_type"] = mime_type
    if isinstance(name, str):
        result["name"] = name
    if metadata:
        result["metadata"] = metadata
    return result


def read_reply(result, version):
    """The reply's kind and the object that holds it, in A2A 0.3's shape or A2A 1.0's."""
    if not isinstance(result, dict):
        return None
    if version == "0.3":
        kind = result.get("kind")
        return {"kind": kind, "value": result} if kind in ("message", "task", "status-update", "artifact-update") else None
    for key, kind in (("message", "message"), ("task", "task"), ("statusUpdate", "status-update"), ("artifactUpdate", "artifact-update")):
        if isinstance(result.get(key), dict):
            return {"kind": kind, "value": result[key]}
    return None


def read_state(value, version):
    if not isinstance(value, str):
        return None
    if version == "0.3":
        return value if value in OUTCOMES else None
    return V10_STATES.get(value)


def same_message(a, b):
    if isinstance(a.get("messageId"), str) and isinstance(b.get("messageId"), str):
        return a["messageId"] == b["messageId"]
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def metadata_of(value):
    return value.get("metadata") if isinstance(value.get("metadata"), dict) else None


def is_a2ui_mime_type(value):
    return isinstance(value, str) and value.split(";")[0].strip().lower() in A2UI_MIME_TYPES


def extension_versions(value):
    versions = []
    for uri in (value or "").split(","):
        match = A2UI_EXTENSION.match(uri.strip())
        if match and match.group(1) not in versions:
            versions.append(match.group(1))
    return versions


def sse_data(text):
    """The data of each server-sent event, by the WHATWG event stream rules; an unfinished event is dropped."""
    out, data, has_data = [], [], False
    for line in re.split(r"\r\n|\r|\n", text):
        if line == "":
            if has_data:
                out.append("\n".join(data))
            data, has_data = [], False
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data.append(value)
            has_data = True
    return out


def header(response, name):
    values = [item["value"] for item in response.get("headers", []) if item["name"].lower() == name]
    return ", ".join(values) if values else None


def parse_json(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def as_list(value):
    return value if isinstance(value, list) else []


def only(values):
    return values[0] if len(values) == 1 else None


def digest(label, length):
    return hashlib.sha256(label.encode()).hexdigest()[:length]


def ns(ms):
    return str(T0 + ms * 1_000_000)


if __name__ == "__main__":
    main()
