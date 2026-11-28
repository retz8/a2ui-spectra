# The A2UI step: how Spectra sees raw text become A2UI messages

This doc explains how Spectra sees the A2UI step, the part of a turn where upstream's agent SDK writes the UI section of the prompt and then turns the model's raw text into A2UI messages. It is written for the developer of an A2UI agent who uses Spectra and wants to know what the wrapper does inside their agent's process and what Spectra makes of it. It starts with the problem, follows one turn of upstream's Python restaurant finder from the prompt to a retry, then opens up the wrapper's rules, and ends with the design decisions and where the code is.

The running example is upstream's Python restaurant finder, `samples/agent/adk/restaurant_finder`, asked for "Top 3 Chinese restaurants in New York". Its reply is parsed twice by one stream, the second copy of the surface is rejected, and the agent asks the model again. That retry is the turn in the root README's screenshots.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/a2ui-step-dark.png">
  <img alt="Inside the agent's process, the wrapper hooks the agent SDK's prompt generator and parser. The prompt, carrying the UI section the generator wrote, goes through Spectra's model proxy to Gemini. The reply's raw text comes back to the parser, and the parser's A2UI messages go through the wire proxy to the host. A failed parse sends the agent back to the model, a retry. Each hooked piece sends a span over OTLP, a prompt_generation span and a parse span, to Spectra's receiver, which places them in their turn for the viewer's turn view." src="diagrams/a2ui-step.png">
</picture>

## Problem it solves

Upstream's agent SDKs do the A2UI step in two pieces:

1. **The prompt generator** writes the UI section of the prompt from the catalog: the inference format's rules, the catalog's components and, on request, examples.
2. **The parser** reads the model's raw text in that inference format, Direct JSON, Express, Elemental or Atom, compiles each block into A2UI messages and validates them. When a block fails, the agent may ask the model again.

Spectra's model proxy sees the request that went to the model and the reply that came back. Its wire proxy sees the A2UI messages that reached the host. Neither sees the A2UI step itself:

- which characters of the raw text became which component;
- that a model call was a retry, and which parse error caused it;
- which part of the prompt is the generated UI section and which is the developer's own text;
- which inference format and catalog version the turn used;
- which model call produced which messages, when a turn has several model calls and tool calls.

The wrapper, `a2ui-spectra-instrumentation`, is OpenTelemetry instrumentation of upstream's agent SDKs that reports the two pieces as spans. It is a dev dependency of the agent, in Python for `a2ui-agent-sdk` and in TypeScript for `@a2ui/agent`. The A2UI step is reported by the wrapper, by a native hook in an A2UI SDK once upstream has one, or by an agent emitting the same spans itself; the turn record's [producers of the A2UI step](../../specification/turn_record/v0_1/docs/turn_record.md#producers-of-the-a2ui-step) is the contract all three follow.

## Five ideas to hold on to

### 1. The wrapper changes nothing the SDK does

Every hooked call returns what it returns and raises or throws what it raises or throws. What the wrapper records around the call runs guarded, and a failure inside it is one warning line. An agent with the wrapper on behaves as it does without it.

### 2. Two kinds of span, one per outermost call

A `prompt_generation` span is one prompt generator's `generate()`. A `parse` span is one call to a public parsing entry point: a whole text, a stream from its opening to its close, one block compiled on its own, or a toolset's tool call. A hooked call made while another is running opens no span of its own, so a `parse_response` that compiles three blocks is one `parse`, not four. Python keeps the running call in a context variable, so concurrent tasks each have their own; in TypeScript every hooked call is synchronous, so a stack holds it.

### 3. The wrapper reports what happened; Spectra works out what it means

The wrapper sends the raw text exactly as the parser was given it, the messages it produced and each error with the range of the block it belongs to. It sends no component ranges and no retries. Spectra works both out when it shows the turn, from the raw text, the inference format and the turn's model calls, so a record stays a statement of what happened.

### 4. The wrapper patches the API it was written against, or nothing

Before hooking anything, the wrapper checks the version floor and that every name it hooks is there. An SDK below the floor, or one whose API has moved, is left unpatched with one warning line naming what it found. Nothing is half-patched: the SDK's core names stand or fall together, and in Python an experimental format, Atom or Elemental, and `a2ui-adk`'s toolset are each hooked whole or skipped whole.

### 5. Each span states the turn record version it follows

Every span carries `a2ui.record.version`, `v0.1` today. Spectra reads the version before anything else, so a wrapper newer than the running Spectra is never misread: its spans are kept as framework spans, and Spectra says the A2UI step was reported under a newer turn record.

## One turn, end to end

The restaurant finder runs under `a2ui-spectra run`, launched through `opentelemetry-instrument` with the Python wrapper installed in its environment. You send "Top 3 Chinese restaurants in New York" from the message box.

1. **The wrapper switches on.** `opentelemetry-instrument` loads it through its `a2ui` entry point. It checks `a2ui-agent-sdk` against its pinned API, finds it at or above the floor of 0.11.0 with every name it hooks, and hooks the parsers, the streams and the prompt generators.
2. **The prompt is written.** The agent builds its instruction with `A2uiInstruction`, which appends the processor's prompt to the agent's own text. Underneath, the Direct JSON prompt generator's `generate()` runs, and the wrapper sends one `prompt_generation` span: the section it wrote, `direct_json`, and the catalog it describes.
3. **The model is called.** ADK calls Gemini through Spectra's model proxy, first for the `get_restaurants` tool call, then for the answer, streamed.
4. **The reply is parsed.** The agent opens a stream, `processor.open_stream()`, and feeds it the reply's text as it arrives. The wrapper opens one `parse` span at `open_stream` and records each chunk fed as an `a2ui.parse.chunk` span event.
5. **The parse fails.** The agent feeds the stream the partial chunks and then the whole reply once more, as ADK's streaming mode delivers it. The second copy's `createSurface` for `default` meets the surface the first copy created, and the message processor rejects it with `A2uiIntegrityError`, "Surface default already exists.". The wrapper records the error as an `exception` span event carrying the range of the block it rejected. The stream throws from that `feed`, which ends it, and the span ends there with an error status.
6. **The agent asks again.** The sample takes the `ValueError` as a bad reply and sends a new request, opening "Your previous response was invalid. Validation failed: Surface default already exists." and asking for the original request again. A second parse, of the second reply, succeeds.
7. **Spectra places the spans.** The receiver reads each span by its `a2ui.event.kind` and its `a2ui.record.version`, and places it in the turn by its trace id, which the wire proxy's `traceparent` gave the agent's request.
8. **The turn view shows the step.** The first parse is a problem on its row, "Read from" the reply it parsed and "Retried by" the call that followed. The raw text is drawn with the rejected block in red. Hovering the text outlines the component under the pointer, and clicking selects it and its node in the tree.

The parse span of step 5, as the wrapper sends it. This is cut from the wrapper capture case `surface_already_exists`, in [`conformance/test_data/wrapper_capture/v0_1/surface_already_exists/expected.json`](../../conformance/test_data/wrapper_capture/v0_1/surface_already_exists/expected.json), which was recorded from this retry with the real wrapper on `a2ui-agent-sdk` 0.12.0, fed a restaurant card twice. The input and the messages are shortened here.

```jsonc
// The span's attributes, as received
{
  "a2ui.event.kind": "parse",
  "a2ui.record.version": "v0.1",
  "a2ui.parse.input": "Here is the restaurant card.\n\n<a2ui-json>\n[\n  {\n    \"version\": \"1.0\",\n    \"createSurface\": {…",
  "a2ui.parse.entry_point": "open_stream",
  "a2ui.parse.streamed": true,
  "a2ui.parse.inference_format": "direct_json",
  "a2ui.parse.catalogs": "[{\"catalogId\":\"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json\",\"protocolVersion\":\"v1.0\"}]",
  "a2ui.parse.messages": "[{\"version\":\"1.0\",\"createSurface\":{\"surfaceId\":\"default\",…}}]",
  "a2ui.sdk.name": "a2ui-agent-sdk",
  "a2ui.sdk.version": "0.12.0",
  "error.type": "A2uiIntegrityError"
}
// Its exception span event
{
  "exception.type": "A2uiIntegrityError",
  "exception.message": "Surface default already exists.",
  "a2ui.parse.block.start": 442,
  "a2ui.parse.block.end": 786
}
```

The span's status is the error, `code` `2`, with the message "Surface default already exists.". The exception event's stack trace is left out here. The block's range counts UTF-16 code units of `a2ui.parse.input`: 442 to 786 is the JSON inside the second `<a2ui-json>` tags, the block the processor refused.

## Inside the machinery

### Switching it on

The wrapper does nothing until it is switched on, and each route ends in the same hooks.

| Language   | Route                                                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python     | `opentelemetry-instrument`, with the package installed                                     | OpenTelemetry loads it through the `opentelemetry_instrumentor` entry point named `a2ui`, beside any other instrumentation installed. OpenTelemetry first checks the package's `instruments` extra, `a2ui-agent-sdk >= 0.11.0`, and skips the wrapper with a line of its own when the SDK is missing or below it: a DEBUG line for a missing SDK; for one below the floor, a DEBUG line up to `opentelemetry-instrumentation` 0.65b0 and an ERROR line from 0.66b1 |
| Python     | `a2ui_spectra_instrumentation.instrument()`, before the agent parses or generates a prompt | Takes `tracer_provider=` for a provider of the agent's own. `uninstrument()` removes every hook; a provider the wrapper started stays. A second `instrument()` writes OpenTelemetry's "already instrumented" warning and does nothing. Both routes use the instrumentor `A2uiInstrumentor`                                                                                                                                                                         |
| TypeScript | `node --import a2ui-spectra-instrumentation/register`                                      | Switches the wrapper on before the agent's own code runs. `NODE_OPTIONS="--import a2ui-spectra-instrumentation/register"` does the same for a command that starts Node itself, such as `npm run dev`                                                                                                                                                                                                                                                               |
| TypeScript | `instrument()`, anywhere before the agent parses or generates a prompt                     | The hooks sit on the classes' prototypes, so the line works before or after the agent imports the SDK. `instrument({tracerProvider})` takes a provider of the agent's own. `uninstrument()` puts every original back; a provider the wrapper started stays. A second `instrument()` is one warning line and does nothing                                                                                                                                           |
| TypeScript | `new A2uiInstrumentation()`, among the agent's OpenTelemetry instrumentations              | Hooks the SDK when constructed, as every OpenTelemetry instrumentation does, and sends its spans to the provider it is handed through `registerInstrumentations` or the NodeSDK. It starts no provider of its own. `disable()` puts every original back                                                                                                                                                                                                            |

`opentelemetry-bootstrap` never suggests the Python wrapper: its list of instrumentations is generated into OpenTelemetry's package from the instrumentations of OpenTelemetry's own contrib repository, so it names none from outside it, and the wrapper is installed by name.

The TypeScript wrapper patches the `@a2ui/agent` it resolves from its own place, so it is installed beside the agent's own copy, in the agent's `node_modules`. A second copy of the SDK elsewhere in the process is left unpatched. It needs Node 22.12 or later, the first Node that loads an ES module through `require()` with no flag.

### The tracer provider

The spans need somewhere to go. Each wrapper decides it the same way, in this order:

1. A provider passed to `instrument()` is used, and the process's own is left as it is.
2. A provider the process has set already is kept. Under `opentelemetry-instrument` with the OpenTelemetry distro installed, the distro sets one before the Python wrapper loads.
3. With none, when the environment names an endpoint, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, and the protocol, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`, is unset or `http/protobuf`, the wrapper starts a provider on the SDK's default resource, with a batch span processor on OpenTelemetry's OTLP/HTTP exporter. `a2ui-spectra run` sets these variables for the agent, and `a2ui-spectra attach` prints them.
4. Otherwise it starts none and says why at info level: what was missing, or which protocol was named. Its spans go to a provider the process sets later.

The two languages differ at the edges:

- **Python** flushes the provider it started when the process exits. The info line goes to the logger `a2ui_spectra_instrumentation`, which Python's logging shows only when the agent sets INFO for it.
- **TypeScript** registers a `NodeTracerProvider`, whose exporter sends OTLP/JSON; the receiver reads it as it reads protobuf. The provider is shut down on `beforeExit`, once, which flushes the spans when the agent's process ends on its own. The wrapper adds no signal handlers, so an agent stopped by a signal, such as Ctrl-C, keeps only what the batch span processor had exported already. The batch delay is OpenTelemetry's default, five seconds, and the `OTEL_BSP_*` variables tune it. The info line goes through OpenTelemetry's `diag`, hidden unless the process sets a diag logger.

### What the spans carry

The attributes of each kind, their types and which are required are in the turn record's [`prompt_generation`](../../specification/turn_record/v0_1/docs/turn_record.md#prompt_generation) and [`parse`](../../specification/turn_record/v0_1/docs/turn_record.md#parse). The wrappers send an array or an object as its JSON text, under the instrumentation scope `a2ui-spectra-instrumentation`. A span's parent is the span current when its outermost call began, so it carries the trace id of the agent's work at that moment.

**`prompt_generation`**

- A prompt generator's `generate()`, with the section it returned, the inference format of the generator's class and the catalogs it describes.
- In Python, the one `generate()` every format's prompt generator has from `PromptGenerator`. A generator of none of the four formats' classes gives no span, and neither does a prompt assembled without `generate()`, such as `assemble_instructions` called on its own, or a skill written by the skill generator.
- In Python, the text `a2ui-adk`'s `SendA2uiToClientToolset` appends to the agent's instructions in its tool's `process_llm_request` is a `prompt_generation` too, carrying `gen_ai.tool.name`. When it appends nothing, there is no span.
- A `generate` that raises or throws gives the failed form: no section, and the error.

**`parse`**

- A whole text, `parse_response` or `parseResponse`; a stream, from `open_stream` or `openStream` to its close; a `compile` called on its own; and in Python, the toolset's tool call, `send_a2ui_json_to_client`.
- The input exactly as the call was given it, every message the call produced, those before an error included, the inference format and the catalogs.
- A stream's chunks are `a2ui.parse.chunk` span events, each at the time it was fed. OpenTelemetry's SDKs hold 128 events a span by default, or the number `OTEL_SPAN_EVENT_COUNT_LIMIT` sets, and drop the oldest past them. So a stream fed more chunks than fit beside its other events keeps its first and last chunk and evenly spaced ones between, and its errors and the time of its first chunk are not dropped. Two cases fall outside this: a provider given a lower limit in code, which the wrapper cannot read, and a span whose errors alone pass the limit; in both the SDK drops the oldest events. In TypeScript, a stream's span ends when `close` returns or throws, or when a `feed` throws; a stream never closed is never exported. The same holds in Python for a stream the agent abandons.
- The toolset's tool call carries its tool's name, its call id when the tool's context names one, and the object the tool returned. Every error the tool swallows is recorded on it: those its inner calls raised, and the tool's own, such as a payload that holds no messages. The tool shows its own errors in one place, a call to its module's logger's `error` while it handles the error, and the wrapper reads them there by hooking that method. A hooked method runs whatever the agent's logging setup is, so a raised level or a disabled logger does not decide whether the error is recorded, and the line itself is written as without the wrapper.

**Errors.** Each error a parse raised or threw, or a stream read past, is an `exception` span event with its type, message and stack trace, and the SDK's structured details when it has them. It carries the range of the block it belongs to, `a2ui.parse.block.start` and `a2ui.parse.block.end`, in UTF-16 code units of the input:

| The parse                                                               | The block an error belongs to                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A whole text, a `compile`, the toolset's call                           | The block being compiled, or whose messages were being applied, found in the input                                                                                                                                                                                                                                                                                           |
| A stream                                                                | The block the error rejected: the block text the error carries, `raw_content` in Python and `rawContent` in TypeScript, else the block after those the stream had finished or rejected when the error came. Stated whole when the span ends, as the parser's `unwrap` finds the block in the stream's whole input. For a stream opened with `wrapped` false, the whole input |
| The check of whole trees                                                | No block. In Python, `RendererState.check_topology` and, in the toolset's call, `validate_payload`; in TypeScript, `RendererState.checkTopology`                                                                                                                                                                                                                             |
| The toolset tool's own errors, such as a payload that holds no messages | No block                                                                                                                                                                                                                                                                                                                                                                     |

The chunk that brought a stream's error may run on into the next block; the range is the rejected block's, not the chunk's. The blocks a stream has finished or rejected are counted as it runs. Python counts a finished block at each check of whole trees it starts, and a rejected one at each error it has placed in a block. TypeScript counts a finished block at each `RendererState.checkTopology` that returns, and a rejected one at each `RendererState.markChecked`, which the stream calls when it catches a rejected block or fails; that is why `markChecked` is hooked.

**A call that is cancelled or interrupted writes no span.** In Python, a cancellation, a keyboard interrupt or the interpreter's exit that passes through a hooked call is no error of the parse or of the prompt generation. The wrapper lets it pass and writes nothing for that call, as for a stream never closed; a stream it passes through is not recorded further.

**Nothing of the agent is kept.** The Python wrapper holds an error only while the outermost hooked call that saw it runs, and keeps its type, message and stack trace as text. An error object holds its traceback, and the traceback the frames of the agent's calls. A stream's event lives as long as its stream and must not keep those frames, or an async generator the agent abandoned in one would never be closed.

### The pinned API

Each wrapper was written against one upstream release, and checks that release's names before it hooks anything.

**Python**, written against `a2ui-agent-sdk` 0.11.0 and `a2ui-adk` 0.3.0, upstream's release of 2026-11-10, with the floor `a2ui-agent-sdk >= 0.11.0`. It checks the floor, that each name it hooks resolves to a callable and that each prompt generator class it reads resolves to a class, per distribution:

| Distribution     | Names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | When one is missing                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a2ui-agent-sdk` | `Parser.parse_response`; `PromptGenerator.generate` in `a2ui.prompt`; `RendererState.check_topology` and `RendererState.apply` in `a2ui.utils`; `compile` and `open_stream` on `DirectJsonParser` and `ExpressParser`; `feed` and `close` on `DirectJsonResponseStream` and `ExpressResponseStream`; the classes `DirectJsonPromptGenerator` and `ExpressPromptGenerator`, read from the modules that define them, `a2ui.inference_formats.direct_json.prompt_generator` and `a2ui.inference_formats.express.prompt_generator`, and not hooked; and `a2ui.parser.to_message_dicts`, which the hooks call | Nothing is hooked; one WARNING line                                                                                                                                                              |
| `a2ui-agent-sdk` | Atom's `AtomParser.compile` and its class `AtomPromptGenerator`; Elemental's `ElementalParser.compile` and its class `ElementalPromptGenerator`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | That format is skipped; one DEBUG line                                                                                                                                                           |
| `a2ui-adk`       | `SendA2uiToClientToolset.get_tools`; `validate_payload` as the toolset's module holds it, whose logger's `error` method is hooked as well; and the module's `_resolve_processor`, from which a call's event takes the processor the tool resolved, since a tool may hold a provider of processors                                                                                                                                                                                                                                                                                                        | The toolset is skipped; one WARNING line, as when `a2ui.adk` fails with an error of its own while it is imported. Without `a2ui-adk`, or when `a2ui.adk` is not there to import, nothing is said |

The tool `get_tools` returns named `send_a2ui_json_to_client` is checked when it is returned: its `run_async` and `process_llm_request` are hooked, or, when it lacks one, that tool is left unhooked with one WARNING line naming the method.

A refusal is one WARNING line under the logger `a2ui_spectra_instrumentation`, naming the distribution and the version found, why, and the pin. This one is printed by the wrapper's own test, `test_check.py`, when it finds `a2ui-agent-sdk` 0.10.0:

```
a2ui-spectra-instrumentation left a2ui-agent-sdk 0.10.0 unpatched: it is below the version floor; it was written against a2ui-agent-sdk 0.11.0, upstream's release of 2026-11-10 (a2ui-agent-sdk >= 0.11.0)
```

A module of the SDK that fails with an error of its own while the check imports it, and a failure while the names are being hooked, are refusals too: the line says which, with the error's class and message, nothing stays hooked, and `instrument()` returns.

**TypeScript**, written against `@a2ui/agent` 0.1.0, upstream's release of 2026-11-02, which is also its floor. `instrument()` and the instrumentation's `enable()` check that `@a2ui/agent` resolves, that the version its `package.json` gives is at least 0.1.0, and that every hooked name is a function on its class's prototype. They stand or fall together:

| Class                                                 | Hooked                         |
| ----------------------------------------------------- | ------------------------------ |
| `Parser`                                              | `parseResponse`                |
| `DirectJsonParser`, `ExpressParser`                   | `openStream`, `compile`        |
| `DirectJsonResponseStream`, `ExpressResponseStream`   | `feed`, `close`                |
| `DirectJsonPromptGenerator`, `ExpressPromptGenerator` | `generate`                     |
| `RendererState`                                       | `checkTopology`, `markChecked` |

A refusal is one warning through `process.emitWarning`, naming the package and the version found, or that it is not installed, the first missing name and the release; nothing is patched. The TypeScript SDK implements Direct JSON and Express alone, so those are the formats it reports.

Which upstream releases each wrapper supports, and the OpenTelemetry versions it is tested on, are in the root README's [What Spectra supports](../../README.md#what-spectra-supports).

### What Spectra does with the spans

**Reading.** The receiver reads a span of the step by its `a2ui.event.kind` before any producer's dialect, and its `a2ui.record.version` before the kind's attributes, as the turn record's [How the receiver reads a span](../../specification/turn_record/v0_1/docs/turn_record.md#how-the-receiver-reads-a-span) has it. It copies the record's names for the kind, an array or an object read from its JSON text or as the structured value, and leaves out a value that does not fit the record's shape. The names on an `exception` span event are read the same way, and an `a2ui.parse.chunk` span event keeps its end alone, or is left out when the end does not fit. A span missing a required attribute of its kind, its `a2ui.record.version` included, is written as a framework span, and so is one of a turn record version this Spectra does not read. The terminal says so in one line per export request for each kind and the attributes it lacks, or each kind and version; for a newer version the viewer also says the step was reported under a newer turn record. This line is cut from the receiver's test, [`receiver.test.ts`](../../tools/spectra/src/receiver/receiver.test.ts), for one `parse` span under turn record v0.2:

```
The receiver wrote 1 span from a2ui-spectra-instrumentation, which started at 2026-10-26T07:33:21.000Z, as a framework_span: it carries a2ui.event.kind parse under turn record v0.2, newer than this Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it.
```

**Placing.** A span joins the turn whose trace id it carries, else the one turn of the run whose time range holds its start. A `prompt_generation` that falls in no turn, such as one written while no turn is open, is kept for the run and placed by its text: in every turn whose model request holds the section it wrote, once per turn and not in a turn that holds a `prompt_generation` with the same section already, checked again each time a model call joins a turn. The turn record's [Placement](../../specification/turn_record/v0_1/docs/turn_record.md#placement) has where the text is looked for.

**Working out.** Four things are worked out each time the turn is shown, and none is written into the record:

- **The retry.** The first model call that starts after a failed `parse` ends is a retry of the call whose reply failed, linked to that parse and counted along the chain: a failure, retry 1, a failure, retry 2. When several failed parses end before one model call, it retries the latest of them. A retry a producer states itself, `a2ui.retry.attempt` on its model call, wins, linked to the parse its link names.
- **The model call a parse read.** The one of its turn whose reply text, or one of whose tool calls' arguments, holds the parse's input or is held in it. When several do, the one accounting for the most of the input, then the latest started before the parse. When none does, the latest model call started before the parse, unless two started at the same moment; then the parse is tied to no model call.
- **The UI section.** Inside a model call's request, the text of the turn's `prompt_generation` is marked as the generated UI section, and the rest is the developer's own.
- **The component ranges.** A reader of the parse's inference format finds the blocks as the pinned SDK's lexer does and names each component by its compiler's id rule. There is one reader per format, Direct JSON, Express, Elemental and Atom, each a hand-written scanner in the viewer. A reader that cannot read the whole text stops where it can, and the viewer says up to which character it drew the ranges and which reader stopped. A reader takes from the catalogs the parse names, those the viewer holds, which names are components, the order a component's positional arguments fill its properties and which components hold children, and follows the SDK the parse names where Python's and TypeScript's compilers differ; with no catalog held, a capitalised name is a component. A range a producer states in `a2ui.parse.components` wins whole.

## When nothing shows up

| What happens                                                                  | What you see                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The wrapper is not installed, or not switched on                              | The turn has no A2UI step. On a model call of a turn whose agent sent A2UI messages, the hint "How to switch it on" gives the install, launch and one-line forms for both languages, each with a link to its wrapper's README                                                                            |
| The agent SDK is below the floor, or its API has moved                        | Nothing is hooked. One WARNING line in the agent's output names the distribution and the version found, and why: below the floor, or the first missing name. Under `opentelemetry-instrument`, an SDK below the floor gets OpenTelemetry's own line instead, as [Switching it on](#switching-it-on) says |
| No tracer provider, and no OTLP endpoint in the agent's environment           | An info line says the wrapper started no provider, shown only when the agent shows the wrapper's INFO lines in Python or sets a diag logger in TypeScript. Under `attach`, set the variables Spectra prints at start in the agent's shell                                                                |
| The environment names the OTLP protocol `grpc`                                | An info line naming the protocol, shown as above. The wrapper starts a provider only for `http/protobuf`, and Spectra's receiver reads OTLP over HTTP                                                                                                                                                    |
| The TypeScript agent is stopped with Ctrl-C                                   | The spans its batch span processor had not exported yet are lost. Let the batch delay pass, or end the agent's process on its own                                                                                                                                                                        |
| A second copy of `@a2ui/agent` sits elsewhere in the process                  | That copy is left unpatched: the wrapper patches the SDK it resolves from its own place                                                                                                                                                                                                                  |
| The spans follow a newer turn record than this Spectra reads                  | They are kept as framework spans, and the terminal and the viewer say to upgrade a2ui-spectra                                                                                                                                                                                                            |
| The parse states no ranges and names no inference format, or its reader stops | No component ranges, or ranges up to the character the reader reached, with a grey sentence saying which                                                                                                                                                                                                 |
| A `prompt_generation` matches no model request                                | It is placed in no turn, so the UI section is not marked                                                                                                                                                                                                                                                 |

## Design decisions

| Decision                                                                         | What it buys                                                                                                                | What it costs                                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The wrapper is OpenTelemetry instrumentation, exported to the receiver           | It sits beside the instrumentations an agent already runs, and the agent's framework spans and the step arrive at one place | The agent needs OpenTelemetry's exporter, and a provider, which the wrapper starts when there is none     |
| Patch the SDK at runtime, as OpenInference and OpenLLMetry patch model libraries | No change to upstream and none to the agent's code beyond one line, or none under `opentelemetry-instrument` or `--import`  | The wrapper is tied to the SDK's names. It checks them first, and has to follow upstream's releases       |
| One span per outermost call                                                      | One parse is one row in the viewer, whichever internal calls it made                                                        | An internal call made inside another is not seen on its own                                               |
| Report what happened; work out ranges and retries when shown                     | A record holds facts, and a better reader or retry rule improves every record already saved                                 | The viewer carries a reader per inference format, written to match the pinned SDK's lexer and compiler    |
| Patch each part of the pinned API whole, or not at all                           | A part of the SDK half patched, reporting some of its parses and not others, never happens                                  | An SDK release that renames one hooked core name turns the whole wrapper off until the wrapper follows it |
| Every span states its turn record version                                        | A wrapper and a Spectra of different releases never misread each other; a newer span is kept and named                      | One more required attribute for every producer, a native hook included                                    |
| Errors carry the block's range in UTF-16 code units                              | The viewer marks the rejected block in the raw text exactly, in either language                                             | Python counts code points, so the Python wrapper converts every range it states                           |
| No signal handlers in the TypeScript wrapper                                     | The wrapper never changes how the agent stops                                                                               | Spans still in the batch are lost when the agent is stopped by a signal                                   |

## Known limits

- The TypeScript SDK implements Direct JSON and Express alone, so a TypeScript agent's step is reported in those two formats.
- The TypeScript wrapper is on OpenTelemetry JavaScript's 2.x line. An agent whose own OpenTelemetry setup is on 3.x is not supported yet, and npm refuses the install.
- Agents not on upstream's Python or TypeScript SDK, Dart agents included, get no wrapper. They can report the step themselves, following the turn record's producers of the A2UI step.
- The skill upstream's `SkillGenerator` writes is not reported.

## Trying it without a model

The wrapper capture suite runs each wrapper on the real SDK, on reply texts recorded from Gemini or written for the case, and compares the record Spectra writes with the expected one, case by case, in each language the case names:

```bash
yarn workspace a2ui-spectra test          # the tool's test target, the wrapper capture suite among it
SPECTRA_TEST_PART=wrapper-capture yarn workspace a2ui-spectra test   # the suite alone
uv run pytest python/a2ui_spectra_instrumentation   # the Python wrapper's own tests
yarn workspace a2ui-spectra-instrumentation test    # the TypeScript wrapper's own tests
```

Each case is a folder under [`conformance/test_data/wrapper_capture/v0_1/`](../../conformance/test_data/wrapper_capture/v0_1), holding its job, with its languages, inference format, entry point and catalogs, the text it parses when it parses one, and the record expected, and is listed in [`conformance/wrapper_capture/capture_v0_1.yaml`](../../conformance/wrapper_capture/capture_v0_1.yaml).

## Where the code is

| What                                                                                     | Where                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The contract: the two kinds, their attributes, how a span is read and placed             | [`specification/turn_record/v0_1/docs/turn_record.md`](../../specification/turn_record/v0_1/docs/turn_record.md#producers-of-the-a2ui-step)                                                                                                                                                                                                                                                                        |
| The Python wrapper: `instrument()`, the instrumentor, the pin                            | [`__init__.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/__init__.py), [`instrumentor.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/instrumentor.py), [`package.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/package.py)                                                                                    |
| The Python wrapper: the pinned-API check, the hooks, the events, the provider            | [`check.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/check.py), [`hooks.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/hooks.py), [`events.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/events.py), [`provider.py`](../../python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/provider.py) |
| The TypeScript wrapper: `instrument()`, the `--import` route, the instrumentation        | [`index.ts`](../../typescript/instrumentation/src/index.ts), [`register.ts`](../../typescript/instrumentation/src/register.ts), [`instrumentation.ts`](../../typescript/instrumentation/src/instrumentation.ts)                                                                                                                                                                                                    |
| The TypeScript wrapper: the pinned-API check, the hooked names, the events, the provider | [`check.ts`](../../typescript/instrumentation/src/check.ts), [`table.ts`](../../typescript/instrumentation/src/table.ts), [`hooks.ts`](../../typescript/instrumentation/src/hooks.ts), [`events.ts`](../../typescript/instrumentation/src/events.ts), [`provider.ts`](../../typescript/instrumentation/src/provider.ts)                                                                                            |
| The receiver's reading of a span of the step                                             | [`tools/spectra/src/receiver/a2ui_step.ts`](../../tools/spectra/src/receiver/a2ui_step.ts)                                                                                                                                                                                                                                                                                                                         |
| Placing a span, and a `prompt_generation` by its text                                    | [`tools/spectra/src/receiver/receiver.ts`](../../tools/spectra/src/receiver/receiver.ts)                                                                                                                                                                                                                                                                                                                           |
| The retry, the model call a parse read, the UI section, parse errors as problems         | [`tools/spectra_viewer/src/model/a2ui_step.ts`](../../tools/spectra_viewer/src/model/a2ui_step.ts)                                                                                                                                                                                                                                                                                                                 |
| The component ranges and the four readers of the raw text                                | [`tools/spectra_viewer/src/model/ranges.ts`](../../tools/spectra_viewer/src/model/ranges.ts), [`tools/spectra_viewer/src/model/readers/`](../../tools/spectra_viewer/src/model/readers)                                                                                                                                                                                                                            |
| The hint for switching on a wrapper                                                      | [`tools/spectra_viewer/src/components/SwitchOnHint.tsx`](../../tools/spectra_viewer/src/components/SwitchOnHint.tsx)                                                                                                                                                                                                                                                                                               |
| The wrapper capture suite: its cases, its drivers and its harness                        | [`conformance/wrapper_capture/`](../../conformance/wrapper_capture), [`conformance/wrapper_driver/`](../../conformance/wrapper_driver), [`tools/spectra/src/receiver/wrapper_capture.conformance.test.ts`](../../tools/spectra/src/receiver/wrapper_capture.conformance.test.ts)                                                                                                                                   |
| This doc's diagram, its source and its two exports                                       | [`docs/design/diagrams/`](diagrams)                                                                                                                                                                                                                                                                                                                                                                                |

## Words used in this doc

| Word             | Meaning                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A2UI step        | The part of a turn where the agent SDK writes the prompt's UI section and turns the model's raw text into A2UI messages    |
| Agent SDK        | Upstream's library for an A2UI agent: `a2ui-agent-sdk` in Python, `@a2ui/agent` in TypeScript                              |
| Inference format | The syntax the model writes a UI in before the SDK compiles it into A2UI messages: Direct JSON, Express, Elemental or Atom |
| Block            | One piece of UI in the raw text, such as a `<a2ui-json>` block in Direct JSON, compiled on its own                         |
| Raw text         | The model's reply as the parser was given it                                                                               |
| Wrapper          | `a2ui-spectra-instrumentation`, the OpenTelemetry instrumentation that reports the A2UI step from upstream's agent SDKs    |
| Span             | OpenTelemetry's record of one operation, with a start, an end, attributes and events                                       |
| Receiver         | Spectra's OpenTelemetry receiver, which takes the agent's spans over OTLP/HTTP                                             |
| Outermost call   | A hooked call made while no other hooked call is running; only it opens a span                                             |
| Pinned API       | The names of the upstream release a wrapper was written against, which it checks before hooking                            |
| Producer         | Any program that sends Spectra spans of the A2UI step: the wrapper, a native hook in an SDK, or the agent itself           |
| Turn record      | The file format of a turn, the contract every capture path writes and every fixture is                                     |
