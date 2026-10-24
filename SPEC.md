# Spectra

Spectra, introduced as "Spectra for A2UI": a dev tool for the developer of an A2UI agent. Settled 2026-10-17.

---

## What Spectra is

- A dev tool for the developer of an A2UI agent: attach to the running agent, see every turn, check and preview it, record and replay it.
- It runs as one local process. Nothing is deployed and there is no cloud for it; at most, a hosted static viewer that opens files locally.
- It is proposed to the A2UI community on its own, apart from A2UIVerse, and is aimed at moving into upstream's `tools/` as `@a2ui/spectra`. Until then it lives in `a2ui-spectra`.
- **Name in prose:** "Spectra", or "Spectra for A2UI" when introducing it.

## The gap

Upstream's roadmap (`docs/public/roadmap.md`) lists "Developer tooling for A2UI at build time" under its long-term vision, with no further detail.

Upstream's developer tools start from a surface: a pasted payload, or one the tool's own model generated.

- **A2UI Inspector** (`tools/inspector/`, Lit) renders a pasted A2UI v0.8 response.
- **A2UI Editor** (`tools/editor/`, Lit) generates and visualizes a surface with Gemini.
- **A2UI Composer** (`tools/composer/`, React on Next.js, on CopilotKit's runtime) builds a surface through a chat, with a live preview, a JSON editor, and tabs for the data model, events, errors and raw messages. It renders the basic catalog only, through the React renderer.
- **Flutter's Catalog Gallery and Composer** live in the `flutter/genui` repo and are listed in the "Dev tools" table of upstream's `samples/README.md`.
- **The Gallery App** is described in upstream's framework adapter blueprint as a reference environment for inspecting the live data model and stepping through progressive rendering. The same blueprint stores envelope `metadata` on each component model; views ignore it "unless forwarding it to developer tooling".

Tools outside upstream that attach to a live agent, as of 2026-10-17:

| Tool                                                                    | Attaches over                               | What it covers                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agui-inspector`](https://github.com/dogganidhal/agui-inspector)       | AG-UI                                       | Sends runs to the agent and records every request and SSE frame with timing; validates against AG-UI's schemas; renders A2UI v0.8 and v0.9; saves and reopens sessions |
| [`a2a-a2ui-inspector`](https://github.com/suyangw-g/a2a-a2ui-inspector) | A2A                                         | Chats with an A2A agent and renders its A2UI v0.9 surfaces                                                                                                             |
| [`a2ui-inspector`](https://github.com/zhijiewong/a2ui-inspector)        | WebSocket, SSE, an HTTP proxy, JSONL replay | An A2UI v0.9 sidecar; sends actions back to the agent; a validation CLI                                                                                                |
| [`agent-surface`](https://github.com/kimjusnu/agent-surface)            | Adapters for AG-UI, A2UI and MCP Apps       | A host with trace replay and diff, and an evaluation gate that writes JUnit output for CI                                                                              |
| [`a2ui-debugger`](https://github.com/mgechev/a2ui-debugger)             | A bare SSE stream, or pasted JSON           | An A2UI v0.8 message log, state tree, preview and time travel                                                                                                          |

None of them sees inside the turn (the exact model request, the raw response, tool calls, tokens, retries, the A2UI step), and none replays a turn without calling the model. Spectra's claim is seeing inside the turn and replaying it without paying for the model, behind one turn record format and one viewer across transports.

## Features

### v1

**Seeing the turn**

- The turn list, and a turn view with the input, the raw text, the A2UI tree, the data model and the preview.
- Everything else the agent returns: collected data, metadata, text. A2UI is one part of the response, not all of it.
- The exact model request: system prompt, tool definitions, model id and settings.
- Token usage.
- Tool calls.
- The A2UI step: which raw text became which component, retries and the parse or validation errors that caused them, and the inference format.
- A timeline of the turn: time to the first token, time to the first component, and the duration of each tool call.

**Checking it**

- The response is A2UI and matches the schema of its protocol version.
- The response matches the catalog.
- Every child id points to an existing component, there is exactly one root, and nothing loops back on itself.
- Every path the UI binds to is filled by the data model.

**Using the drawn surface**

- A preview you can press. Pressing a control shows the exact action event the agent would receive, with its data model snapshot, and can send it to the agent as the next turn.
- Preview variants for narrow and wide widths.

**Not paying for every run**

- One-click save as fixture.
- Two replay modes, each labelled with its cost:
  - **everything recorded** (model and tools): free;
  - **tools recorded, model live:** model tokens only.

  A cache keyed by the exact request means an unchanged request never reaches the model twice. This is the record-and-replay pattern of Ruby's VCR and Netflix's Polly.js, applied to model calls.

- A test command that runs every fixture with model and tools recorded, for CI.

**The dev loop**

- Under `a2ui-spectra run`: restarting the agent and reading its logs.
- Restarting the agent on save, unless the agent's own dev server already reloads.
- Re-running the last turn with one press.
- The preview reloading when the catalog changes, when its preview page is served by the catalog's dev server.

### After v1

- Preview variants for light and dark, and other themes.
- **Fixture editing:** change a recorded tool result (an empty list, a very long list, a very long name, a missing field) and replay.
- **Tokens split by where they went:** system prompt, the catalog schema in the prompt, tool results, conversation history, and cache hits.
- **Fixture to test:** pin assertions (the response is valid, contains a component, offers an action) and export the fixture as a test.
- **Prompt diff:** edit the prompt, replay fixtures with the model live, and see old and new responses side by side, with differences in the tree and in the checks.
- **Prompt drafts in the browser:** edit the system prompt of a recorded turn as a draft and replay it against the recorded tool results through the model proxy, without touching the agent. A winning draft is then copied into the code. Replaying with tools recorded only works while the model keeps asking for the same tool calls; a draft that makes it ask for a different call needs the real agent running.
- Clicking a component or a prompt section opens the source file in the editor.

## Framing

A file format, taps at the edges every stack shares, and one viewer. HAR, the HTTP Archive format, works this way: browsers and proxies write it, any HAR viewer reads it, and none of them depends on the language the website was written in.

```
  host: Spectra's message box, or the adopter's own host app
    │ A2UI over the agent's transport
    ▼
 ┌─────────────────────────── a2ui-spectra, local ───────────────────────────┐
 │ transport adapter (A2A in v1): wire proxy, and host for the message box   │
 │ model proxy · tool proxy · OTLP/HTTP receiver                             │
 │ turn records on disk = fixtures                                           │
 │ viewer ── preview protocol ───────────────────────────────────────────────┼──▶ preview adapter in the catalog's own app
 └───────────────────────────────────────────────────────────────────────────┘
    ▲ wire          ▲ model API calls      ▲ tool calls (MCP, HTTP)   ▲ OpenTelemetry spans
    └───────────────┴──────────────────────┴──────────────────────────┘
                            the agent (any language, any framework)
```

- **Default host:** Spectra's own message box sends the first message.
- **Transport-neutral core.** The turn record, the checks, the viewer, the preview, the model and tool proxies and the OpenTelemetry receiver carry nothing transport-specific. Each transport is an adapter that does both the proxying and the hosting. A2A is the adapter in v1.
- This follows A2UI's own split. The protocol "defines the JSON message structure and the semantic contract … but it does not mandate a specific transport layer" (`specification/v0_9_1/docs/a2ui_protocol.md`, "Transport decoupling"). A transport must deliver messages in order, delimit each message, carry metadata (the data model sent with actions, and the exchange of capabilities), and may give a return channel for actions. Each binding maps that contract onto one transport, and so does each adapter.

## Capture

Capture works at three depths. Each depth adds to the view, and each works without the ones below it.

1. **The wire, with no code change.** The transport adapter sits between the host and the agent. It sees the A2UI messages, the data model, actions and timing.
2. **Model and tool calls, at the network edge and through OpenTelemetry.** The model proxy and the tool proxy see the exact requests and responses. The OpenTelemetry receiver takes whatever the agent's framework emits, which adds what happens inside the agent's process.
3. **The A2UI step, through the wrapper.** See [The wrapper](#the-wrapper).

### Redirection

- `a2ui-spectra run` launches the agent with environment variables set:
  - the model providers' base-URL variables, pointing at the model proxy: `GOOGLE_GEMINI_BASE_URL` (Google's Python and JavaScript SDKs, and ADK through them), `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, and library-specific ones such as LiteLLM's `GEMINI_API_BASE`;
  - `OTEL_EXPORTER_OTLP_ENDPOINT`, pointing at the OpenTelemetry receiver, and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.
- An agent that hardcodes its model endpoint needs a line of config.
- MCP defines no standard variable for a server's URL. For each tool server, the adopter names in Spectra's config the variable their agent reads the URL from. `a2ui-spectra run` points it at the tool proxy, which forwards to the original URL. A URL hardcoded in code needs a small change to read from a variable.
- Tools that are plain functions in the agent's process are not seen at the network edge. They run live during replay, and are seen through OpenTelemetry where the framework emits spans for them. A tool server that redirection does not reach behaves the same way.
- **HTTPS interception** comes after v1, as the fallback for what redirection cannot reach: Spectra as a forward proxy for the agent's outgoing HTTPS, with a locally trusted certificate, as mitmproxy does.

### OpenTelemetry

- The receiver accepts OTLP over HTTP. The protocol variable `a2ui-spectra run` sets moves Python's auto-configuration (`opentelemetry-instrument`, which otherwise defaults to gRPC) onto HTTP as well. An OTLP/gRPC receiver comes after v1.
- Producers emit different dialects of OpenTelemetry's GenAI conventions. ADK v2.12.0 records content under its own `gcp.vertex.agent.*` names by default; OpenInference uses its own `llm.*` and `input.value` names by default; OpenLLMetry mostly follows the current conventions. The receiver translates each dialect into the turn record.
- ADK exports to an endpoint set in the environment only inside its own CLI server (`adk web`, `adk api_server`). An agent that serves A2A itself switches an exporter on: one call to ADK's `maybe_set_otel_providers()`, or launching under `opentelemetry-instrument`.

### The wrapper

Upstream's agent SDKs do the A2UI step with two pieces:

```
catalog ──▶ prompt generator ──▶ prompt ──▶ model ──▶ raw text ──▶ parser ──▶ A2UI messages
            (writes the UI part                        (Direct JSON,        (validates; on failure
             of the prompt)                             Express, …)          the SDK may retry)
```

- The wrapper is OpenTelemetry instrumentation for upstream's Python and TypeScript SDKs: a dev-dependency package that patches the prompt generator and the parser at runtime and emits A2UI spans to the same receiver. OpenInference and OpenLLMetry instrument model libraries the same way.
- It is switched on with one line, or through `opentelemetry-instrument`. The agent's code does not change.
- It covers upstream's public parsing entry points as well as the inference-format classes.
- It reports what the model proxy cannot see:
  - which characters of raw text became which component;
  - that a second model call was a retry, and which parse or validation error caused it;
  - the inference format and catalog version the turn used;
  - which part of the prompt is the generated UI section and which is the developer's own text;
  - which model call produced which messages, when a turn has several model calls and tool calls.
- Three ways to get the A2UI step:
  1. Upstream adds a native hook to its SDKs that emits the same spans.
  2. The wrapper.
  3. Agents not on upstream's SDKs emit the same spans themselves, following the turn record spec.

## Turn record

- The turn record is the contract: a versioned schema that belongs to no language. A fixture is a turn record.
- Model-call fields use the names of OpenTelemetry's GenAI semantic conventions wherever one exists, pinned to a dated snapshot. Since semantic-conventions v1.42.0 those conventions live in `open-telemetry/semantic-conventions-genai`, all at Development level, with no release yet.
- The A2UI parts (messages, surfaces, actions, checks, the wrapper's spans) are Spectra's own. The hook proposal carries them upstream as the shared convention.
- Every event carries a timestamp.
- Nothing in the record is transport-specific. Its shape is checked against AG-UI's (activity snapshots, streamed tool-call arguments) as well as A2A's.
- No credential is ever in the record.
- The exact requests and responses that replay depends on come from Spectra's proxies. OpenTelemetry adds the view from inside the agent's process.
- It ships with shared test data, the way upstream's `conformance/` suite checks that its SDKs in different languages behave the same. Every capture path in every language proves it writes the same record.

## Replay and storage

- **Model calls:** the model proxy records and replays them, keyed by the exact request content. Credentials are not part of the key.
- **Tool calls:** the tool proxy does the same for MCP servers and HTTP tools.
- **Replaying a fixture:** start the agent pointed at Spectra in replay mode, then send the recorded request over the wire.
- **Storage:** plain files.
  - Turns captured during development go to a local store that git ignores, by default.
  - Save as fixture writes the turn record where the adopter decides. What content is safe to commit is the adopter's call.
  - Credentials are stripped at the proxy before anything reaches disk, always.

## Preview

- The viewer talks to the preview over the preview protocol: A2UI messages go in; render errors, actions and a screenshot come out.
- A catalog has a definition (`catalog.json`, the component names and props as JSON Schema, which the checks use) and an implementation per renderer. A catalog renders only through a renderer it is implemented for. The basic catalog is implemented in every upstream renderer.
- **The catalog supplies its own renderer.** The adopter adds the preview adapter as a dev dependency, adds a small page served by the catalog's dev server, and tells Spectra its URL. The adapter takes the renderer as a peer dependency, so the preview runs on the framework and the renderer version the real host uses.
- The preview adapter is a framework-free core holding the preview protocol, with thin adapters for React, Lit and Angular in v1. The Flutter and SwiftUI adapters follow in Dart and Swift, running in a simulator or on a device and connecting back over a socket.
- The basic catalog is built into Spectra, with its own renderer, so it previews with no setup.
- Without the adapter, a custom catalog has no preview and its controls cannot be pressed from the preview. Everything else works.
- The same adapter becomes the renderer-side tap inside a real host app.

## Adopter path

**0. Install:** one binary, through `npx a2ui-spectra`, `uvx a2ui-spectra`, or the curl script.

**1. Point Spectra at the agent.**

```
a2ui-spectra run -- python agent.py
a2ui-spectra run -- npm run dev
a2ui-spectra run -- dart run bin/agent.dart
```

`a2ui-spectra run` launches the command with the environment variables in [Redirection](#redirection) set. Genkit's `genkit start -- <command>` and the MCP Inspector's `npx @modelcontextprotocol/inspector <command>` work the same way.

```
a2ui-spectra attach http://localhost:10002
```

`a2ui-spectra attach` is for an agent that is already running. It gives wire-level capture, unless the adopter sets the environment variables themselves.

What Spectra needs to know, and where it comes from:

| What                                             | Source                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How to reach the agent, and over which transport | An A2A agent's card names its transport and, when it advertises the A2UI extension, the protocol versions and the catalogs it supports. A turn's protocol version comes from its A2UI messages. |
| The catalog schema, for the checks               | The catalog id. The basic catalog is built in; a custom catalog is a path to its `catalog.json`.                                                                                                |
| The catalog's look, for the preview              | The URL of the preview page the catalog's dev server serves with the preview adapter.                                                                                                           |
| Model providers                                  | Redirected through the base-URL variables. An agent that hardcodes its endpoint needs a line of config.                                                                                         |
| Tool servers                                     | The variable the agent reads each server's URL from.                                                                                                                                            |

Settings beyond the defaults go in an optional config file committed in the repo.

**2. Send a turn.** The viewer opens in the browser. Turns come from Spectra's own message box, the default, where Spectra acts as the host over the agent's transport. They can also come from the adopter's own host app, pointed at Spectra's wire proxy.

**3. Go deeper.** Each step is optional, and each adds to the view:

| What the adopter has done                                                                                                                 | What they get                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install, `a2ui-spectra run -- <cmd>`, send a message from the box                                                                         | The tree, the data model, the raw messages and actions; the schema and structural checks; the basic catalog's checks and preview; the timeline; the exact model request, the raw response and tokens; capture, fixtures, replay and the test command; agent restart, logs and restart on save |
| Config only: the custom catalog's `catalog.json`, the tool servers' URL variables, where fixtures are saved                               | Catalog checks for their own components; tool calls recorded, and replay with tools recorded and the model live                                                                                                                                                                               |
| Small code or dependency changes: a hardcoded tool server URL made configurable, an OpenTelemetry exporter switched on, the wrapper added | Framework traces (tools in the agent's process, the framework's own retries); the A2UI step: raw text linked to the tree, the inference format, retries and parse errors                                                                                                                      |
| Catalog side: the preview adapter and its page                                                                                            | The preview of their own catalog, and pressing its controls                                                                                                                                                                                                                                   |

**4. Fixtures:**

- **Save as fixture** writes the turn record.
- Replay runs from the viewer or with `a2ui-spectra replay <file>`.
- `a2ui-spectra test <fixtures folder>` runs every fixture with model and tools recorded.

### Browser, terminal, editor

When launched with `a2ui-spectra run`, Spectra owns the agent's process: restart, logs, and reload on file change. With `a2ui-spectra attach`, Spectra watches the agent but does not own it.

| Where    | What happens there                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser  | Sending messages; reading turns; saving and replaying fixtures; running the fixture set as tests; switching preview widths; restarting the agent and reading its logs (under `a2ui-spectra run`) |
| Terminal | Launching Spectra once; secrets such as API keys in the shell or the agent's `.env`; CI through the same test command                                                                            |
| Editor   | Changing the agent's code, prompt or catalog                                                                                                                                                     |

The round trip from the editor:

- Spectra watches the agent's files and restarts the agent on save, unless the agent's own dev server already reloads.
- The preview reloads when the catalog changes, when its preview page is served by the catalog's dev server.
- "Re-run the last turn" is one press.

## Engineering decisions

| Part                                                                                                  | Decision                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI and local server (transport adapters, proxies, OpenTelemetry receiver, file store, viewer server) | TypeScript written against Node's standard APIs. It runs on Node in development and tests. Bun compiles it into one binary per platform with the web UI embedded, as Temporal's CLI embeds its web UI. The binary's automatic loading of `.env` and `bunfig.toml` is switched off. It imports upstream's web core for state and validation. |
| Checks                                                                                                | Schema checks run as standard JSON Schema, against each protocol version's schemas taken from upstream. The A2UI-specific checks reuse upstream's web core.                                                                                                                                                                                 |
| Viewer                                                                                                | TypeScript, React, Vite; shadcn/ui components on Tailwind; upstream's web core for the tree and the data model                                                                                                                                                                                                                              |
| Preview adapters                                                                                      | A framework-free TypeScript core, with React, Lit and Angular adapters; Dart and Swift for the Flutter and SwiftUI adapters                                                                                                                                                                                                                 |
| Wrappers                                                                                              | OpenTelemetry instrumentation; Python and TypeScript in v1, then Dart                                                                                                                                                                                                                                                                       |
| OpenTelemetry receiver                                                                                | OTLP over HTTP in v1                                                                                                                                                                                                                                                                                                                        |
| Storage                                                                                               | Plain files                                                                                                                                                                                                                                                                                                                                 |

The viewer's own stack is not visible to the adopter.

### Repo

- One repo holds every package: the CLI and local server, the viewer, the preview core and adapters, the Python and TypeScript wrappers, and the turn record spec with its shared test data.
- Shaped like an upstream tool from the first commit: Yarn workspaces built with `wireit`, with upstream's standard script targets (`build`, `lint`, `lint:fix`, `test`, `format`, `format:check`). The Python wrapper is a uv project, as upstream's Python packages are. The layout follows upstream's monorepo conventions.
- **Upstream reference** (`upstream/main` at 020a9d6f): Yarn 4.13.0 with the `node-modules` linker; CI on Node 22; `tools/inspector` and `tools/editor` are `@a2ui/<tool>` workspaces marked `private` and built with `wireit`.

### Distribution and names

- One binary per platform, shipped through:
  - **npm:** one optional package per platform, with no install script, as Biome ships;
  - **PyPI:** one wheel per platform, as Ruff ships;
  - **GitHub releases,** with a curl install script.
- Homebrew and `dart pub global` come after v1.
- Every package and the command are named `a2ui-spectra`. The wrappers and the preview adapters use it as their prefix.
- At the move, it becomes `@a2ui/spectra`.

## v1 coverage

**Coverage line:** the agents and hosts Spectra is tested against jointly exercise:

- the A2UI protocol versions v0.9, v0.9.1 and v1.0;
- A2A 0.3 and A2A 1.0;
- A2A SDKs: Python's and JavaScript's, and at least one in another language;
- the wire forms: a send and a stream; A2UI in a task's status message, in an artifact and in a plain message reply; one A2UI message per part and an array; the MIME type in the part's metadata and on the part;
- the turn outcomes: completed, waiting for input, failed and cancelled;
- the hosts: Spectra's message box, upstream's Angular sample client and upstream's React sample client.

Upstream's three core samples are the headline targets. Agents found in the ecosystem, and agents built for what no found agent exercises, fill the rest.

- `samples/agent/adk/restaurant_finder`: Python on ADK, upstream's Python SDK and A2A, defaulting to Gemini.
- `samples/agent/adk/custom-components-example`: Python on ADK, upstream's Python SDK and A2A, calling Gemini through LiteLLM, with an MCP server over HTTP+SSE.
- `samples/agent/node/restaurant_finder`: TypeScript on `@a2ui/agent`, `@a2ui/web_core`, `@a2a-js/sdk` and `@google/genai`.

The demo shows the restaurant finder in Python and in TypeScript producing the same Spectra view.

A2UIVerse is Spectra's first adopter, and Spectra is tested against its agents too.

| Area                          | v1                                                                                                                                    | After v1                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A2UI protocol versions        | v0.9, v0.9.1, v1.0                                                                                                                    | v0.8 is not covered                                                               |
| Transport                     | A2A 0.3 and 1.0, over JSON-RPC                                                                                                        | AG-UI first, then MCP as transport, REST, WebSockets; A2A over gRPC and HTTP+JSON |
| The A2UI step (wrapper)       | Python and TypeScript, covering upstream's public parsing entry points as well as the inference-format classes                        | Dart, then retired when the upstream hook lands                                   |
| Model providers               | Gemini read in full: prompt, tokens, display. Every other provider is recorded and replayed, shown as raw requests.                   | Reading OpenAI, Anthropic and others                                              |
| Reaching model and tool calls | Redirection through environment variables                                                                                             | HTTPS interception as the fallback                                                |
| Tools                         | MCP over streamable HTTP and over HTTP+SSE; HTTP tools. Tools that are plain functions in the agent's process run live during replay. | MCP over stdio                                                                    |
| Framework traces              | OTLP over HTTP; each producer's dialect translated into the turn record                                                               | OTLP over gRPC                                                                    |
| Preview                       | Web, through preview adapters for React, Lit and Angular; the basic catalog built in                                                  | Flutter (possibly through Flutter's web build first), SwiftUI, Compose            |
| Install                       | npm, PyPI, GitHub releases with a curl script                                                                                         | Homebrew, `dart pub global`                                                       |

What each kind of agent gets in v1:

| Agent                                                                                                                             | What it gets                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A agents on upstream's Python or TypeScript SDK                                                                                 | Everything                                                                                                                                                          |
| A2A agents not on those SDKs: Dart agents on upstream's SDK, agents that build A2UI JSON by hand, any other language or framework | Everything except the A2UI step, which they can report themselves following the turn record spec. Model and tool data wherever redirection and OpenTelemetry reach. |
| AG-UI agents, A2UI over MCP, REST, WebSockets                                                                                     | Nothing until those transports' adapters are added                                                                                                                  |

## Upstream landscape

As read from `upstream/main` at 45633b9 (2026-10-16), unless noted.

- **Protocol versions** (`specification/`): v0.9.1 is the current production release. v1.0, previously known as 0.10, is a release candidate, with its own A2A extension spec. v0.9 is closed. v0.8 is legacy.
- **Agent SDKs:**
  - **Python:** four packages on PyPI (2026-10-22): `a2ui-core` 0.4.0, the core library; `a2ui-agent-sdk` 0.9.0, the agent SDK; `a2ui-a2a` 0.1.0, the A2A extension; `a2ui-adk` 0.1.0, the ADK extension. The A2A and ADK extensions moved out of the agent SDK, with their import paths (`a2ui.a2a`, `a2ui.adk`) unchanged. The agent SDK's code covers v0.8 to v1.0. Elemental and Atom are experimental (`python/a2ui_agent/src/a2ui/inference_formats/experimental/`).
  - **TypeScript:** `@a2ui/agent` 0.0.1, not published to npm. It covers v0.9, v0.9.1 and v1.0, and implements Direct JSON and Express; Elemental and Atom are not implemented, and Express does not stream (`typescript/agents/a2ui_agent/KNOWN_GAPS.md`).
  - **Dart** (`dart/a2ui_agent`), and a legacy JVM SDK (`kotlin/agent_sdk_legacy`).
  - **Inference formats** (Direct JSON, Express, Elemental, Atom) are syntaxes the model writes a UI in before the SDK compiles it into A2UI messages.
- **Renderers:** Lit, Angular and React on the shared web core (`@a2ui/web_core`, 0.14.0 on npm); Flutter on a Dart core (`dart/a2ui_flutter`); SwiftUI on a Swift core (`swift/`). The Lynx renderer lives in `lynx-family/lynx-stack`. Jetpack Compose is planned upstream, and community Compose renderers exist (`docs/public/ecosystem/renderers.md`).
- **Transports:**
  - **A2A** has a full binding: each A2UI message is one A2A message Part, the data model and capabilities go in the A2A message's `metadata`, and an A2UI session maps to A2A's `contextId`.
  - **AG-UI** is listed as stable, with no binding in upstream. Its A2UI mapping is defined on AG-UI's side, in `@ag-ui/a2ui-middleware`: A2UI messages as `ACTIVITY_SNAPSHOT` events with `activityType: "a2ui-surface"`, the UI as the streamed arguments of a `render_a2ui` tool call, and user actions in `forwardedProps`.
  - **MCP, REST and WebSockets.**
- **Agent frameworks:** ADK and AG2. Outside upstream, AG-UI's ecosystem ships A2UI support for LangGraph, CrewAI, Mastra, AWS Strands and Microsoft Agent Framework, mostly through CopilotKit and AG-UI's own A2UI toolkit rather than upstream's agent SDK. CopilotKit's A2UI renderer is built on upstream's web core. (AG-UI and CopilotKit repos, 2026-10-17.)
- **Sample agents:** `samples/agent/` holds the three core samples. `samples/community/` "contains code that is not maintained" (its README), with ten agent entries under `samples/community/agent/adk/` and four samples under `samples/community/mcp/`. Sample clients: Lit, Angular, React, Flutter.
- **Tools:** `tools/inspector`, `tools/editor`, `tools/composer`, `tools/build_catalog`.

## Roadmap

### v1, in `a2ui-spectra`

1. **Foundation:** the repo shaped like an upstream tool, Apache 2.0, CI; the turn record spec's first version, its OpenTelemetry attribute names and shared test data.
2. **First turn on screen:** `a2ui-spectra run` and `a2ui-spectra attach`; the A2A adapter, with the wire proxy and the message box as host; captured turns in the local store; the viewer's turn list, raw messages, tree and data model; schema checks for v0.9, v0.9.1 and v1.0. Built and run as the compiled binary from this phase on.
3. **Checks and preview:** catalog and structural checks; the preview protocol and its core; the built-in basic catalog preview; the React, Lit and Angular preview adapters; the preview you can press; preview widths.
4. **Inside the turn:** the model proxy (Gemini read in full, other providers recorded raw) and the tool proxy (MCP over both HTTP transports), reached by redirection, with credentials stripped; the OTLP/HTTP receiver translating each producer's dialect; the exact model request, tokens and the timeline.
5. **The A2UI step:** the Python and TypeScript wrappers as OpenTelemetry instrumentation; retries and parse errors; raw text linked to the components it became.
6. **Fixtures and replay:** save as fixture; replay with everything recorded and with tools recorded and the model live, each labelled with its cost; `a2ui-spectra replay`; `a2ui-spectra test` for CI.
7. **The dev loop:** agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server.
8. **Shipping:** the binary on npm, PyPI and GitHub releases, with the curl script.
9. **The case:** the demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; a README; the contribution rule; the proposal as a GitHub Discussion.

### After v1: widen coverage and propose the hook

- **Widen coverage,** whatever the answer to the proposal:
  - AG-UI first, then MCP as transport, REST and WebSockets;
  - MCP over stdio, HTTPS interception, an OTLP/gRPC receiver;
  - the Dart wrapper, the Flutter and SwiftUI preview adapters;
  - the features listed under [After v1](#after-v1);
  - Homebrew and `dart pub global`.
- **Propose the hook,** once the community accepts:
  - the design, likely as an upstream blueprint (upstream's language-agnostic design docs that each language's SDK implements), carrying the turn record spec as the shared convention;
  - one PR each to the Python, TypeScript and Dart SDKs, plus test data in upstream's `conformance/` suite.
- **Retire the wrappers:** Spectra detects the native hook and stops wrapping.

### Last: move into `tools/`

- Port into the upstream monorepo as `@a2ui/spectra`, under its workspace, build and lint rules, with Google's Contributor License Agreement covering every contributor.
- Settle with upstream how it ships.
- `a2ui-spectra` becomes an archive that points to the new home.

## Governance

- **Licence:** Apache 2.0, the same as upstream.
- **Home until the move:** `a2ui-spectra` on the personal GitHub account, outside the proposed `a2uiverse` GitHub organization.
- **Contributions:** upstream contributions require Google's Contributor License Agreement, and code from an outside contributor can move upstream only if that contributor has signed it. Until the move, no outside code is merged. Issues and discussion are welcome.
- **The proposal:** a GitHub Discussion, the route upstream's roadmap gives for proposing features. It also asks for a listing in the "Dev tools" table of upstream's `samples/README.md`.
- **What "the community accepts" means:** a maintainer's positive reply in the Discussion, agreeing the hook is worth a blueprint. It gates proposing the hook only.
- **Distribution after the move:** upstream's tools are private, unpublished workspace packages, so how Spectra ships after the move is upstream's decision.

## Open

- **AG-UI's timing:** whether AG-UI ships alongside v1 if v1 lands early.
- **Light and dark preview variants:** they depend on whether upstream's web renderers support dark mode, which is not yet checked.
- **The wrappers' supported SDK versions.** `@a2ui/agent` is not yet on npm and is usable only inside upstream's monorepo.
- **At the move:** where each piece lands inside upstream, and how Spectra ships after.
