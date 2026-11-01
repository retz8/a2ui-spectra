# Phase 6 — The A2UI step

The Python and TypeScript wrappers as OpenTelemetry instrumentation of upstream's agent SDKs; retries and parse errors; raw text linked to the components it became. Phase 6 of SPEC.md's roadmap, between Phase 5, inside the turn, and Phase 7, fixtures and replay. The design authority is SPEC.md, in particular its "Features", "Capture" ("The wrapper") and "Turn record" sections. The record is turn record v0.1, amended as decision 15 says.

## Scope

In scope:

- The Python and TypeScript wrappers, on upstream's agent SDKs at the pin.
- Every inference format the pinned SDKs implement, and A2UI sent as a tool call through `a2ui-adk`'s `SendA2uiToClientToolset`.
- The receiver reading the A2UI step's spans, and placing a UI section generated outside any turn.
- The viewer: component ranges, retries, the model call a parse read, the parse a tree component came from, the UI section in the model call's request, and parse errors as problems.
- The wrapper capture suite.
- The turn record's amendments.
- The design canvas's Phase 6 boards and Flow 6.
- The acceptance run.

Out of scope:

- The released SDKs: PyPI's `a2ui-agent-sdk` 0.9.0 and npm's `@a2ui/agent` 0.0.2.
- The Dart wrapper and the native hook proposal. After v1.
- The A2UI step for A2UIVerse's agents, which are on PyPI's `a2ui-agent-sdk` 0.9.0. Backlog.

## Locked decisions

### 1. The SDKs at the pin

The wrappers support upstream's Python and TypeScript agent SDKs at upstream main `825beac28` (2026-10-30). SPEC.md's upstream reference line moves to this pin.

### 2. The inference formats

Every inference format the pinned SDKs implement is covered, with component ranges for each: Direct JSON, Express, Elemental and Atom in Python; Direct JSON and Express in TypeScript.

### 3. The package

The wrapper is named `a2ui-spectra-instrumentation` in both languages. SPEC.md's prose keeps calling it the wrapper.

### 4. Switching the wrapper on

In Python, the wrapper is switched on by launching under `opentelemetry-instrument` with the package installed, or with one line. In TypeScript, by a launch-time switch loaded through Node's `--import`, or with one line. In either language, switching it on in a process that has no tracer provider starts one, with the OTLP/HTTP exporter, reading the `OTEL_EXPORTER_OTLP_*` variables `a2ui-spectra run` sets; a process with its own tracer provider keeps it.

### 5. The A2UI step's spans

A received span carrying `a2ui.event.kind` set to `prompt_generation` or `parse`, with that kind's attributes under the turn record's names, is read as that event, whoever sent it: the wrapper, a native SDK hook, or an agent reporting its own A2UI step. The wrapper writes exactly that. A span of the step missing a required attribute of its kind is written as a `framework_span`, and the terminal says so. These spans are placed in their turns as the Phase 5 spec's decision 4 places any received span — by the turn's trace id, else by the one turn of the run whose time range holds the span's start — apart from decision 9's.

### 6. One parse event

One `parse` event per outermost call to a public parsing entry point. A stream is one event, from opening the stream to closing it, its input every chunk fed, joined in order. Each block a stream rejects and reads past is an `exception` span event on it, and the event's status is the first error.

### 7. A2UI sent as a tool call

`SendA2uiToClientToolset`'s `send_a2ui_json_to_client` tool call is one `parse` event, whichever path the toolset parses it by; its input is the call's `a2ui_payload` argument. The error the toolset returns to the model counts as decision 13 says, and the model's next call is a retry under decision 10.

### 8. The UI section in the request

A `prompt_generation` event holds the text the SDK generated. The viewer finds that text inside the model call's request when shown, apart from the developer's own text.

### 9. A UI section generated outside any turn

A `prompt_generation` event that falls in no turn is kept for the run and placed in every turn of the run whose model call request holds its section text. It keeps its own timestamp.

### 10. Retries

In a turn, the first model call that starts after a failed `parse` ends is a retry of the call whose reply failed. It is linked to that `parse` event, and its attempt is counted along the chain: a failure, retry 1, a failure, retry 2. The retry is computed when shown. The record's retry link and `a2ui.retry.attempt` are kept for a producer that states a retry itself, and a stated retry wins over the inferred one.

### 11. Component ranges

Spectra works out the component ranges when shown, from a `parse` event's input and inference format, with one TypeScript position reader per format, all four; the readers for Elemental and Atom follow the Python grammars at the pin. The wrappers report the input, the messages, the format and the error, and no ranges. `a2ui.parse.components` is kept for a producer that states ranges itself, and a stated range wins.

### 12. The model call a parse read

A `parse` event is tied to the model call of its turn whose response text, or one of whose tool-call arguments, holds the parse input or is held in it. Failing that, it is tied by time, to the latest model call of the turn that started before the parse started, when exactly one call fits. Otherwise it stays unlinked. This is computed when shown.

### 13. Parse errors as problems

Each error the parser raised is one problem: each rejected block, the one that ended the parse and each one a stream read past. A failed `prompt_generation` in a turn is one problem, on its own row. A retry is marked with the error that caused it and is not counted.

### 14. The parse a tree component came from

A wire message is traced to the latest `parse` event of its turn that started before the message was sent and holds an equal message. Failing that, a component is traced to the latest such `parse` event holding a component with the same surface id and component id. A component in the tree shows its range in that parse's input. This is computed when shown.

### 15. The turn record

Turn record v0.1 is amended in place:

- a section for producers, saying what a span of the A2UI step carries and its wire forms, as decision 5 has it, with the half-formed span written as a `framework_span`;
- a stream's rejected blocks as `exception` span events on its `parse` event, decision 6;
- every error a parse raised as an `exception` span event, with the rejected block's range in the input and the SDK's structured details;
- a stream's chunks as `a2ui.parse.chunk` span events, and `a2ui.parse.streamed`;
- the toolset's tool call and its input, decision 7, the tool's name, call id and result on the `parse`, which belongs to a `tool_call` by its parent, else by an equal call id;
- `a2ui.parse.entry_point`, `a2ui.parse.wrapped` and the input exactly as the call was given it;
- the `sdk` area, the agent SDK's package name and version;
- `a2ui.prompt.catalogs` and `a2ui.parse.catalogs` in place of `a2ui.prompt.catalog_id` and `a2ui.prompt.catalog_version`;
- a failed prompt generation, with no section;
- the inference format's four values;
- a `prompt_generation` event placed by its text, decision 9;
- the retry rule, and a stated retry winning, decision 10;
- component ranges worked out by the reader, and a stated range winning, decision 11.

`a2ui.turn.capture_paths` lists `wrapper` when the turn holds a `prompt_generation` or `parse` event.

### 16. The wrapper capture suite

A wrapper capture suite in `conformance/`, with a driver in each language that calls the pinned SDK's public entry points with the wrapper switched on, inside a turn the harness opens: prompt generation, whole-text parsing, streaming, and the toolset. Its cases cover every format, streamed and whole, valid replies and each kind of error. One expected record serves both languages wherever a format exists in both, and a case whose SDKs differ in wording, class or generated text names an expected record per language. The harness skips, by name, a language whose driver is not yet there. The valid case texts are model replies recorded once from Gemini, each prompted with its format's own generated prompt; the error cases are written by hand. The rules of decisions 10, 11, 12 and 14 are tested in the viewer, on records.

### 17. The design artifact comes first

Phase 6's boards are drawn first on the design canvas "Spectra viewer UI", in light and dark:

1. a `parse` step: the raw text with each component's characters, linked both ways with the tree, selecting a node marking its text and selecting marked text selecting the node;
2. a failed parse, each rejected block marked in the raw text, as problems;
3. a retry marked with the error that caused it;
4. the prompt's UI section marked inside the model call's exact request, apart from the developer's own text, with the inference format and the catalog version;
5. the model call a parse read, linked both ways;
6. a toolset tool call shown as its parse;
7. a turn with no A2UI step events, saying how to switch the wrapper on;
8. a failed prompt generation.

Flow 6 is a new row on the Flows page: finding out why a turn retried and where the model's text went wrong. The header's problem count; the failed parse with its rejected block marked; the retry marked with its cause; the final tree, where selecting a component marks its text.

### 18. The acceptance run

The last sub-task, through the tunnel, under `run` and `attach`, on Gemini, across every board Phase 6 adds, in light and dark; what it finds is fixed within the sub-task. The targets:

- the Python restaurant finder, its retry on "Surface default already exists", A2UI finding 31, walked as Flow 6;
- the custom-components example, its retry on "Catalog not found: inline_catalog", A2UI finding 32, walked as Flow 6;
- the Node restaurant finder, in Direct JSON and in Express;
- the community rizzcharts sample, for the toolset.

Each wrapper is switched on both ways: the Python one under `opentelemetry-instrument` and with its one line, the TypeScript one through `--import` and with its one line.

### 19. Other documents

- SPEC.md, amended in place:
  - the upstream reference line at the pin of decision 1;
  - Capture's "The wrapper": the pinned SDKs, every format, A2UI sent as a tool call, how the wrapper is switched on and the tracer provider it starts, the retry inferred, and the ranges worked out by Spectra from the raw text the wrapper reports;
  - the "Open" item on the wrappers' supported SDK versions, settled as decision 1.
- The Phase 3 spec's decision 9, one count covering every source of problems: retries are marked with their cause, not counted.
- The turn record prose and schema carry decision 15.
- `_dev/TODO.md`: the Phase 6 line names this spec, and its sentence on `SendA2uiToClientToolset` is corrected to the pinned shape; the backlog gains the A2UI step for A2UIVerse's agents, once they move to an SDK release carrying the pinned API.
- `conformance/README.md`, for the wrapper capture suite.
- `_dev/a2ui-findings.md` gains what this phase finds in A2UI, and `_dev/otel-findings.md` what it finds in OpenTelemetry.
- The two packages' READMEs.

## Invariants

- The wrapper never changes what the SDK does: it returns what the SDK returns and raises what it raises. A failure inside the wrapper never reaches the agent. An SDK without the pinned API is left unpatched, with one log line.
- A record states what happened. The retry, the component ranges, the model call a parse read and the parse a component came from are computed when shown, apart from a retry or a range a producer states itself.
