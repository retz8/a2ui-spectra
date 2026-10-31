# Sub-task 5.4 — The OTLP/HTTP receiver

The OTLP/HTTP receiver: traces and logs received from the agent's process, each producer's dialect translated into the turn record, spans placed in their turns and linked to the proxies' events; `run`'s OpenTelemetry variables and the content capture switch; the receiver capture suite in `conformance/`. Sub-task 5.4 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, carrying out its decisions 9 to 12 and 17, the receiver's signals, the dialects, content capture, one call seen by two capture paths and the turn record, and its decisions 4 and 5, placing a call or a span in its turn and what cannot be placed, as they apply to received spans and logs.

## Scope

- The receiver's listener, the two OTLP encodings, traces and logs taken, metrics dropped.
- The variables `run` sets for the receiver and the content capture switch; what `attach` prints; the API's list of them.
- Decoding the wire, from the OTLP schema copied at a pinned release.
- Every received span as an event: its dialect, its kind, the names translated from each of the three dialects.
- Placing spans in their turns, a written turn amended, the unplaced counted.
- Log records attached to their spans and read by the translation.
- Links between the proxies' events and received spans.
- The live stream's amendments.
- The receiver capture suite in `conformance/`, and the recording of the live runs' exports.
- The turn record prose's amendments.

Out of scope: tool calls, spans and the timeline in the viewer, sub-task 5.6; the acceptance run through the tunnel, sub-task 5.7; the wrapper's `prompt_generation` and `parse` spans, Phase 6; OTLP over gRPC, after v1; passing exports on to the adopter's own collector, backlog. LiteLLM's own OpenTelemetry callback is not a named target; in its current-conventions mode the GenAI reader reads it like any other.

## Locked decisions

### 1. The receiver's address

The receiver has its own listener on loopback, on `--receiver-port`, default 9823, under the rules the other ports follow: command line only, a taken port an error at start, no two of Spectra's ports the same. The tool proxy's ports come after it, the first on `--tool-proxy-port`, default 9824, so that any number of tool servers takes ports no other default holds. `OTEL_EXPORTER_OTLP_ENDPOINT` is the listener's origin; the exporters append the signal paths themselves.

### 2. What the receiver accepts

`/v1/traces` and `/v1/logs` are read; `/v1/metrics` is answered and dropped. Both OTLP encodings are read, `application/x-protobuf` and `application/json`, gzip included. A request that was read is answered `200` with an empty export response; a body that cannot be decoded is answered `400`. The HTTP headers of an export request are never recorded.

### 3. Decoding

The OTLP `.proto` files are copied from `open-telemetry/opentelemetry-proto` at v1.11.1 with their notice, the way the GenAI content schemas were copied. The code generated from them is checked in, the generator a dev dependency with a script target, so the build needs no protobuf compiler; `@bufbuild/protobuf` is the one runtime dependency. Both encodings are brought to the OTLP/JSON shape, trace and span ids as hex, times as decimal strings, enums as integers, which is the shape the record already uses.

### 4. The variables `run` sets

`run` sets `OTEL_EXPORTER_OTLP_ENDPOINT` to the receiver, `OTEL_EXPORTER_OTLP_PROTOCOL` to `http/protobuf`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` to `true` unless Spectra's own environment already sets it. An endpoint or protocol variable already set to another value in Spectra's environment, the generic one or a signal-specific one such as `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, is replaced, and the terminal says once at start which variables were replaced and from what; a signal-specific variable that is not set is left unset. Exports are not passed on to the adopter's own collector. ADK's, OpenInference's and OpenLLMetry's own switches keep their defaults.

The pinned conventions name the content capture variable only as an example of an opt-in and define no values. `true` is read as `EVENT_ONLY`, content in log records, by ADK and by LiteLLM's callback; as on by the instrumentations that read the variable as a boolean; and as no content, with a warning, by the ones built on `opentelemetry-util-genai`, whose adopters set their own value.

### 5. What `attach` prints

After the model and tool lines, one `export` line for each of the three variables of decision 4, each ending in the comment that it is Spectra's receiver. `GET /api/context` lists them after the model and tool variables, so the first screen's block needs no change.

### 6. Every span an event; its dialect and its kind

Every received span becomes one event, nothing filtered, with `otel.scope.name`, `otel.scope.version` and `a2ui.received.attributes` as the record has them, OTLP's `kind` and `status` as received, and the span's own `events` and `links` as received. The dialect is read from the span and written on the event as `a2ui.received.dialect`:

| Dialect | Read when | `a2ui.received.dialect` |
| --- | --- | --- |
| ADK | The scope is `gcp.vertex.agent` | `adk` |
| OpenInference | `openinference.span.kind` is present | `openinference` |
| The current GenAI conventions | `gen_ai.operation.name` is present | `genai` |
| None | Otherwise: a `framework_span` with nothing translated | absent |

The kind follows the dialect's own operation marker. `model_call`: ADK's `call_llm` and `generate_content {model}`; OpenInference's `LLM` and `EMBEDDING`; the conventions' inference operations, `chat`, `generate_content`, `text_completion` and `embeddings`. `tool_call`: ADK's `execute_tool {name}`; OpenInference's `TOOL`; the conventions' `execute_tool`. Everything else, `invoke_agent`, `AGENT`, `CHAIN` and the rest, is a `framework_span`.

### 7. The translation

Each dialect's reader writes the record's `model_call` and `tool_call` names beside the received attributes. A value that does not fit the copied GenAI schemas is left out of the GenAI attribute and stays in `a2ui.received.attributes`, the record's rule. Finish reasons are normalised as the model proxy's readers normalise them. `gen_ai.usage.cache_creation.input_tokens`, the name the Python conventions package, OpenLLMetry and LiteLLM write, is read as `gen_ai.usage.cache_write.input_tokens`, the pinned conventions' name.

ADK, tested at 2.3.0, the fork's lock:

| Point | Read from |
| --- | --- |
| `call_llm`: the request, the settings, the system instructions, the tool definitions and the input messages | `gcp.vertex.agent.llm_request` |
| `call_llm`: the output messages | `gcp.vertex.agent.llm_response` |
| `call_llm`, `generate_content {model}`: tokens, finish reasons, the request model | The `gen_ai.` names as written |
| `gen_ai.provider.name` | `gen_ai.system` on `generate_content {model}`: `gemini` as `gcp.gemini`, `vertex_ai` as `gcp.vertex_ai`; the literal `gcp.vertex.agent` on `call_llm` is not a provider |
| `gen_ai.conversation.id` | `gcp.vertex.agent.session_id`, or the attribute as written |
| `generate_content {model}` under the opt-in to the current conventions | The content attributes as written, and the `gen_ai.client.inference.operation.details` log record |
| `generate_content {model}` on the default path | The `gen_ai.system.message`, `gen_ai.user.message` and `gen_ai.choice` log records, whose bodies carry content when capture is on |
| `execute_tool {name}`: the tool name, description, call id and type | The `gen_ai.tool.` names as written |
| `execute_tool {name}`: arguments and result | `gcp.vertex.agent.tool_call_args` and `gcp.vertex.agent.tool_response` |

OpenInference, tested with its LiteLLM instrumentation at 0.1.52:

| Point | Read from |
| --- | --- |
| `gen_ai.operation.name` | `chat` for `LLM`, `embeddings` for `EMBEDDING` |
| `gen_ai.request.model` | `llm.model_name` |
| `gen_ai.provider.name` | `llm.provider`, its known values mapped to the conventions' and the rest as written |
| Tokens | `llm.token_count.prompt`, `.completion`, `.prompt_details.cache_read`, `.prompt_details.cache_write`, `.completion_details.reasoning` |
| The settings | `llm.invocation_parameters` |
| The input and output messages | The flattened `llm.input_messages.{i}.message.*` and `llm.output_messages.{i}.message.*`, roles, text, tool calls and tool results |
| The tool definitions | `llm.tools.{i}.tool.json_schema` |
| `TOOL`: the tool name, arguments and result | `tool.name`, `input.value` and `output.value` |

The current GenAI conventions, tested with OpenLLMetry's LiteLLM instrumentation at 0.62.4:

| Point | Read from |
| --- | --- |
| Every name the pinned conventions define | As written |
| `gen_ai.provider.name` | As written, else `gen_ai.system` |
| The content attributes | `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions` and `gen_ai.tool.definitions`, parsed when they arrive as JSON strings; the `gen_ai.client.inference.operation.details` log record; the `gen_ai.{role}.message` and `gen_ai.choice` log records |
| The producer's own names, such as `llm.usage.total_tokens` and `llm.is_streaming` | Left in the received attributes |

### 8. Placing a span

A span carrying a turn's trace id belongs to that turn, whether the turn is open, waiting for its calls or already written. Any other span belongs to the turn whose time range holds the span's start time, when exactly one does, an open turn's range ending at the present. The turns of this Spectra run, open, waiting and written, are remembered with their ranges in memory, with no cap; a turn an earlier run left in the store is never amended. A span placed in a written turn amends the record in the store; the turn's end time stays the agent's last reply and the checks are not run again. A span already in its turn, by trace id and span id, is ignored. A received tree keeps its own parents; under trace propagation its root's parent is the turn event.

### 9. What cannot be placed

A span whose start falls in no turn's range or in two is not recorded. The terminal says so once per export request and reason, counting the spans and log records it dropped, with their scopes and the span of time they started in. The Phase 5 spec's decision 5 gains this wording for received spans and logs.

### 10. Log records

A log record carrying span context is attached to its span as one of the span's events: the log's time, its event name as the event's name, else its severity text, the log's attributes as received, and its body and severity under `a2ui.received.log.` names. The translation of a span reads the span's attributes and its attached logs together; a log that attaches after the span was placed translates the span again and the event is amended.

A log whose span has not arrived is held in memory, with no cap, until the span arrives; a span that ends unplaced takes its held logs with it. A log without span context is dropped, counted in the terminal line of decision 9.

### 11. Links

A proxy's event and a received span are the same call through trace context when the exchange's `traceparent` names a received span: the same call is that span when it is a model call span, or a tool call span for a tool proxy exchange, else its nearest such ancestor, and every such span above it in the chain, and every span of the kind nested in that nearest one whose time range holds the exchange's start, such as a LiteLLM span its instrumentation did not make current around the request, when they all stay one chain. Without trace context, the same call is the model call span, or tool call span, of the same turn whose time range holds the exchange's start time. Nested spans that each contain the next, such as ADK's `call_llm` around its `generate_content {model}` around an OpenInference or OpenLLMetry LiteLLM span, are one chain and count as one; the exchange links to every model call span in the chain and each links back. Two containing spans that are not ancestor and descendant leave the exchange unlinked. Every exchange whose start a span's range holds links to it, so one span links back to several exchanges when the agent's SDK retried inside it. The record's `links` holds them all; a span's own links as received stay beside them.

### 12. The capture path

`otel_receiver` joins a turn's `a2ui.turn.capture_paths` when the first span is placed in it, amended into the turn event, under `run` and `attach` alike.

### 13. Resource attributes

The resource an export carries is not recorded.

### 14. The live stream

One event, `turn_amended`, `{traceId, events}`: for each turn an export request touched, the events it added or changed, in the record's shape — the placed spans, the proxy events whose links grew, the turn event when its capture paths changed, a span whose attached logs changed its translation. A subscriber replaces by span id. The catch-up for a new subscriber includes the spans placed so far in each open turn.

### 15. The live runs' set-up

The samples' code and the fork's lock are untouched. For a live run the packages are added to the run alone: the OpenTelemetry distro and the OTLP HTTP exporter at least, which make the ADK samples export under `opentelemetry-instrument`; the bootstrap set, which `opentelemetry-bootstrap` picks for the sample's environment, adds the ASGI instrumentation that reads the wire proxy's `traceparent`, so that the tree carries the turn's trace id, and the HTTP client instrumentation that puts a `traceparent` on the proxied request. The tool's README gives the standard recipe: the distro, the exporter and `opentelemetry-bootstrap`.

### 16. The receiver capture suite

A suite in `conformance/` beside the model and tool capture suites: each case is the recorded OTLP/JSON export requests of one run and its expected record; the harness opens a turn, posts the requests to the receiver, closes the turn and compares, exact except for Spectra's own ids and the ids its links name. The exports are recorded from the live runs of decision 18 by a recording tool under `_dev/tools/` and checked by hand once; the expected records join the shared test data and validate against the turn record schema. The cases: ADK by the time window, ADK by trace context, ADK opted in to the current conventions with content in the log record, OpenInference, OpenLLMetry, logs arriving before their span, a span no turn holds and one two turns hold, a nesting chain, and a span with several exchanges.

### 17. Done line

Done when, with the real binary, under `run`: the Python restaurant finder on Gemini writes, with the distro and the exporter alone, a turn holding ADK's tree, `invocation`, `invoke_agent restaurant_agent`, `call_llm` and `generate_content gemini-3.6-flash` with a2a-sdk's spans among them, placed by the time window, `call_llm` and `generate_content` linked to the model proxy's calls by time containment; with the bootstrap set, the same turn placed by its trace id, the tree's root under the turn event, the links made by trace context; with the bootstrap set and the opt-in to the current conventions, a `gen_ai.client.inference.operation.details` log attached to `generate_content` as a span event and `gen_ai.input.messages` translated from it; and the custom-components example on Gemini writes, under OpenInference and then under OpenLLMetry, a turn whose LiteLLM span sits inside ADK's chain, the whole chain linked to the model proxy's call, `a2ui.received.dialect` `openinference` and `genai` in turn. Each turn is read from the record `GET /api/turns/<trace id>` serves, and each run's export is recorded for the suite. Under `attach`: the restaurant finder restarted with the three printed exports writes a turn amended after it closed, and `GET /api/context` lists the three variables after the model and tool ones. The tunnel is sub-task 5.7's.

### 18. Other documents

- The Phase 5 spec, amended in place: decision 4 gains placing by the span's start time against this run's turns and amending a written turn; decision 5 the counted line of decision 9; decision 9 the shape of a log as a span event; decision 11 the value `true`; decision 12 containment by the exchange's start, the nesting chain and one span with several exchanges; a new decision for the receiver's port and the replaced variables; the backlog gains passing exports on to the adopter's own collector.
- The turn record prose and schema: a received log as a span event with its `a2ui.received.log.` names; `a2ui.received.dialect`; a received tree's root may have the turn event as its parent; a same-call link may be several; a span already in its turn is ignored.
- SPEC.md: Capture's OpenTelemetry gains that the receiver takes traces and logs, its port, the replaced variables and the recipe; Capture's Redirection the content switch's value; the adopter-path table's "an OpenTelemetry exporter switched on" becomes launching under `opentelemetry-instrument`; the OpenTelemetry bullet's ADK version becomes the one tested.
- The tool's README: the receiver, `--receiver-port`, the three variables under Redirection and in what `attach` prints, the replaced-variables line and the counted line, `turn_amended`, the recipe. The config schema is unchanged.
- `conformance/README.md`: the receiver capture suite and how to record a case.
- `_dev/TODO.md`: the 5.4 line names this spec and gains the done line.
- `_dev/otel-findings.md`, per the Phase 5 spec's decision 20, each checked against the pinned conventions first: the Phase 5 spec's candidate on ADK's cache token name is rewritten — the name that disagrees with the pinned conventions' `cache_write` is the Python conventions package's `cache_creation`, which OpenLLMetry and LiteLLM follow; the conventions naming the content capture variable only in a footnote, with no values; ADK 2.3.0 writing the literal `gcp.vertex.agent` as `gen_ai.system` on `call_llm` and the deprecated `gen_ai.system` only; a2a-sdk 0.3.25 not reading an incoming `traceparent`.

## Invariants

- No credential is ever in a record: the receiver records no HTTP header of an export request.
- A record states what happened: every received attribute stays as received, and the translated names sit beside it.
- The samples' code and the fork's lock are unchanged; what a live run needs is added to that run alone.

## Open items

- Which HTTP client LiteLLM's async path uses, httpx or aiohttp, decides which client instrumentation the bootstrap set needs for the custom-components runs; checked at the first live run.
- Whether `opentelemetry-instrument` configures the OTLP log exporter by default, so that ADK's log records arrive without a further variable; checked at the first live run.
