# a2ui-spectra-instrumentation

The A2UI wrapper of Spectra for A2UI, for Python: OpenTelemetry instrumentation of upstream's agent SDK, `a2ui-agent-sdk`, and of `a2ui-adk`'s `SendA2uiToClientToolset`. It hooks the SDK's prompt generation, its parsers and the toolset at runtime and exports the A2UI step's spans, `prompt_generation` and `parse`, to Spectra's OpenTelemetry receiver. It changes nothing the SDK does: every hooked call returns what it returns and raises what it raises, and a failure inside the wrapper is one WARNING line.

## Installing

A dev dependency of the agent, installed by name. `opentelemetry-bootstrap` does not install it: its list of instrumentations is generated into the package, so it never suggests one from outside OpenTelemetry's contrib repository.

```
uv add --dev "a2ui-spectra-instrumentation @ git+https://github.com/retz8/a2ui-spectra#subdirectory=python/a2ui_spectra_instrumentation"
```

## Switching it on

Either way, the agent needs the `OTEL_EXPORTER_OTLP_*` variables that point at Spectra's receiver.

- **Under `opentelemetry-instrument`**, with the package installed: `opentelemetry-instrument` loads it through the `opentelemetry_instrumentor` entry point named `a2ui`, beside any other instrumentation installed.
- **With one line**, before the agent parses or generates a prompt:

  ```python
  import a2ui_spectra_instrumentation

  a2ui_spectra_instrumentation.instrument()
  ```

  `instrument()` takes `tracer_provider=` to send the spans to a provider of the agent's own. `uninstrument()` removes every hook; a provider the wrapper started stays. A second `instrument()` writes OpenTelemetry's own "already instrumented" warning and does nothing. `A2uiInstrumentor` is the instrumentor both routes use.

**Under `a2ui-spectra run`**, the variables are set for the agent: launch it as `a2ui-spectra run -- opentelemetry-instrument python agent.py`, or with the one line in its code, `a2ui-spectra run -- python agent.py`.

**Under `a2ui-spectra attach`**, set the variables Spectra prints at start in the agent's shell, then start the agent either way.

## The tracer provider

- A provider passed as `tracer_provider=` is used, and the process's own is left as it is.
- A provider the process has set already is kept. Under `opentelemetry-instrument` with the OpenTelemetry distro installed, the distro sets one before the wrapper loads.
- With none, when the environment names an endpoint, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, and the protocol, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`, is unset or `http/protobuf`, the wrapper sets an SDK tracer provider on the SDK's default resource, with a batch span processor on the OTLP/HTTP exporter. It flushes when the process exits.
- Otherwise it starts none, writes one INFO line saying what was missing or which protocol was named, and its spans go to a provider the process sets later.

## What the spans carry

The spans are the turn record's [producers of the A2UI step](../../specification/turn_record/v0_1/docs/turn_record.md#producers-of-the-a2ui-step), under the instrumentation scope `a2ui-spectra-instrumentation`.

- **One event per outermost call.** A hooked call made while another is running opens no event of its own.
  - `prompt_generation`: `PromptGenerator.generate`, the one `generate()` every format's prompt generator has from the base class, with the section it wrote, the inference format, read from the generator's class, and the catalogs; a generator of none of the four formats' classes gives none, and neither does a prompt assembled without `generate()`, `assemble_instructions` called on its own or the skill generator; and the text the toolset's tool appends to the instructions in its `process_llm_request`, carrying `gen_ai.tool.name`.
  - `parse`: `parse_response`, a stream from `open_stream` to its `close`, a `compile` called on its own, and the toolset's tool call, with the input exactly as the call was given it, the messages it produced, the inference format and the catalogs. A stream's chunks are `a2ui.parse.chunk` span events. The tool call carries its tool's name, its call id when the tool context names one, and the object the tool returned. Every error the tool swallows is recorded on it: those its inner calls raised, and the tool's own, such as a payload that holds no messages, which belong to no block. The wrapper reads the tool's own through a filter on the toolset module's logger, while the tool logs the error it is handling.
- **Errors.** Each error a parse raised, or a stream read past, is an `exception` span event with its stack trace and the SDK's details. It carries the range of the block it belongs to, in UTF-16 code units: for a whole text and the tool call, the block being compiled or whose messages were being applied, found in the input; for a stream, the block it rejected, though the chunk that brought the error runs on into the next: the block text the error carries, or else the block after those the stream had finished or rejected, among the blocks the parser's `unwrap` finds in the input fed so far; either way stated whole when the stream's span ends, as `unwrap` finds the block in the stream's whole input. An error raised by the check of whole trees, `RendererState.check_topology` or `validate_payload`, belongs to no block.
- **Nothing of the agent kept.** The wrapper holds an error only while the outermost hooked call that saw it runs, and keeps its type, message and stack trace as text. An error object holds its traceback, and the traceback the frames of the agent's calls; a stream's event lives as long as its stream, and must not keep those frames, or an async generator the agent abandoned in one would never be closed.
- **What Spectra works out.** The wrapper reports no component ranges and no retries: Spectra works out which characters became which component from the input and the inference format, and which model call was a retry, when it shows the turn.

## The pinned API

The wrapper was written against upstream's release of 2026-11-10, `a2ui-agent-sdk` 0.11.0 and `a2ui-adk` 0.3.0, with the version floor `a2ui-agent-sdk >= 0.11.0`, which is also the package's `instruments` extra. Before hooking, it checks the floor, that each name it hooks resolves to a callable and that each prompt generator class it reads resolves to a class, per distribution:

| Distribution     | Names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | When one is missing                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `a2ui-agent-sdk` | `Parser.parse_response`; `PromptGenerator.generate` in `a2ui.prompt`; `RendererState.check_topology`, `RendererState.apply` and `validate_payload` in `a2ui.utils`; `compile` and `open_stream` on `DirectJsonParser` and `ExpressParser`; `feed` and `close` on `DirectJsonResponseStream` and `ExpressResponseStream`; the classes `DirectJsonPromptGenerator` and `ExpressPromptGenerator`, read from the modules that define them, `a2ui.inference_formats.direct_json.prompt_generator` and `a2ui.inference_formats.express.prompt_generator`, and not hooked; and `a2ui.parser.to_message_dicts`, which the hooks call | Nothing is hooked; one WARNING line                                           |
| `a2ui-agent-sdk` | Atom's `AtomParser.compile` and its class `AtomPromptGenerator`; Elemental's `ElementalParser.compile` and its class `ElementalPromptGenerator`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | That format is skipped; one DEBUG line                                        |
| `a2ui-adk`       | `SendA2uiToClientToolset.get_tools`, and `validate_payload` as the toolset's module holds it, whose logger also gets the filter; on the tool `get_tools` returns named `send_a2ui_json_to_client`, `run_async` and `process_llm_request`                                                                                                                                                                                                                                                                                                                                                                                     | The toolset is skipped; one WARNING line. Without `a2ui-adk`, nothing is said |

A refusal is one WARNING line under the logger `a2ui_spectra_instrumentation`, naming the distribution and the version found, the first missing name, and the pin:

```
a2ui-spectra-instrumentation left a2ui-agent-sdk 0.10.0 unpatched: it is below the version floor; it was written against a2ui-agent-sdk 0.11.0, upstream's release of 2026-11-10 (a2ui-agent-sdk >= 0.11.0)
```

Under `opentelemetry-instrument`, OpenTelemetry checks the `instruments` extra before it loads the wrapper, and skips it with a DEBUG line of its own when the agent SDK is missing or below the floor.

## Commands

From the repository root, after `uv sync --all-packages`:

- `uv run pytest`: the wrapper's tests, on an SDK tracer provider with an in-memory exporter.
- `uv run mypy`: strict type checks.
- `uv run pyink --check .` and `uv run pyink .`: formatting.

The wrapper capture suite in [`../../conformance/`](../../conformance) runs it through the Python driver, under `yarn test:all`.
