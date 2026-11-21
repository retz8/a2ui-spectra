# Spectra for A2UI

A debugging and observation tool for the developer of an [A2UI](https://github.com/a2ui-project/a2ui) agent: attach to the running agent, see every turn, check and preview it, record and replay it.

> **Status:** not released yet. Spectra runs from source; see [`tools/spectra/`](tools/spectra/README.md).

![A message sent to upstream's Python restaurant finder from Spectra's viewer: the model call, the tool call and the A2UI messages arrive as steps while the surface draws itself in the preview](docs/images/turn.gif)

<sub>Upstream's Python restaurant finder on Gemini, at three times speed.</sub>

## Why

A wrong surface can come from any link in a generative UI turn:

1. **The prompt**, built from your catalog.
2. **The model**, calling tools and writing the UI.
3. **The agent SDK**, compiling that text into A2UI messages, and asking the model again when a block fails.
4. **The renderer**, drawing whatever arrives.

The evidence is scattered across logs, the network and the browser, and every rerun costs a model call. Spectra puts the whole chain on one screen and records it, so it runs again for free.

## What you get

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/viewer-dark.png">
  <img alt="The same turn, closed: Spectra opens it on its one problem, a parse the agent SDK stopped because the block created the surface a second time, with the model reply it read, the call that retried it, and the raw text" src="docs/images/viewer-light.png">
</picture>

<sub>The same turn, closed. Spectra opens it on its one problem, a parse the SDK stopped, linked to the model reply it read and the call that retried it.</sub>

- **See inside the turn.** The exact model request, tokens and cost, every tool call, the raw text and which part of it became which component, and the surface, step by step.
- **Catch mistakes.** Each response is checked against its schema and catalog: unknown components, child ids that point nowhere, loops, bindings the data model never fills.
- **Press the buttons.** The live preview shows the exact action event your agent would receive, and can send it as the next turn.
- **Stay in the loop.** Restart on save, the agent's logs, the last turn re-run with one press, and the preview reloading when your catalog changes.

## Install

The same binary through every channel.

Run it through npm, with Node 22 or later:

```sh
npx a2ui-spectra
```

Run it through PyPI, with [uv](https://docs.astral.sh/uv/):

```sh
uvx a2ui-spectra
```

Install it on macOS or Linux, into `$XDG_BIN_HOME`, else `~/.local/bin`, from the GitHub release, its checksum verified:

```sh
curl -fsSL https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.sh | sh
```

Install it on Windows, into `%LOCALAPPDATA%\Programs\a2ui-spectra\bin` and onto your `PATH`, from the GitHub release, its checksum verified:

```powershell
irm https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.ps1 | iex
```

One binary for macOS arm64 and x64, Linux x64 and arm64 on glibc, and Windows x64. Windows on arm64 and Linux on musl, such as Alpine, are not supported.

The binary makes no request of its own: no update check and no usage counts.

<details>
<summary><b>Downloading the binary by hand</b></summary>

<br>

Download your platform's archive and `checksums.txt` from the release page into one folder, and verify the archive: its checksum, then its build provenance attestation with GitHub's `gh`.

```sh
shasum -a 256 --ignore-missing -c checksums.txt     # sha256sum on Linux
gh attestation verify a2ui-spectra-v0.1.0-darwin-arm64.tar.gz --repo retz8/a2ui-spectra
```

```powershell
(Get-FileHash .\a2ui-spectra-v0.1.0-windows-x64.zip).Hash -eq (Select-String windows-x64 .\checksums.txt).Line.Split(' ')[0]
gh attestation verify .\a2ui-spectra-v0.1.0-windows-x64.zip --repo retz8/a2ui-spectra
```

The binaries are not signed with a paid developer identity, and a browser's download carries the download mark. On macOS, clear it on the archive and unpack it with `tar`; if Safari or the Finder unpacked it already, run the first line on `a2ui-spectra` instead.

```sh
xattr -d com.apple.quarantine a2ui-spectra-v0.1.0-darwin-arm64.tar.gz
tar -xzf a2ui-spectra-v0.1.0-darwin-arm64.tar.gz
```

On Windows, unblock the archive, extract it and unblock the binary.

```powershell
Unblock-File .\a2ui-spectra-v0.1.0-windows-x64.zip
Expand-Archive .\a2ui-spectra-v0.1.0-windows-x64.zip
Unblock-File .\a2ui-spectra-v0.1.0-windows-x64\a2ui-spectra.exe
```

A binary installed through `npx`, `uvx` or the install scripts carries no download mark; the install check establishes it on macOS and Windows. Not established: whether Smart App Control on Windows 11, which blocks unsigned code it cannot vouch for and allows no exception for one app, lets the binary run; whether SmartScreen checks it when started from a terminal; and whether Gatekeeper assesses it beyond the mark. The full account, with Apple's and Microsoft's pages, is in [Distribution](docs/design/distribution.md#a-binary-downloaded-by-hand).

</details>

## First run

From your agent's folder, start the agent under Spectra, naming the address it serves A2A on:

```sh
a2ui-spectra run --agent-url http://localhost:10002 -- uv run .
```

Spectra starts its listeners, then the agent, and opens the viewer in your browser. Send a message from the viewer's message box, and the turn arrives step by step. Saving a file in the folder restarts the agent. Ctrl-C stops Spectra and the agent.

For an agent already running, attach to it instead, and set the variables Spectra prints in the agent's shell before restarting the agent:

```sh
a2ui-spectra attach http://localhost:10002
```

The commands, their options and the config file are in [`tools/spectra/`](tools/spectra/README.md).

## OpenTelemetry instrumentation

With nothing added, Spectra sees a turn at the agent's edges: the wire, the model calls and the tool calls. To see inside the agent's process, it reads OpenTelemetry. Its receiver takes OTLP over HTTP; `run` points the agent's exporter at it, and `attach` prints the variables that do.

**The A2UI step, from the wrapper.** For an agent on upstream's agent SDK, the wrapper `a2ui-spectra-instrumentation` reports each prompt the SDK writes and each parse of the model's raw text. Each parse becomes a step of the turn: the raw text with each component's characters linked to the tree, the error that stopped a block, the model reply it read and the call that retried it. Install it as a dev dependency of the agent, and launch the agent under it.

A Python agent, on `a2ui-agent-sdk`:

```sh
uv add --dev a2ui-spectra-instrumentation
a2ui-spectra run --agent-url http://localhost:10002 -- uv run opentelemetry-instrument python agent.py
```

A TypeScript agent, on `@a2ui/agent`:

```sh
npm install --save-dev a2ui-spectra-instrumentation
a2ui-spectra run --agent-url http://localhost:10002 -- node --import a2ui-spectra-instrumentation/register agent.js
```

Or switch it on with one line in the agent's code, and launch the agent as you do today. The [Python wrapper's README](python/a2ui_spectra_instrumentation/README.md) and the [TypeScript wrapper's](typescript/instrumentation/README.md) have the line, and what each supports.

**Your framework's own spans.** The receiver also reads the spans your agent's framework exports, in ADK's, OpenInference's and OpenLLMetry's dialects: which step of the framework made each call, tools that never cross the network, and the framework's log records. Launch the agent with an OTLP exporter over HTTP. For a Python agent, [the recipe](docs/design/opentelemetry.md#the-recipe-for-a-python-agent) adds three things to its run and nothing to its code.

## Record once, replay for free

Like Ruby's VCR, for model calls. Save any turn as a fixture, a JSON file in your repo, and replay it:

- **Everything recorded: free.** Every model and tool call is answered from the record, and nothing leaves your machine. A broken turn comes back on demand while you fix the code.
- **Tools recorded, model live: tokens only.** After a prompt edit, the model is called only from where the request changed.
- **In CI.** `a2ui-spectra test` replays every fixture and fails when a turn no longer matches its record.

```
# the agent's URL from agent.url in a2ui-spectra.json
a2ui-spectra replay a2ui-spectra-fixtures/chinese-restaurants.json -- uv run .
a2ui-spectra test -- uv run .
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/replay-passed-dark.png">
  <img alt="The replayed turn: 146 ms, three calls from the record, free, replayed from chinese-restaurants.json with everything recorded, passed, the same parse failure and retry in its steps" src="docs/images/replay-passed-light.png">
</picture>

<sub>The restaurant turn, recorded for $0.036 and replayed from its fixture: 146 ms instead of 25 s, free, and passed, the parse failure and its retry included.</sub>

## How it works

Spectra is one local process at the edges every agent stack already has: the wire, the model and tool calls, and OpenTelemetry. So it works with any A2UI agent, in any language and on any framework.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/design/diagrams/spectra-dark.svg">
  <img alt="Spectra at the edges of an agent: the host's turn passes through Spectra's wire proxy to your agent; the agent's model calls, tool calls and OpenTelemetry spans pass through the model proxy, the tool proxy and the receiver; each of the four feeds the viewer in your browser" src="docs/design/diagrams/spectra.svg">
</picture>

**Your keys stay yours.** Spectra runs on your machine and nothing is deployed. API keys and other credentials are removed from everything it records, before it shows or saves anything.

Add more as you need it:

| Add                                                                                        | And see                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Nothing                                                                                    | Turns, checks, the basic catalog's preview, model calls with tokens and cost, replay |
| A config file                                                                              | Your own catalog's checks, and your tool calls recorded                              |
| The [wrapper](#opentelemetry-instrumentation) for upstream's agent SDKs, and OpenTelemetry | The A2UI step: raw text to components, retries, parse errors; your framework's spans |
| A [preview adapter](typescript/preview/core/README.md) on your catalog's dev server        | Your own components, drawn by your own renderer                                      |

## What Spectra supports

- **A2UI:** v0.9, v0.9.1 and v1.0, upstream's current and previous versions in [`versions.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/versions.json). Not v0.8.
- **Transport:** A2A 0.3 and A2A 1.0, over JSON-RPC.
- **Model APIs read in full:** Gemini, OpenAI's Chat Completions and Responses, and Anthropic's Messages. Any other call is recorded raw.
- **Upstream packages:** each agent SDK and renderer at upstream's main, pinned at `0888f88b2` (2026-11-13), and at its published latest.
- **OpenTelemetry, for the wrappers:** each range tested at its floor and at its published latest.
  - The Python wrapper: OpenTelemetry `>=1.39.0,<2`, tested at 1.39.0 and 1.45.2; `opentelemetry-instrumentation` from 0.60b0, tested to 0.66b2; `wrapt` `>=1.16.0,<3`, tested at 1.16.0 and 2.5.2.
  - The TypeScript wrapper: OpenTelemetry JavaScript's 2.x line, `@opentelemetry/api` `>=1.3.0 <1.10.0`, tested at 1.3.0 and 1.9.1, with `@opentelemetry/instrumentation` and `@opentelemetry/exporter-trace-otlp-http` `^0.223.0` and `@opentelemetry/sdk-trace-node` `^2.12.0`, tested to 0.223.2 and 2.12.1. Not OpenTelemetry JavaScript 3.x yet.

<details>
<summary><b>v1.0's renamed envelope keys, and which release reads which</b></summary>

<br>

Upstream renamed a v1.0 component's `catalogId`, `accessibility`, `metadata` and `checks` to `@catalogId`, `@accessibility`, `@metadata` and `@checks`. Upstream's main reads both forms and emits the `@` form. npm's releases predate the rename; PyPI's of 2026-11-17 emit the `@` form.

Spectra reads both. A bare key passes where upstream's transition accepts it, where the component's schema declares no property of that name, and the viewer marks it as the legacy form. A component carrying both forms of a key is rejected. When upstream drops the bare form ([#4082](https://github.com/a2ui-project/a2ui/issues/4082)), so does Spectra.

| Package                                  | Used by                                | Published latest         | Envelope keys in that release                                                   |
| ---------------------------------------- | -------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `a2ui-agent-sdk`, with `a2ui-adk` (PyPI) | The Python wrapper, from 0.11.0        | 0.12.0, `a2ui-adk` 0.3.0 | Emits the `@` keys                                                              |
| `@a2ui/agent` (npm)                      | The TypeScript wrapper, from 0.1.0     | 0.1.0                    | Emits the bare keys                                                             |
| `@a2ui/web_core` (npm)                   | Every preview adapter, `^0.15.0`       | 0.15.0                   | Reads the bare keys only, and refuses an `updateComponents` carrying an `@` key |
| `@a2ui/react` (npm)                      | The React preview adapter, `^0.15.0`   | 0.15.0                   | Reads the bare keys only, through web core 0.15.0                               |
| `@a2ui/lit` (npm)                        | The Lit preview adapter, `^0.15.0`     | 0.15.0                   | Reads the bare keys only, through web core 0.15.0                               |
| `@a2ui/angular` (npm)                    | The Angular preview adapter, `^0.14.0` | 0.14.0                   | Reads the bare keys only, through web core 0.15.0                               |

A preview page on a published renderer reports what that renderer refuses, in its own words: a surface carrying the `@` keys is refused there until npm carries a release that reads them.

</details>

## How each part works

The design docs explain each part of Spectra: what it does, the rules it follows and why, and where its code is. Start with [A turn, end to end](docs/design/turn-end-to-end.md).

| Doc                                                         | What it explains                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [A turn, end to end](docs/design/turn-end-to-end.md)        | One turn from the message box to the viewer, passing each part once                                |
| [The wire](docs/design/wire.md)                             | The wire proxy and the message box: where A2UI sits in an A2A message, how a turn opens and closes |
| [Model and tool calls](docs/design/model-and-tool-calls.md) | Redirection, the model proxy and the tool proxy, tokens, the estimated cost                        |
| [OpenTelemetry](docs/design/opentelemetry.md)               | The receiver: each framework's spans, and how a span joins its turn                                |
| [The A2UI step](docs/design/a2ui-step.md)                   | The wrappers: the prompt and the parse inside the agent SDK, raw text to components, retries       |
| [The checks](docs/design/checks.md)                         | The four checks and the catalogs they check against                                                |
| [The preview](docs/design/preview.md)                       | The preview protocol, its core and adapters, the built-in page, a press                            |
| [Replay and fixtures](docs/design/replay-and-fixtures.md)   | The record, the two replay modes, the verdict, `replay` and `test`, the store and fixtures         |
| [The agent's process](docs/design/agent-process.md)         | Under `run`: start, restart on save, the agent's output, the stop                                  |
| [The viewer](docs/design/viewer.md)                         | The page: what each area shows and where it comes from                                             |
| [The API](docs/design/api.md)                               | The routes and the live stream, for a script or a coding agent                                     |
| [Distribution](docs/design/distribution.md)                 | The binary, its packages, the install scripts, and what a release verifies                         |

The turn record, the file format every fixture is, is specified in [`specification/turn_record/v0_1/`](specification/turn_record/v0_1/README.md).

## In this repo

| Package                                                                                                                                                        | What it is                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`tools/spectra/`](tools/spectra/README.md)                                                                                                                    | The `a2ui-spectra` command                                           |
| [`tools/spectra_viewer/`](tools/spectra_viewer/README.md)                                                                                                      | The viewer                                                           |
| [`tools/spectra_basic_preview/`](tools/spectra_basic_preview/README.md)                                                                                        | The built-in preview page for the basic catalogs                     |
| [`typescript/preview/`](typescript/preview/core/README.md)                                                                                                     | The preview protocol's core, and the React, Lit and Angular adapters |
| [`typescript/instrumentation/`](typescript/instrumentation/README.md), [`python/a2ui_spectra_instrumentation/`](python/a2ui_spectra_instrumentation/README.md) | The wrapper, for TypeScript and for Python                           |
| [`specification/turn_record/v0_1/`](specification/turn_record/v0_1/README.md)                                                                                  | The turn record: the file format every fixture is                    |
| [`conformance/`](conformance/README.md)                                                                                                                        | The turn record's shared test data                                   |
| [`samples/preview/`](samples/preview/react/README.md)                                                                                                          | Sample catalog apps, one per preview adapter                         |

## Development

The repository is Yarn workspaces built with Wireit, and a uv workspace for the Python wrapper. With Node 22, Yarn 4 through Corepack, and uv, from the repository root:

```sh
yarn install
uv sync --all-packages
yarn build:all
yarn test:all
yarn lint:all
yarn format:check:all
node scripts/check_links.mjs
```

Each package's README closes with its own commands. The licence is Apache 2.0, as upstream's.
