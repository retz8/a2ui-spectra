# Sub-task 6.2 — The turn record and the receiver

The turn record's amendments for the A2UI step; the receiver reading the step's spans from any producer and placing a UI section generated outside any turn by its text; the wrapper capture suite's harness, case texts and expected records. Sub-task 6.2 of the Phase 6 spec, `_dev/docs/spec/phase-6-the-a2ui-step.md`, carrying out its decisions 5 to 7, the step's spans, one parse event and A2UI sent as a tool call; 9 to 11, a UI section outside any turn, retries and component ranges; 15, the turn record; and 16, the wrapper capture suite. The record is turn record v0.1, amended in place.

## Scope

- The turn record v0.1 prose and schema, amended in place: the producers section, the new attributes and span events, the reading and placement rules.
- The receiver: a received span read by `a2ui.event.kind`; a `prompt_generation` that falls in no turn placed by its text.
- The wrapper capture suite in `conformance/`: the harness and its contract with the drivers, the case list, the case texts recorded from Gemini and written by hand, the expected records, the recorder and the record-writer.
- The Phase 1 validator suite's fixtures and cases brought to the amended shapes.
- Four receiver capture cases derived by hand for the receiver's new reading.
- Out of scope: the drivers and the wrappers, sub-tasks 6.3 and 6.4; the viewer, 6.5; the acceptance run, 6.6.

## Locked decisions

### 1. Every parse error is an `exception` span event

Each error a parse raised is one `exception` span event on the `parse` event, the error that ended the parse included, with OpenTelemetry's `exception.type`, `exception.message` and, when the producer has one, `exception.stacktrace`. The event's `status` and `error.type` come from the first error. A parse that failed on one error has one event; a stream that read past rejected blocks has one per block.

### 2. What the `exception` event carries

The rejected block's range in the parse input, `a2ui.parse.block.start` and `a2ui.parse.block.end`, UTF-16 code units, start inclusive and end exclusive; optional, left out by an error that belongs to no one block, such as the tree check that runs after every block. The SDK's structured details, `a2ui.parse.error.details`, the list of `{path, code, message, surfaceId?}` as the SDK gives it, only when it gives any.

### 3. The SDK on the event

A new `sdk` area: `a2ui.sdk.name`, the agent SDK's package name, `a2ui-agent-sdk` or `@a2ui/agent`, and `a2ui.sdk.version`, the version the package reports; both optional, on `prompt_generation` and `parse` events. The toolset's parse names the agent SDK, whose parser did the parsing.

### 4. The catalogs

`a2ui.prompt.catalogs`, required on a `prompt_generation`, an array of at least one `{catalogId, protocolVersion}`, the protocol version in the record's own form, `v0.9`, `v0.9.1`, `v1.0`, normalised by the producer. `a2ui.parse.catalogs`, the same shape, optional on a `parse`. `a2ui.prompt.catalog_id` and `a2ui.prompt.catalog_version` are removed.

### 5. A stream

`a2ui.parse.streamed`, boolean, true for a stream. One `a2ui.parse.chunk` span event per `feed`, at the feed's time, carrying `a2ui.parse.chunk.end`, the offset in `a2ui.parse.input` the chunk brought the text to; no text.

### 6. The toolset's parse

A parse made by a tool call carries `gen_ai.tool.name`, `send_a2ui_json_to_client`, `gen_ai.tool.call.id` when the tool context gives one, and `gen_ai.tool.call.result`, the object the tool returned, on success and on failure alike. The tie between the parse and the tool call's span is the parent: a `parse` whose parent is a `tool_call` event belongs to that tool call; failing the parent, a `tool_call` and a `parse` of the same turn with equal `gen_ai.tool.call.id` are the same call. No link joins them.

### 7. The entry point, the input and the span name

Span names stay the kinds, `parse` and `prompt_generation`. `a2ui.parse.entry_point`, required, one of `parse_response`, `open_stream`, `compile` and `tool_call`, the last for the toolset's call whichever path it parses by. `a2ui.parse.wrapped`, optional, `false` when the SDK was told the whole text is one block without tags; absent means wrapped. `a2ui.parse.input` is exactly what the call was given: the whole text, the one block, the joined chunks or the `a2ui_payload` argument. The toolset's prompt generation is one `prompt_generation` whose `ui_section` is exactly the text the toolset appended to the instructions, carrying `gen_ai.tool.name`; a `prompt_generation` has no entry point.

### 8. A failed prompt generation

A `prompt_generation` whose generation failed has `status.code` 2 with the message, `error.type` with the class and one `exception` span event, and no `a2ui.prompt.ui_section`: the attribute is required only when the status is not an error. `a2ui.prompt.inference_format` and `a2ui.prompt.catalogs` stay required.

### 9. The inference format's values

`a2ui.prompt.inference_format` and `a2ui.parse.inference_format` take one of `direct_json`, `express`, `elemental` and `atom`; `a2ui.parse.inference_format` stays optional.

### 10. Reading an A2UI step span

`a2ui.event.kind` is read before any dialect: a received span whose value is `prompt_generation` or `parse` is that kind, with no `a2ui.received.dialect`, and `a2ui.received.attributes` keeps everything as received. Any other value is not honoured; the span is read by its dialect and the attribute stays in the received attributes. The translated names are the record's own, copied: the `a2ui.prompt.`, `a2ui.parse.` and `a2ui.sdk.` names, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.result` and `error.type`, each parsed from its JSON string where the record holds an array or an object, and left out when the value does not fit the record's shape; the span's events pass as received, `a2ui.parse.error.details` on an `exception` event parsed the same way; a name the record does not define stays in the received attributes only. A span missing a required attribute of its kind is written as a `framework_span`, and the terminal says so once per export request and reason, counting the spans. `a2ui.retry.attempt` on a received `model_call` span of any dialect is copied onto the event; the span's own links are kept as they are.

### 11. Placing a `prompt_generation` by its text

The section text is looked for in the turn's `model_call` events from the model proxy, any string value of the request body walked as JSON, and in received `model_call` spans, the text of `gen_ai.system_instructions` and `gen_ai.input.messages`; a request holds the text when one string value contains the whole of it. The search runs on arrival, against every turn of the run so far, open, waiting or written, a written turn amended; and again each time a model call joins a turn of the run, the proxy's at placement and a received one when the receiver places it, against the kept prompt generations, held in memory for the run with no cap. A turn that already holds a `prompt_generation` with equal section text takes no other; a text found in several of a turn's model calls places the event once. The event is written as received, its own trace id and parent, into each turn it is placed in; `wrapper` joins the turn's capture paths; the live stream's `turn_amended` carries it. Only an event that falls in no turn is placed by text.

### 12. The capture path

`wrapper` joins a turn's `a2ui.turn.capture_paths` when a `prompt_generation` or `parse` event is placed in it, beside `otel_receiver`.

### 13. The suite's layout and the job

`conformance/wrapper_capture/capture_v0_1.yaml`, action `capture_wrapper`; data under `test_data/wrapper_capture/v0_1/<case>/`: `input.json`, the driver's job, the case text as a raw text file with the chunk boundaries beside it, and the expected record. The drivers under `conformance/wrapper_driver/python/`, a uv project, and `conformance/wrapper_driver/typescript/`; each driver's own project file brings in its wrapper and the pinned SDK. The job names the languages the case runs in; the inference format; the entry point, `generate`, `parse_response`, `open_stream`, `compile` or `tool_call`; the catalogs by id and protocol version, the basic catalog built in and a custom one as a `catalog.json` path, and any examples; the text, the chunks in order for a stream, or the `a2ui_payload` for the toolset; `wrapped`; `after_rejected_block`; for the toolset, whether a renderer state is bound; and whether the driver runs before the turn opens.

### 14. The run

The harness starts the receiver's listener, opens one turn, a turn event placed by the time window and open while the driver runs, and launches the driver with the job's path as its one argument and the two variables `run` sets, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL`. The driver switches the wrapper on with its one-line form, which starts the tracer provider from those variables, runs the job, lets the SDK's expected error pass and exits 0, the provider's shutdown flushing the export; a failure of the driver's own exits non-zero with its message on stderr and fails the case. The harness then closes the turn and compares the written turn with the expected record. No trace context is handed to the driver.

### 15. The comparison and the shared record

One expected record serves both languages where a format exists in both. The comparison skips, and checks well-formed instead, as the A2A capture suite does: trace, span and parent ids; every time, with order kept; the writer's version; `otel.scope.version`; `exception.stacktrace`, present when the record expects it; and `a2ui.sdk.name` and `a2ui.sdk.version`, which must name the language's package and carry a non-empty version. Everything else is compared exactly, messages and class names included. A case whose error wording or class differs between the languages names an expected record per language: `expect` is one path when shared, else a map by language; a case keeps one file when the two come out equal.

### 16. The cases

Thirty-four cases, each naming the languages it runs in:

- Prompt generation: `<format>_generate` for each of the four formats on the basic catalog; `express_generate_two_catalogs`, the basic catalog and a custom `catalog.json` from `test_data/catalogs/`, both at v1.0; `generate_failed`, catalogs of mixed protocol versions, v0.9 and v0.9.1, verified when the drivers are written and swapped if either SDK rejects it before the generator; `generate_outside_turn`, the driver run before the turn opens and a proxy model call whose request holds the section text placed in the turn.
- Valid parses: `<format>_parse_response` for the four formats; `<format>_open_stream` for Direct JSON and Express; `<format>_compile` for the four formats on the same block; `express_parse_response_unwrapped`.
- Errors, per format: `<format>_malformed_block`, a block the grammar rejects; `<format>_unknown_component`, a block the catalog refuses.
- Errors, format-independent: `surface_already_exists`, the second `createSurface default` of A2UI finding 31, in Direct JSON; `dangling_child`, the tree check after every block, with no block range; `express_open_stream_rejected_block_end`; `express_open_stream_rejected_blocks_continue`, two rejected blocks and a good one read past; `direct_json_open_stream_truncated`, a stream closed inside a block.
- The toolset: `tool_call_without_state`, the per-block `compile` path; `tool_call_with_state`, the bound-state path; `tool_call_catalog_not_found`, the `inline_catalog` reply of A2UI finding 32, the error returned to the model in `gen_ai.tool.call.result`.

### 17. The recordings

A dev tool under `_dev/tools/` on the pinned Python SDK: for each format it builds the processor on the basic catalog at v1.0, generates the prompt with the SDK, sends it with one fixed user message, a card for one restaurant with its name, address, a rating and a button, to `gemini-3.6-flash` as a stream, and keeps the reply as the chunks arrived, the joined text serving the whole-text cases and the chunk boundaries the stream cases. It parses the reply with the SDK before saving and asks again when the reply does not parse. The Gemini key comes from the file CLAUDE.local.md names, passed in the environment and never written. Each saved reply is checked by hand once; the error texts are written by hand. The README's recording line names the model and the SDK and tool versions.

### 18. The expected records

A dev tool under `_dev/tools/` assembles each expected record by running the pinned SDKs on the case's text for the facts the record states, the messages, the error's class, message and details, the partial results, and writes the events in this spec's shapes, each error's block range found by locating the SDK's `raw_content` in the input; the Python side on the pinned SDK from git, the TypeScript side from the `a2ui-upstream` worktree at the pin. The stand-ins for ids and times are the A2A capture suite's. Every record is checked by hand once, the error cases for their messages, and validates against the schema through the existing check on the test data as a whole. The harness's write mode, `SPECTRA_WRITE_WRAPPER_CAPTURE=1`, exists from this sub-task for 6.3 and 6.4; when a driver and a record disagree, the record changes only where it was wrong about what the SDK does, and the disagreement is noted in the sub-task's close-out.

### 19. The derived receiver cases

Four cases in the receiver capture suite, derived by hand, their expected records written by the harness's write mode and checked by hand: `a2ui_step_spans`, an export holding a `prompt_generation` and a `parse` span in their wire form, read into the record's shapes, `wrapper` joining the capture paths; `a2ui_step_malformed`, a `parse` span without `a2ui.parse.input` written as a `framework_span`, with its counted line; `stated_retry`, a `model_call` span carrying `a2ui.retry.attempt` and a link to its parse; `prompt_generation_by_text`, a `prompt_generation` arriving before any turn, then a turn with a proxy model call whose request holds its section text.

### 20. The harness without drivers

The harness looks for each language's driver project under `conformance/wrapper_driver/`, runs a case for the languages it finds and reports the rest skipped by name, so the suite lands green and 6.3 and 6.4 each turn their language's cases on.

### 21. Other documents

- The turn record v0.1 prose and schema, in place: the producers section, the wire forms, the reading rule and the half-formed fallback; the `sdk` area and every attribute and span event of decisions 1 to 9; `catalog_id` and `catalog_version` removed for `catalogs`; the tie by parent; the placement-by-text, retry and component-range rules.
- The Phase 1 validator suite: every fixture brought to the amended shapes, `minimal_parse`, `minimal_prompt_generation`, `prompt_generation_failed`, the two full records, `prompt_generation_without_catalog_id` renamed for `catalogs`; the must-pass and must-fail cases the 1.3 rule of one per unit of the schema asks for the new units.
- `conformance/README.md`: the wrapper capture suite, the job's fields, the drivers' place, the skip, the recorder and the record-writer, the four derived receiver cases.
- The Phase 6 spec, in place: decision 15 gains this spec's record amendments; decision 16 the per-language expected records and the skipping harness; decision 5 the half-formed fallback.
- `_dev/TODO.md`: the 6.2 line names this spec and gains the done line; the 6.3 and 6.4 lines name the driver's place.
- `_dev/a2ui-findings.md`: the two SDKs' divergence, the same errors worded differently and different error classes exposed, Python's Express raising a plain `ExpressValidationError` where TypeScript has `ExpressUnknownComponentError`.

### 22. Done line

Done when the turn record v0.1 prose and schema carry the amendments and every fixture and capture-suite expected record validates; the four derived receiver cases pass; the thirty-four wrapper cases, their texts and expected records are in `conformance/`, the harness reporting both languages skipped by name; the recorder and the record-writer are under `_dev/tools/`; and the gates are green in CI.

## Invariants

- No credential is ever in a record, a fixture, a case text or a commit: the Gemini key is passed to the recorder's process and never written.
- A record states what happened: every received attribute stays as received, and the translated names sit beside it; the retry, the component ranges, the model call a parse read and the parse a component came from are computed when shown, apart from a retry or a range a producer states itself.
