# Task 5.2 — Redirection, placement and the model proxy: handoff

Spec: `_dev/docs/spec/task-5.2-redirection-placement-model-proxy.md`. Written on 2026-10-31.

## Where things stand

Implemented and committed on `main`, HEAD `3df4a8d`: the trace context on A2A requests, the placement by trace id then time window, the model proxy with its five variables and `--model-proxy-port`, the four APIs read in full, credential removal, the live stream's call events, what `attach` prints and the first screen's variables block, the stand-in provider, the model capture suite with its recordings, and the documents. `yarn test:all`, `yarn lint:all` and `yarn format:check:all` are clean; the model proxy's own suite has 18 cases, the conformance workspace 178.

The done line's local part is verified with the binary under `run`, the keys shown as `REMOVED` and no credential string in the served record:

- the Python restaurant finder on Gemini: three streamed calls read in full, with cache reads;
- the custom-components example on Gemini through LiteLLM: three calls read in full, with cache reads;
- the custom-components example on Anthropic through LiteLLM (`LITELLM_MODEL=anthropic/claude-haiku-5-5`, and `GEMINI_API_KEY` set too, since the example checks for it at startup): three calls read in full.

The turns of these runs sit under each sample's `.a2ui-spectra/turns` in the A2UI fork.

The last fix: the custom-components example closes the connection once it has the content, before the provider's last stream event with the finish reason and usage, on Gemini and on Anthropic alike. The model proxy now reads a reply on for five seconds after the agent's close and records the call complete when the reply ends by then; decision 16's agent-close row in the spec says so.

## What's next

The done line's tunnel part: under `attach`, the first screen through the tunnel shows the variables block, and the restaurant finder restarted with those variables set gives the same. It needs Jioh to say A2UIVerse's client on 5173 is idle, then:

1. start the restaurant finder on its port, and `a2ui-spectra attach --agent-url http://localhost:10002 --port 5173 --no-open`, so the browser reaches the viewer at `https://vnw20xbg-5173.asse.devtunnels.ms`;
2. check the first screen's block and its Copy button with Claude-in-Chrome;
3. restart the restaurant finder with the printed `export` lines set, send a turn, and check the record as `run` was checked (the turn's model calls read in full, `x-goog-api-key` as `REMOVED`);
4. stop Spectra so 5173 goes back to A2UIVerse;
5. tick 5.2 in `_dev/TODO.md`.

## Open threads

- The A2UIVerse agent on Claude recording, the anthropic SDK through ADK's `AnthropicLlm`: that support is only on a2uiverse-apps branch `phase-17/latency` (HEAD `6cb8e6c`), not on its `main`. Either record from that branch's working tree and pin it in `conformance/README.md`'s roster, or defer the recording.
- A candidate A2UI finding, unverified and not written: the custom-components example's validation retry on "Catalog not found: inline_catalog" leads to an extra model call per turn. Decision 20 of the spec names `_dev/a2ui-findings.md` for it.
- Which layer leaves the stream early, ADK's `LiteLlm`, LiteLLM itself or the A2UI agent SDK, was not located; the README and the spec describe the observed behaviour only.
