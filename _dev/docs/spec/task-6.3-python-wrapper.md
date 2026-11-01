# Sub-task 6.3 — The Python wrapper

`a2ui-spectra-instrumentation` for Python on upstream's agent SDK at the pin, the Python driver passing the wrapper capture suite, and the documents. Sub-task 6.3 of the Phase 6 spec, `_dev/docs/spec/phase-6-the-a2ui-step.md`, carrying out its decisions 1 to 4, the SDKs at the pin, the inference formats, the package and switching the wrapper on; 5 to 7, the step's spans, one parse event and A2UI sent as a tool call; and the Python half of 16, the wrapper capture suite. The record is turn record v0.1 as sub-task 6.2 amended it.

## Scope

- The package `a2ui-spectra-instrumentation`, module `a2ui_spectra_instrumentation`, under `python/a2ui_spectra_instrumentation/`: the hooks, the pinned-API check, the two ways of switching it on, the tracer provider it starts, its tests.
- The Python driver under `conformance/wrapper_driver/python/`, passing every wrapper capture case that names Python.
- The root uv workspace and the Python gates in CI.
- The documents and the findings.
- Out of scope: the TypeScript wrapper, 6.4; the viewer, 6.5; the acceptance run, 6.6, which runs the wrapper live against the agents on both routes; the released SDK, PyPI's `a2ui-agent-sdk` 0.9.0; a second SDK API shape in the wrappers, backlog.

## Locked decisions

### 1. Where the wrapper hooks

The wrapper hooks the format classes and the toolset, not the processor. On the agent SDK: `Parser.parse_response` on the base class; `compile` on the Direct JSON, Express, Atom and Elemental parsers; `open_stream` on the Direct JSON and Express parsers and `feed` and `close` on their two stream classes; `generate` on the four prompt generators; `RendererState.check_topology` and `validate_payload` from `a2ui.utils`. On `a2ui-adk`: `SendA2uiToClientToolset.get_tools`, with `run_async` patched on the returned tool named `send_a2ui_json_to_client`, and `SendA2uiToClientToolset.process_llm_request`.

`parse_response` is the `parse` event with entry point `parse_response`; `open_stream` the `parse` event with entry point `open_stream`, one per stream object; `compile`, when outermost, the `parse` event with entry point `compile`; `generate` the `prompt_generation` event. The tool's `run_async` is the `parse` event with entry point `tool_call`, the dict the tool returned as `gen_ai.tool.call.result` and the errors its inner calls raised recorded on it before the toolset swallows them. `process_llm_request` is one `prompt_generation` whose `a2ui.prompt.ui_section` is exactly the text it appended to the instructions, carrying `gen_ai.tool.name`. A prompt generator's section method called on its own is not an event.

### 2. One event per outermost call

A context-local variable holds the open event. A hooked call made while an event is open opens no event. The inner `compile` annotates the open event with the block being compiled.

### 3. An error's block

The current block is set on `compile` entry from the text the SDK handed it, for whole-text parsing and the toolset; for a stream, it is the last block `parser.unwrap` finds in the input fed so far. Its range is that block text located in the input from a moving cursor, in UTF-16 code units. The hooks on `check_topology` and `validate_payload` mark a whole-tree check on the same context variable; an error raised under the marker carries no block. The current block is cleared when a whole-tree check starts.

### 4. The pinned-API check

Before patching, the wrapper checks a version floor, `a2ui-agent-sdk > 0.9.0`, and that every name it hooks resolves to a callable. The check is per distribution. The agent SDK's core names — `Parser.parse_response`, `RendererState.check_topology`, `validate_payload`, and Direct JSON's and Express's parser, stream and generator — stand or fall together. Atom's and Elemental's parser and generator are each patched when present and skipped at DEBUG when not. The toolset's two names stand or fall together; `a2ui-adk` not installed logs nothing. A refusal is one WARNING line through the standard `logging` module under the logger `a2ui_spectra_instrumentation`, naming the distribution and version found, the first missing name, and the pin the wrapper was written against. Only public names are hooked. Each hook reads the call's arguments by binding them to the wrapped call's signature. The hooked names are one table.

### 5. A stream's span

A stream's span opens at `open_stream` and ends when `close` returns or raises, or when a `feed` raises. Each `feed` is one `a2ui.parse.chunk` span event carrying the UTF-16 length of the input fed so far; `a2ui.parse.input` is the joined chunks, set when the span ends. A `feed` after the stream has ended passes the SDK's `ValueError` through with nothing recorded. An abandoned stream — never closed, never raising — has its span never ended and never exported.

### 6. The public surface

`A2uiInstrumentor`, an OpenTelemetry `BaseInstrumentor`, registered in the `opentelemetry_instrumentor` entry-point group for `opentelemetry-instrument`; and module-level `instrument()` and `uninstrument()` that call it, the one-line form. `instrument()` runs the check of decision 4, applies the hooks, starts the provider as decision 7 says, and accepts `tracer_provider=`. `uninstrument()` removes every hook; a provider the wrapper started stays. A second `instrument()` gets `BaseInstrumentor`'s own warning and does nothing.

### 7. The tracer provider

When the process has no tracer provider — the global one is OpenTelemetry's proxy — and the environment names an endpoint, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, and the protocol, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`, is unset or `http/protobuf`, the wrapper sets an SDK `TracerProvider` on the SDK's default resource, with a `BatchSpanProcessor` on the OTLP/HTTP exporter. Otherwise one log line says what was missing or what protocol was named, no provider is started, and the hooks are applied with a tracer from the proxy, so a provider set later receives the spans. A provider already set is kept. Nothing is added to the resource.

### 8. The package

`python/a2ui_spectra_instrumentation/`: distribution `a2ui-spectra-instrumentation`, module `a2ui_spectra_instrumentation`, `requires-python >= 3.10`, built with `hatchling`, static version `0.0.1` in step with the TypeScript packages. Hard dependencies: `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation` and `wrapt`, with floors at which the pinned `a2ui-adk`'s cap on OpenTelemetry still resolves, verified at the first sync. The agent SDK is not a dependency; the floor of decision 4 is the `instruments` extra. The instrumentation scope is `a2ui-spectra-instrumentation`, its version the package's.

### 9. The root uv workspace

A `pyproject.toml` at the repository root, not itself a package, with members `python/a2ui_spectra_instrumentation` and `conformance/wrapper_driver/python`; the pinned SDK declared once in the root's sources, `a2ui-agent-sdk` and `a2ui-adk` from upstream's git repository at `825beac28` by subdirectory; one lock. `pyink`, `mypy` strict and `pytest` are configured at the root as upstream has them, `pyink` and `mypy` excluding `_dev/`, `pytest` on the wrapper's `tests/` with the importlib import mode. A `.python-version` at the root pins 3.12.

### 10. The driver

One file, `driver.py`, beside the member's `pyproject.toml`, which depends on the wrapper as a workspace member and on the pinned SDK and `a2ui-adk` through the root's sources; no README of its own. It behaves as the conformance README and the expected records fix: the one-line form; the processor the job describes, the basic catalog built in and a `catalog.json` by path, a renderer state bound when the job says; the five entry points, a stream fed each chunk in order, stopping at the first that raises, and closed unless one raised; the toolset's tool taken from `get_tools()` and run with a stand-in context carrying only `actions.skip_summarization`, so no call id. The SDK's `A2uiError` passes and the driver exits 0; anything else exits non-zero with its message on stderr. It prints nothing, carries no trace context, and shares no code with `_dev/tools/wrapper_capture_facts.py`.

### 11. CI

The one `ci` job gains `setup-uv` with its cache and `uv sync --all-packages` after the Node setup, then `pyink --check`, `mypy` and `pytest` as steps beside `lint:all` and `format:check:all`; `test:all` runs the drivers from the same sync.

### 12. The wrapper's tests

A `pytest` suite under the package's `tests/`, on an SDK provider with an in-memory exporter handed in through `tracer_provider=`, with short inline texts. It covers: the check — a core name missing, nothing patched and one WARNING line; an experimental format removed, the rest patched and one DEBUG line; `a2ui-adk` unimportable, silence; the floor against a faked 0.9.0; one event per outermost call for each nesting, and the A2A path, `parser.parse_response` called directly; the block rule; isolation, a fault injected into a hook leaving the SDK's return and exception unchanged with one WARNING line; the provider's three cases and the `tracer_provider=` argument; streams, one closed, one ended by a raising `feed`, one abandoned, and a `feed` after the end; `uninstrument()`; arguments passed by keyword; the launcher route, a subprocess running `opentelemetry-instrument` whose child reports whether the hook is in place and whether the global provider is the SDK's. It does not cover the span attributes case by case, which is the capture suite's, or a live model.

### 13. The expected records

When the driver and a record disagree, the record changes only where it was wrong about what the SDK does, through the harness's write mode; the change and its reason go in the commit message and in the sub-task's close-out line.

### 14. Other documents

- `python/a2ui_spectra_instrumentation/README.md`: what the package is; the two ways to switch it on, under `a2ui-spectra run` and under `attach`; what the spans carry, with ranges worked out by Spectra; the pinned API, the floor and the refusal line; the provider rule; that `opentelemetry-bootstrap` does not install it, so it is installed by name.
- SPEC.md, in place: the upstream reference line at `825beac28`; "The wrapper" rewritten to the Phase 6 spec's decision 19 — the pinned SDKs, every format, A2UI sent as a tool call, both switch-on routes and the provider it starts, the retry inferred and the ranges worked out by Spectra from the reported text — with the Python specifics, 6.4 adding the TypeScript `--import` sentence; the "Open" item on supported SDK versions settled as decision 1 says.
- `conformance/README.md`: the root uv workspace and `.python-version` as the way the driver is synced; the skip sentence stands for TypeScript.
- `_dev/TODO.md`: the 6.3 line names this spec and gains its done line; the Backlog gains: a second SDK API shape in the wrappers, a hook table per shape chosen by the pinned-API check, each with its own floor and capture records; the re-pin procedure, the wrapper capture suite run against the new pin.
- `_dev/a2ui-findings.md`, one entry each: the agent SDK at the pin requires `a2ui-core >=0.4.1,<0.5.0` while its own workspace builds core as `0.4.1.dev171`, which PEP 440 orders below `0.4.1`, so `uv pip check` reports the install inconsistent though uv's resolver accepts it; `SendA2uiToClientToolset` never reads the call id ADK's `ToolContext` carries as `function_call_id`, so a parse made by the tool is tied to its call only by the parent span; no inference format exposes a name, only its class; the restaurant finder sample parses each reply twice, as a stream while it arrives and whole when it ends, so a turn shows two `parse` events per model call.
- `_dev/otel-findings.md`: `opentelemetry-bootstrap` cannot be extended by a third-party instrumentation, its library list being generated into the package, so an instrumentation outside the contrib repository is never suggested or installed by it.
- Not touched: the turn record spec and schema, the design canvas, the receiver.

### 15. Done line

Done when `a2ui-spectra-instrumentation` under `python/` hooks the pinned SDK's public entry points and the toolset by public names, one event per outermost call, errors tied to their blocks, and leaves an SDK below the floor or missing a core name unpatched with one line; it is switched on under `opentelemetry-instrument` and with `a2ui_spectra_instrumentation.instrument()`, starting a provider only when the process has none and the environment names an endpoint; the Python driver passes every wrapper capture case that names Python under `yarn test:all`, the harness reporting only TypeScript skipped, and any expected record the write mode changed names its reason in the commit; the wrapper's `pytest` suite, `pyink` and `mypy` are green and run in CI's one job beside the Yarn gates; SPEC.md, the package README, the conformance README, the TODO and both findings files carry decision 14's amendments; and the gates are green in CI.

## Invariants

- The wrapper never changes what the SDK does: it returns what the SDK returns and raises what it raises. A failure inside the wrapper never reaches the agent; it is one WARNING line.
- A record states what happened: the wrapper reports the input, the messages, the format and the errors, and no ranges; the retry, the component ranges, the model call a parse read and the parse a component came from are computed when shown.
- No credential is ever in a record, a fixture, a test or a commit.
