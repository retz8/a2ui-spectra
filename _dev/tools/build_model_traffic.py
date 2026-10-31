"""Builds the model capture recordings that come from the providers' published shapes rather than from
live traffic, as HAR 1.2 files under conformance/test_data/model_capture/v0_1/:

- openai_chat/reference_examples.har: OpenAI's Chat Completions API, in the shapes of its API reference
  (https://platform.openai.com/docs/api-reference/chat): a completion not streamed, one streamed with
  usage in the last chunk, a tool call and the request carrying its result, a completion whose usage
  reports cached_tokens, an unknown model's 404, and an error object inside a 2xx stream.
- openai_responses/reference_examples.har: OpenAI's Responses API, in the shapes of its API reference
  (https://platform.openai.com/docs/api-reference/responses): a response not streamed, one streamed to
  response.completed, a function call and the request carrying its output, a response whose usage
  reports cached_tokens, an unknown model's 404, and a stream ending in response.failed
  (https://platform.openai.com/docs/api-reference/responses-streaming/response/failed).
- anthropic/overloaded_stream.har: a Messages stream carrying an `error` event, in the shape of
  Anthropic's streaming documentation (https://docs.anthropic.com/en/docs/build-with-claude/streaming,
  "Error events").
- gemini/rate_limited.har: a 429 in Gemini's documented error shape
  (https://ai.google.dev/gemini-api/docs/troubleshooting, `{"error": {"code", "message", "status"}}`).
- openai_chat/custom_components_conversation.har and openai_responses/custom_components_conversation.har:
  the custom-components example's conversation, "Who is Alex Jordan?", as the stand-in plays it for the
  acceptance run on each OpenAI API: the requests, responses and stream events in the shapes of OpenAI's
  API reference, carrying the example's own replies from its Gemini recording of the same conversation,
  gemini/custom_components_litellm.har — the get_contact_info call, the answer, and the answer again
  after the example's validation retry — with that recording's token counts.

Every HAR carries the credential headers a client sends with the placeholder value RECORDED-CREDENTIAL,
never a key. From the repository root:

    python3 -I _dev/tools/build_model_traffic.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "conformance/test_data/model_capture/v0_1"
PLACEHOLDER = "RECORDED-CREDENTIAL"

OPENAI = "https://api.openai.com"
ANTHROPIC = "https://api.anthropic.com"
GEMINI = "https://generativelanguage.googleapis.com"


def main():
    write("openai_chat/reference_examples.har", openai_chat_entries())
    write("openai_responses/reference_examples.har", openai_responses_entries())
    write("anthropic/overloaded_stream.har", anthropic_overloaded_entries())
    write("gemini/rate_limited.har", gemini_rate_limited_entries())
    conversation = gemini_conversation("gemini/custom_components_litellm.har")
    write("openai_chat/custom_components_conversation.har", chat_conversation_entries(conversation))
    write("openai_responses/custom_components_conversation.har", responses_conversation_entries(conversation))


def write(name, entries):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    log = {"log": {"version": "1.2", "creator": {"name": "build_model_traffic.py", "version": "1"}, "entries": entries}}
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{path}: {len(entries)} exchanges")


def entry(url, request_headers, request_body, status, status_text, response_headers, response_text, started="2026-10-24T00:00:00.000Z"):
    body = json.dumps(request_body) if not isinstance(request_body, str) else request_body
    return {
        "startedDateTime": started,
        "time": 1000,
        "request": {
            "method": "POST",
            "url": url,
            "httpVersion": "HTTP/1.1",
            "cookies": [],
            "headers": [{"name": name, "value": value} for name, value in request_headers],
            "queryString": [],
            "headersSize": -1,
            "bodySize": len(body.encode("utf-8")),
            "postData": {"mimeType": "application/json", "text": body},
        },
        "response": {
            "status": status,
            "statusText": status_text,
            "httpVersion": "HTTP/1.1",
            "cookies": [],
            "headers": [{"name": name, "value": value} for name, value in response_headers],
            "content": {"size": len(response_text.encode("utf-8")), "mimeType": response_headers[0][1], "text": response_text},
            "redirectURL": "",
            "headersSize": -1,
            "bodySize": -1,
        },
        "cache": {},
        "timings": {"send": 0, "wait": 800, "receive": 200},
    }


def sse(events):
    """A server-sent event stream: each event as `data: <json>`, with an optional event name."""
    out = []
    for item in events:
        if isinstance(item, tuple):
            name, data = item
            out.append(f"event: {name}\ndata: {json.dumps(data)}\n\n")
        elif isinstance(item, str):
            out.append(f"data: {item}\n\n")
        else:
            out.append(f"data: {json.dumps(item)}\n\n")
    return "".join(out)


OPENAI_HEADERS = [
    ("content-type", "application/json"),
    ("accept", "application/json"),
    ("authorization", f"Bearer {PLACEHOLDER}"),
    ("user-agent", "OpenAI/Python 1.109.1"),
]
JSON_RESPONSE = [("content-type", "application/json")]
SSE_RESPONSE = [("content-type", "text/event-stream; charset=utf-8")]

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {"type": "object", "properties": {"location": {"type": "string", "description": "The city and state, e.g. San Francisco, CA"}}, "required": ["location"]},
    },
}


def chat_usage(prompt, completion, cached=0, reasoning=0):
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "prompt_tokens_details": {"cached_tokens": cached, "audio_tokens": 0},
        "completion_tokens_details": {"reasoning_tokens": reasoning, "audio_tokens": 0, "accepted_prediction_tokens": 0, "rejected_prediction_tokens": 0},
    }


def chat_completion(id_, content, finish, usage, tool_calls=None):
    message = {"role": "assistant", "content": content, "refusal": None, "annotations": []}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": id_,
        "object": "chat.completion",
        "created": 1761264000,
        "model": "gpt-4.1-mini-2025-04-14",
        "choices": [{"index": 0, "message": message, "logprobs": None, "finish_reason": finish}],
        "usage": usage,
        "service_tier": "default",
        "system_fingerprint": "fp_reference",
    }


def chat_chunk(id_, delta, finish=None, usage=None):
    chunk = {
        "id": id_,
        "object": "chat.completion.chunk",
        "created": 1761264001,
        "model": "gpt-4.1-mini-2025-04-14",
        "service_tier": "default",
        "system_fingerprint": "fp_reference",
        "choices": [] if delta is None else [{"index": 0, "delta": delta, "logprobs": None, "finish_reason": finish}],
    }
    if usage is not None or delta is None:
        chunk["usage"] = usage
    return chunk


def openai_chat_entries():
    url = f"{OPENAI}/v1/chat/completions"
    system = {"role": "developer", "content": "You are a helpful assistant."}
    not_streamed = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "messages": [system, {"role": "user", "content": "Hello!"}]},
        200, "OK", JSON_RESPONSE,
        json.dumps(chat_completion("chatcmpl-ref-1", "Hello! How can I assist you today?", "stop", chat_usage(19, 10))),
    )
    streamed = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "messages": [system, {"role": "user", "content": "Hello!"}], "stream": True, "stream_options": {"include_usage": True}},
        200, "OK", SSE_RESPONSE,
        sse([
            chat_chunk("chatcmpl-ref-2", {"role": "assistant", "content": "", "refusal": None}),
            chat_chunk("chatcmpl-ref-2", {"content": "Hello"}),
            chat_chunk("chatcmpl-ref-2", {"content": "! How can I assist you today?"}),
            chat_chunk("chatcmpl-ref-2", {}, "stop"),
            chat_chunk("chatcmpl-ref-2", None, usage=chat_usage(19, 10)),
            "[DONE]",
        ]),
    )
    tool_call = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "messages": [{"role": "user", "content": "What is the weather like in Boston today?"}], "tools": [WEATHER_TOOL], "tool_choice": "auto"},
        200, "OK", JSON_RESPONSE,
        json.dumps(chat_completion(
            "chatcmpl-ref-3", None, "tool_calls", chat_usage(82, 17),
            tool_calls=[{"id": "call_abc123", "type": "function", "function": {"name": "get_weather", "arguments": "{\n\"location\": \"Boston, MA\"\n}"}}],
        )),
    )
    tool_result = entry(
        url, OPENAI_HEADERS,
        {
            "model": "gpt-4.1-mini",
            "messages": [
                {"role": "user", "content": "What is the weather like in Boston today?"},
                {"role": "assistant", "content": None, "tool_calls": [{"id": "call_abc123", "type": "function", "function": {"name": "get_weather", "arguments": "{\n\"location\": \"Boston, MA\"\n}"}}]},
                {"role": "tool", "tool_call_id": "call_abc123", "content": "{\"temperature\": \"22\", \"unit\": \"celsius\", \"description\": \"Sunny\"}"},
            ],
            "tools": [WEATHER_TOOL],
        },
        200, "OK", JSON_RESPONSE,
        json.dumps(chat_completion("chatcmpl-ref-4", "The weather in Boston today is sunny with a temperature of 22°C.", "stop", chat_usage(129, 18))),
    )
    cached = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "messages": [{"role": "system", "content": "You are a helpful assistant. " * 80}, {"role": "user", "content": "Hello again!"}]},
        200, "OK", JSON_RESPONSE,
        json.dumps(chat_completion("chatcmpl-ref-5", "Hello again! How can I help you today?", "stop", chat_usage(2006, 11, cached=1920))),
    )
    unknown_model = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-does-not-exist", "messages": [{"role": "user", "content": "Hello!"}]},
        404, "Not Found", JSON_RESPONSE,
        json.dumps({"error": {"message": "The model `gpt-does-not-exist` does not exist or you do not have access to it.", "type": "invalid_request_error", "param": None, "code": "model_not_found"}}),
    )
    stream_error = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "messages": [{"role": "user", "content": "Hello!"}], "stream": True},
        200, "OK", SSE_RESPONSE,
        sse([
            chat_chunk("chatcmpl-ref-7", {"role": "assistant", "content": "", "refusal": None}),
            chat_chunk("chatcmpl-ref-7", {"content": "Hel"}),
            {"error": {"message": "The server had an error while processing your request. Sorry about that!", "type": "server_error", "param": None, "code": None}},
        ]),
    )
    return [not_streamed, streamed, tool_call, tool_result, cached, unknown_model, stream_error]


def responses_usage(inp, out, cached=0, reasoning=0):
    return {"input_tokens": inp, "input_tokens_details": {"cached_tokens": cached}, "output_tokens": out, "output_tokens_details": {"reasoning_tokens": reasoning}, "total_tokens": inp + out}


def response_object(id_, output, usage, status="completed", error=None, incomplete=None, instructions=None, tools=None):
    return {
        "id": id_,
        "object": "response",
        "created_at": 1761264000,
        "status": status,
        "background": False,
        "error": error,
        "incomplete_details": incomplete,
        "instructions": instructions,
        "max_output_tokens": None,
        "model": "gpt-4.1-mini-2025-04-14",
        "output": output,
        "parallel_tool_calls": True,
        "previous_response_id": None,
        "reasoning": {"effort": None, "summary": None},
        "store": True,
        "temperature": 1.0,
        "text": {"format": {"type": "text"}},
        "tool_choice": "auto",
        "tools": tools or [],
        "top_p": 1.0,
        "truncation": "disabled",
        "usage": usage,
        "user": None,
        "metadata": {},
    }


def text_item(id_, text):
    return {"type": "message", "id": id_, "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": text, "annotations": []}]}


RESPONSES_WEATHER_TOOL = {"type": "function", "name": "get_weather", "description": "Get the current weather in a given location", "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}, "strict": False}


def openai_responses_entries():
    url = f"{OPENAI}/v1/responses"
    not_streamed = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "instructions": "You are a helpful assistant.", "input": "Hello!"},
        200, "OK", JSON_RESPONSE,
        json.dumps(response_object("resp_ref_1", [text_item("msg_ref_1", "Hello! How can I assist you today?")], responses_usage(19, 10), instructions="You are a helpful assistant.")),
    )
    created = response_object("resp_ref_2", [], None, status="in_progress", instructions="You are a helpful assistant.")
    completed = response_object("resp_ref_2", [text_item("msg_ref_2", "Hello! How can I assist you today?")], responses_usage(19, 10), instructions="You are a helpful assistant.")
    message_item = {"type": "message", "id": "msg_ref_2", "status": "in_progress", "role": "assistant", "content": []}
    streamed = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "instructions": "You are a helpful assistant.", "input": "Hello!", "stream": True},
        200, "OK", SSE_RESPONSE,
        sse([
            ("response.created", {"type": "response.created", "sequence_number": 0, "response": created}),
            ("response.in_progress", {"type": "response.in_progress", "sequence_number": 1, "response": created}),
            ("response.output_item.added", {"type": "response.output_item.added", "sequence_number": 2, "output_index": 0, "item": message_item}),
            ("response.content_part.added", {"type": "response.content_part.added", "sequence_number": 3, "item_id": "msg_ref_2", "output_index": 0, "content_index": 0, "part": {"type": "output_text", "text": "", "annotations": []}}),
            ("response.output_text.delta", {"type": "response.output_text.delta", "sequence_number": 4, "item_id": "msg_ref_2", "output_index": 0, "content_index": 0, "delta": "Hello"}),
            ("response.output_text.delta", {"type": "response.output_text.delta", "sequence_number": 5, "item_id": "msg_ref_2", "output_index": 0, "content_index": 0, "delta": "! How can I assist you today?"}),
            ("response.output_text.done", {"type": "response.output_text.done", "sequence_number": 6, "item_id": "msg_ref_2", "output_index": 0, "content_index": 0, "text": "Hello! How can I assist you today?"}),
            ("response.content_part.done", {"type": "response.content_part.done", "sequence_number": 7, "item_id": "msg_ref_2", "output_index": 0, "content_index": 0, "part": {"type": "output_text", "text": "Hello! How can I assist you today?", "annotations": []}}),
            ("response.output_item.done", {"type": "response.output_item.done", "sequence_number": 8, "output_index": 0, "item": text_item("msg_ref_2", "Hello! How can I assist you today?")}),
            ("response.completed", {"type": "response.completed", "sequence_number": 9, "response": completed}),
        ]),
    )
    call_item = {"type": "function_call", "id": "fc_ref_3", "call_id": "call_ref_3", "name": "get_weather", "arguments": "{\"location\":\"Boston, MA\"}", "status": "completed"}
    tool_call = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "input": [{"role": "user", "content": "What is the weather like in Boston today?"}], "tools": [RESPONSES_WEATHER_TOOL]},
        200, "OK", JSON_RESPONSE,
        json.dumps(response_object("resp_ref_3", [call_item], responses_usage(82, 17), tools=[RESPONSES_WEATHER_TOOL])),
    )
    tool_result = entry(
        url, OPENAI_HEADERS,
        {
            "model": "gpt-4.1-mini",
            "input": [
                {"role": "user", "content": "What is the weather like in Boston today?"},
                {"type": "function_call", "call_id": "call_ref_3", "name": "get_weather", "arguments": "{\"location\":\"Boston, MA\"}"},
                {"type": "function_call_output", "call_id": "call_ref_3", "output": "{\"temperature\": \"22\", \"unit\": \"celsius\", \"description\": \"Sunny\"}"},
            ],
            "tools": [RESPONSES_WEATHER_TOOL],
        },
        200, "OK", JSON_RESPONSE,
        json.dumps(response_object("resp_ref_4", [text_item("msg_ref_4", "The weather in Boston today is sunny with a temperature of 22°C.")], responses_usage(129, 18), tools=[RESPONSES_WEATHER_TOOL])),
    )
    cached = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "instructions": "You are a helpful assistant. " * 80, "input": "Hello again!"},
        200, "OK", JSON_RESPONSE,
        json.dumps(response_object("resp_ref_5", [text_item("msg_ref_5", "Hello again! How can I help you today?")], responses_usage(2006, 11, cached=1920), instructions="You are a helpful assistant. " * 80)),
    )
    unknown_model = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-does-not-exist", "input": "Hello!"},
        404, "Not Found", JSON_RESPONSE,
        json.dumps({"error": {"message": "The model `gpt-does-not-exist` does not exist or you do not have access to it.", "type": "invalid_request_error", "param": None, "code": "model_not_found"}}),
    )
    failed_created = response_object("resp_ref_7", [], None, status="in_progress")
    failed = response_object("resp_ref_7", [], None, status="failed", error={"code": "server_error", "message": "The model failed to generate a response."})
    stream_failed = entry(
        url, OPENAI_HEADERS,
        {"model": "gpt-4.1-mini", "input": "Hello!", "stream": True},
        200, "OK", SSE_RESPONSE,
        sse([
            ("response.created", {"type": "response.created", "sequence_number": 0, "response": failed_created}),
            ("response.in_progress", {"type": "response.in_progress", "sequence_number": 1, "response": failed_created}),
            ("response.failed", {"type": "response.failed", "sequence_number": 2, "response": failed}),
        ]),
    )
    return [not_streamed, streamed, tool_call, tool_result, cached, unknown_model, stream_failed]


ANTHROPIC_HEADERS = [
    ("content-type", "application/json"),
    ("accept", "text/event-stream"),
    ("x-api-key", PLACEHOLDER),
    ("anthropic-version", "2023-06-01"),
    ("user-agent", "Anthropic/Python 0.69.0"),
]


def anthropic_overloaded_entries():
    return [entry(
        f"{ANTHROPIC}/v1/messages", ANTHROPIC_HEADERS,
        {"model": "claude-sonnet-4-5", "max_tokens": 256, "messages": [{"role": "user", "content": "Hello!"}], "stream": True},
        200, "OK", SSE_RESPONSE,
        sse([
            ("message_start", {"type": "message_start", "message": {"id": "msg_ref_overloaded", "type": "message", "role": "assistant", "model": "claude-sonnet-4-5-20250929", "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 9, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 1}}}),
            ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            ("ping", {"type": "ping"}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}),
            ("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
        ]),
    )]


GEMINI_HEADERS = [
    ("content-type", "application/json"),
    ("x-goog-api-key", PLACEHOLDER),
    ("x-goog-api-client", "google-genai-sdk/1.27.0 gl-python/3.13.5"),
    ("user-agent", "google-genai-sdk/1.27.0 gl-python/3.13.5"),
]


def gemini_rate_limited_entries():
    return [entry(
        f"{GEMINI}/v1beta/models/gemini-2.5-flash:generateContent", GEMINI_HEADERS,
        {"contents": [{"role": "user", "parts": [{"text": "Hello!"}]}]},
        429, "Too Many Requests", [("content-type", "application/json; charset=UTF-8")],
        json.dumps({"error": {"code": 429, "message": "You exceeded your current quota, please check your plan and billing details.", "status": "RESOURCE_EXHAUSTED"}}),
    )]


# --- The custom-components conversation, from its Gemini recording ---

CHAT_MODEL = "gpt-4.1-mini"
CHAT_RESPONSE_MODEL = "gpt-4.1-mini-2025-04-14"
DELTA_CHARS = 120


def gemini_conversation(name):
    """The conversation's calls as the Gemini recording holds them: the system prompt, the tools, and
    per call the contents sent and what came back, text or a function call, with the token counts."""
    har = json.loads((ROOT / name).read_text(encoding="utf-8"))
    calls = []
    for entry in har["log"]["entries"]:
        request = json.loads(entry["request"]["postData"]["text"])
        text, call, usage = [], None, None
        for line in entry["response"]["content"]["text"].splitlines():
            if not line.startswith("data:"):
                continue
            chunk = json.loads(line[5:].strip())
            for candidate in chunk.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    if "text" in part:
                        text.append(part["text"])
                    if "functionCall" in part:
                        call = part["functionCall"]
            usage = chunk.get("usageMetadata", usage)
        calls.append({"contents": request["contents"], "text": "".join(text), "call": call, "usage": usage})
    first = json.loads(har["log"]["entries"][0]["request"]["postData"]["text"])
    return {
        "system": first["system_instruction"]["parts"][0]["text"],
        "tools": [f for t in first["tools"] for f in t["function_declarations"]],
        "calls": calls,
    }


def tool_call_id(index):
    return f"call_cc_{index}"


def pieces(text):
    return [text[i : i + DELTA_CHARS] for i in range(0, len(text), DELTA_CHARS)] or [""]


def usage_counts(usage):
    return usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0), usage.get("cachedContentTokenCount", 0)


def chat_messages(conversation, contents):
    """The conversation's contents as Chat Completions messages, the system prompt first."""
    messages = [{"role": "system", "content": conversation["system"]}]
    call_index = 0
    for content in contents:
        for part in content["parts"]:
            if "text" in part:
                messages.append({"role": "user" if content["role"] == "user" else "assistant", "content": part["text"]})
            elif "function_call" in part or "functionCall" in part:
                call = part.get("function_call") or part["functionCall"]
                call_index += 1
                messages.append({"role": "assistant", "content": None, "tool_calls": [{"id": tool_call_id(call_index), "type": "function", "function": {"name": call["name"], "arguments": json.dumps(call["args"])}}]})
            elif "function_response" in part or "functionResponse" in part:
                response = part.get("function_response") or part["functionResponse"]
                messages.append({"role": "tool", "tool_call_id": tool_call_id(call_index), "content": json.dumps(response["response"])})
    return messages


def chat_tools(conversation):
    return [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t["parameters"]}} for t in conversation["tools"]]


def chat_conversation_entries(conversation):
    entries = []
    for index, call in enumerate(conversation["calls"], 1):
        prompt, completion, cached = usage_counts(call["usage"])
        request = {"model": CHAT_MODEL, "messages": chat_messages(conversation, call["contents"]), "tools": chat_tools(conversation), "stream": True, "stream_options": {"include_usage": True}}
        id_ = f"chatcmpl-cc-{index}"
        chunks = [chat_chunk(id_, {"role": "assistant", "content": "", "refusal": None})]
        if call["call"] is not None:
            call_id = tool_call_id(sum(1 for c in call["contents"] for p in c["parts"] if "function_call" in p or "functionCall" in p) + 1)
            arguments = json.dumps(call["call"]["args"])
            chunks.append(chat_chunk(id_, {"tool_calls": [{"index": 0, "id": call_id, "type": "function", "function": {"name": call["call"]["name"], "arguments": ""}}]}))
            for piece in pieces(arguments):
                chunks.append(chat_chunk(id_, {"tool_calls": [{"index": 0, "function": {"arguments": piece}}]}))
            chunks.append(chat_chunk(id_, {}, "tool_calls"))
        else:
            for piece in pieces(call["text"]):
                chunks.append(chat_chunk(id_, {"content": piece}))
            chunks.append(chat_chunk(id_, {}, "stop"))
        chunks.append(chat_chunk(id_, None, usage=chat_usage(prompt, completion, cached=cached)))
        chunks.append("[DONE]")
        for chunk in chunks:
            if isinstance(chunk, dict):
                chunk["model"] = CHAT_RESPONSE_MODEL
        entries.append(entry(f"{OPENAI}/v1/chat/completions", OPENAI_HEADERS, request, 200, "OK", SSE_RESPONSE, sse(chunks)))
    return entries


def responses_input(contents):
    """The conversation's contents as Responses API input items."""
    items = []
    call_index = 0
    for content in contents:
        for part in content["parts"]:
            if "text" in part:
                items.append({"role": "user" if content["role"] == "user" else "assistant", "content": part["text"]})
            elif "function_call" in part or "functionCall" in part:
                call = part.get("function_call") or part["functionCall"]
                call_index += 1
                items.append({"type": "function_call", "call_id": tool_call_id(call_index), "name": call["name"], "arguments": json.dumps(call["args"])})
            elif "function_response" in part or "functionResponse" in part:
                response = part.get("function_response") or part["functionResponse"]
                items.append({"type": "function_call_output", "call_id": tool_call_id(call_index), "output": json.dumps(response["response"])})
    return items


def responses_tools(conversation):
    return [{"type": "function", "name": t["name"], "description": t.get("description", ""), "parameters": t["parameters"], "strict": False} for t in conversation["tools"]]


def responses_conversation_entries(conversation):
    entries = []
    for index, call in enumerate(conversation["calls"], 1):
        prompt, completion, cached = usage_counts(call["usage"])
        tools = responses_tools(conversation)
        request = {"model": CHAT_MODEL, "instructions": conversation["system"], "input": responses_input(call["contents"]), "tools": tools, "stream": True}
        id_ = f"resp_cc_{index}"
        base = dict(instructions=conversation["system"], tools=tools)
        created = response_object(id_, [], None, status="in_progress", **base)
        events = [
            ("response.created", {"type": "response.created", "sequence_number": 0, "response": created}),
            ("response.in_progress", {"type": "response.in_progress", "sequence_number": 1, "response": created}),
        ]
        sequence = 2

        def event(name, **fields):
            nonlocal sequence
            events.append((name, {"type": name, "sequence_number": sequence, **fields}))
            sequence += 1

        if call["call"] is not None:
            call_id = tool_call_id(sum(1 for c in call["contents"] for p in c["parts"] if "function_call" in p or "functionCall" in p) + 1)
            arguments = json.dumps(call["call"]["args"])
            item_id = f"fc_cc_{index}"
            added = {"type": "function_call", "id": item_id, "call_id": call_id, "name": call["call"]["name"], "arguments": "", "status": "in_progress"}
            event("response.output_item.added", output_index=0, item=added)
            for piece in pieces(arguments):
                event("response.function_call_arguments.delta", item_id=item_id, output_index=0, delta=piece)
            event("response.function_call_arguments.done", item_id=item_id, output_index=0, arguments=arguments)
            done = {**added, "arguments": arguments, "status": "completed"}
        else:
            item_id = f"msg_cc_{index}"
            event("response.output_item.added", output_index=0, item={"type": "message", "id": item_id, "status": "in_progress", "role": "assistant", "content": []})
            event("response.content_part.added", item_id=item_id, output_index=0, content_index=0, part={"type": "output_text", "text": "", "annotations": []})
            for piece in pieces(call["text"]):
                event("response.output_text.delta", item_id=item_id, output_index=0, content_index=0, delta=piece)
            event("response.output_text.done", item_id=item_id, output_index=0, content_index=0, text=call["text"])
            event("response.content_part.done", item_id=item_id, output_index=0, content_index=0, part={"type": "output_text", "text": call["text"], "annotations": []})
            done = text_item(item_id, call["text"])
        event("response.output_item.done", output_index=0, item=done)
        completed = response_object(id_, [done], responses_usage(prompt, completion, cached=cached), **base)
        event("response.completed", response=completed)
        entries.append(entry(f"{OPENAI}/v1/responses", OPENAI_HEADERS, request, 200, "OK", SSE_RESPONSE, sse(events)))
    return entries


if __name__ == "__main__":
    main()
