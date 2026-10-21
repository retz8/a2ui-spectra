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
- **OpenTelemetry.** The receiver writes the spans the agent's process sends: `model_call` and `tool_call` events seen from inside the agent, `prompt_generation` and `parse` events from the A2UI wrapper or a native SDK hook, and `framework_span` events for the rest. These keep their own `traceId` and their own parents. The root of such a tree may have no parent.

Events written at the wire and the network edge share the turn event's `traceId`.

An event that came from the receiver carries `otel.scope.name`, and `otel.scope.version` when the producer gave one. It also carries `a2ui.received.attributes`: every attribute of the span exactly as received. Beside it, the event carries the GenAI and `a2ui.` names the receiver translated from the producer's dialect.

### Links

- **The same call.** A call seen both by a proxy and by the receiver is two events, one per capture path. When the two are known to be the same call, each links to the other.
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

The model proxy reads Gemini in full, into the GenAI names below. For every other provider it records the raw exchange only. Every GenAI inference attribute a source can fill may be present, the opt-in content attributes included. The schema types these:

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

A tool call event lasts from the request to the response. A proxy's event has the turn event as parent and `kind` `3`.

| Attribute                                                                                                                                                        | Type                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `gen_ai.operation.name`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `gen_ai.tool.description`, `gen_ai.agent.name`, `gen_ai.conversation.id` | string                            |
| `gen_ai.tool.call.arguments`                                                                                                                                     | `gen-ai-tool-call-arguments.json` |
| `gen_ai.tool.call.result`                                                                                                                                        | `gen-ai-tool-call-result.json`    |
| `mcp.method.name`, `mcp.session.id`, `mcp.protocol.version`, `mcp.resource.uri`, `jsonrpc.request.id`                                                            | string                            |
| `error.type`                                                                                                                                                     | string                            |

An MCP call carries the `mcp.` attributes. A tool call event may also carry the exchange attributes and the received-span attributes below.

### The exchange

A proxy records the HTTP exchange on its `model_call` or `tool_call` event.

| Attribute                       | Type            | Meaning                                                              |
| ------------------------------- | --------------- | -------------------------------------------------------------------- |
| `http.request.method`           | string          | The request method.                                                  |
| `url.full`                      | string          | The request URL, with credentials removed.                           |
| `http.request.header.<name>`    | array of string | One request header, `<name>` in lowercase, with credentials removed. |
| `http.response.header.<name>`   | array of string | One response header, `<name>` in lowercase.                          |
| `http.response.status_code`     | integer         | The response status.                                                 |
| `server.address`, `server.port` | string, integer | The server the request went to.                                      |
| `a2ui.http.request.body`        | any             | The request body.                                                    |
| `a2ui.http.response.body`       | any             | The response body, when it was not streamed.                         |

A body is the parsed JSON value when it is JSON, and its text otherwise. Replay matches requests on JSON content, ignoring whitespace and key order.

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

| Attribute                     | Type              | Required | Meaning                                         |
| ----------------------------- | ----------------- | -------- | ----------------------------------------------- |
| `a2ui.event.kind`             | string            | yes      | `"check"`.                                      |
| `a2ui.check.name`             | string            | yes      | `schema`, `catalog`, `structural` or `binding`. |
| `a2ui.check.passed`           | boolean           | yes      | Whether the check passed.                       |
| `a2ui.check.protocol_version` | string            | yes      | The A2UI protocol version checked against.      |
| `a2ui.check.catalog_id`       | string            | no       | The catalog checked against.                    |
| `a2ui.check.findings`         | array of findings | yes      | What the check found. Empty when it passed.     |

The checks:

- **`schema`:** the response is A2UI and matches the schema of its protocol version.
- **`catalog`:** the response matches the catalog.
- **`structural`:** every child id points to an existing component, there is exactly one root, and nothing loops back on itself.
- **`binding`:** every path the UI binds to is filled by the data model.

A finding uses A2UI's error shape:

| Field       | Type   | Required | Meaning                             |
| ----------- | ------ | -------- | ----------------------------------- |
| `code`      | string | yes      | The finding's code.                 |
| `surfaceId` | string | no       | The surface it concerns.            |
| `path`      | string | no       | A JSON path to the offending value. |
| `message`   | string | yes      | What is wrong.                      |

A2UI's own codes are used where they fit: `VALIDATION_FAILED`, and in v1.0 `UNALLOWED_PARENT` and `UNALLOWED_CHILD`. Other codes are uppercase snake case, named by the check that reports them.

No other attributes are allowed on check events.

### `framework_span`

A span received from the agent that is none of the other kinds, such as a framework's own agent or step spans.

| Attribute                  | Type   | Required | Meaning                                           |
| -------------------------- | ------ | -------- | ------------------------------------------------- |
| `a2ui.event.kind`          | string | yes      | `"framework_span"`.                               |
| `otel.scope.name`          | string | yes      | The instrumentation scope that produced the span. |
| `otel.scope.version`       | string | no       | Its version.                                      |
| `a2ui.received.attributes` | object | yes      | Every attribute of the span, exactly as received. |

A framework span may also carry names the receiver translated.

### Received-span attributes

| Attribute                  | Type   | Meaning                                           |
| -------------------------- | ------ | ------------------------------------------------- |
| `otel.scope.name`          | string | The instrumentation scope that produced the span. |
| `otel.scope.version`       | string | Its version.                                      |
| `a2ui.received.attributes` | object | Every attribute of the span, exactly as received. |

## The `a2ui.` attributes

Every attribute the record defines itself is in the `a2ui.` namespace, named `a2ui.<area>.<name>` under OpenTelemetry's naming rules.

| Attribute                        | Type                      | On                                     |
| -------------------------------- | ------------------------- | -------------------------------------- |
| `a2ui.event.kind`                | string                    | every event                            |
| `a2ui.turn.outcome`              | string                    | `turn`                                 |
| `a2ui.turn.protocol_version`     | string                    | `turn`                                 |
| `a2ui.turn.capture_paths`        | array of string           | `turn`                                 |
| `a2ui.turn.writer.name`          | string                    | `turn`                                 |
| `a2ui.turn.writer.version`       | string                    | `turn`                                 |
| `a2ui.wire.message`              | object                    | `wire_input`, `wire_output`            |
| `a2ui.wire.data_model`           | object                    | `wire_input`                           |
| `a2ui.wire.capabilities`         | object                    | `wire_input`                           |
| `a2ui.wire.metadata`             | object                    | `wire_input`, `wire_output`            |
| `a2ui.http.request.body`         | any                       | `model_call`, `tool_call`              |
| `a2ui.http.response.body`        | any                       | `model_call`, `tool_call`              |
| `a2ui.http.response.chunk.body`  | any                       | `a2ui.http.response.chunk` span events |
| `a2ui.http.response.chunk.event` | string                    | `a2ui.http.response.chunk` span events |
| `a2ui.http.response.chunk.id`    | string                    | `a2ui.http.response.chunk` span events |
| `a2ui.prompt.ui_section`         | string                    | `prompt_generation`                    |
| `a2ui.prompt.inference_format`   | string                    | `prompt_generation`                    |
| `a2ui.prompt.catalog_id`         | string                    | `prompt_generation`                    |
| `a2ui.prompt.catalog_version`    | string                    | `prompt_generation`                    |
| `a2ui.parse.input`               | string                    | `parse`                                |
| `a2ui.parse.inference_format`    | string                    | `parse`                                |
| `a2ui.parse.messages`            | array                     | `parse`                                |
| `a2ui.parse.components`          | array of component ranges | `parse`                                |
| `a2ui.retry.attempt`             | integer                   | `model_call`                           |
| `a2ui.check.name`                | string                    | `check`                                |
| `a2ui.check.passed`              | boolean                   | `check`                                |
| `a2ui.check.protocol_version`    | string                    | `check`                                |
| `a2ui.check.catalog_id`          | string                    | `check`                                |
| `a2ui.check.findings`            | array of findings         | `check`                                |
| `a2ui.received.attributes`       | object                    | events from the OpenTelemetry receiver |

## Rules

- **No credential is ever in a record.** Credentials are removed from headers and URLs before anything is written.
- **Nothing in a record is transport-specific.** Wire content is written in GenAI's message and part shape, and transport envelopes are not kept.
- **A record states what happened, and check events judge it.** A2UI part content, `a2ui.parse.messages`, the `a2ui.http.` bodies and `a2ui.received.attributes` are not validated against any A2UI or provider schema. A record of a turn whose agent sent invalid A2UI is a valid record.
- **GenAI content attributes validate against the copied schemas.** A value that does not fit, such as a tool result that is not a JSON object, is left out of the GenAI attribute. It remains in the exchange body or in `a2ui.received.attributes`.
- **Text positions count UTF-16 code units.**
