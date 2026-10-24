# Task 2.3 — The coverage roster: agent survey

Facts gathered during the 2.2 grill (2026-10-24) on A2A agents that emit A2UI, for choosing 2.3's roster. Each fact carries its source. **Verified** facts were read from the primary source at the commit named; **unverified** ones come from a web survey and were not re-checked.

## A2A and its SDKs (verified)

- A2A 1.0.0 was released 2026-03-12, v1.0.1 on 2026-05-28 (https://github.com/a2aproject/A2A/releases). A2A 1.0 uses the JSON-RPC methods `SendMessage` and `SendStreamingMessage`, the headers `A2A-Extensions` and `A2A-Version`, a card with `supportedInterfaces` and no top-level `url`, parts without a `kind` field, and `TASK_STATE_*` state names (A2A spec v1.0.1, sections 3.2.6, 5.3, 6.7, 8.5, 9.4.8, 12.7).
- Python `a2a-sdk` 1.0.0 shipped 2026-04-20; the latest is 1.2.3, 2026-10-19 (https://pypi.org/project/a2a-sdk/).
- Unverified: `@a2a-js/sdk` 1.3.0 (2026-09-29, 1.0.0 on 2026-07-22); a2a-java 1.4.0.Final; `a2a-go/v2` 2.7.0; a2a-dotnet 1.0.0-preview3 (2026-10-14, no stable release); a2a-rs 0.4.2. All speak A2A 1.0, with 0.3 compatibility layers in Python, JS, Java, Go and .NET.

## Upstream at 020a9d6f (verified)

The three core samples and every community agent speak A2A 0.3. The root `uv.lock` locks `a2a-sdk` 0.3.25 and `google-adk` 2.3.0; `@a2a-js/sdk` is 0.3.13.

| Agent | A2UI emitted | Notes |
| --- | --- | --- |
| `samples/agent/adk/restaurant_finder` | v0.9 | Own executor. Advertises v0.8 and v0.9 (`agent.py:79`). `application/json+a2ui`, one message per part. Ends `input-required` (`final=false`) or `completed`. Port 10002, needs `GEMINI_API_KEY`. |
| `samples/agent/adk/custom-components-example` | v0.9 | Own executor. Reads capabilities from a data part (`agent_executor.py:81-94`). Port 10004, plus an MCP server on 8000. No shipped client targets it. |
| `samples/agent/node/restaurant_finder` | v0.9 or v1.0 | Picks the newest version the capabilities metadata names, else v0.9 (`src/pick-a2ui.ts`, `src/versions.ts`). Writes `"v0.9"` under `application/a2ui+json`. No A2UI extension on its card. Ends `failed` on a version or catalog mismatch (`src/agent.ts:73-78`). Port 10002, `STUB_LLM=true` runs without a key. |
| `community/agent/adk/file_upload_summarizer` | v0.9 | Serves through ADK's `A2aAgentExecutor` (`agent_executor.py:36`). Port 10008, needs a key. |
| `community/agent/adk/mcp_app_proxy` | v0.8, v0.9 | `A2aAgentExecutor` (`agent_executor.py:74`). Port 10006, needs a key and the `mcp-apps-calculator` MCP server. |
| `community/agent/adk/orchestrator` and four subagents | v0.9 | `A2aAgentExecutor`. The orchestrator is an A2A client of its subagents (`orchestrator_agent_executor.py:270-281`). Ports 10002 and 10011–10014, needs a key. |
| `community/agent/adk/rizzcharts/python` | v0.8, v0.9 | `A2aAgentExecutor` (`agent_executor.py:78`). Port 10002, needs a key. |
| `community/agent/adk/rizzcharts/java`, `/kotlin` | v0.8 under a v0.9 extension | A2UI's own `A2aHandler`: `message/send` only, a plain `Message` reply. Needs a key. |
| `community/agent/adk/gemini_enterprise/v0_9` | v0.9 | Own executor, one `completed` status with all parts. Own lockfile (`a2a-sdk` 0.3.26, `google-adk` 2.2.0). Needs a key. |
| `community/agent/adk/mcp-apps-in-a2ui-sample` | v0.8 | A FastAPI imitation of A2A: raw messages as parts, no part kind or MIME type. No key. |
| `community/macros` | v0.9.1 | Plain REST, not A2A. |

ADK's `A2aAgentExecutor`, `google-adk` 2.3.0 (`a2a/executor/a2a_agent_executor.py`):

- Sends `submitted`, then `working` with no message, then one `working` status update per ADK event with content.
- If the state is still `working` at the end, it re-sends the last status message's parts as one artifact update with `last_chunk=True`, then a final `completed` (`:292-323`).
- Otherwise the final status carries the aggregated state (`failed`, `auth_required` or `input_required`) and its message. With an empty last message, the final status can be `working` with `final=True` (`:325-337`).

## A2UIVerse (verified)

`a2uiverse-apps` at b85bbfa (2026-10-23), with uncommitted catalog changes in Shop A and CircleCI. `a2uiverse` at 6f32919 (2026-10-24).

- The app agents run on the agent kit: `a2a-sdk` 0.3.26, `google-adk` 2.8.0, `a2ui-agent-sdk` 0.2.4, Python 3.14 or later.
- Each card advertises `https://a2ui.org/a2a-extension/a2ui/v0.9.1`, but messages carry `"version": "v0.9"` under `application/json+a2ui`, one message per part.
- `deterministic` mode is the default and needs no key. It sends a `Task` in `submitted`, then one `completed` status with all parts (`executor_deterministic.py:131-141`).
- Outcomes reachable in `deterministic` mode: `completed`; `canceled` (`:168-173`); `auth-required` on the OAuth-style sign-in agents — Calendar, CircleCI, GitHub, Gmail, Linear — when an action needs a scope the token lacks. `input-required` and `failed` are not reachable; an exception becomes a JSON-RPC InternalError.
- Shop A has no sign-in: `uv run python -m app --mode deterministic` from `mocks/shop-a/agent`, port 12001. Shop B uses an API-key gate; the other apps need an agent-issued token.

| Agent | Port |
| --- | --- |
| GitHub | 11001 |
| Gmail | 11002 |
| Calendar | 11003 |
| CircleCI | 11004 |
| Linear | 11005 |
| Shop A | 12001 |
| Shop B | 12002 |

- The orchestrator (`a2uiverse/apps/orchestrator`) is TypeScript on `@a2a-js/sdk` 0.3.14. It emits its own surfaces as `"v0.9"` data parts with no MIME type, plus parts tagged `application/json+a2ui-shell`, and relays the apps' parts. Port 10001; it needs `GOOGLE_API_KEY`, the marketplace and installed apps.

## Outside upstream

### Verified

- **filipw/strathweb-a2ui** at c92222f (2026-09-14), MIT.
  - .NET Microsoft Agent Framework 1.18.0 on a2a-dotnet 1.0.0-preview2: A2A 1.0, `SendMessage` and `SendStreamingMessage`, endpoint `/a2a`.
  - Emits `"version": "v0.9.1"` as one data part holding an array. `application/a2ui+json` is carried only in `metadata.mimeType`; the A2A 1.0 `mediaType` field is never set (`src/Strathweb.A2UI.A2A/A2UIParts.cs:22-26`).
  - Replies are plain `Message`s, never a task or artifact: one for a send, one per agent update for a stream.
  - The card advertises the `.../a2ui/v0.9.1` extension.
  - CoffeeShop and BookingWizard need no key: `dotnet run --project samples/CoffeeShop` or `samples/BookingWizard`, .NET SDK 10.0.100. BookingWizard is on port 5202; CoffeeShop sets no port (ASP.NET Core's default 5000).
- **muncus/a2term `cmd/examplesvc`** at 79426d3 (2026-10-23), Apache-2.0.
  - Go on `a2a-go/v2` 2.5.0, A2A 1.0, JSON-RPC only, port 9002, no key. The card declares no streaming and no A2UI extension.
  - Every reply is a plain `Message`. Most commands put one `"v0.9"` `updateComponents` object inside `<a2ui-json>` tags in a text part.
  - `multipart` adds one data part holding an array, with `application/a2ui+json` in both `mediaType` and `metadata.mimeType`.
  - No command sends `createSurface`.

### Unverified (web survey)

| Agent or library | Stack, A2A version | A2UI emitted | Key |
| --- | --- | --- | --- |
| LangGraph Agent Server (`langgraph-api` 0.15.0 or later), https://docs.langchain.com/langsmith/server-a2a | Python, A2A 1.0 plus four 0.3 method names, `/a2a/{assistant_id}`; Elastic-2.0 licence | v0.9 when enabled; `application/json+a2ui`; one message or an array per part | none for a deterministic graph we write |
| AG2 `ag2.a2ui.a2a.A2UIAgentExecutor` (ag2 1.2.1), https://github.com/ag2ai/ag2 | Python, `a2a-sdk` 1.2 or later | v0.9, v0.9.1 or v1.0; a text part plus one data part holding an array, in the final status message; v1.0 `callRendererFunction` ends `input-required` | the docs example needs an Anthropic key |
| flutter/genui Verdure server, https://github.com/flutter/genui/tree/main/examples/verdure | ADK, A2A 0.3 | v0.9, one message per part, likely untagged | Gemini |
| AGenUI `samples/go/rizzcharts`, https://github.com/AGenUI/AGenUI | Go, hand-written A2A 0.3, `message/send` only | v0.9 in `task.status.message`, `application/json+a2ui` | OpenAI or Gemini |
| googlemaps-samples/a2ui `agent/python`, https://github.com/googlemaps-samples/a2ui | ADK, A2A 0.3 | v0.9 | Gemini and Maps |
| CrewAI `A2UIServerExtension` | `a2a-sdk` 0.3 | v0.9 opt-in, one message per part | OpenAI |
| PraisonAI | `a2a-sdk` 0.3 | A2UI in an artifact, wrapped as `{"messages": [...]}` | no served example |

Ruled out (v0.8 only, or not over A2A): CopilotKit's `with-a2a-a2ui` example (v0.8 message names), the Strands and Java v0.8 agents, Genkit's A2UI plugins, Microsoft Agent Framework for Python (AG-UI only), `zavora-ai/adk-ui` (no A2A).

## CopilotKit as an A2A host (verified from CopilotKit's docs)

CopilotKit's runtime wraps an A2A agent in `A2AAgent` from `@ag-ui/a2a`, constructed from an `@a2a-js/sdk` `A2AClient`, and forwards A2UI to the browser over AG-UI (https://unpkg.com/@copilotkit/runtime@1.65.0/skills/runtime/references/wiring-a2a.md; https://docs.copilotkit.ai/a2a-protocol).
