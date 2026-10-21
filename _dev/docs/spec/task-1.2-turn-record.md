# Task 1.2 — The turn record spec's first version

Spec for sub-task 1.2 of Phase 1 — Foundation (`_dev/docs/spec/phase-1-foundation.md`): the turn record's schema, its prose, the `a2ui.` attribute names and the GenAI conventions pin. The Phase 1 spec's decisions on the record's full v1 shape, the spec's location, JSON Schema as the normative form, the GenAI conventions pin, the `a2ui.` namespace and the OpenTelemetry findings apply. SPEC.md's "Turn record" section is the design authority.

## Scope

- The turn record's first version: its JSON Schema, its prose and its README, in their version directory.
- Copies of OpenTelemetry's GenAI content schemas at the pinned commit.
- The `a2ui.` attribute names.
- The GenAI conventions pin, recorded in the prose.
- The OpenTelemetry findings surfaced while designing the record, recorded in `_dev/otel-findings.md`.
- Not in scope: the case list, the fixtures and the validation harness, which are sub-task 1.3, the shared test data.

## Locked decisions

### 1. What a record file holds

One turn, plus the full recordings of the earlier turns of its conversation, in order. Replay sends the earlier turns first to rebuild the agent's session, then the turn itself. A first turn carries no earlier turns. A fixture is a turn record.

### 2. Versioning

A2UI's scheme: versions are written like `v0.1`, with a third part allowed as in A2UI's `v0.9.1`. Each version has its own directory, written like upstream's `v0_9`. Each record declares its version in a top-level field. The first version is `v0.1`.

### 3. Where the spec lives

`specification/turn_record/v0_1/`, holding `json/` for the schemas, `docs/` for the prose, and a README. The test workspace stays `conformance/`.

### 4. The schema's id

The schema file's raw GitHub address on `main`, under its version directory. At the move it changes to upstream's domain, which bumps the version like any other amendment.

### 5. The top level

`version` and `turns`. `turns` lists the turns oldest first, and the recorded turn is the last. Every turn has the same shape: a flat list of its events.

### 6. Events

Events nest like OpenTelemetry spans: each has an id, a parent, a start time and, if it lasts, an end time. Each event uses OTLP's span field names and time format: `traceId`, `spanId`, `parentSpanId`, `name`, `kind`, `startTimeUnixNano`, `endTimeUnixNano`, `attributes`, `events`, `links` and `status`. `attributes` is an object keyed by attribute name, in place of OTLP's typed key and value list. `kind` keeps OTLP's meaning: client, server or internal.

### 7. Event kinds

One attribute, `a2ui.event.kind`, names the kind on every event, and the schema picks each event's rules from it. GenAI events keep `gen_ai.operation.name` as well. The kinds are:

- **Turn:** the root of each turn, from the host's request to the agent's last reply.
- **Wire input:** what the host sent.
- **Wire output:** each piece the agent sent back, in order.
- **Model call:** one call to a model API.
- **Tool call:** one call to a tool over MCP or HTTP, or one run inside the agent's process.
- **Prompt generation:** the UI section the SDK wrote into the prompt, with the inference format and catalog version.
- **Parse:** raw text turned into A2UI messages.
- **Check:** the result of one check run on the turn.
- **Framework span:** any received span that is none of the above.

### 8. The turn event

The turn event follows GenAI's remote agent invocation, a client span with the operation name `invoke_agent`. It carries the agent's name from its card and `gen_ai.conversation.id`. Its outcome, such as completed, failed or waiting for input, is in OTLP's status and in an `a2ui.` outcome attribute. GenAI's required `gen_ai.provider.name` is left out. The turn event also records the A2UI protocol version the turn used, the capture paths active for the turn (wire, model proxy, tool proxy, OpenTelemetry receiver and wrapper), and the writer and its version.

### 9. Wire events

Each wire event is one delivery from the transport, holding its parts in order in GenAI's message and part shape. Text, files and other data use GenAI's part types. A2UI messages go in an A2UI part type, an open part in GenAI's schema. The data model, capabilities and any other metadata are `a2ui.` attributes on the event.

### 10. A call seen by two capture paths

One event per capture path. The proxy's event sits under the turn, and the receiver's event sits in the agent's span tree. When Spectra can tell they are the same call, an OTLP link joins them.

### 11. Proxy exchanges

The request method, URL, headers and response status use OpenTelemetry's stable HTTP attribute names. The request body and the response body are `a2ui.` attributes. A streamed response is recorded as span events, one per chunk, each with its own time and body. A body is parsed JSON when it is JSON, and its text otherwise. A streamed chunk is one server-sent event, its data handled the same way. Replay matches on JSON content.

### 12. Model and tool calls

Model call events carry every GenAI inference attribute their source can fill, the opt-in content attributes included. Gemini is read in full into GenAI names; every other provider keeps only the raw exchange. Tool call events use GenAI's tool attributes, and MCP calls also carry the `mcp.` attributes. Errors use OTLP's status and the core `error.type` attribute.

### 13. The A2UI step

The parse event records the text the parser was given and, for each component it produced, the surface id, the component id, and the start and end of that component's text, counted in UTF-16 code units. A parse or validation error is recorded on the parse event. A retried model call carries an OTLP link to the failed parse event and an `a2ui.` attribute giving its attempt number.

### 14. Check events

One check event per check per turn: schema, catalog, structural or binding. It records whether the check passed, the protocol version and catalog it checked against, and its findings. Each finding uses A2UI's error shape: a code, the surface id, the JSON path and a message. A2UI's codes are used where they fit, and Spectra adds codes for the rest.

### 15. Received spans

A span from the OpenTelemetry receiver keeps the GenAI names the receiver translated, every original attribute unchanged, and the producing scope's name and version. Received spans keep their own trace id. Events Spectra writes itself share the turn's trace id.

### 16. The `a2ui.` names

Names follow OpenTelemetry's naming rules as `a2ui.<area>.<name>`, with the areas `turn`, `wire`, `http`, `prompt`, `parse`, `retry` and `check`, plus `a2ui.event.kind`. Kind values are snake_case, such as `model_call` and `wire_output`. The exact list of names is in the prose.

### 17. Schema files

Spectra's own schema is one file, `turn_record.json`. OpenTelemetry's eight GenAI content schemas are copied unchanged from the pinned commit into the version's `json/` directory and referenced by relative path. The record's schema does not validate the A2UI payloads or the proxy bodies it carries; their validity is reported by check events.

### 18. The prose

`docs/turn_record.md` holds the file shape, each kind's attributes, the `a2ui.` name list, the GenAI pin (`open-telemetry/semantic-conventions-genai` at 8538971b, 2026-10-21, schema version `1.42.0-dev`) and the origin of the copied schemas.

### 19. OpenTelemetry findings

Issues found in the GenAI conventions while designing the record are recorded in `_dev/otel-findings.md`. Each is checked against the pinned commit before it goes in. A finding that rests on MCP's own changelog is checked against MCP's spec first.

## Invariants

- No credential is ever in the record. Credentials are stripped from headers and URLs alike.
- Nothing in the record is transport-specific.
