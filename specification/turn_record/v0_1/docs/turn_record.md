# A2UI turn record, v0.1

The turn record is a file format for one turn of an A2UI agent: the request a host sent, everything the agent sent back, and what happened inside the agent in between. A record holds the recorded turn together with the full recordings of the earlier turns of its conversation. A fixture is a turn record.

A record belongs to no language and no transport. Model-call and tool-call fields use the names of OpenTelemetry's GenAI semantic conventions wherever one exists. The A2UI parts use the `a2ui.` names defined here.

The normative definition is [`../json/turn_record.json`](../json/turn_record.json), in JSON Schema draft 2020-12. This document describes it.

## Pinned conventions

| Convention                      | Pin                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OpenTelemetry GenAI conventions | `open-telemetry/semantic-conventions-genai` at `8538971bd11dba723fdd33c804b5a32121827ff7`, 2026-10-21, schema version `1.42.0-dev` |
| OpenTelemetry core conventions  | `v1.44.0`, the version the GenAI conventions pin in `model/manifest.yaml`                                                          |
| GenAI conventions stability     | Development, for every GenAI name used here                                                                                        |

Moving a pin is a spec change and bumps the record version.

### Copied schemas

These eight files are copied unchanged from `model/gen-ai/` at the GenAI commit above, under that repository's Apache 2.0 licence:

- `gen-ai-input-messages.json`
- `gen-ai-output-messages.json`
- `gen-ai-system-instructions.json`
- `gen-ai-tool-definitions.json`
- `gen-ai-tool-call-arguments.json`
- `gen-ai-tool-call-result.json`
- `gen-ai-retrieval-documents.json`
- `gen-ai-memory-records.json`

`turn_record.json` references them by relative path. They declare no `$schema` and no `$id`. A validator loads each one under its address relative to `turn_record.json`'s `$id`, and reads them as draft 2020-12, as the GenAI repository's own tests do. `gen-ai-tool-definitions.json` references the draft-07 meta-schema, and the blob part uses a `binary` format that JSON Schema does not define, so a strict validator needs the draft-07 meta-schema loaded and the `binary` format accepted.

## Versions

- A version is written `v<major>.<minor>`, with an optional third part, as A2UI writes its own versions. This version is `v0.1`.
- Each version has its own directory, written `v<major>_<minor>`, under `specification/turn_record/`.
- Every record declares its version in the top-level `version` field.
- Any amendment bumps the version.
- The schema's `$id` is the raw GitHub address of `turn_record.json` under its version directory.

## The file

```json
{
  "version": "v0.1",
  "turns": [{"events": []}, {"events": []}]
}
```

| Field     | Type   | Required | Meaning                                                    |
| --------- | ------ | -------- | ---------------------------------------------------------- |
| `version` | string | yes      | The record version, `"v0.1"`.                              |
| `turns`   | array  | yes      | The turns of the conversation, oldest first. At least one. |

The recorded turn is the last turn. The turns before it are the earlier turns of the same conversation, recorded in full. Replay sends the earlier turns in order to rebuild the agent's session, then sends the recorded turn. A first turn has no earlier turns.

A turn is an object with one field, `events`: a flat list of the turn's events. Exactly one of them is the turn event.

## Events

Every event is shaped as an OTLP span, using OTLP's JSON field names and encodings, with one change: `attributes` is an object keyed by attribute name, in place of OTLP's typed key and value list.

| Field               | Type    | Required | Meaning                                                                                              |
| ------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `traceId`           | string  | yes      | 32 lowercase hex characters.                                                                         |
| `spanId`            | string  | yes      | 16 lowercase hex characters.                                                                         |
| `parentSpanId`      | string  | per kind | The `spanId` of the parent event, 16 lowercase hex characters.                                       |
| `name`              | string  | yes      | The span name.                                                                                       |
| `kind`              | integer | yes      | OTLP's span kind: `0` unspecified, `1` internal, `2` server, `3` client, `4` producer, `5` consumer. |
| `startTimeUnixNano` | string  | yes      | Nanoseconds since the Unix epoch, as a decimal string. A point-in-time event's time.                 |
| `endTimeUnixNano`   | string  | per kind | Nanoseconds since the Unix epoch, as a decimal string. Present when the event lasts.                 |
| `attributes`        | object  | yes      | The event's attributes, keyed by name. Always holds `a2ui.event.kind`.                               |
| `events`            | array   | no       | Timed points inside the event: OTLP span events, each with `timeUnixNano`, `name` and `attributes`.  |
| `links`             | array   | no       | Links to related events: each with `traceId`, `spanId` and optional `attributes`.                    |
| `status`            | object  | per kind | OTLP's status: `code` `0` unset, `1` ok, `2` error, and an optional `message`.                       |

### Kinds

`a2ui.event.kind` names the kind of every event. The schema picks each event's rules from it.

| Kind                | What it is                                                                  | Parent                                       | End time |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| `turn`              | The root of the turn, from the host's request to the agent's last reply.    | none                                         | required |
| `wire_input`        | What the host sent.                                                         | the turn event                               | none     |
| `wire_output`       | One piece the agent sent back.                                              | the turn event                               | none     |
| `model_call`        | One call to a model API.                                                    | the turn event, or the agent's own span tree | required |
| `tool_call`         | One call to a tool over MCP or HTTP, or one run inside the agent's process. | the turn event, or the agent's own span tree | required |
| `prompt_generation` | The UI section an A2UI SDK wrote into the prompt.                           | the agent's own span tree                    | optional |
| `parse`             | Raw text turned into A2UI messages.                                         | the agent's own span tree                    | optional |
| `check`             | The result of one check run on the turn.                                    | the turn event                               | none     |
| `framework_span`    | A span received from the agent that is none of the kinds above.             | the agent's own span tree                    | required |

### Where events come from

Events come from three capture depths, and each works without the others.

- **The wire.** The transport adapter writes the turn event and the wire events.
- **The network edge.** The model proxy and the tool proxy write `model_call` and `tool_call` events under the turn event.
- **OpenTelemetry.** The receiver writes the spans the agent's process sends: `model_call` and `tool_call` events seen from inside the agent, `prompt_generation` and `parse` events from the A2UI wrapper or a native SDK hook, and `framework_span` events for the rest. These keep their own `traceId` and their own parents. The root of such a tree may have no parent; under trace propagation, a tree carrying the turn's `traceId` has the turn event as its root's parent. A span already in its turn, by its `traceId` and `spanId`, is not written again.

Events written at the wire and the network edge share the turn event's `traceId`.

An event that came from the receiver carries `otel.scope.name`, and `otel.scope.version` when the producer gave one. It also carries `a2ui.received.attributes`: every attribute of the span exactly as received. Beside it, the event carries the GenAI and `a2ui.` names the receiver translated from the producer's dialect, and `a2ui.received.dialect`, the dialect they were read from: `adk`, ADK's own names; `openinference`, OpenInference's; or `genai`, the current GenAI conventions. A span of none of them has no `a2ui.received.dialect`: it is a `framework_span` with nothing translated.

A log record the agent's process sends with span context is kept as one of its span's span events, at the log's time. The span event is named by the log's event name, else by its severity text. Its attributes are the log's attributes as received, with its body under `a2ui.received.log.body` and its severity under `a2ui.received.log.severity_number` and `a2ui.received.log.severity_text`. The receiver translates a span together with the log records attached to it.

### Links

- **The same call.** A call seen both by a proxy and by the receiver is two events, one per capture path. When the two are known to be the same call, each links to the other. A call may be several events on either side: nested spans that each contain the next, such as a framework's model call span around an instrumented client's, are one chain, and each of them links to the proxy's event and it to each; and a span links to every proxy event its client sent inside it, such as a retry.
- **A retry.** A `model_call` that retries after a failed parse links to the `parse` event whose error caused it, and carries `a2ui.retry.attempt`.

A link to a `parse` event is a retry link. A link between two `model_call` events, or between two `tool_call` events, is a same-call link.

## Event kinds in detail

### `turn`

`kind` is `3`, client. The event follows OpenTelemetry's GenAI remote agent invocation: `name` is `invoke_agent {gen_ai.agent.name}`, or `invoke_agent` when the name is unknown. `status` is required: `code` `2` when the outcome is `failed`.

| Attribute                    | Type            | Required | Meaning                                                                                                 |
| ---------------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `a2ui.event.kind`            | string          | yes      | `"turn"`.                                                                                               |
| `gen_ai.operation.name`      | string          | yes      | `"invoke_agent"`.                                                                                       |
| `gen_ai.agent.name`          | string          | no       | The agent's name, from its card.                                                                        |
| `gen_ai.conversation.id`     | string          | no       | The conversation the turn belongs to: A2A's `contextId`, AG-UI's `threadId`.                            |
| `a2ui.turn.outcome`          | string          | yes      | `completed`, `failed`, `cancelled` or `waiting_for_input`.                                              |
| `a2ui.turn.protocol_version` | string          | no       | The A2UI protocol version the turn used, such as `"v0.9.1"`.                                            |
| `a2ui.turn.capture_paths`    | array of string | yes      | The capture paths active for the turn: `wire`, `model_proxy`, `tool_proxy`, `otel_receiver`, `wrapper`. |
| `a2ui.turn.writer.name`      | string          | yes      | The program that wrote the record.                                                                      |
| `a2ui.turn.writer.version`   | string          | yes      | Its version.                                                                                            |

GenAI's required `gen_ai.provider.name` is left out: no provider value applies to an agent reached over an agent protocol.

A turn with no `model_call` event and `model_proxy` in its capture paths had no model call through the model proxy. A turn without `model_proxy` in its capture paths says nothing about model calls at the network edge. The same holds for each capture path.

### `wire_input` and `wire_output`

Each wire event is one delivery from the transport, at the time it was sent or arrived, in delivery order. Wire events have no end time.

`a2ui.wire.message` holds the delivery in GenAI's message and part shape, as defined by `ChatMessage` in `gen-ai-input-messages.json`: a `role` and a list of `parts`. The host's input has the role `user`. The agent's output has the role `assistant`. Text, files and other data use GenAI's part types. A2UI messages use the A2UI part:

```json
{
  "type": "a2ui",
  "content": {"version": "v0.9.1", "createSurface": {"surfaceId": "s1", "catalogId": "basic"}}
}
```

`content` is one A2UI message, or an array of them, as the transport delivered it. It is not validated against any A2UI schema.

A data part that is not A2UI is a generic part of type `data`, its `content` the data.

| Attribute                | Type   | Required | On           | Meaning                                                    |
| ------------------------ | ------ | -------- | ------------ | ---------------------------------------------------------- |
| `a2ui.event.kind`        | string | yes      | both         | `"wire_input"` or `"wire_output"`.                         |
| `a2ui.wire.message`      | object | yes      | both         | The delivery, as a GenAI message.                          |
| `a2ui.wire.data_model`   | object | no       | `wire_input` | The A2UI data model the host sent, as A2UI defines it.     |
| `a2ui.wire.capabilities` | object | no       | `wire_input` | The A2UI capabilities the host sent, as A2UI defines them. |
| `a2ui.wire.metadata`     | object | no       | both         | Any other metadata the delivery carried.                   |

No other attributes are allowed on wire events.

### `model_call`

A model call event lasts from the request to the end of the response. A proxy's event has the turn event as parent and `kind` `3`.

The model proxy reads four APIs in full, into the GenAI names below, on the providers' own hosts: Google's Gemini API, OpenAI's Chat Completions and Responses, and Anthropic's Messages. Every other call, on those hosts or any other, is recorded as the raw exchange only. Every GenAI inference attribute a source can fill may be present, the opt-in content attributes included. The schema types these:

| Attribute                                                                                                                                                                          | Type                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `gen_ai.operation.name`, `gen_ai.provider.name`                                                                                                                                    | string                            |
| `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.model`, `gen_ai.output.type`, `gen_ai.conversation.id`                                                              | string                            |
| `gen_ai.request.max_tokens`, `gen_ai.request.top_k`, `gen_ai.request.seed`, `gen_ai.request.choice.count`                                                                          | integer                           |
| `gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.frequency_penalty`, `gen_ai.request.presence_penalty`, `gen_ai.response.time_to_first_chunk`                 | number                            |
| `gen_ai.request.stream`                                                                                                                                                            | boolean                           |
| `gen_ai.request.stop_sequences`, `gen_ai.response.finish_reasons`                                                                                                                  | array of string                   |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens` | integer                           |
| `gen_ai.system_instructions`                                                                                                                                                       | `gen-ai-system-instructions.json` |
| `gen_ai.input.messages`                                                                                                                                                            | `gen-ai-input-messages.json`      |
| `gen_ai.output.messages`                                                                                                                                                           | `gen-ai-output-messages.json`     |
| `gen_ai.tool.definitions`                                                                                                                                                          | `gen-ai-tool-definitions.json`    |
| `a2ui.retry.attempt`                                                                                                                                                               | integer, from 1                   |
| `error.type`                                                                                                                                                                       | string                            |

A model call event may also carry the exchange attributes and the received-span attributes below, and other GenAI attributes the schema does not list.

### `tool_call`

A tool call event lasts from the request to the response, whichever side asks. A proxy's event has the turn event as parent and `kind` `3`; an event for an operation the server initiated has `kind` `4`, the client's view of a server-initiated operation in the pinned MCP conventions.

| Attribute                                                                                                                                                                              | Type                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `gen_ai.operation.name`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `gen_ai.tool.description`, `gen_ai.prompt.name`, `gen_ai.agent.name`, `gen_ai.conversation.id` | string                            |
| `gen_ai.tool.call.arguments`                                                                                                                                                           | `gen-ai-tool-call-arguments.json` |
| `gen_ai.tool.call.result`                                                                                                                                                              | `gen-ai-tool-call-result.json`    |
| `mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`, `mcp.resource.uri`, `jsonrpc.request.id`, `rpc.response.status_code`                                                      | string                            |
| `error.type`                                                                                                                                                                           | string                            |

An MCP call carries the `mcp.` attributes. A tool call event may also carry the exchange attributes and the received-span attributes below.

The tool proxy writes one event per MCP message:

- **The name.** `{mcp.method.name} {target}`, the target the tool name of a `tools/call`, the prompt name of a `prompts/get` or the resource URI of a `resources/read`; `{mcp.method.name}` alone otherwise.
- **The attributes.** `mcp.method.name`, the JSON-RPC method; `jsonrpc.request.id`, the id as a string, on a request; `mcp.session.id`, the `Mcp-Session-Id` under streamable HTTP, or the HTTP+SSE endpoint URL's `session_id` or `sessionId` parameter; `mcp.protocol.version`, the version the session's `initialize` result negotiated, else the request's `MCP-Protocol-Version` header. A `tools/call` carries `gen_ai.operation.name` `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.arguments` when the params' `arguments` is an object, and `gen_ai.tool.call.result`, the JSON-RPC `result`. A `resources/read` carries `mcp.resource.uri`, and a `prompts/get` `gen_ai.prompt.name`. `server.address` and `server.port` are the original server's.
- **A client's request or notification** is its POST's exchange. Under streamable HTTP, the reply is on the POST: a JSON body is the response body, and a stream is the event's chunks. Under HTTP+SSE, the exchange is the POST with its `202 Accepted`, and the reply, arriving on the session's `GET` stream, is a chunk on the event. The session's `initialize` event starts when its `GET` stream opens, and the stream's `endpoint` event is its first chunk.
- **A message the server sends on its own,** on a `GET` stream: a JSON-RPC response is a chunk on the event of the request with that id in its session; a `notifications/progress` whose `progressToken` is a pending request's `_meta.progressToken` is a chunk on that request's event; any other notification is an event of its own, starting and ending at its arrival, with the message as its one chunk and no exchange; a request is an event of its own, from its arrival, with the message as a chunk, to the arrival of the client's POST carrying the response with that id, that POST's exchange recorded on it. A message inside a POST's own streamed reply is a chunk on that POST's event, whatever its method. A response no pending request is waiting for is an event of its own named `response`, with no `mcp.method.name`; so is a client's POST carrying a response that answers no server request event.
- **The session's end,** a `DELETE` carrying `Mcp-Session-Id`, is a housekeeping event named `DELETE`, with `mcp.session.id` and the exchange and no `mcp.method.name`.
- **A failed call.** A JSON-RPC error is status `code` `2`, the error's code as a string in both `error.type` and `rpc.response.status_code`, and its `message` as the status message. A `tools/call` result with `isError` is `error.type` `tool_error` with status `code` `1`, and carries no `gen_ai.tool.call.result`. A request the client cancels with `notifications/cancelled` ends at the notification with `error.type` `cancelled`; one whose `GET` stream closes before its reply ends then with `error.type` `aborted`.

A request to a tool server that is not an MCP message is an HTTP tool request: a `tool_call` event with the exchange only, named `{method} {path}`, the path without its query.

### The exchange

A proxy records the HTTP exchange on its `model_call` or `tool_call` event.

| Attribute                       | Type            | Meaning                                                                           |
| ------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `http.request.method`           | string          | The request method.                                                               |
| `url.full`                      | string          | The request URL, with credentials removed.                                        |
| `http.request.header.<name>`    | array of string | One request header, `<name>` in lowercase, with credentials removed.              |
| `http.response.header.<name>`   | array of string | One response header, `<name>` in lowercase, with credentials removed.             |
| `http.response.status_code`     | integer         | The response status.                                                              |
| `server.address`, `server.port` | string, integer | The server the request went to.                                                   |
| `a2ui.http.request.body`        | any             | The request body, when it is JSON, text or form-encoded.                          |
| `a2ui.http.response.body`       | any             | The response body, when it was not streamed and it is JSON, text or form-encoded. |

A body is the parsed JSON value when it is JSON, and its text otherwise. A body whose `content-type` is not JSON (`application/json` or `*+json`), not `text/*` and not form-encoded is left out of the exchange; its `content-type` and `content-length` headers stay. Replay matches requests on JSON content, ignoring whitespace and key order.

A removed credential keeps its place: the header, or the URL parameter, stays under its name with the value `REMOVED`, and a URL's `user:pass@` becomes `REMOVED@`.

A streamed response is recorded as span events in `events`, one per server-sent event, in arrival order. Each is named `a2ui.http.response.chunk`, with its arrival time in `timeUnixNano` and these attributes:

| Attribute                        | Type   | Required | Meaning                                                                |
| -------------------------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `a2ui.http.response.chunk.body`  | any    | yes      | The event's data: its parsed JSON value when JSON, its text otherwise. |
| `a2ui.http.response.chunk.event` | string | no       | The server-sent event's `event` field.                                 |
| `a2ui.http.response.chunk.id`    | string | no       | The server-sent event's `id` field.                                    |

The first chunk's time gives the time to the first token.

### `prompt_generation`

The UI section an A2UI SDK generated for the prompt, written by the wrapper or a native SDK hook.

| Attribute                      | Type   | Required | Meaning                                                   |
| ------------------------------ | ------ | -------- | --------------------------------------------------------- |
| `a2ui.event.kind`              | string | yes      | `"prompt_generation"`.                                    |
| `a2ui.prompt.ui_section`       | string | yes      | The text the SDK wrote into the prompt.                   |
| `a2ui.prompt.inference_format` | string | yes      | The inference format, such as `direct_json` or `express`. |
| `a2ui.prompt.catalog_id`       | string | yes      | The catalog the section describes.                        |
| `a2ui.prompt.catalog_version`  | string | no       | The catalog's version, when it has one apart from its id. |
| `error.type`                   | string | no       | The error class, when generation failed.                  |

A `prompt_generation` event may also carry the received-span attributes.

### `parse`

Raw text turned into A2UI messages by an A2UI SDK's parser, written by the wrapper or a native SDK hook. A parse or validation error is recorded on the event: `status` with `code` `2` and the error's message, and `error.type` with its class.

| Attribute                     | Type                      | Required | Meaning                                                                                                |
| ----------------------------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `a2ui.event.kind`             | string                    | yes      | `"parse"`.                                                                                             |
| `a2ui.parse.input`            | string                    | yes      | The text the parser was given.                                                                         |
| `a2ui.parse.inference_format` | string                    | no       | The inference format the parser read.                                                                  |
| `a2ui.parse.messages`         | array                     | no       | The A2UI messages it produced, including those before an error. Not validated against any A2UI schema. |
| `a2ui.parse.components`       | array of component ranges | no       | Which text became which component.                                                                     |
| `error.type`                  | string                    | no       | The error class, when parsing or validation failed.                                                    |

A component range is an object:

| Field         | Type    | Meaning                                                             |
| ------------- | ------- | ------------------------------------------------------------------- |
| `surfaceId`   | string  | The surface the component belongs to.                               |
| `componentId` | string  | The component.                                                      |
| `start`       | integer | Where the component's text starts in `a2ui.parse.input`, inclusive. |
| `end`         | integer | Where it ends, exclusive.                                           |

`start` and `end` count UTF-16 code units.

A `parse` event may also carry the received-span attributes.

### `check`

One check run on the turn. Each turn has at most one check event per check.

| Attribute                     | Type                      | Required  | Meaning                                                                                                                                          |
| ----------------------------- | ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a2ui.event.kind`             | string                    | yes       | `"check"`.                                                                                                                                       |
| `a2ui.check.name`             | string                    | yes       | `schema`, `catalog`, `structural` or `binding`.                                                                                                  |
| `a2ui.check.passed`           | boolean                   | yes       | Whether the check passed: it has no findings.                                                                                                    |
| `a2ui.check.protocol_version` | string                    | yes       | The A2UI protocol version checked against.                                                                                                       |
| `a2ui.check.findings`         | array of findings         | yes       | What the check found. Empty when it passed.                                                                                                      |
| `a2ui.check.skipped`          | array of skipped surfaces | per check | The surfaces the check could not judge. Required on `catalog`, `structural` and `binding`, empty when none was skipped; not allowed on `schema`. |

The checks:

- **`schema`:** each A2UI message the agent sent matches the schema of its protocol version.
- **`catalog`:** each component the agent sent matches its catalog's definition, and so do the function calls and the theme the catalog defines.
- **`structural`:** on each surface the turn touched, as it stands at the turn's close: every child id points to an existing component, a component has the id `root`, every component is reachable from it, nothing loops back on itself, no id is given to two components in one message, and the catalog's composition rules hold; and every surface a message names was created.
- **`binding`:** on the same surfaces, every path the UI binds to has a value in the data model.

A skipped surface is an object:

| Field       | Type   | Required | Meaning                                                                                                                                                                   |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaceId` | string | yes      | The surface.                                                                                                                                                              |
| `catalogId` | string | no       | The catalog id the surface named, when it named one.                                                                                                                      |
| `reason`    | string | yes      | `no_definition`: the catalog id resolves to no definition. `not_created`: the surface does not exist, for lack of a `createSurface` or because the processor rejected it. |

A finding uses A2UI's error shape:

| Field       | Type   | Required | Meaning                                                     |
| ----------- | ------ | -------- | ----------------------------------------------------------- |
| `code`      | string | yes      | The finding's code.                                         |
| `surfaceId` | string | no       | The surface it concerns.                                    |
| `path`      | string | no       | A JSON Pointer from the turn object to the offending value. |
| `message`   | string | yes      | What is wrong.                                              |

`path` runs from the turn object through the wire output event, its part, the part's content and, for an array of messages, the message's index, such as `/events/9/attributes/a2ui.wire.message/parts/2/content/updateComponents/components/6/value`. It points at the offending value: a schema or catalog finding at the property, a dangling child at the child id itself, an unfilled binding at the binding object, an unreachable component at the component, a surface never created at the first message of the turn that names it. A finding about a whole surface, or about a component that an earlier turn's message carried, has no path and names the component and the surface in its message. Findings are ordered by the message and the component they point at; findings with no path come last.

The codes:

| Code                                  | Check               | When                                                                                                                                           |
| ------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`                   | `schema`, `catalog` | A message fails its version's schema, or names no message type or several; a component, function call or theme fails its catalog's definition. |
| `SCHEMA_VERSION_MISSING`              | `schema`            | A message with no `version` string.                                                                                                            |
| `SCHEMA_VERSION_UNSUPPORTED`          | `schema`            | A `version` other than v0.9, v0.9.1 and v1.0.                                                                                                  |
| `SCHEMA_NOT_AN_OBJECT`                | `schema`            | Content, or an element of an array, that is not a JSON object.                                                                                 |
| `SCHEMA_VERSIONS_MIXED`               | `schema`            | The agent's messages in one turn declare more than one version.                                                                                |
| `COMPONENT_UNKNOWN`                   | `catalog`           | A component type the catalog does not define.                                                                                                  |
| `FUNCTION_UNKNOWN`                    | `catalog`           | A function the catalog does not define.                                                                                                        |
| `CHILD_NOT_FOUND`                     | `structural`        | A child id with no component.                                                                                                                  |
| `COMPONENT_UNREACHABLE`               | `structural`        | A component the root does not reach.                                                                                                           |
| `ROOT_MISSING`                        | `structural`        | No component with the id `root`.                                                                                                               |
| `CYCLIC_REFERENCE`                    | `structural`        | A component that reaches itself.                                                                                                               |
| `DUPLICATE_COMPONENT_ID`              | `structural`        | An id given to two components in one message.                                                                                                  |
| `SURFACE_NOT_CREATED`                 | `structural`        | A message names a surface that no `createSurface` created.                                                                                     |
| `UNALLOWED_PARENT`, `UNALLOWED_CHILD` | `structural`        | A composition rule of a v1.0 catalog is broken; A2UI's own codes.                                                                              |
| `BINDING_PATH_UNFILLED`               | `binding`           | A bound path with no value in the data model.                                                                                                  |
| `BINDING_LIST_NOT_ARRAY`              | `binding`           | A template's list path whose value is not an array.                                                                                            |

A2UI's own codes are used where they fit. The others are uppercase snake case, named by the check that reports them.

No other attributes are allowed on check events.

### `framework_span`

A span received from the agent that is none of the other kinds, such as a framework's own agent or step spans.

| Attribute                  | Type   | Required | Meaning                                           |
| -------------------------- | ------ | -------- | ------------------------------------------------- |
| `a2ui.event.kind`          | string | yes      | `"framework_span"`.                               |
| `otel.scope.name`          | string | yes      | The instrumentation scope that produced the span. |
| `otel.scope.version`       | string | no       | Its version.                                      |
| `a2ui.received.dialect`    | string | no       | The dialect its translated names were read from.  |
| `a2ui.received.attributes` | object | yes      | Every attribute of the span, exactly as received. |

A framework span may also carry names the receiver translated.

### Received-span attributes

| Attribute                  | Type   | Meaning                                                                  |
| -------------------------- | ------ | ------------------------------------------------------------------------ |
| `otel.scope.name`          | string | The instrumentation scope that produced the span.                        |
| `otel.scope.version`       | string | Its version.                                                             |
| `a2ui.received.dialect`    | string | `adk`, `openinference` or `genai`, the dialect its names were read from. |
| `a2ui.received.attributes` | object | Every attribute of the span, exactly as received.                        |

A span event that is a received log record carries:

| Attribute                           | Type    | Meaning                            |
| ----------------------------------- | ------- | ---------------------------------- |
| `a2ui.received.log.body`            | any     | The log record's body.             |
| `a2ui.received.log.severity_number` | integer | Its severity number, from 1 to 24. |
| `a2ui.received.log.severity_text`   | string  | Its severity text.                 |

## The `a2ui.` attributes

Every attribute the record defines itself is in the `a2ui.` namespace, named `a2ui.<area>.<name>` under OpenTelemetry's naming rules.

| Attribute                           | Type                      | On                                     |
| ----------------------------------- | ------------------------- | -------------------------------------- |
| `a2ui.event.kind`                   | string                    | every event                            |
| `a2ui.turn.outcome`                 | string                    | `turn`                                 |
| `a2ui.turn.protocol_version`        | string                    | `turn`                                 |
| `a2ui.turn.capture_paths`           | array of string           | `turn`                                 |
| `a2ui.turn.writer.name`             | string                    | `turn`                                 |
| `a2ui.turn.writer.version`          | string                    | `turn`                                 |
| `a2ui.wire.message`                 | object                    | `wire_input`, `wire_output`            |
| `a2ui.wire.data_model`              | object                    | `wire_input`                           |
| `a2ui.wire.capabilities`            | object                    | `wire_input`                           |
| `a2ui.wire.metadata`                | object                    | `wire_input`, `wire_output`            |
| `a2ui.http.request.body`            | any                       | `model_call`, `tool_call`              |
| `a2ui.http.response.body`           | any                       | `model_call`, `tool_call`              |
| `a2ui.http.response.chunk.body`     | any                       | `a2ui.http.response.chunk` span events |
| `a2ui.http.response.chunk.event`    | string                    | `a2ui.http.response.chunk` span events |
| `a2ui.http.response.chunk.id`       | string                    | `a2ui.http.response.chunk` span events |
| `a2ui.prompt.ui_section`            | string                    | `prompt_generation`                    |
| `a2ui.prompt.inference_format`      | string                    | `prompt_generation`                    |
| `a2ui.prompt.catalog_id`            | string                    | `prompt_generation`                    |
| `a2ui.prompt.catalog_version`       | string                    | `prompt_generation`                    |
| `a2ui.parse.input`                  | string                    | `parse`                                |
| `a2ui.parse.inference_format`       | string                    | `parse`                                |
| `a2ui.parse.messages`               | array                     | `parse`                                |
| `a2ui.parse.components`             | array of component ranges | `parse`                                |
| `a2ui.retry.attempt`                | integer                   | `model_call`                           |
| `a2ui.check.name`                   | string                    | `check`                                |
| `a2ui.check.passed`                 | boolean                   | `check`                                |
| `a2ui.check.protocol_version`       | string                    | `check`                                |
| `a2ui.check.findings`               | array of findings         | `check`                                |
| `a2ui.check.skipped`                | array of skipped surfaces | `check`                                |
| `a2ui.received.dialect`             | string                    | events from the OpenTelemetry receiver |
| `a2ui.received.attributes`          | object                    | events from the OpenTelemetry receiver |
| `a2ui.received.log.body`            | any                       | received log records' span events      |
| `a2ui.received.log.severity_number` | integer                   | received log records' span events      |
| `a2ui.received.log.severity_text`   | string                    | received log records' span events      |

## Rules

- **No credential is ever in a record.** Credentials are removed from headers and URLs before anything is written: the value becomes `REMOVED`, the name is kept.
- **Nothing in a record is transport-specific.** Wire content is written in GenAI's message and part shape, and transport envelopes are not kept.
- **A record states what happened, and check events judge it.** A2UI part content, `a2ui.parse.messages`, the `a2ui.http.` bodies and `a2ui.received.attributes` are not validated against any A2UI or provider schema. A record of a turn whose agent sent invalid A2UI is a valid record.
- **GenAI content attributes validate against the copied schemas.** A value that does not fit, such as a tool result that is not a JSON object, is left out of the GenAI attribute. It remains in the exchange body or in `a2ui.received.attributes`.
- **Text positions count UTF-16 code units.**
