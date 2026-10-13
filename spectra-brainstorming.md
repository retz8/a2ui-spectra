# Spectra brainstorming

Recorded 2026-10-12. Spectra: a dev tool for the developer of an A2UI agent. It is proposed to the A2UI community on its own, separate from A2UIVerse, and is aimed at moving into upstream's `tools/` eventually.

---

## Decisions

- **Framing:** a file format, taps at the edges every stack shares, and one viewer.
- **Default host:** Spectra's own message box sends the first message.
- **Process ownership:** Spectra owns the agent's process when launched with `spectra run`.
- **Strategy:** v1 implements the A2UI step with a small wrapper package and is proposed to the community. When the community accepts, propose adding the hook to upstream's SDKs.
- **End state:** Spectra moves into upstream's `tools/`.
- **Home until then:** a separate repo, `a2ui-spectra`, on the personal GitHub account, outside the proposed `a2uiverse` GitHub organization.
- **v1 coverage line:** every A2A sample agent upstream ships works fully under Spectra, plus the five A2UIVerse agents.

## Gap

- Upstream's roadmap (`docs/public/roadmap.md`) lists "Developer tooling for A2UI at build time" under its long-term "Full App UIs" heading, with no further detail.
- Upstream developer tools today:
  - **A2UI Inspector** (`tools/inspector/`) renders a pasted A2UI response.
  - **A2UI Composer** builds a surface through a Gemini chat. It has a live preview, a JSON editor, and tabs for the data model, events, errors and raw messages.
  - **Flutter's Catalog Gallery and Composer** live in the `flutter/genui` repo and are listed in the "Dev tools" table of upstream's `samples/README.md`.
  - **The Gallery App** is described in upstream's framework adapter blueprint as a reference environment for inspecting the live data model and stepping through progressive rendering.
  - The same blueprint stores envelope `metadata` on each component model. Views ignore it "unless forwarding it to developer tooling".
- Each of these starts from a surface: a pasted payload, or one the tool's own model generated. None attaches to a developer's own agent, with its prompt, tools and model, while it runs. Spectra fills that gap.

## What the developer needs to see

- The input prompt and the output raw response.
- Validation of the raw response:
  - the response shape is A2UI and matches the correct protocol version's schema;
  - the response matches the catalog;
  - how it will look.
- Retries and tool calls of the agent itself.
- Everything else the agent returns: collected data, metadata, text. A2UI is one part of the response, not all of it.
- Token usage.
- One-click fixture and replay. Calling one's own agent during development costs tokens, and the fixture solves that.

### Further features

**Seeing the turn**

1. **The exact model request:** system prompt, tool definitions, model id and settings.
2. **Tokens split by where they went:** system prompt, the catalog schema in the prompt, tool results, conversation history, and cache hits.
3. **Two checks after the catalog check:**
   - every child id points to an existing component, there is exactly one root, and nothing loops back on itself;
   - every path the UI binds to is filled by the data model.
4. **A timeline of the turn:** time to the first token, time to the first component, and the duration of each tool call.

**Using the drawn surface**

5. **A preview you can press.** Pressing a control shows the exact action event the agent would receive, with its data model snapshot, and can send it to the agent as the next turn.
6. **Preview variants:** narrow and wide widths, light and dark, other themes.

**Not paying for every run**

7. **Two replay modes, each labelled with its cost:**
   - **everything recorded** (model and tools): free;
   - **tools recorded, model live:** model tokens only.

   A cache keyed by the exact request means an unchanged request never reaches the model twice. This is the record-and-replay pattern of Ruby's VCR and Netflix's Polly.js, applied to model calls.
8. **Fixture editing:** change a recorded tool result (an empty list, a very long list, a very long name, a missing field) and replay.
9. **Fixture to test:** pin assertions (the response is valid, contains a component, offers an action) and export the fixture as a test.
10. **Prompt diff:** edit the prompt, replay fixtures with the model live, and see old and new responses side by side, with differences in the tree and in the checks.

## Framing

A file format, taps at the edges every stack shares, and one viewer. HAR, the HTTP Archive format, works this way: browsers and proxies write it, any HAR viewer reads it, and none of them depends on the language the website was written in.

```
 any agent  (Python / TS / Dart / Kotlin · ADK / LangGraph / …)
   │ model API calls     │ tool calls (MCP, HTTP)     │ optional SDK hook
   ▼                     ▼                            ▼
 ┌─────────────────────── spectra, local ───────────────────────┐
 │  model proxy · tool proxy · OpenTelemetry receiver ·          │
 │  wire proxy (A2A / AG-UI / WS / REST / MCP)                   │
 │  turn records on disk  =  fixtures                            │
 │  web viewer ─── preview protocol ──────────────────────────────┼─▶ web core host
 └───────────────────────────────────────────────────────────────┘    Flutter host
                                                                       SwiftUI host
```

### Turn record

- The turn record is the contract: a schema that belongs to no language. A fixture is a turn record.
- It ships with shared test data, the way upstream's `conformance/` suite checks that its SDKs in different languages behave the same. Every capture method in every language proves it writes the same record.
- It is built on OpenTelemetry's GenAI semantic conventions, OpenTelemetry's standard attribute names for model calls (model id, prompt, completion, tokens), with A2UI-specific attributes added.

### Capture at three depths

Each depth adds to the view, and each works without the ones below it.

1. **The wire, with no code change.** A local proxy sits between the host and the agent. It sees the A2UI messages, the data model, actions and timing.
2. **Model and tool calls, through OpenTelemetry.** Spectra runs a local OpenTelemetry receiver. Whatever the agent's framework already emits (ADK natively; other frameworks through the OpenInference or OpenLLMetry plugins) fills in the prompt, the raw response, the tool calls, the tokens and the retries.
3. **The A2UI step, through an SDK hook.** It sits in the prompt generator and the parser of upstream's agent SDKs. See [SDK hook](#sdk-hook).

### Replay at the network edges

- **Model calls:** a record-and-replay proxy for the model provider's API, which the agent reaches through a base-URL override. Requests are keyed by their exact content.
- **Tool calls:** the same approach for MCP servers and HTTP tools.
- **Replaying a fixture:** start the agent pointed at Spectra in replay mode, then send the recorded request over the wire.
- **Tools that are plain functions in the agent's process** are not seen at the network edge. They run live during replay.

### Preview through any renderer

- The viewer talks to a **preview host** over a small protocol: A2UI messages go in; render errors, actions and a screenshot come out.
- There is one preview host per renderer core:
  - the web core host covers Lit, Angular, React and Lynx, loading a web catalog into a frame;
  - the Flutter host and the SwiftUI host run in a simulator or on a device and connect back over a socket.
- The same adapter becomes the renderer-side tap inside a real host app.

### One install for any ecosystem

- One local process holds the proxies, the OpenTelemetry receiver, the file store and the viewer server.
- It is one binary with the web UI embedded, as Temporal's CLI embeds its web UI.
- It is distributed through each ecosystem's package manager (`brew`, `npx`, `pipx`/`uvx`, `dart pub global`, a curl script), as Ruff ships one binary through pip and Biome through npm.
- The viewer's own stack is not visible to the adopter.
- Schema checks run as standard JSON Schema. The A2UI-specific checks reuse upstream's web core.
- There is no cloud for Spectra. At most, a hosted static viewer that opens files locally.

## Adopter path

**0. Install:** one binary, through the adopter's own package manager.

**1. Point Spectra at the agent.**

```
spectra run -- python agent.py
spectra run -- npm run dev
spectra run -- dart run bin/agent.dart
```

`spectra run` launches the command with environment variables set: base URLs for the common model providers (for example `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`) pointing at the model proxy, and `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at the OpenTelemetry receiver. Genkit's `genkit start -- <command>` and the MCP Inspector's `npx @modelcontextprotocol/inspector <command>` work the same way.

```
spectra attach http://localhost:10002
```

`spectra attach` is for an agent that is already running. It gives wire-level capture, unless the adopter sets the environment variables themselves.

What Spectra needs to know, and where it comes from:

| What | Source |
| --- | --- |
| How to reach the agent, and over which transport | An A2A agent's card names its transport, the A2UI extension and protocol version, and the catalogs it supports. For AG-UI, REST, WebSockets or MCP as transport, the adopter names the transport. |
| The catalog schema, for the checks | The catalog id from the card. The basic catalog is built in; a custom catalog is a path to its `catalog.json`. |
| The catalog's look, for the preview | Web catalogs: a path to the package or the URL of its dev server, loaded by the web preview host. Flutter or SwiftUI: a small dev dependency in the app that connects back to Spectra. |
| Model providers | Detected through the base-URL variables. An agent that hardcodes its endpoint needs a line of config. |
| Tool servers | The MCP servers and HTTP tools to record are listed, unless the SDK hook reports them. |

Settings beyond the defaults go in an optional config file committed in the repo.

**2. Send a turn.** The viewer opens in the browser. Turns come from Spectra's own message box, the default, where Spectra acts as the host over the agent's transport. They can also come from the adopter's own host app, pointed at Spectra's wire proxy.

**3. First turn on screen:** tree, data model, preview, actions, and the schema and catalog checks. If the framework already emits OpenTelemetry, also the prompt, raw response, tool calls and tokens.

**4. Go deeper:** add the SDK hook. The raw text links to the tree, the inference format is named, and retries and parse errors show.

**5. Fixtures:**
- **Save as fixture** writes the turn record into the repo.
- Replay runs from the viewer or with `spectra replay <file>`.
- `spectra test <fixtures folder>` runs every fixture with model and tools recorded.

| Time | What the adopter has done | What they get |
| --- | --- | --- |
| 10 seconds | Install, `spectra run -- <cmd>`, send a message from the box | Tree, preview, checks |
| 1 minute | Their framework already emits OpenTelemetry | Prompt, raw response, tools, tokens |
| 10 minutes | SDK hook, catalog preview set up, first fixture saved | Full view, replay, a CI test |

## Browser, terminal, editor

When launched with `spectra run`, Spectra owns the agent's process: restart, logs, and reload on file change. With `spectra attach`, Spectra watches the agent but does not own it.

| Where | What happens there |
| --- | --- |
| Browser | Sending messages; reading turns; saving, editing and replaying fixtures; running the fixture set as tests; switching preview variants; restarting the agent and reading its logs (under `spectra run`) |
| Terminal | Launching Spectra once; secrets such as API keys in the shell or the agent's `.env`; CI through the same test command |
| Editor | Changing the agent's code, prompt or catalog |

The round trip from the editor:
- Spectra watches the agent's files and restarts the agent on save, unless the agent's own dev server already reloads.
- The web preview host reloads when the catalog changes, when it is pointed at the catalog's dev server.
- "Re-run the last turn" is one press.
- Clicking a component or a prompt section opens the source file in the editor. In the tunnel setup, the links target the tunnel's VS Code in the browser.

**Prompt drafts in the browser:** edit the system prompt of a recorded turn as a draft and replay it against the recorded tool results through the model proxy, without touching the agent. A winning draft is then copied into the code.

The catch: replaying with tools recorded only works while the model keeps asking for the same tool calls. If the edited prompt makes it ask for a different call, there is no recording to answer it, so the draft needs the real agent running.

## SDK hook

Spectra works without any change upstream. The hook unlocks the deepest view.

Upstream's agent SDKs (Python, TypeScript, Dart) do the A2UI step with two pieces:

```
catalog ──▶ prompt generator ──▶ prompt ──▶ model ──▶ raw text ──▶ parser ──▶ A2UI messages
            (writes the UI part                        (Direct JSON,        (validates; on failure
             of the prompt)                             Express, …)          the SDK may retry)
```

The hook is a small optional callback in those two pieces. It reports what they did, ideally as an OpenTelemetry span. It adds what the model proxy cannot see:

- which characters of raw text became which component;
- that a second model call was a retry, and which parse or validation error caused it;
- the inference format and catalog version the turn used;
- which part of the prompt is the generated UI section and which is the developer's own text;
- which model call produced which messages, when a turn has several model calls and tool calls.

Three ways to get it:

1. Upstream adds the hook to its SDKs.
2. `a2ui-spectra` ships small wrapper packages around upstream's prompt generator and parser.
3. Agents not on upstream's SDKs report the same events themselves, following the turn record spec.

Strategy: v1 implements with the small wrapper package and is proposed to the community. When the community accepts, propose adding the hook to their SDKs, using the wrappers as the working proof of what the hook reports.

## Repo, name, home

- **Repo:** separate from A2UIVerse, named `a2ui-spectra`, on the personal GitHub account.
- **Name in prose:** "Spectra", or "Spectra for A2UI" when introducing it.
- **Eventual home:** upstream's `tools/`, as `@a2ui/spectra`.
- **Shaped like an upstream tool from the first commit.** Upstream's `tools/` holds `build_catalog`, `composer`, `editor` and `inspector`. Each is a Yarn workspace named `@a2ui/<tool>`, marked `private`, built with `wireit`, with the standard script targets (`build`, `lint`, `lint:fix`, `test`, `format`, `format:check`).
- **License:** Apache 2.0, the same as upstream.
- **Contributor agreement:** upstream contributions require Google's Contributor License Agreement. Code from an outside contributor can move upstream only if that contributor has signed it.
- **Distribution after the move:** upstream's tools are private, unpublished workspace packages, so how Spectra ships after the move is upstream's decision. Until then it ships from `a2ui-spectra`.
- **A2UIVerse's role:** A2UIVerse is Spectra's first user. The agent kit adopts the wrapper, and the five A2UIVerse agents run under `spectra run`.

## Implementation stack (proposed, not confirmed)

| Part | Language and framework |
| --- | --- |
| CLI and local server (proxies, OpenTelemetry receiver, file store, viewer server) | TypeScript, compiled to one binary with Bun or Deno, also published to npm. It imports upstream's TypeScript packages: the web core for state and validation, and the TypeScript agent SDK's parsers for the inference formats it ships. |
| Viewer | TypeScript, React, Vite |
| Web preview host | TypeScript on upstream's web core |
| Flutter and SwiftUI preview hosts | Dart and Swift |
| Wrappers | Python and TypeScript in v1, then Dart |
| Storage | Plain files in the agent's repo |

## Upstream landscape

- **Agent SDKs:** Python, TypeScript and Dart, plus a legacy Kotlin SDK. Each supports four inference formats (Direct JSON, Express, Elemental, Atom): syntaxes the model writes a UI in before the SDK compiles it into A2UI messages.
- **Renderers:** Lit, Angular, React and Lynx on one shared web core; Flutter on a Dart core; SwiftUI on a Swift core; Jetpack Compose planned.
- **Transports:** A2A, AG-UI, REST, WebSockets, MCP.
- **Agent frameworks:** ADK and AG2; LangGraph, CrewAI and others proposed.
- **Sample agents:**
  - `samples/agent/adk/`: `restaurant_finder` and `custom-components-example`, in Python on ADK, upstream's Python SDK and A2A, defaulting to Gemini.
  - `samples/agent/node/restaurant_finder`: the same restaurant finder in TypeScript, on `@a2ui/agent`, `@a2ui/web_core`, `@a2a-js/sdk` and `@google/genai`.
  - `samples/community/agent/adk/`: seven ADK agents.
  - `samples/community/mcp/`: four samples using MCP as the transport.
  - Sample clients: Lit, Angular, React, Flutter.
- **The A2UIVerse agent kit:** Python, on upstream's `a2ui-agent-sdk` (schema manager, parser, streaming parser, validator), ADK, `a2a-sdk`, and MCP through ADK's MCP toolset, defaulting to `gemini-3.7-flash`. It calls upstream's parsing functions directly, not only the inference-format classes.

## v1 coverage

Coverage line: every A2A sample agent upstream ships works fully under Spectra, plus the five A2UIVerse agents.

| Area | v1 | After the proposal |
| --- | --- | --- |
| Transport | A2A | AG-UI first, then MCP as transport, REST, WebSockets |
| The A2UI step (wrapper) | Python and TypeScript, covering upstream's public parsing entry points as well as the inference-format classes | Dart, then retired when the upstream hook lands |
| Model providers | Gemini read in full: prompt, tokens, display. Every other provider is recorded and replayed, shown as raw requests. | Reading OpenAI, Anthropic and others |
| Tools | MCP over the connection type the A2UIVerse agents use. Tools that are plain functions in the agent's process run live during replay. | The remaining MCP connection types |
| Framework traces | OpenTelemetry receiver | Other frameworks through OpenInference or OpenLLMetry |
| Preview | Web host for Lit, Angular, React | Flutter (possibly through Flutter's web build first), SwiftUI, Compose |

The demo shows the restaurant finder in Python and in TypeScript producing the same Spectra view.

What each kind of agent gets in v1:

| Agent | What it gets |
| --- | --- |
| The A2UIVerse agent kit's five agents; upstream's ADK samples (same stack, still to be checked); TypeScript agents on upstream's SDK | Everything |
| Dart agents on upstream's SDK; Python agents that build A2UI JSON by hand | Everything except the A2UI step |
| Any other language or framework speaking A2A | Tree, preview and checks, plus model and tool data where the base-URL override and OpenTelemetry are set up |
| AG-UI agents, A2UI over MCP, REST, WebSockets | Nothing until those transports are added |

## Roadmap

### Before the proposal: v1 in `a2ui-spectra`

- **Foundation:** the repo shaped like an upstream tool, Apache 2.0, a rule on Google's Contributor License Agreement; the turn record spec, its OpenTelemetry attribute names and shared test data.
- **Capture:** the A2A wire proxy, the model proxy with record and replay, the MCP tool proxy, the OpenTelemetry receiver, the Python and TypeScript wrapper packages.
- **Viewing:** `spectra run` and `spectra attach` with Spectra's message box as the default host; the viewer (turn list, turn view with raw text, tree, data model and preview, the checks, tokens); the web preview host with the basic catalog and custom web catalogs.
- **Fixtures:** save, replay in both modes, a test command for CI.
- **Shipping:** installable with one command.
- **The case:**
  - the A2UIVerse agents running under Spectra;
  - a demo of a real misfit found and fixed in minutes;
  - a README;
  - the proposal as a GitHub Discussion, the route upstream's roadmap gives for proposing features.

### After the community accepts: widen and propose the hook

- **Widen coverage:** the remaining transports, the Dart wrapper, the Flutter and SwiftUI preview hosts.
- **Propose the hook:**
  - the design, likely as an upstream blueprint (upstream's language-agnostic design docs that each language's SDK implements), carrying the turn record spec as the shared convention;
  - one PR each to the Python, TypeScript and Dart SDKs, plus test data in upstream's `conformance/` suite.
- **Retire the wrappers:** Spectra detects the native hook and stops wrapping.

### Last: move into `tools/`

- Port into the upstream monorepo as `@a2ui/spectra` under its workspace, build and lint rules, with Google's Contributor License Agreement covering every contributor.
- Settle with upstream how it ships.
- `a2ui-spectra` becomes an archive that points to the new home.

## Open

- **What "the community accepts" means:** a maintainer's yes in the Discussion, a listing in upstream's dev tools table, or an invitation into `tools/`.
- **Gemini and the model proxy:** whether Python `google-genai`, ADK's Gemini model class and JavaScript `@google/genai` accept a base-URL override from the environment. The fallback is a standard HTTPS proxy with a locally trusted certificate, as mitmproxy does.
- **MCP connection type:** whether the A2UIVerse agents connect to their MCP servers as local subprocesses (stdio) or over HTTP.
- **CLI command name:** `spectra` or `a2ui-spectra`, pending a collision check on npm, PyPI and Homebrew.
- **Outside contributions before the move:** keep the repo solo, or require Google's Contributor License Agreement.
- **Implementation stack:** confirm.

## Related

- `_dev/docs/(idea)Generative-UI-Monitor.md`: the idea doc for Spectra and Observatory. It still describes "A2UIVerse Spectra" as a member of the A2UIVerse family.
- `_dev/docs/(idea)A2UIVerse-Family.md`: the A2UIVerse family idea doc. It still lists Spectra as an A2UIVerse product.
