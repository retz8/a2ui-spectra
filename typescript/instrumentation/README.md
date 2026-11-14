# a2ui-spectra-instrumentation

The A2UI wrapper of Spectra for A2UI, for TypeScript: OpenTelemetry instrumentation of upstream's agent SDK, `@a2ui/agent`. It replaces the SDK's prompt generators' and parsers' public methods on their exported classes' prototypes at runtime and exports the A2UI step's spans, `prompt_generation` and `parse`, to Spectra's OpenTelemetry receiver. It changes nothing the SDK does: every hooked call returns what it returns and throws what it throws, and a failure inside the wrapper is one warning line.

## Installing

A dev dependency of the agent, on Node 22.12 or later, the first Node that loads an ES module through `require()` with no flag. The wrapper patches the `@a2ui/agent` it resolves from its own place, so it is installed beside the agent's own copy, in the agent's `node_modules`; a second copy of the SDK elsewhere in the process is left unpatched. Until it ships, it is installed from a packed tarball:

```
yarn workspace a2ui-spectra-instrumentation build
yarn workspace a2ui-spectra-instrumentation pack --out a2ui-spectra-instrumentation.tgz
npm install --save-dev /path/to/a2ui-spectra/typescript/instrumentation/a2ui-spectra-instrumentation.tgz
```

`@a2ui/agent` and `@opentelemetry/api` are peer dependencies: the agent's own copies are the ones used.

## Switching it on

Each way, the agent needs the `OTEL_EXPORTER_OTLP_*` variables that point at Spectra's receiver.

- **Through Node's `--import`**, before the agent's own code runs:

  ```
  node --import a2ui-spectra-instrumentation/register agent.js
  ```

  It switches the wrapper on as the one line does, starting a tracer provider when the process has none. `NODE_OPTIONS="--import a2ui-spectra-instrumentation/register"` does the same for a command that starts Node itself, such as `npm run dev`.

- **With one line**, anywhere before the agent parses or generates a prompt:

  ```ts
  import {instrument} from 'a2ui-spectra-instrumentation';

  instrument();
  ```

  The hooks are on the classes' prototypes, so the line works before or after the agent imports the SDK. `instrument({tracerProvider})` sends the spans to a provider of the agent's own. `uninstrument()` puts every original back; a provider the wrapper started stays. A second `instrument()` is one warning line and does nothing.

- **As an instrumentation under the agent's own provider**, beside the others an agent on OpenTelemetry's NodeSDK already lists:

  ```ts
  import {A2uiInstrumentation} from 'a2ui-spectra-instrumentation';

  const sdk = new NodeSDK({instrumentations: [new A2uiInstrumentation()]});
  ```

  Constructed, it hooks the SDK, as every OpenTelemetry instrumentation does, and its spans go to the provider it is handed, through `registerInstrumentations` or the NodeSDK. It starts no provider of its own. Its `disable()` puts every original back.

**Under `a2ui-spectra run`**, the variables are set for the agent: launch it as `a2ui-spectra run -- node --import a2ui-spectra-instrumentation/register agent.js`, or with the one line or the instrumentation in its code, `a2ui-spectra run -- npm run dev`.

**Under `a2ui-spectra attach`**, set the variables Spectra prints at start in the agent's shell, then start the agent any of the three ways.

## The tracer provider

- A provider passed as `instrument({tracerProvider})` is used, and the process's own is left as it is.
- A provider the process has registered already is kept.
- With none, when the environment names an endpoint, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, and the protocol, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` or `OTEL_EXPORTER_OTLP_PROTOCOL`, is unset or `http/protobuf`, the wrapper registers a `NodeTracerProvider` on the SDK's default resource, with a batch span processor on OpenTelemetry's OTLP/HTTP trace exporter, which reads the endpoint itself and sends OTLP/JSON, which Spectra's receiver reads as it reads protobuf. Nothing is added to the resource.
- Otherwise it starts none, and says what was missing or which protocol was named at info, through OpenTelemetry's `diag`. The hooks trace through the OpenTelemetry API's global tracer, so a provider the process registers later takes the spans.

**The exit flush.** The provider the wrapper started is shut down on `beforeExit`, once, which flushes the spans when the agent's process ends naturally. The wrapper adds no signal handlers: an agent stopped by a signal, such as Ctrl-C, keeps only what the batch span processor had exported already. The batch delay is OpenTelemetry's default, five seconds, and its `OTEL_BSP_*` variables tune it.

## What the spans carry

The spans are the turn record's [producers of the A2UI step](../../specification/turn_record/v0_1/docs/turn_record.md#producers-of-the-a2ui-step), under the instrumentation scope `a2ui-spectra-instrumentation`.

- **One event per outermost call.** Every hooked call is synchronous, so a stack holds the open event; a hooked call made while another is running opens no event of its own.
  - `prompt_generation`: a prompt generator's `generate`, with the section it returned, the inference format of the generator's class and its catalogs. A `generate` that throws gives the failed form: no section, and the error.
  - `parse`: `parseResponse`, a stream from `openStream` to its end, and a `compile` called on its own, with the input exactly as the call was given it, every message the call returned, the format of the parser's class, when it is Direct JSON's or Express's, and the parser's catalogs. A stream's chunks are `a2ui.parse.chunk` span events. A stream's span ends when `close` returns or throws, or when a `feed` throws; a stream never closed is never exported.
- **Errors.** Each error a parse threw, or a stream returned in a rejected block's place, is an `exception` span event with its class name, message and stack trace, and the SDK's structured details when its `details` are objects. It carries the range of the block it belongs to, in UTF-16 code units. For a whole text and a `compile` called on its own, it is the block the parser was compiling, found in the input; an error thrown by `RendererState.checkTopology`, the check of whole trees, belongs to no block. For a stream, it is the block the error rejected: the text the error carries as `rawContent`, else the block after those the stream had finished or rejected when it caught the error, counted at its `RendererState.markChecked`; either way stated whole, as the parser's `unwrap` finds the block in the stream's whole input.
- **What Spectra works out.** The wrapper reports no component ranges and no retries: Spectra works out which characters became which component from the input and the inference format, and which model call was a retry, when it shows the turn.

## The pinned API

The wrapper was written against upstream's release of 2026-11-02, `@a2ui/agent` 0.1.0, which is its version floor; see [What Spectra supports](../../README.md#what-spectra-supports). Before hooking, `instrument()` and the instrumentation's `enable()` check that `@a2ui/agent` resolves, that the version its `package.json` gives is at least 0.1.0, and that every hooked name is a function on its class's prototype. They stand or fall together:

| Class                                                 | Hooked                         |
| ----------------------------------------------------- | ------------------------------ |
| `Parser`                                              | `parseResponse`                |
| `DirectJsonParser`, `ExpressParser`                   | `openStream`, `compile`        |
| `DirectJsonResponseStream`, `ExpressResponseStream`   | `feed`, `close`                |
| `DirectJsonPromptGenerator`, `ExpressPromptGenerator` | `generate`                     |
| `RendererState`                                       | `checkTopology`, `markChecked` |

A refusal is one warning line, through `process.emitWarning`, naming the package and the version found, or that it is not installed, the first missing name, and the release, and nothing is patched:

```
(node:12345) Warning: a2ui-spectra-instrumentation left @a2ui/agent 0.0.2 unpatched: it is below the version floor; it was written against @a2ui/agent 0.1.0, upstream's release of 2026-11-02 (@a2ui/agent >= 0.1.0)
```

## Commands

From this directory:

- `yarn build`: compiles `src/` into `dist/`.
- `yarn test`: builds, then runs the wrapper's tests with Node's test runner, on an SDK tracer provider with an in-memory exporter, and as subprocesses for the routes and the check's floor.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

The wrapper capture suite in [`../../conformance/`](../../conformance) runs it through the TypeScript driver, under `yarn test:all`.
