# Spectra for A2UI

A debugging and observation tool for the developer of an [A2UI](https://github.com/a2ui-project/a2ui) agent: attach to the running agent, see every turn, check and preview it, record and replay it.

> **Status:** not released yet. Spectra runs from source; see [`tools/spectra/README.md`](tools/spectra/README.md).

![A message sent to upstream's Python restaurant finder from Spectra's viewer: the model call, the tool call and the A2UI messages arrive as steps while the surface draws itself in the preview](docs/images/turn.gif)

<sub>Upstream's Python restaurant finder on Gemini, under `a2ui-spectra run`, played at three times speed.</sub>

## Why

A generative UI turn is more than the surface it ends with. The agent builds a prompt from your catalog; the model calls tools and writes the UI in an inference format; the agent SDK compiles that into A2UI messages, and asks the model again when a block fails; the renderer draws what arrives. When the surface comes out wrong, the reason is somewhere in that chain, spread across the agent's logs, the network and the browser.

Spectra puts the whole turn on one screen, checks it, and records it, so you can run it again without paying for the model.

## What you get

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/viewer-dark.png">
  <img alt="The same turn, closed: Spectra opens it on its one problem, a parse the agent SDK stopped because the block created the surface a second time, with the model reply it read, the call that retried it, and the raw text" src="docs/images/viewer-light.png">
</picture>

<sub>The same turn, closed. Spectra opens it on its one problem: the agent SDK's parser stopped on a block that created the surface a second time, and the agent asked the model again. The detail links the model reply the parse read and the call that retried it, above the raw text.</sub>

- **See inside the turn.** The exact request your agent sent the model, with the system prompt, tools and settings; tokens, cache use and estimated cost; every tool call; the raw text the model wrote, and which part of it became which component; the A2UI messages, the tree, the data model and the drawn surface, step by step on one timeline.
- **Catch mistakes before a user does.** Each response is checked against its protocol version's schema and its catalog: an unknown component or property, a child id that points nowhere, a missing root or a loop, a binding the data model never fills.
- **Press the buttons.** The preview is live. Pressing a control shows the exact action event your agent would receive, with its data model, and sends it as the next turn if you choose. Switch between narrow and wide widths.
- **Stop paying to reproduce.** Save a turn as a fixture and replay it with everything recorded, for free, or after a prompt edit with the tools recorded and the model live, paying only from where the request changed. `a2ui-spectra test` runs every fixture in CI.
- **Stay in the loop.** Under `a2ui-spectra run`, Spectra restarts your agent when you save, shows its logs, re-runs the last turn with one press, and reloads the preview when your catalog changes.

## How it works

Spectra is one local process. It sits at the edges every agent stack already has, so it works with any A2UI agent, in any language and on any framework.

```
   Spectra's message box, or your own host app
        │ A2A
        ▼
 ┌───────────────────── a2ui-spectra, local ──────────────────────┐
 │ wire proxy · model proxy · tool proxy · OpenTelemetry receiver │──▶ the viewer, in your browser
 └────────────────────────────────────────────────────────────────┘
        ▲ the wire     ▲ model calls     ▲ tool calls     ▲ spans
        └──────────────┴─────────────────┴────────────────┘
                 your agent: any language, any framework
```

Start your agent under Spectra, or attach to one that is already running:

```
a2ui-spectra run --agent-url http://localhost:10002 -- uv run .
a2ui-spectra attach http://localhost:10002
```

`run` points your agent's model and tool clients at Spectra's proxies through the base-URL variables they already read; `attach` prints the same variables for you to set. Each step below is optional and adds to what you see:

| What you add                                                                                                                                                     | What you see                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Nothing                                                                                                                                                          | Every turn on the wire, the checks, the basic catalog's preview, every model request with its tokens and cost, fixtures and replay |
| A config file naming your catalog and your tool servers                                                                                                          | Your own catalog's checks, and your tool calls recorded and replayed                                                               |
| The wrapper, [`a2ui-spectra-instrumentation`](python/a2ui_spectra_instrumentation/README.md), for upstream's Python and TypeScript agent SDKs, and OpenTelemetry | The A2UI step: which raw text became which component, retries and parse errors; your framework's own spans                         |
| A [preview adapter](typescript/preview/core/README.md) on your catalog's dev server                                                                              | Your own components drawn by your own renderer, and pressable                                                                      |

## What Spectra supports

- **A2UI protocol versions:** v0.9, v0.9.1 and v1.0, the versions upstream's [`specification/versions.json`](https://github.com/a2ui-project/a2ui/blob/main/specification/versions.json) gives as current or previous. v0.8 is not supported.
- **Transport:** A2A 0.3 and A2A 1.0, over JSON-RPC.
- **Model APIs read in full:** Gemini, OpenAI's Chat Completions and Responses, and Anthropic's Messages, on the providers' own hosts. Any other call is recorded and replayed as a raw request.

**v1.0's renamed envelope keys.** On a v1.0 component, upstream renamed `catalogId`, `accessibility`, `metadata` and `checks` to `@catalogId`, `@accessibility`, `@metadata` and `@checks`. Spectra reads both forms. A bare key passes wherever upstream's transition accepts it, where the component's schema declares no property of that name, and the viewer marks it as the legacy form; a component carrying both forms of a key is rejected. When upstream drops the bare form ([#4082](https://github.com/a2ui-project/a2ui/issues/4082)), so does Spectra.

**Upstream packages.** Spectra follows upstream's main at its pin, `0888f88b2` (2026-11-13), which reads both forms of the envelope keys and emits the `@` form. It supports each package below at the pin's main and at its published latest, which predates the rename.

| Package                                  | Used by                                | Published latest         | Envelope keys in that release                                                                         |
| ---------------------------------------- | -------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `a2ui-agent-sdk`, with `a2ui-adk` (PyPI) | The Python wrapper, from 0.11.0        | 0.11.0, `a2ui-adk` 0.3.0 | Emits the bare keys                                                                                   |
| `@a2ui/agent` (npm)                      | The TypeScript wrapper, from 0.1.0     | 0.1.0                    | Emits the bare keys                                                                                   |
| `@a2ui/web_core` (npm)                   | Every preview adapter, `^0.15.0`       | 0.15.0                   | Reads the bare keys only: it refuses the whole `updateComponents` when a component carries an `@` key |
| `@a2ui/react` (npm)                      | The React preview adapter, `^0.15.0`   | 0.15.0                   | Reads the bare keys only, through web core 0.15.0                                                     |
| `@a2ui/lit` (npm)                        | The Lit preview adapter, `^0.15.0`     | 0.15.0                   | Reads the bare keys only, through web core 0.15.0                                                     |
| `@a2ui/angular` (npm)                    | The Angular preview adapter, `^0.14.0` | 0.14.0                   | Reads the bare keys only, through web core 0.15.0                                                     |

Spectra's own checks and viewer read both forms whatever your packages are. A preview page on a published renderer draws what that renderer draws and reports what it refuses, in the renderer's own words, so a v1.0 surface carrying the `@` keys is refused there until npm carries a release that reads them.

## In this repo

| Package                                                                                                                                               | What it is                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`tools/spectra/`](tools/spectra/README.md)                                                                                                           | The `a2ui-spectra` command: the proxies, the OpenTelemetry receiver, the store and the viewer's server |
| [`tools/spectra_viewer/`](tools/spectra_viewer/README.md)                                                                                             | The viewer                                                                                             |
| [`tools/spectra_basic_preview/`](tools/spectra_basic_preview/README.md)                                                                               | The built-in preview page for the basic catalogs                                                       |
| [`typescript/preview/core/`](typescript/preview/core/README.md)                                                                                       | `a2ui-spectra-preview`, the preview protocol and its framework-free core                               |
| [`typescript/preview/react/`](typescript/preview/react/README.md)                                                                                     | `a2ui-spectra-preview-react`, the React preview adapter                                                |
| [`typescript/preview/lit/`](typescript/preview/lit/README.md)                                                                                         | `a2ui-spectra-preview-lit`, the Lit preview adapter                                                    |
| [`typescript/preview/angular/`](typescript/preview/angular/README.md)                                                                                 | `a2ui-spectra-preview-angular`, the Angular preview adapter                                            |
| [`typescript/instrumentation/`](typescript/instrumentation/README.md)                                                                                 | `a2ui-spectra-instrumentation`, the wrapper for TypeScript                                             |
| [`python/a2ui_spectra_instrumentation/`](python/a2ui_spectra_instrumentation/README.md)                                                               | `a2ui-spectra-instrumentation`, the wrapper for Python                                                 |
| [`specification/turn_record/v0_1/`](specification/turn_record/v0_1/README.md)                                                                         | The turn record, version 0.1: the file format every capture path writes and every fixture is           |
| [`conformance/`](conformance/README.md)                                                                                                               | The turn record's shared test data                                                                     |
| [`samples/preview/react/`](samples/preview/react/README.md), [`lit/`](samples/preview/lit/README.md), [`angular/`](samples/preview/angular/README.md) | The sample catalog apps, one per preview adapter                                                       |
