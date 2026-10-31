# Task 5.3 — The tool proxy: close-out notes

Spec: `_dev/docs/spec/task-5.3-tool-proxy.md`. Ticked on 2026-10-31.

## How the done line was verified

With the binary, the Gemini key never in a record, a log or the store:

- under `run`, the custom-components example on Gemini with its floor plan server (`mcp` 1.28.1), a config naming `FLOOR_PLAN_SERVER_URL`, and the conversation `_dev/tools/a2a_requests/custom_components/floor_plan.json` sent through the wire proxy: "Who is Alex Jordan?", then its `view_location` action. The action's turn, served by `GET /api/turns/<trace id>`, holds `initialize` from the carrier's opening with its `endpoint` and reply chunks, `notifications/initialized`, and `resources/read ui://floor-plan-server/map` with the resource's HTML in its reply chunk, each with `mcp.session.id` and `mcp.protocol.version` `2025-11-25`; the turn lists `wire`, `model_proxy` and `tool_proxy`;
- under `attach`, the same example restarted with the printed exports: the same three events, the turn listing `wire` and `tool_proxy`; the export line and `GET /api/context` list `FLOOR_PLAN_SERVER_URL` after the five model variables.

- A2UIVerse's CircleCI agent, from a2uiverse-apps `main` at `4eb336e` in live mode on Gemini on port 11004, signed in as Jioh's live CircleCI account, under `run` with a config naming `CIRCLECI_MCP_URL` at CircleCI's hosted server, and the read-only turn `_dev/tools/a2a_requests/a2uiverse_circleci/recent_runs.json`, "Show me the recent runs". The turn holds `initialize`, `notifications/initialized` and `tools/list`, then `tools/call list_runs` and five `tools/call list_run_workflows`, over streamable HTTP with each reply a stream, each call with its tool name, arguments and result, `Authorization` as `REMOVED`; no CircleCI token, agent token, refresh token or Gemini key in the record, the store or the log.

The custom-components turns sit under the example's `.a2ui-spectra/turns` in the A2UI fork; the CircleCI turn's store was in a scratch worktree, removed after the run.

The CircleCI agent ran against a scratch copy of its sign-in store, its access token refreshed there from the orchestrator's vault, so the live store and the vault were only read. The port was lent by A2UIVerse's 17.11 session.

The change it ran on is in a2uiverse-apps `main` as `4eb336e`, local and not pushed: `CIRCLECI_MCP_URL` read from the environment with the hosted URL as its default, a test that it is read, and the variable in the agent's README. The README has no configuration table, so the variable is a sentence in its "Run" section.

## Open threads

- The real floor plan server answers each POST `202` with no `content-type`, so its `Accepted` body is left out of the exchange by 5.2's rule for bodies; the hand-written shared test data has `text/plain` and the body.
- An action sent at once after a model turn found that turn still waiting on its last model call, which the model proxy reads on for five seconds after the example leaves, so two turns were open and the MCP calls, which carry no trace context, were not placed. The floor plan request file waits eight seconds before the action.
- CircleCI's MCP server assigns no `Mcp-Session-Id`, so its events carry no `mcp.session.id`, and its client opens no `GET` stream. A `GET` carrying `Mcp-Session-Id` answered `405`, from a server with a session but no `GET` stream, is an HTTP tool request by the spec's table, a failed call with `error.type` `405`; no server tried so far does this.
- A client's POST carrying the response to a server request that came inside a POST's own streamed reply answers no event; it is recorded as an event named `response`, as the turn record prose now says.
- The token request test takes a JSON object body carrying `grant_type` as well as a form-encoded one, so Anthropic's JSON token endpoint stays unrecorded now that the path test is gone.
- The TypeScript MCP SDK's client drops progress over HTTP+SSE: it handles the reply before the progress notifications that arrived just ahead of it on the one stream. The tool capture suite's progress scenario does not assert the client saw it.
- `_dev/otel-findings.md` gains finding 19: the pinned transport table ties HTTP with SSE to `2024-11-05` or older, while `mcp` 1.28.1 negotiates `2025-11-25` over it.
