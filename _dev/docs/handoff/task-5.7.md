# Task 5.7 — The acceptance run: handoff

Spec: `_dev/docs/spec/task-5.7-acceptance-run.md`. Work on 2026-10-31, overnight; everything below is committed on `main`, nothing pushed.

## Where things stand

Sessions 1 to 3 of the spec's decision 3 are through, every board they carry seen in light and dark, with the real binary through the tunnel on 5173:

- The Node restaurant finder under `attach`: the first screen's variables block, a wire-only turn, then the five model variables set and Gemini calls read in full; Flows 1 to 4 walked once (Flow 4 pressed and submitted on the built-in preview); the hand-sent `GET /api/json` and the `404` through the tool proxy to Spectra's own tool server during an open turn.
- The custom-components example under `attach`: span-only rows from ADK's spans, then every variable set with the conventions opt-in; Flow 5's four boards, by mouse and by the keyboard alone, with `m`; the linked pair's spans section with the `gen_ai.client.inference.operation.details` log record.
- The example under `run`: Gemini with the floor plan server (the HTTP+SSE rows; the floor plan turn sent from `_dev/tools/a2a_requests/custom_components/floor_plan.json` through the wire proxy, since the example reads an action from v0.8's `userAction` only, finding 23), Anthropic Haiku, Chat Completions and Responses against the stand-in, the recorded-raw turn, OpenInference and OpenLLMetry.
- 1,200 × 760 was done in an iframe of that size on the tunnel page, the remote window refusing to resize; the timeline narrowed to 380px and 340px; Maximize there and on the 1,920 × 953 window; the keys list in light and dark.

Fixed tonight, each committed: the open turn's header duration following an in-flight call; the compact `1m 27s` in the timeline's columns and the spans section's event times, in a wider column; focus to the timeline after the prefix link selects a call in another turn; decision 15's `a2ui.mcp.stream.url` across the proxy, the record, the shared test data, the tool capture records (the harness normalising its origin) and the viewer's `reply on GET /sse`, seen live. Findings 31 and 32 are in `_dev/a2ui-findings.md`. The spec's sections 18 to 22 hold the run so far. `yarn test:all` is green.

## What's next

1. With Jioh: the Linear agent live on Gemini and the CircleCI agent live on Claude (`anthropic/claude-haiku-5-5`) under `run`, from `a2uiverse-apps` `main` (`5657ed6`), each signed in through a scratch copy of its sign-in store; two typed read-only turns each; the `tools/call` over streamable HTTP board, the bearer token `REMOVED`, ADK's spans around a Claude call, the cache share on Claude. Configs go in the run's store folder beside `node_finder.json` and `example.json`: the agent's URL, the catalog path, `headers` naming the token's variable, `tools` naming `LINEAR_MCP_URL` / `CIRCLECI_MCP_URL`.
2. Then the spec's done line: the done commit naming the boards not checked, the tall window's height (953px), the fork's ref `825beac28` with google-adk 2.3.0, LiteLLM 1.90.1, `openinference-instrumentation-litellm` 0.1.52 and `opentelemetry-instrumentation-litellm` 0.62.4, the a2uiverse-apps commit, and the Claude model; tick 5.7 and ask about marking Phase 5 done.

## Open threads

- The run's store and logs live in this session's scratchpad: `/private/tmp/claude-501/-Users-jiohin-Desktop-future-of-sw-a2ui-spectra/90a0925e-7fdc-44cf-b8c6-d36f355d504e/scratchpad/run/` (`store/` with the configs and `.a2ui-spectra/turns`, `run_example.sh`, `keys.sh`, `otel-requirements.txt`, the Spectra and agent logs, `scratch_rf/` with finding 31's reproduction). A fresh session may start the two remaining sessions from an empty store or keep this one.
- The Chromium end-to-end test of the React sample wants port 9831, the port Spectra's own tool server takes in `conformance/README.md`; a tool server left running fails it. Not a code change tonight.
- The viewer showed "Not connected to Spectra · reconnecting" twice through the tunnel while Spectra ran; it reconnected each time. Not reproduced locally.
- The 5.6 spec's "reply on the SSE stream" line (its decision 10) still reads the old wording; the 5.1 spec's decision 16 carries the new one.
