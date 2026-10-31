"""Writes the expected record of each model capture recording: the turn record v0.1 file the model proxy
must write from a HAR file of model API traffic, by the rules of
_dev/docs/spec/task-5.2-redirection-placement-model-proxy.md.

It shares no code with the model proxy. Trace ids, span ids, times, where the request went and the
headers the replay adds are stand-ins or left out, which the model capture suite's comparison skips.
From the repository root:

    python3 -I _dev/tools/write_model_capture_records.py conformance/test_data/model_capture/v0_1/*/*.har

Each <conversation>.har gets its expected record beside it, as <conversation>.json: one turn holding a
stand-in turn event and one model call event per exchange, in order. With --raw, the record is written
as <conversation>_raw.json with every call recorded raw, as calls to a host that is not a provider's
are.
"""

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

WRITER_NAME = "a2ui-spectra"
WRITER_VERSION = "0.0.0"

GEMINI_HOST = "generativelanguage.googleapis.com"
OPENAI_HOST = "api.openai.com"
ANTHROPIC_HOST = "api.anthropic.com"

REMOVED = "REMOVED"
CREDENTIAL_REQUEST_HEADERS = {"authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "api-key", "cookie"}
CREDENTIAL_RESPONSE_HEADERS = {"set-cookie"}
CREDENTIAL_PARAMETERS = {"key", "api_key", "access_token"}
CREDENTIAL_NAME = re.compile(r"key|token|secret|auth|password|cookie", re.IGNORECASE)

# Headers that belong to one connection, which a proxy does not pass on.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"}

GEMINI_PATH = re.compile(r"^(?:/v1[a-z0-9]*)?/models/([^/:]+):(generateContent|streamGenerateContent)$")

# The stand-in clock: 2026-10-24T00:00:00Z.
T0 = 1792800000 * 10**9


def main():
    raw = "--raw" in sys.argv[1:]
    for name in (arg for arg in sys.argv[1:] if arg != "--raw"):
        har = Path(name)
        stem = f"{har.stem}_raw" if raw else har.stem
        record = expected_record(json.loads(har.read_text(encoding="utf-8")), stem, raw)
        out = har.with_name(f"{stem}.json")
        out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        calls = len(record["turns"][0]["events"]) - 1
        print(f"{out}: {calls} model calls{' recorded raw' if raw else ''}")


def expected_record(har, label, raw):
    trace = digest(f"trace:{label}", 32)
    turn_span = digest(f"span:{label}:turn", 16)
    entries = har["log"]["entries"]
    events = []
    for index, entry in enumerate(entries):
        events.append(model_call(entry, trace, turn_span, f"{label}:{index}", index, raw))
    turn = {
        "traceId": trace,
        "spanId": turn_span,
        "name": "invoke_agent",
        "kind": 3,
        "startTimeUnixNano": ns(0),
        "endTimeUnixNano": ns(len(entries) * 1000 + 1000),
        "attributes": {
            "a2ui.event.kind": "turn",
            "gen_ai.operation.name": "invoke_agent",
            "a2ui.turn.outcome": "completed",
            "a2ui.turn.capture_paths": ["wire", "model_proxy"],
            "a2ui.turn.writer.name": WRITER_NAME,
            "a2ui.turn.writer.version": WRITER_VERSION,
        },
        "status": {"code": 1},
    }
    return {"version": "v0.1", "turns": [{"events": [turn, *events]}]}


def model_call(entry, trace, parent, label, index, raw):
    request, response = entry["request"], entry["response"]
    url = urlsplit(request["url"])
    method = request["method"]
    reader = None if raw else reader_for(method, url.hostname or "", url.path, dict(parse_qsl(url.query)))
    request_text = request.get("postData", {}).get("text")
    request_json = parse_json(request_text)

    attributes = {"a2ui.event.kind": "model_call"}
    if reader is not None:
        attributes.update(reader.request(url.path, request_json))
    attributes["http.request.method"] = method
    attributes["url.full"] = remove_from_url(request["url"])
    for name, values in header_lists(request["headers"], "request").items():
        attributes[f"http.request.header.{name}"] = values
    content_type = header_value(request["headers"], "content-type")
    if request_text is not None and body_kept(content_type):
        attributes["a2ui.http.request.body"] = body_value(request_text)

    status = response["status"]
    response_headers = header_lists(response["headers"], "response")
    for name, values in response_headers.items():
        attributes[f"http.response.header.{name}"] = values
    attributes["http.response.status_code"] = status
    response_type = header_value(response["headers"], "content-type") or ""
    streamed = response_type.lower().startswith("text/event-stream")
    text = response["content"].get("text", "")
    span_events = []
    failure = None
    if streamed:
        chunks = sse_events(text)
        for chunk in chunks:
            chunk_attributes = {"a2ui.http.response.chunk.body": body_value(chunk["data"])}
            if "event" in chunk:
                chunk_attributes["a2ui.http.response.chunk.event"] = chunk["event"]
            if "id" in chunk:
                chunk_attributes["a2ui.http.response.chunk.id"] = chunk["id"]
            span_events.append({"timeUnixNano": ns(index * 1000 + 100 + len(span_events)), "name": "a2ui.http.response.chunk", "attributes": chunk_attributes})
    elif body_kept(response_type):
        attributes["a2ui.http.response.body"] = body_value(text)

    if reader is not None:
        if status >= 400:
            message = reader.error_message(parse_json(text))
            failure = {"type": str(status), **({"message": message} if message else {})}
        elif streamed:
            read, stream_error = reader.stream([{"event": c.get("event"), "data": body_value(c["data"])} for c in chunks])
            attributes.update(read)
            failure = stream_error
        elif text:
            attributes.update(reader.response(parse_json(text)))
    elif status >= 400:
        failure = {"type": str(status)}
    if response.get("_brokenOff"):
        failure = failure or {"type": "ECONNRESET", "message": "The provider's response broke before it ended."}
    if failure is not None:
        attributes["error.type"] = failure["type"]

    operation = attributes.get("gen_ai.operation.name")
    model = attributes.get("gen_ai.request.model")
    name = (f"{operation} {model}" if model else operation) if operation else method
    event = {
        "traceId": trace,
        "spanId": digest(f"span:{label}", 16),
        "parentSpanId": parent,
        "name": name,
        "kind": 3,
        "startTimeUnixNano": ns(index * 1000 + 100),
        "endTimeUnixNano": ns(index * 1000 + 900),
        "attributes": attributes,
    }
    if span_events:
        event["events"] = span_events
    if failure is None:
        event["status"] = {"code": 1}
    else:
        event["status"] = {"code": 2, **({"message": failure["message"]} if failure.get("message") else {})}
    return event


# --- The exchange ---


def header_lists(headers, side):
    lists = {}
    for item in headers:
        name = item["name"].lower()
        if name in HOP_BY_HOP or name in ("host", "content-length"):
            continue
        credential = is_credential_request_header(name) if side == "request" else name in CREDENTIAL_RESPONSE_HEADERS
        lists.setdefault(name, []).append(REMOVED if credential else item["value"])
    return lists


def header_value(headers, name):
    values = [item["value"] for item in headers if item["name"].lower() == name]
    return ", ".join(values) if values else None


def is_credential_request_header(name):
    return name in CREDENTIAL_REQUEST_HEADERS or CREDENTIAL_NAME.search(name) is not None


def is_credential_parameter(name):
    return name.lower() in CREDENTIAL_PARAMETERS or CREDENTIAL_NAME.search(name) is not None


def remove_from_url(url):
    parts = urlsplit(url)
    netloc = parts.hostname or ""
    if parts.port:
        netloc += f":{parts.port}"
    if parts.username is not None or parts.password is not None:
        netloc = f"{REMOVED}@{netloc}"
    query = "&".join(
        f"{pair.split('=', 1)[0]}={REMOVED}" if is_credential_parameter(pair.split('=', 1)[0]) else pair
        for pair in parts.query.split("&")
        if pair
    )
    return urlunsplit((parts.scheme, netloc, parts.path, query, parts.fragment))


def body_kept(content_type):
    kind = (content_type or "").split(";")[0].strip().lower()
    return kind == "application/json" or kind.endswith("+json") or kind.startswith("text/") or kind == "application/x-www-form-urlencoded"


def body_value(text):
    parsed = parse_json(text)
    return text if parsed is None and text != "null" else parsed


def sse_events(text):
    """Each server-sent event of a stream, by the WHATWG rules; an unfinished event is dropped."""
    events, data, event_name, event_id, has_data = [], [], None, None, False
    for line in re.split(r"\r\n|\r|\n", text):
        if line == "":
            if has_data:
                item = {"data": "\n".join(data)}
                if event_name is not None:
                    item["event"] = event_name
                if event_id is not None:
                    item["id"] = event_id
                events.append(item)
            data, event_name, event_id, has_data = [], None, None, False
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data.append(value)
            has_data = True
        elif field == "event":
            event_name = value
        elif field == "id" and "\0" not in value:
            event_id = value
    return events


# --- The readers ---


def reader_for(method, host, path, query):
    if method != "POST":
        return None
    host = host.lower()
    gemini = GEMINI_PATH.match(path)
    if gemini and host == GEMINI_HOST:
        if gemini.group(2) == "streamGenerateContent" and query.get("alt") != "sse":
            return None
        return GeminiReader()
    if host == OPENAI_HOST:
        if path == "/v1/chat/completions":
            return OpenAiChatReader()
        if path == "/v1/responses":
            return OpenAiResponsesReader()
    if host == ANTHROPIC_HOST and path == "/v1/messages":
        return AnthropicReader()
    return None


def defined(mapping):
    return {key: value for key, value in mapping.items() if value is not None}


def as_int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def as_num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def as_str(value):
    return value if isinstance(value, str) else None


def as_list(value):
    return value if isinstance(value, list) else []


def as_str_list(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    return None


def modality_of(mime_type):
    top = (mime_type or "").split("/")[0].strip().lower()
    return top if top in ("image", "video", "audio") else "document"


def tool_call(call_id, name, arguments):
    return defined({"type": "tool_call", "id": call_id, "name": name, "arguments": arguments})


def tool_result(call_id, response):
    return defined({"type": "tool_call_response", "id": call_id, "response": response})


def parsed_arguments(value):
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def data_or_uri(url, modality):
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", url, re.DOTALL)
    if match:
        return defined({"type": "blob", "mime_type": match.group(1), "modality": modality, "content": match.group(3)})
    return {"type": "uri", "modality": modality, "uri": url}


def finish_reasons_of(messages):
    reasons = [message["finish_reason"] for message in messages if "finish_reason" in message]
    return reasons or None


class GeminiReader:
    FINISH = {
        "STOP": "stop", "MAX_TOKENS": "length", "SAFETY": "content_filter", "RECITATION": "content_filter",
        "BLOCKLIST": "content_filter", "PROHIBITED_CONTENT": "content_filter", "SPII": "content_filter",
        "IMAGE_SAFETY": "content_filter", "IMAGE_PROHIBITED_CONTENT": "content_filter", "IMAGE_RECITATION": "content_filter",
        "LANGUAGE": "error", "MALFORMED_FUNCTION_CALL": "error", "UNEXPECTED_TOOL_CALL": "error", "OTHER": "error",
    }

    def finish(self, value):
        return (self.FINISH.get(value) or "error") if isinstance(value, str) else None

    # A request is read in both spellings, the camel case and the snake case, as the Gemini API takes
    # either; a response in camel case, as the API answers.
    @staticmethod
    def snake(name):
        return re.sub(r"[A-Z]", lambda letter: "_" + letter.group(0).lower(), name)

    def field(self, mapping, name, request):
        value = mapping.get(name)
        if value is None and request:
            value = mapping.get(self.snake(name))
        return value

    def dict_field(self, mapping, name, request):
        value = self.field(mapping, name, request)
        return value if isinstance(value, dict) else None

    PART_FLAGS = ("thought", "thoughtSignature", "thought_signature")

    def parts(self, value, request):
        out = []
        for part in as_list(value):
            if not isinstance(part, dict):
                continue
            call = self.dict_field(part, "functionCall", request)
            response = self.dict_field(part, "functionResponse", request)
            inline = self.dict_field(part, "inlineData", request)
            file = self.dict_field(part, "fileData", request)
            if isinstance(part.get("text"), str):
                out.append({"type": "reasoning" if part.get("thought") is True else "text", "content": part["text"]})
            elif call is not None:
                out.append(tool_call(as_str(call.get("id")), as_str(call.get("name")) or "", call.get("args")))
            elif response is not None:
                out.append(defined({**tool_result(as_str(response.get("id")), response.get("response")), "name": as_str(response.get("name"))}))
            elif inline is not None:
                mime = as_str(self.field(inline, "mimeType", request))
                out.append(defined({"type": "blob", "mime_type": mime, "modality": modality_of(mime), "content": as_str(inline.get("data")) or ""}))
            elif file is not None:
                mime = as_str(self.field(file, "mimeType", request))
                out.append(defined({"type": "uri", "mime_type": mime, "modality": modality_of(mime), "uri": as_str(self.field(file, "fileUri", request)) or ""}))
            else:
                keys = [key for key in part if key not in self.PART_FLAGS]
                out.append({"type": keys[0] if keys else "unknown", "content": part})
        return out

    def role(self, value):
        return "assistant" if value == "model" else (as_str(value) or "user")

    def tools(self, value):
        definitions = []
        for tool in as_list(value):
            if not isinstance(tool, dict):
                continue
            for declaration in as_list(self.field(tool, "functionDeclarations", True)):
                if isinstance(declaration, dict):
                    parameters = declaration.get("parameters")
                    if parameters is None:
                        parameters = self.field(declaration, "parametersJsonSchema", True)
                    definitions.append(defined({"type": "function", "name": as_str(declaration.get("name")) or "", "description": as_str(declaration.get("description")), "parameters": parameters}))
            for key in tool:
                if key not in ("functionDeclarations", "function_declarations"):
                    definitions.append({"type": key, "name": key})
        return definitions or None

    def usage(self, value):
        if not isinstance(value, dict):
            return {}
        prompt, tool_use = as_int(value.get("promptTokenCount")), as_int(value.get("toolUsePromptTokenCount"))
        candidates, thoughts = as_int(value.get("candidatesTokenCount")), as_int(value.get("thoughtsTokenCount"))
        return {
            "gen_ai.usage.input_tokens": sum_present(prompt, tool_use),
            "gen_ai.usage.cache_read.input_tokens": as_int(value.get("cachedContentTokenCount")),
            "gen_ai.usage.output_tokens": sum_present(candidates, thoughts),
            "gen_ai.usage.reasoning.output_tokens": thoughts,
        }

    def request(self, path, body):
        match = GEMINI_PATH.match(path)
        body = body if isinstance(body, dict) else {}
        config = self.dict_field(body, "generationConfig", True) or {}
        setting = lambda name: self.field(config, name, True)
        instruction = self.dict_field(body, "systemInstruction", True)
        system = self.parts(instruction.get("parts"), True) if instruction is not None else None
        messages = [{"role": self.role(c.get("role")), "parts": self.parts(c.get("parts"), True)} for c in as_list(body.get("contents")) if isinstance(c, dict)]
        mime = as_str(setting("responseMimeType"))
        output_type = None if mime is None else ("json" if "json" in mime.lower() else "text" if mime.lower().startswith("text/") else mime)
        return defined({
            "gen_ai.operation.name": "generate_content",
            "gen_ai.provider.name": "gcp.gemini",
            "gen_ai.request.model": match.group(1) if match else None,
            "gen_ai.request.stream": bool(match and match.group(2) == "streamGenerateContent"),
            "gen_ai.request.temperature": as_num(setting("temperature")),
            "gen_ai.request.top_p": as_num(setting("topP")),
            "gen_ai.request.top_k": as_int(setting("topK")),
            "gen_ai.request.max_tokens": as_int(setting("maxOutputTokens")),
            "gen_ai.request.stop_sequences": as_str_list(setting("stopSequences")),
            "gen_ai.request.choice.count": as_int(setting("candidateCount")),
            "gen_ai.request.seed": as_int(setting("seed")),
            "gen_ai.request.frequency_penalty": as_num(setting("frequencyPenalty")),
            "gen_ai.request.presence_penalty": as_num(setting("presencePenalty")),
            "gen_ai.output.type": output_type,
            "gen_ai.system_instructions": system or None,
            "gen_ai.input.messages": messages or None,
            "gen_ai.tool.definitions": self.tools(body.get("tools")),
        })

    def candidate_message(self, candidate):
        content = candidate.get("content") if isinstance(candidate.get("content"), dict) else {}
        return defined({"role": self.role(content.get("role", "model")), "parts": self.parts(content.get("parts"), False), "finish_reason": self.finish(candidate.get("finishReason"))})

    def response_attributes(self, body, messages):
        return defined({
            "gen_ai.response.id": as_str(body.get("responseId")),
            "gen_ai.response.model": as_str(body.get("modelVersion")),
            "gen_ai.response.finish_reasons": finish_reasons_of(messages),
            **self.usage(body.get("usageMetadata")),
            "gen_ai.output.messages": messages or None,
        })

    def response(self, body):
        if not isinstance(body, dict):
            return {}
        return self.response_attributes(body, [self.candidate_message(c) for c in as_list(body.get("candidates")) if isinstance(c, dict)])

    def stream(self, chunks):
        merged, candidates, error = {}, {}, None
        for chunk in chunks:
            data = chunk["data"]
            if not isinstance(data, dict):
                continue
            if isinstance(data.get("error"), dict):
                if error is None:
                    error = {"type": as_str(data["error"].get("status")) or str(data["error"].get("code", "error")), "message": as_str(data["error"].get("message"))}
                continue
            for key in ("responseId", "modelVersion", "usageMetadata"):
                if key in data:
                    merged[key] = data[key]
            for candidate in as_list(data.get("candidates")):
                if not isinstance(candidate, dict):
                    continue
                slot = candidates.setdefault(as_int(candidate.get("index")) or 0, {"parts": [], "finish": None})
                content = candidate.get("content") if isinstance(candidate.get("content"), dict) else {}
                for part in self.parts(content.get("parts"), False):
                    if part["type"] == "text" and slot["parts"] and slot["parts"][-1]["type"] == "text":
                        slot["parts"][-1]["content"] += part["content"]
                    else:
                        slot["parts"].append(part)
                if "finishReason" in candidate:
                    slot["finish"] = candidate["finishReason"]
        messages = [defined({"role": "assistant", "parts": slot["parts"], "finish_reason": self.finish(slot["finish"])}) for _, slot in sorted(candidates.items())]
        return self.response_attributes(merged, messages), error

    def error_message(self, body):
        return as_str(body["error"].get("message")) if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


def sum_present(*counts):
    present = [count for count in counts if count is not None]
    return sum(present) if present else None


OPENAI_FINISH = {"stop": "stop", "length": "length", "content_filter": "content_filter", "tool_calls": "tool_call", "function_call": "tool_call"}


def openai_finish(value):
    return (OPENAI_FINISH.get(value) or "error") if isinstance(value, str) else None


def output_type_of(fmt):
    kind = as_str(fmt.get("type")) if isinstance(fmt, dict) else as_str(fmt)
    if kind is None:
        return None
    return "json" if kind in ("json_object", "json_schema") else kind


def openai_usage(value, input_key, output_key, input_details, output_details):
    if not isinstance(value, dict):
        return {}
    in_details = value.get(input_details) if isinstance(value.get(input_details), dict) else {}
    out_details = value.get(output_details) if isinstance(value.get(output_details), dict) else {}
    return {
        "gen_ai.usage.input_tokens": as_int(value.get(input_key)),
        "gen_ai.usage.output_tokens": as_int(value.get(output_key)),
        "gen_ai.usage.cache_read.input_tokens": as_int(in_details.get("cached_tokens")),
        "gen_ai.usage.reasoning.output_tokens": as_int(out_details.get("reasoning_tokens")),
    }


class OpenAiChatReader:
    def content_parts(self, content):
        if isinstance(content, str):
            return [{"type": "text", "content": content}]
        out = []
        for part in as_list(content):
            if not isinstance(part, dict):
                continue
            kind = part.get("type")
            if kind == "text":
                out.append({"type": "text", "content": as_str(part.get("text")) or ""})
            elif kind == "image_url":
                url = part["image_url"].get("url") if isinstance(part.get("image_url"), dict) else as_str(part.get("image_url"))
                out.append(data_or_uri(url or "", "image"))
            elif kind == "input_audio":
                audio = part.get("input_audio") if isinstance(part.get("input_audio"), dict) else {}
                fmt = as_str(audio.get("format"))
                out.append(defined({"type": "blob", "mime_type": "audio" if fmt is None else f"audio/{fmt}", "modality": "audio", "content": as_str(audio.get("data")) or ""}))
            elif kind == "refusal":
                out.append({"type": "refusal", "content": part.get("refusal")})
            else:
                out.append({"type": as_str(kind) or "unknown", "content": part})
        return out

    def tool_calls(self, value):
        out = []
        for call in as_list(value):
            if isinstance(call, dict):
                fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                out.append(tool_call(as_str(call.get("id")), as_str(fn.get("name")) or "", parsed_arguments(fn.get("arguments"))))
        return out

    def tools(self, value):
        definitions = []
        for tool in as_list(value):
            if not isinstance(tool, dict):
                continue
            if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                fn = tool["function"]
                definitions.append(defined({"type": "function", "name": as_str(fn.get("name")) or "", "description": as_str(fn.get("description")), "parameters": fn.get("parameters")}))
            else:
                kind = as_str(tool.get("type")) or "unknown"
                definitions.append({"type": kind, "name": kind})
        return definitions or None

    def assistant_message(self, message, finish):
        parts = []
        reasoning = as_str(message.get("reasoning")) or as_str(message.get("reasoning_content"))
        if reasoning:
            parts.append({"type": "reasoning", "content": reasoning})
        content = message.get("content")
        if isinstance(content, str) and content != "":
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            parts.extend(self.content_parts(content))
        if isinstance(message.get("refusal"), str):
            parts.append({"type": "refusal", "content": message["refusal"]})
        parts.extend(self.tool_calls(message.get("tool_calls")))
        return defined({"role": "assistant", "parts": parts, "finish_reason": openai_finish(finish)})

    def request(self, path, body):
        body = body if isinstance(body, dict) else {}
        system, messages = [], []
        for message in as_list(body.get("messages")):
            if not isinstance(message, dict):
                continue
            role = as_str(message.get("role")) or "user"
            if role in ("system", "developer"):
                system.extend(self.content_parts(message.get("content")))
            elif role == "assistant":
                content = message.get("content")
                parts = [] if content in (None, "") else self.content_parts(content)
                messages.append({"role": role, "parts": parts + self.tool_calls(message.get("tool_calls"))})
            elif role in ("tool", "function"):
                messages.append({"role": "tool", "parts": [tool_result(as_str(message.get("tool_call_id")), message.get("content"))]})
            else:
                messages.append(defined({"role": role, "parts": self.content_parts(message.get("content")), "name": as_str(message.get("name"))}))
        max_tokens = as_int(body.get("max_completion_tokens"))
        if max_tokens is None:
            max_tokens = as_int(body.get("max_tokens"))
        return defined({
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "openai",
            "openai.api.type": "chat_completions",
            "gen_ai.request.model": as_str(body.get("model")),
            "gen_ai.request.stream": body.get("stream") is True,
            "gen_ai.request.temperature": as_num(body.get("temperature")),
            "gen_ai.request.top_p": as_num(body.get("top_p")),
            "gen_ai.request.max_tokens": max_tokens,
            "gen_ai.request.stop_sequences": as_str_list(body.get("stop")),
            "gen_ai.request.choice.count": as_int(body.get("n")),
            "gen_ai.request.seed": as_int(body.get("seed")),
            "gen_ai.request.frequency_penalty": as_num(body.get("frequency_penalty")),
            "gen_ai.request.presence_penalty": as_num(body.get("presence_penalty")),
            "gen_ai.output.type": output_type_of(body.get("response_format")),
            "gen_ai.system_instructions": system or None,
            "gen_ai.input.messages": messages or None,
            "gen_ai.tool.definitions": self.tools(body.get("tools")),
        })

    def response_attributes(self, body, messages):
        return defined({
            "gen_ai.response.id": as_str(body.get("id")),
            "gen_ai.response.model": as_str(body.get("model")),
            "gen_ai.response.finish_reasons": finish_reasons_of(messages),
            **openai_usage(body.get("usage"), "prompt_tokens", "completion_tokens", "prompt_tokens_details", "completion_tokens_details"),
            "gen_ai.output.messages": messages or None,
        })

    def response(self, body):
        if not isinstance(body, dict):
            return {}
        messages = [self.assistant_message(c["message"], c.get("finish_reason")) for c in as_list(body.get("choices")) if isinstance(c, dict) and isinstance(c.get("message"), dict)]
        return self.response_attributes(body, messages)

    def stream(self, chunks):
        merged, choices, error = {}, {}, None
        for chunk in chunks:
            data = chunk["data"]
            if not isinstance(data, dict):
                continue
            if isinstance(data.get("error"), dict):
                if error is None:
                    err = data["error"]
                    error = {"type": as_str(err.get("type")) or as_str(err.get("code")) or "error", "message": as_str(err.get("message"))}
                continue
            for key in ("id", "model", "usage"):
                if data.get(key) is not None:
                    merged[key] = data[key]
            for choice in as_list(data.get("choices")):
                if not isinstance(choice, dict):
                    continue
                slot = choices.setdefault(as_int(choice.get("index")) or 0, {"content": "", "reasoning": "", "refusal": "", "calls": {}, "finish": None})
                delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
                if isinstance(delta.get("content"), str):
                    slot["content"] += delta["content"]
                reasoning = as_str(delta.get("reasoning")) or as_str(delta.get("reasoning_content"))
                if reasoning is not None:
                    slot["reasoning"] += reasoning
                if isinstance(delta.get("refusal"), str):
                    slot["refusal"] += delta["refusal"]
                for call in as_list(delta.get("tool_calls")):
                    if not isinstance(call, dict):
                        continue
                    entry = slot["calls"].setdefault(as_int(call.get("index")) or 0, {"id": None, "name": "", "arguments": ""})
                    fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                    if isinstance(call.get("id"), str):
                        entry["id"] = call["id"]
                    if isinstance(fn.get("name"), str):
                        entry["name"] += fn["name"]
                    if isinstance(fn.get("arguments"), str):
                        entry["arguments"] += fn["arguments"]
                if choice.get("finish_reason") is not None:
                    slot["finish"] = choice["finish_reason"]
        messages = []
        for _, slot in sorted(choices.items()):
            message = {"content": slot["content"], "tool_calls": [{"id": call["id"], "function": {"name": call["name"], "arguments": call["arguments"]}} for _, call in sorted(slot["calls"].items())]}
            if slot["reasoning"]:
                message["reasoning"] = slot["reasoning"]
            if slot["refusal"]:
                message["refusal"] = slot["refusal"]
            messages.append(self.assistant_message(message, slot["finish"]))
        return self.response_attributes(merged, messages), error

    def error_message(self, body):
        return as_str(body["error"].get("message")) if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


class OpenAiResponsesReader:
    def content_parts(self, content):
        if isinstance(content, str):
            return [{"type": "text", "content": content}]
        out = []
        for part in as_list(content):
            if not isinstance(part, dict):
                continue
            kind = part.get("type")
            if kind in ("input_text", "output_text"):
                out.append({"type": "text", "content": as_str(part.get("text")) or ""})
            elif kind == "input_image":
                url = as_str(part.get("image_url"))
                out.append(data_or_uri(url, "image") if url is not None else {"type": "input_image", "content": part})
            elif kind == "refusal":
                out.append({"type": "refusal", "content": part.get("refusal")})
            else:
                out.append({"type": as_str(kind) or "unknown", "content": part})
        return out

    def summary_text(self, item):
        return "\n".join(as_str(entry.get("text")) or "" for entry in as_list(item.get("summary")) if isinstance(entry, dict))

    def item_message(self, item):
        kind = as_str(item.get("type")) or ("message" if "role" in item else None)
        if kind == "message":
            return {"role": as_str(item.get("role")) or "user", "parts": self.content_parts(item.get("content"))}
        if kind == "function_call":
            return {"role": "assistant", "parts": [tool_call(as_str(item.get("call_id")) or as_str(item.get("id")), as_str(item.get("name")) or "", parsed_arguments(item.get("arguments")))]}
        if kind == "function_call_output":
            return {"role": "tool", "parts": [tool_result(as_str(item.get("call_id")), item.get("output"))]}
        if kind == "reasoning":
            return {"role": "assistant", "parts": [{"type": "reasoning", "content": self.summary_text(item)}]}
        if kind is None:
            return None
        return {"role": "assistant", "parts": [{"type": kind, "content": item}]}

    def tools(self, value):
        definitions = []
        for tool in as_list(value):
            if not isinstance(tool, dict):
                continue
            if tool.get("type") == "function":
                definitions.append(defined({"type": "function", "name": as_str(tool.get("name")) or "", "description": as_str(tool.get("description")), "parameters": tool.get("parameters")}))
            else:
                kind = as_str(tool.get("type")) or "unknown"
                definitions.append({"type": kind, "name": as_str(tool.get("name")) or kind})
        return definitions or None

    def request(self, path, body):
        body = body if isinstance(body, dict) else {}
        system, messages = [], []
        if isinstance(body.get("instructions"), str):
            system.append({"type": "text", "content": body["instructions"]})
        if isinstance(body.get("input"), str):
            messages.append({"role": "user", "parts": [{"type": "text", "content": body["input"]}]})
        for item in as_list(body.get("input")):
            if not isinstance(item, dict):
                continue
            message = self.item_message(item)
            if message is None:
                continue
            if message["role"] in ("system", "developer"):
                system.extend(message["parts"])
            else:
                messages.append(message)
        text = body.get("text") if isinstance(body.get("text"), dict) else {}
        return defined({
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "openai",
            "openai.api.type": "responses",
            "gen_ai.request.model": as_str(body.get("model")),
            "gen_ai.request.stream": body.get("stream") is True,
            "gen_ai.request.temperature": as_num(body.get("temperature")),
            "gen_ai.request.top_p": as_num(body.get("top_p")),
            "gen_ai.request.max_tokens": as_int(body.get("max_output_tokens")),
            "gen_ai.output.type": output_type_of(text.get("format")),
            "gen_ai.system_instructions": system or None,
            "gen_ai.input.messages": messages or None,
            "gen_ai.tool.definitions": self.tools(body.get("tools")),
        })

    def finish(self, response, tool_called):
        status = response.get("status")
        if status == "completed":
            return "tool_call" if tool_called else "stop"
        if status == "incomplete":
            details = response.get("incomplete_details") if isinstance(response.get("incomplete_details"), dict) else {}
            return "content_filter" if details.get("reason") == "content_filter" else "length"
        if status in ("failed", "cancelled"):
            return "error"
        return None

    def output_message(self, response):
        parts, tool_called = [], False
        for item in as_list(response.get("output")):
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind == "message":
                parts.extend(self.content_parts(item.get("content")))
            elif kind == "function_call":
                tool_called = True
                parts.append(tool_call(as_str(item.get("call_id")) or as_str(item.get("id")), as_str(item.get("name")) or "", parsed_arguments(item.get("arguments"))))
            elif kind == "reasoning":
                parts.append({"type": "reasoning", "content": self.summary_text(item)})
            else:
                parts.append({"type": as_str(kind) or "unknown", "content": item})
        finish = self.finish(response, tool_called)
        if not parts and finish is None:
            return None
        return defined({"role": "assistant", "parts": parts, "finish_reason": finish})

    def response_attributes(self, response):
        message = self.output_message(response)
        return defined({
            "gen_ai.response.id": as_str(response.get("id")),
            "gen_ai.response.model": as_str(response.get("model")),
            "gen_ai.response.finish_reasons": [message["finish_reason"]] if message and "finish_reason" in message else None,
            **openai_usage(response.get("usage"), "input_tokens", "output_tokens", "input_tokens_details", "output_tokens_details"),
            "gen_ai.output.messages": [message] if message else None,
        })

    def response(self, body):
        return self.response_attributes(body) if isinstance(body, dict) else {}

    def stream(self, chunks):
        last, items, error = None, [], None
        for chunk in chunks:
            data = chunk["data"]
            if not isinstance(data, dict):
                continue
            kind = as_str(data.get("type"))
            if kind == "error":
                if error is None:
                    error = {"type": as_str(data.get("code")) or "error", "message": as_str(data.get("message"))}
                continue
            if isinstance(data.get("response"), dict):
                last = data["response"]
                if kind == "response.failed" and error is None:
                    failure = last.get("error") if isinstance(last.get("error"), dict) else {}
                    error = {"type": as_str(failure.get("code")) or "error", "message": as_str(failure.get("message"))}
            if kind == "response.output_item.done":
                items.append(data.get("item"))
        if last is None:
            return {}, error
        response = last if isinstance(last.get("output"), list) and last["output"] else {**last, "output": items}
        return self.response_attributes(response), error

    def error_message(self, body):
        return as_str(body["error"].get("message")) if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


class AnthropicReader:
    STOP = {"end_turn": "stop", "stop_sequence": "stop", "pause_turn": "stop", "max_tokens": "length", "tool_use": "tool_call", "refusal": "content_filter", "model_context_window_exceeded": "length"}

    def finish(self, value):
        return (self.STOP.get(value) or "error") if isinstance(value, str) else None

    def blocks(self, content):
        if isinstance(content, str):
            return [{"type": "text", "content": content}]
        out = []
        for block in as_list(content):
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "text":
                out.append({"type": "text", "content": as_str(block.get("text")) or ""})
            elif kind in ("image", "document"):
                source = block.get("source") if isinstance(block.get("source"), dict) else {}
                mime = as_str(source.get("media_type"))
                if source.get("type") == "base64":
                    out.append(defined({"type": "blob", "mime_type": mime, "modality": modality_of(mime), "content": as_str(source.get("data")) or ""}))
                elif source.get("type") == "url":
                    out.append(defined({"type": "uri", "mime_type": mime, "modality": modality_of(mime), "uri": as_str(source.get("url")) or ""}))
                else:
                    out.append({"type": as_str(kind) or "unknown", "content": block})
            elif kind in ("tool_use", "server_tool_use"):
                out.append(tool_call(as_str(block.get("id")), as_str(block.get("name")) or "", block.get("input")))
            elif kind == "tool_result":
                out.append(tool_result(as_str(block.get("tool_use_id")), block.get("content")))
            elif kind == "thinking":
                out.append({"type": "reasoning", "content": as_str(block.get("thinking")) or ""})
            elif kind == "redacted_thinking":
                out.append({"type": "redacted_thinking", "content": block})
            else:
                out.append({"type": as_str(kind) or "unknown", "content": block})
        return out

    def tools(self, value):
        definitions = []
        for tool in as_list(value):
            if not isinstance(tool, dict):
                continue
            if tool.get("type") in (None, "custom"):
                definitions.append(defined({"type": "function", "name": as_str(tool.get("name")) or "", "description": as_str(tool.get("description")), "parameters": tool.get("input_schema")}))
            else:
                kind = as_str(tool.get("type")) or "unknown"
                definitions.append({"type": kind, "name": as_str(tool.get("name")) or kind})
        return definitions or None

    def usage(self, value):
        if not isinstance(value, dict):
            return {}
        inp = as_int(value.get("input_tokens"))
        read, write = as_int(value.get("cache_read_input_tokens")), as_int(value.get("cache_creation_input_tokens"))
        details = value.get("output_tokens_details") if isinstance(value.get("output_tokens_details"), dict) else {}
        return {
            "gen_ai.usage.input_tokens": None if inp is None else sum_present(inp, read, write),
            "gen_ai.usage.output_tokens": as_int(value.get("output_tokens")),
            "gen_ai.usage.cache_read.input_tokens": read,
            "gen_ai.usage.cache_write.input_tokens": write,
            "gen_ai.usage.reasoning.output_tokens": as_int(details.get("thinking_tokens")),
        }

    def request(self, path, body):
        body = body if isinstance(body, dict) else {}
        system = self.blocks(body["system"]) if "system" in body else None
        messages = [{"role": as_str(m.get("role")) or "user", "parts": self.blocks(m.get("content"))} for m in as_list(body.get("messages")) if isinstance(m, dict)]
        return defined({
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": "anthropic",
            "gen_ai.request.model": as_str(body.get("model")),
            "gen_ai.request.stream": body.get("stream") is True,
            "gen_ai.request.max_tokens": as_int(body.get("max_tokens")),
            "gen_ai.request.temperature": as_num(body.get("temperature")),
            "gen_ai.request.top_p": as_num(body.get("top_p")),
            "gen_ai.request.top_k": as_int(body.get("top_k")),
            "gen_ai.request.stop_sequences": as_str_list(body.get("stop_sequences")),
            "gen_ai.system_instructions": system or None,
            "gen_ai.input.messages": messages or None,
            "gen_ai.tool.definitions": self.tools(body.get("tools")),
        })

    def response_attributes(self, message):
        finish = self.finish(message.get("stop_reason"))
        parts = self.blocks(message.get("content"))
        output = None if not parts and finish is None else [defined({"role": "assistant", "parts": parts, "finish_reason": finish})]
        return defined({
            "gen_ai.response.id": as_str(message.get("id")),
            "gen_ai.response.model": as_str(message.get("model")),
            "gen_ai.response.finish_reasons": [finish] if finish else None,
            **self.usage(message.get("usage")),
            "gen_ai.output.messages": output,
        })

    def response(self, body):
        return self.response_attributes(body) if isinstance(body, dict) else {}

    def stream(self, chunks):
        message, usage, blocks, error = {}, {}, {}, None
        for chunk in chunks:
            data = chunk["data"]
            if not isinstance(data, dict):
                continue
            kind = data.get("type")
            if kind == "error":
                if error is None:
                    failure = data.get("error") if isinstance(data.get("error"), dict) else {}
                    error = {"type": as_str(failure.get("type")) or "error", "message": as_str(failure.get("message"))}
            elif kind == "message_start" and isinstance(data.get("message"), dict):
                message.update(data["message"])
                if isinstance(data["message"].get("usage"), dict):
                    usage.update(data["message"]["usage"])
            elif kind == "content_block_start" and isinstance(data.get("content_block"), dict):
                blocks[as_int(data.get("index")) if as_int(data.get("index")) is not None else len(blocks)] = {**data["content_block"], "_json": None}
            elif kind == "content_block_delta":
                block = blocks.get(as_int(data.get("index")) or 0)
                delta = data.get("delta") if isinstance(data.get("delta"), dict) else {}
                if block is None:
                    continue
                if delta.get("type") == "text_delta":
                    block["text"] = (as_str(block.get("text")) or "") + (as_str(delta.get("text")) or "")
                elif delta.get("type") == "thinking_delta":
                    block["thinking"] = (as_str(block.get("thinking")) or "") + (as_str(delta.get("thinking")) or "")
                elif delta.get("type") == "input_json_delta":
                    block["_json"] = (block["_json"] or "") + (as_str(delta.get("partial_json")) or "")
                elif delta.get("type") == "signature_delta":
                    block["signature"] = (as_str(block.get("signature")) or "") + (as_str(delta.get("signature")) or "")
            elif kind == "message_delta":
                for key, value in (data.get("delta") or {}).items() if isinstance(data.get("delta"), dict) else []:
                    if value is not None:
                        message[key] = value
                for key, value in (data.get("usage") or {}).items() if isinstance(data.get("usage"), dict) else []:
                    if value is not None:
                        usage[key] = value
        assembled = []
        for _, block in sorted(blocks.items()):
            block = dict(block)
            partial = block.pop("_json")
            if partial is not None:
                try:
                    block["input"] = json.loads(partial)
                except ValueError:
                    block["input"] = partial
            assembled.append(block)
        return self.response_attributes({**message, "content": assembled, "usage": usage}), error

    def error_message(self, body):
        return as_str(body["error"].get("message")) if isinstance(body, dict) and isinstance(body.get("error"), dict) else None


# --- Helpers ---


def parse_json(text):
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def digest(label, length):
    return hashlib.sha256(label.encode()).hexdigest()[:length]


def ns(ms):
    return str(T0 + ms * 1_000_000)


if __name__ == "__main__":
    main()
