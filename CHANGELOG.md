# Spectra Changelog

## Unreleased

## 0.1.0

- The first release of Spectra for A2UI, a debugging and observation tool for the developer of an A2UI agent.
- `a2ui-spectra`, one binary for macOS arm64, macOS x64, Linux x64, Linux arm64 and Windows x64, through `npx a2ui-spectra`, `uvx a2ui-spectra` and the install scripts:
  - `a2ui-spectra run -- <command>` starts the agent with its model providers, tool servers and OpenTelemetry pointed at Spectra, restarts it on save and shows its logs; `a2ui-spectra attach <url>` watches an agent already running.
  - The A2A adapter, over JSON-RPC, for A2A 0.3 and 1.0: the wire proxy, and the message box as host.
  - The viewer: the turn list; each turn's input, raw text, A2UI tree, data model and preview; the exact model request, the raw response, tokens, prompt cache use, the estimated cost and the prefix break; tool calls; the A2UI step; the timeline.
  - The checks, for A2UI v0.9, v0.9.1 and v1.0: the schema of the protocol version, the catalog, the structure, and the paths the UI binds to.
  - The preview, built in for the basic catalog, and through a preview adapter for a custom catalog; pressing a control shows the action the agent would receive and can send it as the next turn.
  - The model proxy, reading Gemini, OpenAI's Chat Completions and Responses, and Anthropic's Messages in full; the tool proxy, for MCP over streamable HTTP and over HTTP+SSE, and HTTP tools; the OTLP/HTTP receiver.
  - Save as fixture; replay with everything recorded, or with tools recorded and the model live; `a2ui-spectra replay <file>` and `a2ui-spectra test [<folder>]`.
- Turn record `v0.1`, the format every capture path writes and every fixture is.
- `a2ui-spectra-preview`, the preview core, and the preview adapters `a2ui-spectra-preview-react`, on `@a2ui/react` `^0.15.0`, `a2ui-spectra-preview-lit`, on `@a2ui/lit` `^0.15.0`, and `a2ui-spectra-preview-angular`, on `@a2ui/angular` `^0.14.0`, each with `@a2ui/web_core` `^0.15.0`.
- `a2ui-spectra-instrumentation`, the wrapper reporting the A2UI step, on npm for `@a2ui/agent` 0.1.0 or later, on OpenTelemetry JavaScript's 2.x line with `@opentelemetry/api` `>=1.3.0 <1.10.0`, and on PyPI for `a2ui-agent-sdk` 0.11.0 or later, with OpenTelemetry `>=1.39.0,<2`.
