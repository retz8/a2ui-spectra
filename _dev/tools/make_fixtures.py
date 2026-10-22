"""Writes the turn record v0.1 fixtures under conformance/test_data/turn_record/v0_1/ and their case list,
conformance/turn_record/validator_v0_1.yaml.

Reads upstream's samples from the sibling ../A2UI checkout at 059b8d34. From the repository root:

    python3 -I _dev/tools/make_fixtures.py .
    yarn prettier --write conformance/turn_record/validator_v0_1.yaml
"""

import copy
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(sys.argv[1]).resolve()
A2UI = REPO.parent / "A2UI"
PIN = "059b8d34"
OUT = REPO / "conformance/test_data/turn_record/v0_1"
SUITE = REPO / "conformance/turn_record/validator_v0_1.yaml"
FIXTURE_DIR = "test_data/turn_record/v0_1"


def upstream_json(path):
    return json.loads(subprocess.check_output(["git", "-C", str(A2UI), "show", f"{PIN}:{path}"]))


T0 = int(datetime(2026, 10, 21, 10, 0, 0, tzinfo=timezone.utc).timestamp()) * 10**9


def ns(ms):
    return str(T0 + round(ms * 1_000_000))


def trace_id(label):
    return hashlib.sha256(f"trace:{label}".encode()).hexdigest()[:32]


def span_id(label):
    return hashlib.sha256(f"span:{label}".encode()).hexdigest()[:16]


def u16(text):
    return len(text.encode("utf-16-le")) // 2


def event(trace, span, name, kind, start, attributes, parent=None, end=None, events=None, links=None, status=None):
    e = {"traceId": trace, "spanId": span}
    if parent:
        e["parentSpanId"] = parent
    e["name"] = name
    e["kind"] = kind
    e["startTimeUnixNano"] = ns(start)
    if end is not None:
        e["endTimeUnixNano"] = ns(end)
    e["attributes"] = attributes
    if events:
        e["events"] = events
    if links:
        e["links"] = links
    if status:
        e["status"] = status
    return e


def record(*turns):
    return {"version": "v0.1", "turns": [{"events": list(t)} for t in turns]}


BASIC = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
WRITER = {"a2ui.turn.writer.name": "a2ui-spectra", "a2ui.turn.writer.version": "0.0.0"}
ADK_SCOPE = {"otel.scope.name": "gcp.vertex.agent", "otel.scope.version": "1.28.1"}
WRAPPER_SCOPE = {"otel.scope.name": "a2ui_spectra_wrapper", "otel.scope.version": "0.0.0"}
OPEN, CLOSE = "<a2ui-json>", "</a2ui-json>"

WORKFLOW = """## Workflow Description:

The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in `<a2ui-json>` and `</a2ui-json>` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the `components` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives."""


def a2ui_text(prefix, messages, surface_id, close=True):
    """The model's text: a prefix, then the messages in one A2UI JSON block.

    Returns the text and the UTF-16 range of every component it holds.
    """
    text = prefix + OPEN + "\n["
    ranges = []
    for i, message in enumerate(messages):
        if i:
            text += ","
        if "updateComponents" in message:
            body = message["updateComponents"]
            text += '{"version":"%s","updateComponents":{"surfaceId":"%s","components":[' % (
                message["version"],
                body["surfaceId"],
            )
            for j, component in enumerate(body["components"]):
                if j:
                    text += ","
                start = u16(text)
                text += json.dumps(component, ensure_ascii=False, separators=(",", ":"))
                ranges.append(
                    {"surfaceId": body["surfaceId"], "componentId": component["id"], "start": start, "end": u16(text)}
                )
            text += "]}}"
        else:
            text += json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    text += "]\n"
    if close:
        text += CLOSE
    return text, ranges


# The minimal fixtures.

MT = trace_id("minimal")
MR = trace_id("minimal received")
MIN_TURN = span_id("minimal turn")
MIN_MESSAGES = [
    {"version": "v0.9", "createSurface": {"surfaceId": "main", "catalogId": BASIC}},
    {
        "version": "v0.9",
        "updateComponents": {"surfaceId": "main", "components": [{"id": "root", "component": "Text", "text": "Hello"}]},
    },
]
MIN_TEXT, MIN_RANGES = a2ui_text("", MIN_MESSAGES, "main")


def min_turn(capture_paths):
    return event(
        MT,
        MIN_TURN,
        "invoke_agent",
        3,
        0,
        {
            "a2ui.event.kind": "turn",
            "gen_ai.operation.name": "invoke_agent",
            "a2ui.turn.outcome": "completed",
            "a2ui.turn.capture_paths": capture_paths,
            **WRITER,
        },
        end=1500,
        status={"code": 1},
    )


MINIMAL = {
    "turn": record([min_turn(["wire"])]),
    "wire_input": record(
        [
            min_turn(["wire"]),
            event(
                MT,
                span_id("minimal wire input"),
                "wire_input",
                1,
                5,
                {
                    "a2ui.event.kind": "wire_input",
                    "a2ui.wire.message": {"role": "user", "parts": [{"type": "text", "content": "Hello"}]},
                },
                parent=MIN_TURN,
            ),
        ]
    ),
    "wire_output": record(
        [
            min_turn(["wire"]),
            event(
                MT,
                span_id("minimal wire output"),
                "wire_output",
                1,
                1400,
                {
                    "a2ui.event.kind": "wire_output",
                    "a2ui.wire.message": {"role": "assistant", "parts": [{"type": "a2ui", "content": MIN_MESSAGES}]},
                },
                parent=MIN_TURN,
            ),
        ]
    ),
    "model_call": record(
        [
            min_turn(["model_proxy"]),
            event(
                MT,
                span_id("minimal model call"),
                "generate_content",
                3,
                100,
                {"a2ui.event.kind": "model_call"},
                parent=MIN_TURN,
                end=900,
            ),
        ]
    ),
    "tool_call": record(
        [
            min_turn(["tool_proxy"]),
            event(
                MT,
                span_id("minimal tool call"),
                "execute_tool",
                3,
                300,
                {"a2ui.event.kind": "tool_call"},
                parent=MIN_TURN,
                end=400,
            ),
        ]
    ),
    "prompt_generation": record(
        [
            min_turn(["otel_receiver", "wrapper"]),
            event(
                MR,
                span_id("minimal prompt generation"),
                "prompt_generation",
                1,
                50,
                {
                    "a2ui.event.kind": "prompt_generation",
                    "a2ui.prompt.ui_section": WORKFLOW,
                    "a2ui.prompt.inference_format": "direct_json",
                    "a2ui.prompt.catalog_id": BASIC,
                },
            ),
        ]
    ),
    "parse": record(
        [
            min_turn(["otel_receiver", "wrapper"]),
            event(
                MR,
                span_id("minimal parse"),
                "parse",
                1,
                950,
                {"a2ui.event.kind": "parse", "a2ui.parse.input": MIN_TEXT},
            ),
        ]
    ),
    "check": record(
        [
            min_turn(["wire"]),
            event(
                MT,
                span_id("minimal check"),
                "check",
                1,
                1450,
                {
                    "a2ui.event.kind": "check",
                    "a2ui.check.name": "schema",
                    "a2ui.check.passed": True,
                    "a2ui.check.protocol_version": "v0.9",
                    "a2ui.check.findings": [],
                },
                parent=MIN_TURN,
            ),
        ]
    ),
    "framework_span": record(
        [
            min_turn(["otel_receiver"]),
            event(
                MR,
                span_id("minimal framework span"),
                "invoke_agent restaurant_agent",
                1,
                20,
                {
                    "a2ui.event.kind": "framework_span",
                    "otel.scope.name": "gcp.vertex.agent",
                    "a2ui.received.attributes": {},
                },
                end=1300,
            ),
        ]
    ),
}


# The full record: two turns of upstream's restaurant finder, a list and then a booking form.

EXAMPLES = "samples/agent/adk/restaurant_finder/examples/0.9"
RESTAURANTS = upstream_json("samples/agent/adk/restaurant_finder/restaurant_data.json")[:2]
CONVERSATION = "c3e9a1d4-5b7f-4e2a-8d61-0f4b2c9e7a35"
MODEL = "gemini-3.6-flash"
AGENT_DESCRIPTION = "An agent that finds restaurants and helps book tables."
TOOL_DESCRIPTION = (
    "Call this tool to get a list of restaurants based on a cuisine and location.\n"
    "'count' is the number of restaurants to return."
)
TOOL_PARAMETERS = {
    "type": "object",
    "properties": {
        "cuisine": {"type": "string"},
        "location": {"type": "string"},
        "count": {"type": "integer", "default": 5},
    },
    "required": ["cuisine", "location"],
}
TOOL_R = {"name": "get_restaurants", "description": TOOL_DESCRIPTION, "parameters": TOOL_PARAMETERS}
ROLE = "You are a helpful restaurant finding assistant. Your final output MUST be an A2UI UI definition."
UI_DESCRIPTION = """-   If the query is for a list of restaurants, use the restaurant data you have already received from the `get_restaurants` tool to populate the `updateDataModel` message.
-   IMPORTANT: When using updateDataModel to update items, you MUST specify `path: "/items"` in `updateDataModel`, and the `value` MUST be an array of restaurants.
-   IMPORTANT: Always specify the path when using updateDataModel. The part message is ignored when the path is missing.
-   If the number of restaurants is 5 or fewer, you MUST use the `SINGLE_COLUMN_LIST_EXAMPLE` template.
-   If the number of restaurants is more than 5, you MUST use the `TWO_COLUMN_LIST_EXAMPLE` template.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), you MUST use the `BOOKING_FORM_EXAMPLE` template.
-   If the query is a booking submission (e.g., "User submitted a booking..."), you MUST use the `CONFIRMATION_EXAMPLE` template."""
INSTRUCTION = f"{ROLE}\n\n## UI Description:\n{UI_DESCRIPTION}\n\n{WORKFLOW}"

# Turn 1: the list.
LIST = upstream_json(f"{EXAMPLES}/single_column_list.json")
LIST[0]["createSurface"]["sendDataModel"] = True
LIST[2]["updateDataModel"]["value"] = "Top 2 Chinese Restaurants in New York"
LIST[3]["updateDataModel"]["value"] = RESTAURANTS
LIST_DATA = {"title": LIST[2]["updateDataModel"]["value"], "items": RESTAURANTS}

# Turn 2: the booking form. The model leaves dietary out of the data model.
BOOKING = upstream_json(f"{EXAMPLES}/booking_form.json")
xian = RESTAURANTS[0]
BOOKING[2]["updateDataModel"]["value"] = {
    "title": f"Book a Table at {xian['name']}",
    "address": xian["address"],
    "restaurantName": xian["name"],
    "partySize": "2",
    "reservationTime": "",
    "imageUrl": xian["imageUrl"],
}
booking_components = BOOKING[1]["updateComponents"]["components"]
DIETARY_FIELD = next(i for i, c in enumerate(booking_components) if c["id"] == "dietary-field")
SUBMIT_BUTTON = next(i for i, c in enumerate(booking_components) if c["id"] == "submit-button")

Q1 = "Top 2 Chinese restaurants in New York"
Q2 = f"USER_WANTS_TO_BOOK: {xian['name']}, Address: {xian['address']}, ImageURL: {xian['imageUrl']}"
TOOL_ARGS = {"cuisine": "Chinese", "location": "New York", "count": 2}
TOOL_RETURN = json.dumps(RESTAURANTS)
TOOL_CALL_ID = "adk-7f2c9b14-3e8a-4d56-b0a1-9c4e2f6d8a03"

T1_PREFIX = "Here are the top 2 Chinese restaurants in New York 🍜\n"
T1_TEXT, T1_RANGES = a2ui_text(T1_PREFIX, LIST, "default")
T2_PREFIX = f"Please fill in your booking details for {xian['name']}.\n"
T2_TEXT, T2_RANGES = a2ui_text(T2_PREFIX, BOOKING, "booking-form")
T2_FULL_ATTEMPT_1, _ = a2ui_text(f"Let's book a table at {xian['name']}.\n", BOOKING, "booking-form", close=False)
T2_ATTEMPT_1 = T2_FULL_ATTEMPT_1[: T2_FULL_ATTEMPT_1.index('"submit-button"') - 7]
try:
    json.loads(T2_ATTEMPT_1[T2_ATTEMPT_1.index(OPEN) + len(OPEN) :])
    raise SystemExit("attempt 1 must not parse")
except json.JSONDecodeError as e:
    PARSE_ERROR = f"Failed to parse A2UI JSON: {e}"
RETRY_QUERY = (
    f"Your previous response was invalid. {PARSE_ERROR} You MUST generate a valid response that strictly"
    " follows the A2UI JSON SCHEMA. The response MUST be a JSON list of A2UI messages. Ensure each JSON part"
    f" is wrapped in '{OPEN}' and '{CLOSE}' tags. Please retry the original request: '{Q2}'"
)

ST1, ST2 = trace_id("full turn 1"), trace_id("full turn 2")
RT1, RT2 = trace_id("full received 1"), trace_id("full received 2")
S = {name: span_id(f"full {name}") for name in [
    "turn 1", "wire input 1", "wire output 1a", "wire output 1b", "agent 1", "prompt 1",
    "proxy call 1a failed", "proxy call 1a", "received call 1a", "tool 1", "proxy call 1b", "received call 1b",
    "parse 1", "check 1 schema", "check 1 structural",
    "turn 2", "wire input 2", "wire output 2", "agent 2",
    "proxy call 2a", "received call 2a", "parse 2a", "proxy call 2b", "received call 2b", "parse 2b",
    "check 2 schema", "check 2 catalog", "check 2 structural", "check 2 binding",
]}


def text_part(text):
    return {"type": "text", "content": text}


def gemini_text(text):
    return {"role": "model", "parts": [{"text": text}]}


GEMINI_USER_1 = {"role": "user", "parts": [{"text": Q1}]}
GEMINI_CALL = {"role": "model", "parts": [{"functionCall": {"id": TOOL_CALL_ID, "name": "get_restaurants", "args": TOOL_ARGS}}]}
GEMINI_RESPONSE = {
    "role": "user",
    "parts": [{"functionResponse": {"id": TOOL_CALL_ID, "name": "get_restaurants", "response": {"result": TOOL_RETURN}}}],
}
GENAI_USER_1 = {"role": "user", "parts": [text_part(Q1)]}
GENAI_CALL = {"role": "assistant", "parts": [{"type": "tool_call", "id": TOOL_CALL_ID, "name": "get_restaurants", "arguments": TOOL_ARGS}]}
GENAI_RESPONSE = {
    "role": "tool",
    "parts": [{"type": "tool_call_response", "id": TOOL_CALL_ID, "response": {"result": TOOL_RETURN}}],
}


def gemini_request(contents, instruction=None, tool=None):
    tool = tool or TOOL_R
    return {
        "contents": contents,
        "systemInstruction": {"role": "user", "parts": [{"text": instruction or INSTRUCTION}]},
        "tools": [{"functionDeclarations": [tool]}],
        "generationConfig": {},
    }


def usage(prompt, candidates):
    return {"promptTokenCount": prompt, "candidatesTokenCount": candidates, "totalTokenCount": prompt + candidates}


def gemini_response(parts, response_id, prompt_tokens, output_tokens, finish="STOP", model=None):
    candidate = {"content": {"role": "model", "parts": parts}, "index": 0}
    if finish:
        candidate["finishReason"] = finish
    return {
        "candidates": [candidate],
        "usageMetadata": usage(prompt_tokens, output_tokens),
        "modelVersion": model or MODEL,
        "responseId": response_id,
    }


def chunks(text, response_id, prompt_tokens, output_tokens, times, finish="STOP"):
    cut = [0, len(text) // 3, 2 * len(text) // 3, len(text)]
    out = []
    for i, time in enumerate(times):
        last = i == len(times) - 1
        body = gemini_response(
            [{"text": text[cut[i] : cut[i + 1]]}], response_id, prompt_tokens, output_tokens if last else 0, finish=finish if last else None
        )
        out.append(
            {"timeUnixNano": ns(time), "name": "a2ui.http.response.chunk", "attributes": {"a2ui.http.response.chunk.body": body}}
        )
    return out


def exchange(stream, request_body, response_body=None, model=None, user_agent="google-genai-sdk/1.27.0 gl-python/3.13.5"):
    method = "streamGenerateContent?alt=sse" if stream else "generateContent"
    attributes = {
        "http.request.method": "POST",
        "url.full": f"https://generativelanguage.googleapis.com/v1beta/models/{model or MODEL}:{method}",
        "http.request.header.content-type": ["application/json"],
    }
    if user_agent:
        attributes["http.request.header.user-agent"] = [user_agent]
    attributes |= {
        "http.response.header.content-type": ["text/event-stream" if stream else "application/json; charset=UTF-8"],
        "http.response.status_code": 200,
        "server.address": "generativelanguage.googleapis.com",
        "server.port": 443,
        "a2ui.http.request.body": request_body,
    }
    if response_body is not None:
        attributes["a2ui.http.response.body"] = response_body
    return attributes


def proxy_model_call(stream, input_messages, output_parts, response_id, prompt_tokens, output_tokens, request_body, response_body=None, first_chunk=None, finish="stop", model=None, instruction=None, tool=None, user_agent="google-genai-sdk/1.27.0 gl-python/3.13.5"):
    model, instruction, tool = model or MODEL, instruction or INSTRUCTION, tool or TOOL_R
    attributes = {
        "a2ui.event.kind": "model_call",
        "gen_ai.operation.name": "generate_content",
        "gen_ai.provider.name": "gcp.gemini",
        "gen_ai.request.model": model,
        "gen_ai.request.stream": stream,
        "gen_ai.output.type": "text",
        "gen_ai.response.id": response_id,
        "gen_ai.response.model": model,
        "gen_ai.response.finish_reasons": [finish],
        "gen_ai.usage.input_tokens": prompt_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "gen_ai.system_instructions": [text_part(instruction)],
        "gen_ai.input.messages": input_messages,
        "gen_ai.output.messages": [{"role": "assistant", "parts": output_parts, "finish_reason": finish}],
        "gen_ai.tool.definitions": [{"type": "function", **tool}],
    }
    if first_chunk is not None:
        attributes["gen_ai.response.time_to_first_chunk"] = first_chunk
    attributes.update(exchange(stream, request_body, response_body, model, user_agent))
    return attributes


def received_model_call(invocation, event_label, request_contents, response, prompt_tokens, output_tokens, finish="stop", model=None, conversation=None):
    model, conversation = model or MODEL, conversation or CONVERSATION
    original = {
        "gen_ai.system": "gcp.vertex.agent",
        "gen_ai.request.model": model,
        "gcp.vertex.agent.invocation_id": invocation,
        "gcp.vertex.agent.session_id": conversation,
        "gcp.vertex.agent.event_id": event_label,
        "gcp.vertex.agent.llm_request": json.dumps({"model": model, "contents": request_contents}, ensure_ascii=False),
        "gcp.vertex.agent.llm_response": json.dumps(response, ensure_ascii=False),
        "gen_ai.usage.input_tokens": prompt_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "gen_ai.response.finish_reasons": [response["candidates"][0]["finishReason"]],
    }
    return {
        "a2ui.event.kind": "model_call",
        "gen_ai.operation.name": "generate_content",
        "gen_ai.request.model": model,
        "gen_ai.conversation.id": conversation,
        "gen_ai.usage.input_tokens": prompt_tokens,
        "gen_ai.usage.output_tokens": output_tokens,
        "gen_ai.response.finish_reasons": [finish],
        **ADK_SCOPE,
        "a2ui.received.attributes": original,
    }


def agent_span(trace, span, start, end, invocation, agent="restaurant_agent", description=None, conversation=None):
    conversation = conversation or CONVERSATION
    original = {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.description": description or AGENT_DESCRIPTION,
        "gen_ai.agent.name": agent,
        "gen_ai.conversation.id": conversation,
        "gcp.vertex.agent.invocation_id": invocation,
    }
    attributes = {
        "a2ui.event.kind": "framework_span",
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": agent,
        "gen_ai.conversation.id": conversation,
        **ADK_SCOPE,
        "a2ui.received.attributes": original,
    }
    return event(trace, span, f"invoke_agent {agent}", 1, start, attributes, end=end, status={"code": 0})


def wrapper_event(kind_attributes):
    return {**kind_attributes, **WRAPPER_SCOPE, "a2ui.received.attributes": dict(kind_attributes)}


def a2ui_parts(messages):
    return [{"type": "a2ui", "content": m} for m in messages]


def turn(trace, span, start, end, agent="Restaurant Agent", conversation=None):
    return event(
        trace,
        span,
        f"invoke_agent {agent}",
        3,
        start,
        {
            "a2ui.event.kind": "turn",
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": agent,
            "gen_ai.conversation.id": conversation or CONVERSATION,
            "a2ui.turn.outcome": "completed",
            "a2ui.turn.protocol_version": "v0.9",
            "a2ui.turn.capture_paths": ["wire", "model_proxy", "tool_proxy", "otel_receiver", "wrapper"],
            **WRITER,
        },
        end=end,
        status={"code": 1},
    )


def check(trace, span, parent, time, name, passed, findings, catalog=None):
    attributes = {
        "a2ui.event.kind": "check",
        "a2ui.check.name": name,
        "a2ui.check.passed": passed,
        "a2ui.check.protocol_version": "v0.9",
    }
    if catalog:
        attributes["a2ui.check.catalog_id"] = catalog
    attributes["a2ui.check.findings"] = findings
    return event(trace, span, "check", 1, time, attributes, parent=parent)


ADK_METADATA = {
    "adk_app_name": "restaurant_agent",
    "adk_user_id": "A2A_USER_" + CONVERSATION,
    "adk_session_id": CONVERSATION,
    "adk_author": "restaurant_agent",
}
CAPABILITIES = {"v0.9": {"supportedCatalogIds": [BASIC]}}

# Turn 1.
call_1a_response = gemini_response([GEMINI_CALL["parts"][0]], "resp-1a", 2841, 31)
call_1b_response = gemini_response([{"text": T1_TEXT}], "resp-1b", 3260, 912)
t1 = [
    turn(ST1, S["turn 1"], 0, 5020),
    event(
        ST1,
        S["wire input 1"],
        "wire_input",
        1,
        3,
        {
            "a2ui.event.kind": "wire_input",
            "a2ui.wire.message": {"role": "user", "parts": [text_part(Q1)]},
            "a2ui.wire.capabilities": CAPABILITIES,
            "a2ui.wire.metadata": {"locale": "en-US"},
        },
        parent=S["turn 1"],
    ),
    event(
        ST1,
        S["wire output 1a"],
        "wire_output",
        1,
        8,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part("Finding restaurants that match your criteria...")]},
        },
        parent=S["turn 1"],
    ),
    agent_span(RT1, S["agent 1"], 10, 4995, "e-4b1d7e20-9a6c-4f3e-8b52-1c0a7d9e3f64"),
    event(
        RT1,
        S["prompt 1"],
        "prompt_generation",
        1,
        12,
        wrapper_event(
            {
                "a2ui.event.kind": "prompt_generation",
                "a2ui.prompt.ui_section": WORKFLOW,
                "a2ui.prompt.inference_format": "direct_json",
                "a2ui.prompt.catalog_id": BASIC,
            }
        ),
        parent=S["agent 1"],
        end=14,
    ),
    event(
        RT1,
        S["received call 1a"],
        "call_llm",
        1,
        20,
        received_model_call(
            "e-4b1d7e20-9a6c-4f3e-8b52-1c0a7d9e3f64", "8d2f4a61", [GEMINI_USER_1], call_1a_response, 2841, 31
        ),
        parent=S["agent 1"],
        end=1220,
        links=[{"traceId": ST1, "spanId": S["proxy call 1a failed"]}, {"traceId": ST1, "spanId": S["proxy call 1a"]}],
    ),
    event(
        ST1,
        S["proxy call 1a"],
        f"generate_content {MODEL}",
        3,
        250,
        proxy_model_call(
            False,
            [GENAI_USER_1],
            GENAI_CALL["parts"],
            "resp-1a",
            2841,
            31,
            gemini_request([GEMINI_USER_1]),
            call_1a_response,
        ),
        parent=S["turn 1"],
        end=1210,
        links=[{"traceId": RT1, "spanId": S["received call 1a"]}],
        status={"code": 1},
    ),
    event(
        RT1,
        S["tool 1"],
        "execute_tool get_restaurants",
        1,
        1225,
        {
            "a2ui.event.kind": "tool_call",
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": "get_restaurants",
            "gen_ai.tool.call.id": TOOL_CALL_ID,
            "gen_ai.tool.type": "function",
            "gen_ai.tool.description": TOOL_DESCRIPTION,
            "gen_ai.tool.call.arguments": TOOL_ARGS,
            "gen_ai.tool.call.result": {"result": TOOL_RETURN},
            "gen_ai.agent.name": "restaurant_agent",
            "gen_ai.conversation.id": CONVERSATION,
            **ADK_SCOPE,
            "a2ui.received.attributes": {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "get_restaurants",
                "gen_ai.tool.description": TOOL_DESCRIPTION,
                "gen_ai.tool.call.id": TOOL_CALL_ID,
                "gcp.vertex.agent.tool_call_args": json.dumps(TOOL_ARGS),
                "gcp.vertex.agent.event_id": "3a9c6e15",
                "gcp.vertex.agent.tool_response": json.dumps({"result": TOOL_RETURN}, ensure_ascii=False),
            },
        },
        parent=S["agent 1"],
        end=1240,
        status={"code": 0},
    ),
    event(
        RT1,
        S["received call 1b"],
        "call_llm",
        1,
        1250,
        received_model_call(
            "e-4b1d7e20-9a6c-4f3e-8b52-1c0a7d9e3f64",
            "5e7b0c92",
            [GEMINI_USER_1, GEMINI_CALL, GEMINI_RESPONSE],
            call_1b_response,
            3260,
            912,
        ),
        parent=S["agent 1"],
        end=4950,
        links=[{"traceId": ST1, "spanId": S["proxy call 1b"]}],
    ),
    event(
        ST1,
        S["proxy call 1b"],
        f"generate_content {MODEL}",
        3,
        1255,
        proxy_model_call(
            False,
            [GENAI_USER_1, GENAI_CALL, GENAI_RESPONSE],
            [text_part(T1_TEXT)],
            "resp-1b",
            3260,
            912,
            gemini_request([GEMINI_USER_1, GEMINI_CALL, GEMINI_RESPONSE]),
            call_1b_response,
        ),
        parent=S["turn 1"],
        end=4940,
        links=[{"traceId": RT1, "spanId": S["received call 1b"]}],
        status={"code": 1},
    ),
    event(
        RT1,
        S["parse 1"],
        "parse",
        1,
        4960,
        wrapper_event(
            {
                "a2ui.event.kind": "parse",
                "a2ui.parse.input": T1_TEXT,
                "a2ui.parse.inference_format": "direct_json",
                "a2ui.parse.messages": LIST,
                "a2ui.parse.components": T1_RANGES,
            }
        ),
        parent=S["agent 1"],
        end=4975,
    ),
    event(
        ST1,
        S["wire output 1b"],
        "wire_output",
        1,
        5000,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part(T1_PREFIX.strip())] + a2ui_parts(LIST)},
            "a2ui.wire.metadata": ADK_METADATA,
        },
        parent=S["turn 1"],
    ),
    check(ST1, S["check 1 schema"], S["turn 1"], 5010, "schema", True, []),
    check(ST1, S["check 1 structural"], S["turn 1"], 5012, "structural", True, []),
]

# The first request gets a 503, and google-genai retries it after its initial delay of 2 seconds.
GEMINI_503 = {"error": {"code": 503, "message": "The model is overloaded. Please try again later.", "status": "UNAVAILABLE"}}
failed = {
    "a2ui.event.kind": "model_call",
    "gen_ai.operation.name": "generate_content",
    "gen_ai.provider.name": "gcp.gemini",
    "gen_ai.request.model": MODEL,
    "gen_ai.request.stream": False,
    "gen_ai.system_instructions": [text_part(INSTRUCTION)],
    "gen_ai.input.messages": [GENAI_USER_1],
    "gen_ai.tool.definitions": [{"type": "function", **TOOL_R}],
    "error.type": "503",
    **exchange(False, gemini_request([GEMINI_USER_1]), GEMINI_503),
}
failed["http.response.status_code"] = 503
t1.insert(
    next(i for i, e in enumerate(t1) if e["spanId"] == S["proxy call 1a"]),
    event(
        ST1,
        S["proxy call 1a failed"],
        f"generate_content {MODEL}",
        3,
        25,
        failed,
        parent=S["turn 1"],
        end=240,
        links=[{"traceId": RT1, "spanId": S["received call 1a"]}],
        status={"code": 2, "message": GEMINI_503["error"]["message"]},
    ),
)


def shift(events, from_ms, by_ms):
    """Moves every time from from_ms on by by_ms."""
    threshold = T0 + from_ms * 1_000_000

    def moved(value):
        return str(int(value) + by_ms * 1_000_000) if int(value) >= threshold else value

    for e in events:
        for field in ("startTimeUnixNano", "endTimeUnixNano"):
            if field in e:
                e[field] = moved(e[field])
        for span_event in e.get("events", []):
            span_event["timeUnixNano"] = moved(span_event["timeUnixNano"])


shift(t1, 245, 2000)

# Turn 2.
B = 60_000
GEMINI_T1_ANSWER = gemini_text(T1_TEXT)
GENAI_T1_ANSWER = {"role": "assistant", "parts": [text_part(T1_TEXT)]}
history_gemini = [GEMINI_USER_1, GEMINI_CALL, GEMINI_RESPONSE, GEMINI_T1_ANSWER, {"role": "user", "parts": [{"text": Q2}]}]
history_genai = [GENAI_USER_1, GENAI_CALL, GENAI_RESPONSE, GENAI_T1_ANSWER, {"role": "user", "parts": [text_part(Q2)]}]
retry_gemini = history_gemini + [gemini_text(T2_ATTEMPT_1), {"role": "user", "parts": [{"text": RETRY_QUERY}]}]
retry_genai = history_genai + [
    {"role": "assistant", "parts": [text_part(T2_ATTEMPT_1)]},
    {"role": "user", "parts": [text_part(RETRY_QUERY)]},
]
call_2a_response = gemini_response([{"text": T2_ATTEMPT_1}], "resp-2a", 4310, 518, finish="MAX_TOKENS")
call_2b_response = gemini_response([{"text": T2_TEXT}], "resp-2b", 4975, 655)
action = {
    "version": "v0.9",
    "action": {
        "name": "book_restaurant",
        "surfaceId": "default",
        "sourceComponentId": "template-book-button",
        "timestamp": "2026-10-21T10:01:00.004Z",
        "context": {"restaurantName": xian["name"], "imageUrl": xian["imageUrl"], "address": xian["address"]},
    },
}
INVOCATION_2 = "e-9c3a5f81-2d4b-4e7c-a6f0-5b8e1d3c7a29"
t2 = [
    turn(ST2, S["turn 2"], B, B + 4600),
    event(
        ST2,
        S["wire input 2"],
        "wire_input",
        1,
        B + 4,
        {
            "a2ui.event.kind": "wire_input",
            "a2ui.wire.message": {"role": "user", "parts": a2ui_parts([action])},
            "a2ui.wire.data_model": {"version": "v0.9", "surfaces": {"default": LIST_DATA}},
            "a2ui.wire.capabilities": CAPABILITIES,
            "a2ui.wire.metadata": {"locale": "en-US"},
        },
        parent=S["turn 2"],
    ),
    agent_span(RT2, S["agent 2"], B + 10, B + 4570, INVOCATION_2),
    event(
        RT2,
        S["received call 2a"],
        "call_llm",
        1,
        B + 20,
        received_model_call(INVOCATION_2, "b71e3d08", history_gemini, call_2a_response, 4310, 518, finish="length"),
        parent=S["agent 2"],
        end=B + 2020,
        links=[{"traceId": ST2, "spanId": S["proxy call 2a"]}],
    ),
    event(
        ST2,
        S["proxy call 2a"],
        f"generate_content {MODEL}",
        3,
        B + 25,
        proxy_model_call(
            True,
            history_genai,
            [text_part(T2_ATTEMPT_1)],
            "resp-2a",
            4310,
            518,
            gemini_request(history_gemini),
            first_chunk=0.875,
            finish="length",
        ),
        parent=S["turn 2"],
        end=B + 2010,
        events=chunks(T2_ATTEMPT_1, "resp-2a", 4310, 518, [B + 900, B + 1400, B + 2000], finish="MAX_TOKENS"),
        links=[{"traceId": RT2, "spanId": S["received call 2a"]}],
        status={"code": 1},
    ),
    event(
        RT2,
        S["parse 2a"],
        "parse",
        1,
        B + 2030,
        wrapper_event(
            {
                "a2ui.event.kind": "parse",
                "a2ui.parse.input": T2_ATTEMPT_1,
                "a2ui.parse.inference_format": "direct_json",
                "a2ui.parse.messages": BOOKING[:1],
                "error.type": "a2ui.core.exceptions.A2uiParseError",
            }
        ),
        parent=S["agent 2"],
        end=B + 2035,
        status={"code": 2, "message": PARSE_ERROR},
    ),
    event(
        RT2,
        S["received call 2b"],
        "call_llm",
        1,
        B + 2040,
        {
            **received_model_call(INVOCATION_2, "f0c58a27", retry_gemini, call_2b_response, 4975, 655),
            "a2ui.retry.attempt": 2,
        },
        parent=S["agent 2"],
        end=B + 4540,
        links=[{"traceId": ST2, "spanId": S["proxy call 2b"]}, {"traceId": RT2, "spanId": S["parse 2a"]}],
    ),
    event(
        ST2,
        S["proxy call 2b"],
        f"generate_content {MODEL}",
        3,
        B + 2045,
        {
            **proxy_model_call(
                True,
                retry_genai,
                [text_part(T2_TEXT)],
                "resp-2b",
                4975,
                655,
                gemini_request(retry_gemini),
                first_chunk=0.755,
            ),
            "a2ui.retry.attempt": 2,
        },
        parent=S["turn 2"],
        end=B + 4530,
        events=chunks(T2_TEXT, "resp-2b", 4975, 655, [B + 2800, B + 3600, B + 4500]),
        links=[{"traceId": RT2, "spanId": S["received call 2b"]}, {"traceId": RT2, "spanId": S["parse 2a"]}],
        status={"code": 1},
    ),
    event(
        RT2,
        S["parse 2b"],
        "parse",
        1,
        B + 4550,
        wrapper_event(
            {
                "a2ui.event.kind": "parse",
                "a2ui.parse.input": T2_TEXT,
                "a2ui.parse.inference_format": "direct_json",
                "a2ui.parse.messages": BOOKING,
                "a2ui.parse.components": T2_RANGES,
            }
        ),
        parent=S["agent 2"],
        end=B + 4560,
    ),
    event(
        ST2,
        S["wire output 2"],
        "wire_output",
        1,
        B + 4580,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part(T2_PREFIX.strip())] + a2ui_parts(BOOKING)},
            "a2ui.wire.metadata": ADK_METADATA,
        },
        parent=S["turn 2"],
    ),
    check(ST2, S["check 2 schema"], S["turn 2"], B + 4590, "schema", True, []),
    check(ST2, S["check 2 catalog"], S["turn 2"], B + 4591, "catalog", True, [], catalog=BASIC),
    check(ST2, S["check 2 structural"], S["turn 2"], B + 4592, "structural", True, []),
    check(
        ST2,
        S["check 2 binding"],
        S["turn 2"],
        B + 4593,
        "binding",
        False,
        [
            {
                "code": "BINDING_PATH_UNFILLED",
                "surfaceId": "booking-form",
                "path": f"/components/{DIETARY_FIELD}/value",
                "message": "The data model has no value at /dietary.",
            },
            {
                "code": "BINDING_PATH_UNFILLED",
                "surfaceId": "booking-form",
                "path": f"/components/{SUBMIT_BUTTON}/action/event/context/dietary",
                "message": "The data model has no value at /dietary.",
            },
        ],
    ),
]
FULL = record(t1, t2)


# The second full record: two turns of upstream's custom-components-example, a contact lookup and then the
# floor plan its view_location action fetches over MCP.

CC = "samples/agent/adk/custom-components-example"


def upstream_text(path):
    return subprocess.check_output(["git", "-C", str(A2UI), "show", f"{PIN}:{path}"]).decode("utf-8")


C_CONVERSATION = "7d1e4b92-0c3a-4f85-b6e2-9a5f3c8d1e70"
C_API_MODEL = "gemini-3.6-flash"
C_ADK_MODEL = "gemini/gemini-3.6-flash"
C_AGENT_CARD = "Contact Lookup Agent"
C_AGENT = "contact_agent"
C_AGENT_DESCRIPTION = "An agent that finds colleague contact info."
C_TOOL = {
    "name": "get_contact_info",
    "description": (
        "Call this tool to get a list of contacts based on a name and optional department.\n"
        "'name' is the person's name to search for.\n"
        "'department' is the optional department to filter by."
    ),
    "parameters": {
        "type": "object",
        "properties": {"name": {"type": "string"}, "department": {"type": "string", "default": ""}},
        "required": ["name"],
    },
}
C_ROLE = "You are a helpful contact lookup assistant. Your final output MUST be a a2ui UI JSON response."
C_WORKFLOW = """
Buttons that represent the main action on a card or view (e.g., 'Follow', 'Email', 'Search') SHOULD include the `"primary": true` (for spec version v0.8) or `"variant": "primary"` attribute (for spec version v0.9+).
"""
C_UI = """
-   **For finding contacts (e.g., "Who is Alex Jordan?"):**
    a.  You MUST call the `get_contact_info` tool.
    b.  If the tool returns a **single contact**, you MUST use the `MULTI_SURFACE_EXAMPLE` template. Provide BOTH the Contact Card and the Org Chart in a single response.
    c.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template. Populate the `dataModelUpdate.contents` (v0.8) or `updateDataModel.value` (v0.9+) with the list of contacts for the "contacts" key.
    d.  If the tool returns an **empty list**, respond with text only and an empty JSON list: "I couldn't find anyone by that name.<a2ui-json>[]</a2ui-json>"
"""
C_INSTRUCTION = f"{C_ROLE}\n\n## Workflow Description:\n{C_WORKFLOW}\n\n## UI Description:\n{C_UI}\n\n{WORKFLOW}"
INLINE_CATALOG = json.loads(upstream_text(f"{CC}/inline_catalog_0.9.json"))
C_CAPABILITIES = {"v0.9": {"supportedCatalogIds": [BASIC], "inlineCatalogs": [INLINE_CATALOG]}}

ALEX = json.loads(upstream_text(f"{CC}/contact_data.json"))[0]
MULTI = json.loads(upstream_text(f"{CC}/examples/0.9/multi_surface.json"))
# The model fills the contact card's data model as the template writes it, which has no id.
MULTI[4]["updateDataModel"]["value"] = {key: ALEX[key] for key in MULTI[4]["updateDataModel"]["value"]}
card_components = MULTI[2]["updateComponents"]["components"]
LOCATION_BUTTON = next(i for i, c in enumerate(card_components) if c["id"] == "location-button")

C_Q1 = "Who is Alex Jordan?"
C_TOOL_ARGS = {"name": "Alex Jordan"}
C_TOOL_RETURN = json.dumps([ALEX])
C_TOOL_CALL_ID = "adk-2b8e6f40-1c7d-4a93-9e05-d4f1a6b3c827"
C1_PREFIX = "Here is Alex Jordan's contact card and where they sit in the org chart.\n"
C1_TEXT, C1_RANGES = a2ui_text(C1_PREFIX, MULTI, None)

FLOOR_PLAN_HTML = upstream_text(f"{CC}/floor_plan_template.html").replace("__AGENT_STATIC_URL__", "http://localhost:10004")
FLOOR_PLAN = [
    {"version": "v0.9", "createSurface": {"surfaceId": "location-surface", "catalogId": "inline_catalog"}},
    {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "location-surface",
            "components": [
                {"id": "root", "component": "WebFrame", "interactionMode": "interactive", "height": 400, "html": FLOOR_PLAN_HTML}
            ],
        },
    },
]
# The agent writes the floor plan with json.dumps' default separators.
C2_TEXT = f"Here is the floor plan.\n{OPEN}\n{json.dumps(FLOOR_PLAN)}\n{CLOSE}"
C2_RANGES = []
for message in FLOOR_PLAN:
    for component in message.get("updateComponents", {}).get("components", []):
        start = C2_TEXT.index(json.dumps(component))
        C2_RANGES.append({
            "surfaceId": message["updateComponents"]["surfaceId"],
            "componentId": component["id"],
            "start": u16(C2_TEXT[:start]),
            "end": u16(C2_TEXT[:start]) + u16(json.dumps(component)),
        })

SESSION = "4c9e2a7b1f5d48e6a03b8c1d7e2f9a64"
MCP_BASE = "http://127.0.0.1:8000"
MCP_POST = f"{MCP_BASE}/messages/?session_id={SESSION}"
MCP_VERSION = "2025-11-25"

CT1, CT2 = trace_id("custom turn 1"), trace_id("custom turn 2")
CR1, CR2 = trace_id("custom received 1"), trace_id("custom received 2")
CS = {name: span_id(f"custom {name}") for name in [
    "turn 1", "wire input 1", "wire output 1a", "wire output 1b", "agent 1", "prompt 1",
    "proxy call 1a", "received call 1a", "tool 1", "proxy call 1b", "received call 1b", "parse 1",
    "check 1 schema", "check 1 structural", "check 1 binding",
    "turn 2", "wire input 2", "wire output 2", "mcp initialize", "mcp initialized", "mcp read", "parse 2",
    "check 2 schema", "check 2 catalog", "check 2 structural",
]}

C_GEMINI_USER_1 = {"role": "user", "parts": [{"text": C_Q1}]}
C_GEMINI_CALL = {"role": "model", "parts": [{"functionCall": {"id": C_TOOL_CALL_ID, "name": "get_contact_info", "args": C_TOOL_ARGS}}]}
C_GEMINI_RESPONSE = {
    "role": "user",
    "parts": [{"functionResponse": {"id": C_TOOL_CALL_ID, "name": "get_contact_info", "response": {"result": C_TOOL_RETURN}}}],
}
C_GENAI_USER_1 = {"role": "user", "parts": [text_part(C_Q1)]}
C_GENAI_CALL = {"role": "assistant", "parts": [{"type": "tool_call", "id": C_TOOL_CALL_ID, "name": "get_contact_info", "arguments": C_TOOL_ARGS}]}
C_GENAI_RESPONSE = {
    "role": "tool",
    "parts": [{"type": "tool_call_response", "id": C_TOOL_CALL_ID, "response": {"result": C_TOOL_RETURN}}],
}
C_INVOCATION_1 = "e-6a2f8d13-4b7e-4c90-a5d1-3e9b0f7c2a58"
c_call_1a_response = gemini_response([C_GEMINI_CALL["parts"][0]], "resp-c1a", 1984, 18, model=C_API_MODEL)
c_call_1b_response = gemini_response([{"text": C1_TEXT}], "resp-c1b", 2290, 1406, model=C_API_MODEL)
C_PROXY = {"model": C_API_MODEL, "instruction": C_INSTRUCTION, "tool": C_TOOL, "user_agent": None}
C_RECEIVED = {"model": C_ADK_MODEL, "conversation": C_CONVERSATION}


def c_turn(trace, span, start, end):
    return turn(trace, span, start, end, agent=C_AGENT_CARD, conversation=C_CONVERSATION)


def mcp_call(span, name, start, end, request, reply=None, endpoint_time=None, reply_time=None, extra=None):
    attributes = {
        "a2ui.event.kind": "tool_call",
        "mcp.method.name": request["method"],
        "mcp.session.id": SESSION,
        "mcp.protocol.version": MCP_VERSION,
    }
    if "id" in request:
        attributes["jsonrpc.request.id"] = str(request["id"])
    attributes |= extra or {}
    attributes |= {
        "http.request.method": "POST",
        "url.full": MCP_POST,
        "http.request.header.content-type": ["application/json"],
        "http.response.header.content-type": ["text/plain; charset=utf-8"],
        "http.response.status_code": 202,
        "server.address": "127.0.0.1",
        "server.port": 8000,
        "a2ui.http.request.body": request,
        "a2ui.http.response.body": "Accepted",
    }
    chunks_ = []
    if endpoint_time is not None:
        chunks_.append({
            "timeUnixNano": ns(endpoint_time),
            "name": "a2ui.http.response.chunk",
            "attributes": {
                "a2ui.http.response.chunk.body": f"/messages/?session_id={SESSION}",
                "a2ui.http.response.chunk.event": "endpoint",
            },
        })
    if reply is not None:
        chunks_.append({
            "timeUnixNano": ns(reply_time),
            "name": "a2ui.http.response.chunk",
            "attributes": {"a2ui.http.response.chunk.body": reply, "a2ui.http.response.chunk.event": "message"},
        })
    return event(CT2, span, name, 3, start, attributes, parent=CS["turn 2"], end=end, events=chunks_, status={"code": 1})


c1 = [
    c_turn(CT1, CS["turn 1"], 0, 9020),
    event(
        CT1, CS["wire input 1"], "wire_input", 1, 3,
        {
            "a2ui.event.kind": "wire_input",
            "a2ui.wire.message": {"role": "user", "parts": [text_part(C_Q1)]},
            "a2ui.wire.capabilities": C_CAPABILITIES,
        },
        parent=CS["turn 1"],
    ),
    event(
        CT1, CS["wire output 1a"], "wire_output", 1, 8,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part("Looking up contact information...")]},
        },
        parent=CS["turn 1"],
    ),
    agent_span(CR1, CS["agent 1"], 10, 8995, C_INVOCATION_1, agent=C_AGENT, description=C_AGENT_DESCRIPTION, conversation=C_CONVERSATION),
    event(
        CR1, CS["prompt 1"], "prompt_generation", 1, 12,
        wrapper_event({
            "a2ui.event.kind": "prompt_generation",
            "a2ui.prompt.ui_section": WORKFLOW,
            "a2ui.prompt.inference_format": "direct_json",
            "a2ui.prompt.catalog_id": BASIC,
        }),
        parent=CS["agent 1"], end=14,
    ),
    event(
        CR1, CS["received call 1a"], "call_llm", 1, 20,
        received_model_call(C_INVOCATION_1, "1f6a9c30", [C_GEMINI_USER_1], c_call_1a_response, 1984, 18, **C_RECEIVED),
        parent=CS["agent 1"], end=1120,
        links=[{"traceId": CT1, "spanId": CS["proxy call 1a"]}],
    ),
    event(
        CT1, CS["proxy call 1a"], f"generate_content {C_API_MODEL}", 3, 25,
        proxy_model_call(False, [C_GENAI_USER_1], C_GENAI_CALL["parts"], "resp-c1a", 1984, 18,
                         gemini_request([C_GEMINI_USER_1], C_INSTRUCTION, C_TOOL), c_call_1a_response, **C_PROXY),
        parent=CS["turn 1"], end=1110,
        links=[{"traceId": CR1, "spanId": CS["received call 1a"]}],
        status={"code": 1},
    ),
    event(
        CR1, CS["tool 1"], "execute_tool get_contact_info", 1, 1125,
        {
            "a2ui.event.kind": "tool_call",
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": "get_contact_info",
            "gen_ai.tool.call.id": C_TOOL_CALL_ID,
            "gen_ai.tool.type": "function",
            "gen_ai.tool.description": C_TOOL["description"],
            "gen_ai.tool.call.arguments": C_TOOL_ARGS,
            "gen_ai.tool.call.result": {"result": C_TOOL_RETURN},
            "gen_ai.agent.name": C_AGENT,
            "gen_ai.conversation.id": C_CONVERSATION,
            **ADK_SCOPE,
            "a2ui.received.attributes": {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "get_contact_info",
                "gen_ai.tool.description": C_TOOL["description"],
                "gen_ai.tool.call.id": C_TOOL_CALL_ID,
                "gcp.vertex.agent.tool_call_args": json.dumps(C_TOOL_ARGS),
                "gcp.vertex.agent.event_id": "9b4d2e71",
                "gcp.vertex.agent.tool_response": json.dumps({"result": C_TOOL_RETURN}),
            },
        },
        parent=CS["agent 1"], end=1131, status={"code": 0},
    ),
    event(
        CR1, CS["received call 1b"], "call_llm", 1, 1140,
        received_model_call(C_INVOCATION_1, "c37e5a08", [C_GEMINI_USER_1, C_GEMINI_CALL, C_GEMINI_RESPONSE],
                            c_call_1b_response, 2290, 1406, **C_RECEIVED),
        parent=CS["agent 1"], end=8950,
        links=[{"traceId": CT1, "spanId": CS["proxy call 1b"]}],
    ),
    event(
        CT1, CS["proxy call 1b"], f"generate_content {C_API_MODEL}", 3, 1145,
        proxy_model_call(False, [C_GENAI_USER_1, C_GENAI_CALL, C_GENAI_RESPONSE], [text_part(C1_TEXT)], "resp-c1b", 2290, 1406,
                         gemini_request([C_GEMINI_USER_1, C_GEMINI_CALL, C_GEMINI_RESPONSE], C_INSTRUCTION, C_TOOL),
                         c_call_1b_response, **C_PROXY),
        parent=CS["turn 1"], end=8940,
        links=[{"traceId": CR1, "spanId": CS["received call 1b"]}],
        status={"code": 1},
    ),
    event(
        CR1, CS["parse 1"], "parse", 1, 8960,
        wrapper_event({
            "a2ui.event.kind": "parse",
            "a2ui.parse.input": C1_TEXT,
            "a2ui.parse.inference_format": "direct_json",
            "a2ui.parse.messages": MULTI,
            "a2ui.parse.components": C1_RANGES,
        }),
        parent=CS["agent 1"], end=8975,
    ),
    event(
        CT1, CS["wire output 1b"], "wire_output", 1, 9000,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part(C1_PREFIX.strip())] + a2ui_parts(MULTI)},
            "a2ui.wire.metadata": ADK_METADATA | {"adk_app_name": C_AGENT, "adk_author": C_AGENT,
                                                  "adk_user_id": "A2A_USER_" + C_CONVERSATION,
                                                  "adk_session_id": C_CONVERSATION},
        },
        parent=CS["turn 1"],
    ),
    check(CT1, CS["check 1 schema"], CS["turn 1"], 9010, "schema", True, []),
    check(CT1, CS["check 1 structural"], CS["turn 1"], 9011, "structural", True, []),
    check(
        CT1, CS["check 1 binding"], CS["turn 1"], 9012, "binding", False,
        [{
            "code": "BINDING_PATH_UNFILLED",
            "surfaceId": "contact-card",
            "path": f"/components/{LOCATION_BUTTON}/action/event/context/contactId",
            "message": "The data model has no value at /id.",
        }],
    ),
]

C = 90_000
initialize = {
    "jsonrpc": "2.0", "id": 0, "method": "initialize",
    "params": {"protocolVersion": MCP_VERSION, "capabilities": {}, "clientInfo": {"name": "mcp", "version": "0.1.0"}},
}
initialized = {"jsonrpc": "2.0", "method": "notifications/initialized"}
read = {"jsonrpc": "2.0", "id": 1, "method": "resources/read", "params": {"uri": "ui://floor-plan-server/map"}}
c2 = [
    c_turn(CT2, CS["turn 2"], C, C + 160),
    event(
        CT2, CS["wire input 2"], "wire_input", 1, C + 4,
        {
            "a2ui.event.kind": "wire_input",
            "a2ui.wire.message": {"role": "user", "parts": a2ui_parts([{
                "userAction": {
                    "name": "view_location",
                    "surfaceId": "contact-card",
                    "sourceComponentId": "location-button",
                    "timestamp": "2026-10-21T10:01:30.004Z",
                    "context": {},
                }
            }])},
            "a2ui.wire.capabilities": C_CAPABILITIES,
        },
        parent=CS["turn 2"],
    ),
    mcp_call(CS["mcp initialize"], "initialize", C + 10, C + 31, initialize,
             reply={"jsonrpc": "2.0", "id": 0, "result": {
                 "protocolVersion": MCP_VERSION,
                 "capabilities": {"experimental": {}, "resources": {"subscribe": False, "listChanged": False}},
                 "serverInfo": {"name": "floor-plan-server", "version": "1.26.0"},
             }},
             endpoint_time=C + 14, reply_time=C + 30),
    mcp_call(CS["mcp initialized"], "notifications/initialized", C + 32, C + 36, initialized),
    mcp_call(CS["mcp read"], "resources/read ui://floor-plan-server/map", C + 37, C + 58, read,
             reply={"jsonrpc": "2.0", "id": 1, "result": {"contents": [
                 {"uri": "ui://floor-plan-server/map", "mimeType": "text/plain", "text": FLOOR_PLAN_HTML}
             ]}},
             reply_time=C + 57, extra={"mcp.resource.uri": "ui://floor-plan-server/map"}),
    event(
        CR2, CS["parse 2"], "parse", 1, C + 62,
        wrapper_event({
            "a2ui.event.kind": "parse",
            "a2ui.parse.input": C2_TEXT,
            "a2ui.parse.inference_format": "direct_json",
            "a2ui.parse.messages": FLOOR_PLAN,
            "a2ui.parse.components": C2_RANGES,
        }),
        end=C + 65,
    ),
    event(
        CT2, CS["wire output 2"], "wire_output", 1, C + 140,
        {
            "a2ui.event.kind": "wire_output",
            "a2ui.wire.message": {"role": "assistant", "parts": [text_part("Here is the floor plan.")] + a2ui_parts(FLOOR_PLAN)},
        },
        parent=CS["turn 2"],
    ),
    check(CT2, CS["check 2 schema"], CS["turn 2"], C + 150, "schema", True, []),
    check(CT2, CS["check 2 catalog"], CS["turn 2"], C + 151, "catalog", True, [], catalog="inline_catalog"),
    check(CT2, CS["check 2 structural"], CS["turn 2"], C + 152, "structural", True, []),
]
FULL_CUSTOM = record(c1, c2)


# Must-pass fixtures for the optional attributes of closed attribute sets that the full records leave out.


def prompt_generation_failed(r):
    e = events_of(r)[1]
    e["attributes"].update({
        "a2ui.prompt.ui_section": "",
        "a2ui.prompt.catalog_id": "example.com:contacts",
        "a2ui.prompt.catalog_version": "2.1.0",
        "error.type": "a2ui.core.exceptions.A2uiCatalogError",
    })
    e["status"] = {"code": 2, "message": "Catalog example.com:contacts declares no components."}


def chunk_with_id(r):
    events_of(r)[1]["events"] = [
        {
            "timeUnixNano": ns(400 + 200 * i),
            "name": "a2ui.http.response.chunk",
            "attributes": {
                "a2ui.http.response.chunk.body": {"text": text},
                "a2ui.http.response.chunk.event": "message",
                "a2ui.http.response.chunk.id": str(i + 1),
            },
        }
        for i, text in enumerate(["Hel", "lo"])
    ]


EXTRA_PASS = [
    ("prompt_generation_failed", "prompt_generation", prompt_generation_failed,
     "A prompt generation that failed, with its error type, for a catalog that carries its own version."),
    ("chunk_with_id", "model_call", chunk_with_id,
     "A model call whose streamed chunks carry the server-sent event's event and id fields."),
]


# The must-fail fixtures: each a minimal fixture broken in one place.

def events_of(r):
    return r["turns"][0]["events"]


def attrs(r, i=1):
    return events_of(r)[i]["attributes"]


def broken(base, change):
    r = copy.deepcopy(MINIMAL[base])
    change(r)
    return r


def must_fail():
    cases = []

    def case(file, base, change, description, *details):
        cases.append((file, broken(base, change), description, [{"path": p, "code": c} for p, c in details]))

    case("version_not_v0_1", "turn", lambda r: r.update(version="v0.2"),
         "The record declares a version other than v0.1.", ("/version", "const"))
    case("turns_empty", "turn", lambda r: r.update(turns=[]),
         "The record holds no turn.", ("/turns", "minItems"))
    case("turn_without_events", "turn", lambda r: r.update(turns=[{}]),
         "A turn has no events list.", ("/turns/0", "required"))
    case("turn_without_turn_event", "wire_input", lambda r: events_of(r).pop(0),
         "A turn holds no turn event.", ("/turns/0/events", "contains"))

    def second_turn_event(r):
        extra = copy.deepcopy(events_of(r)[0])
        extra["spanId"] = span_id("minimal second turn")
        events_of(r).append(extra)

    case("turn_with_two_turn_events", "turn", second_turn_event,
         "A turn holds two turn events.", ("/turns/0/events", "maxContains"))
    case("trace_id_uppercase", "turn", lambda r: events_of(r)[0].update(traceId=MT.upper()),
         "A trace id is not lowercase hex.", ("/turns/0/events/0/traceId", "pattern"))
    case("span_id_too_short", "turn", lambda r: events_of(r)[0].update(spanId=MIN_TURN[:8]),
         "A span id has 8 hex characters instead of 16.", ("/turns/0/events/0/spanId", "pattern"))
    case("start_time_not_decimal", "turn", lambda r: events_of(r)[0].update(startTimeUnixNano="2026-10-21T10:00:00Z"),
         "A start time is a date string, not nanoseconds as a decimal string.",
         ("/turns/0/events/0/startTimeUnixNano", "pattern"))
    case("turn_protocol_version_without_v", "turn",
         lambda r: attrs(r, 0).update({"a2ui.turn.protocol_version": "0.9"}),
         "The turn's protocol version lacks its leading v.",
         ("/turns/0/events/0/attributes/a2ui.turn.protocol_version", "pattern"))
    case("status_code_unknown", "turn", lambda r: events_of(r)[0].update(status={"code": 3}),
         "A status code is outside OTLP's 0, 1 and 2.", ("/turns/0/events/0/status/code", "enum"))
    case("event_kind_unknown", "wire_input", lambda r: attrs(r).update({"a2ui.event.kind": "wire_message"}),
         "An event names a kind the record does not define.",
         ("/turns/0/events/1/attributes/a2ui.event.kind", "enum"))
    case("turn_without_outcome", "turn", lambda r: attrs(r, 0).pop("a2ui.turn.outcome"),
         "The turn event has no outcome.", ("/turns/0/events/0/attributes", "required"))
    case("wire_input_with_end_time", "wire_input", lambda r: events_of(r)[1].update(endTimeUnixNano=ns(6)),
         "A wire input event has an end time.", ("/turns/0/events/1", "not"))
    case("wire_message_without_role", "wire_input", lambda r: attrs(r)["a2ui.wire.message"].pop("role"),
         "A wire message has no role.", ("/turns/0/events/1/attributes/a2ui.wire.message", "required"))
    case("wire_output_with_data_model", "wire_output", lambda r: attrs(r).update({"a2ui.wire.data_model": {}}),
         "A wire output event carries the data model, which only the host sends.",
         ("/turns/0/events/1/attributes", "additionalProperties"))
    case("a2ui_part_without_content", "wire_output", lambda r: attrs(r)["a2ui.wire.message"]["parts"][0].pop("content"),
         "An A2UI part has no content.", ("/turns/0/events/1/attributes/a2ui.wire.message/parts/0", "required"))
    case("model_call_without_end_time", "model_call", lambda r: events_of(r)[1].pop("endTimeUnixNano"),
         "A model call event has no end time.", ("/turns/0/events/1", "required"))
    case("chunk_without_body", "model_call",
         lambda r: events_of(r)[1].update(events=[{
             "timeUnixNano": ns(500), "name": "a2ui.http.response.chunk",
             "attributes": {"a2ui.http.response.chunk.event": "message"}}]),
         "A streamed chunk has no body.", ("/turns/0/events/1/events/0/attributes", "required"))
    case("link_without_span_id", "model_call", lambda r: events_of(r)[1].update(links=[{"traceId": MR}]),
         "A link has no span id.", ("/turns/0/events/1/links/0", "required"))
    case("tool_call_header_not_array", "tool_call",
         lambda r: attrs(r).update({"http.request.header.content-type": "application/json"}),
         "A request header is a string, not an array of strings.",
         ("/turns/0/events/1/attributes/http.request.header.content-type", "type"))
    case("tool_call_result_not_object", "tool_call",
         lambda r: attrs(r).update({"gen_ai.tool.call.result": TOOL_RETURN}),
         "A tool result that is not a JSON object is in gen_ai.tool.call.result.",
         ("/turns/0/events/1/attributes/gen_ai.tool.call.result", "type"))
    case("prompt_generation_without_catalog_id", "prompt_generation", lambda r: attrs(r).pop("a2ui.prompt.catalog_id"),
         "A prompt generation event has no catalog id.", ("/turns/0/events/1/attributes", "required"))
    case("parse_without_input", "parse", lambda r: attrs(r).pop("a2ui.parse.input"),
         "A parse event has no input text.", ("/turns/0/events/1/attributes", "required"))
    case("component_range_negative_start", "parse",
         lambda r: attrs(r).update({"a2ui.parse.components": [dict(MIN_RANGES[0], start=-1)]}),
         "A component range starts before the input.",
         ("/turns/0/events/1/attributes/a2ui.parse.components/0/start", "minimum"))
    case("check_unknown_name", "check", lambda r: attrs(r).update({"a2ui.check.name": "accessibility"}),
         "A check event names a check the record does not define.",
         ("/turns/0/events/1/attributes/a2ui.check.name", "enum"))

    def finding_without_code(r):
        attrs(r).update({
            "a2ui.check.passed": False,
            "a2ui.check.findings": [{"surfaceId": "main", "path": "/components/0/text", "message": "Text is empty."}],
        })

    case("finding_without_code", "check", finding_without_code,
         "A check finding has no code.", ("/turns/0/events/1/attributes/a2ui.check.findings/0", "required"))
    case("framework_span_without_received_attributes", "framework_span",
         lambda r: attrs(r).pop("a2ui.received.attributes"),
         "A framework span has no received attributes.", ("/turns/0/events/1/attributes", "required"))
    return cases


def write(name, value):
    (OUT / f"{name}.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    lines = [
        "# Turn record v0.1: every fixture validated against",
        "# specification/turn_record/v0_1/json/turn_record.json.",
        "",
    ]

    def emit(name, description, fixture, details=None):
        lines.append(f"- name: {name}")
        lines.append(f"  description: {json.dumps(description)}")
        lines.append("  action: validate_turn_record")
        lines.append(f"  fixture: {json.dumps(fixture)}")
        if details:
            lines.append("  expectError:")
            lines.append("    category: ValidationError")
            lines.append("    details:")
            for d in details:
                lines.append(f"      - path: {json.dumps(d['path'])}")
                lines.append(f"        code: {d['code']}")
        lines.append("")

    for kind, value in MINIMAL.items():
        write(f"minimal_{kind}", value)
        what = "only the turn event" if kind == "turn" else f"the turn event and one {kind} event"
        emit(f"minimal_{kind}", f"A one-turn record holding {what}, with only the required fields.",
             f"{FIXTURE_DIR}/minimal_{kind}.json")
    write("full_record_restaurant_finder", FULL)
    emit("full_record_restaurant_finder",
         "Two turns of upstream's restaurant finder, a list whose first model request gets a 503 and is retried,"
         " then a booking form whose model call is retried after a failed parse, with every kind present.", f"{FIXTURE_DIR}/full_record_restaurant_finder.json")
    write("full_record_custom_components", FULL_CUSTOM)
    emit("full_record_custom_components",
         "Two turns of upstream's custom-components-example, a contact card with an org chart and then the floor"
         " plan its view_location action reads over MCP, with every kind present.",
         f"{FIXTURE_DIR}/full_record_custom_components.json")
    for file, base, change, description in EXTRA_PASS:
        write(file, broken(base, change))
        emit(file, description, f"{FIXTURE_DIR}/{file}.json")
    for file, value, description, details in must_fail():
        write(file, value)
        emit(file, description, f"{FIXTURE_DIR}/{file}.json", details)
    SUITE.parent.mkdir(parents=True, exist_ok=True)
    SUITE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


main()
