# Task 5.5 — The model call in the viewer: handoff

Spec: `_dev/docs/spec/task-5.5-model-call-in-viewer.md`. Every part of the spec is built and tested; the done line's run through the tunnel is the one step left before the tick.

## Where it stands

- Verified locally with the binary, not through the tunnel, on the custom-components example on Gemini through LiteLLM, the viewer driven by Playwright in light and dark:
  - under `run`, two turns in conversation `f6f0f12a-d52a-4b4d-8b9f-0d626ec6166d` from the message box: the second line with its tokens, 88% from cache, the cost and "LiteLLM prices 2026-10-28"; the second turn's first call with its hit ratio and "Shares all of the earlier call's request", the link selecting the first turn's last call; Maximize with `m`;
  - under `attach`, line 28 of the example's `prompt_builder.py` changed, `'Call'` added to its examples, and the agent restarted with the printed exports: the conversation continued through the wire proxy, the new turn's first call reading "Prefix breaks in the system prompt · against the call at 18:52:12", the marker at the inserted `'Call', `, the turn's cache share down from 88% to 60%; the prompt change reverted after;
  - a call in flight filling from `call_progress`: its usage, the response "streaming" and "so far", the latest surfaces.
- No key in the store or the logs. The turns sit under the example's `.a2ui-spectra/turns` in the A2UI fork.
- Tests: the tool's under Node and against the binary, the viewer's, the conformance data checks, and the model capture suite on the rewritten Gemini records, all green.
- The canvas's components page shows the fourth sentence form, and the first form's link on "the earlier call's request".

## Next

- The done line through the tunnel: borrow 5173 once Jioh says A2UIVerse's client on it is idle, start Spectra with `--port 5173`, and repeat `run`, then `attach` with the prompt line changed. The message box continues only a conversation it started in the same run, so the `attach` turn goes through the wire proxy with `_dev/tools/send_a2a_requests.py` and a request file carrying the conversation's `contextId`. Then tick 5.5.

## Open threads

- LiteLLM sends the next question as a second part of the last user message, so a request whose last segment's text goes on in the other's counts as its prefix; decision 15 of the Phase 5 spec says so.
- The canvas's Main boards still draw the first sentence form without its link.
- The failed-call count and the call rows take the model proxy's calls only; a call seen through the agent's spans only is sub-task 5.6's.
- A call recorded raw and a failed call are covered on hand-written records only; no call failed in the live runs.
