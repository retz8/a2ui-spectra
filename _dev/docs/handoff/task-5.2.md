# Task 5.2 — Redirection, placement and the model proxy: handoff

Spec: `_dev/docs/spec/task-5.2-redirection-placement-model-proxy.md`. Written on 2026-10-31.

## Where things stand

Implemented and committed on `main`: the trace context on A2A requests, the placement by trace id then time window, the model proxy with its five variables and `--model-proxy-port`, the four APIs read in full, credential removal, the live stream's call events, what `attach` prints and the first screen's variables block, the stand-in provider, the model capture suite with its recordings, and the documents. `yarn test:all`, `yarn lint:all` and `yarn format:check:all` are clean; the model proxy's own suite has 18 cases, the conformance workspace 178.

The done line is verified with the binary, the keys shown as `REMOVED` and no credential string in the served record:

- under `run`: the Python restaurant finder on Gemini, three streamed calls read in full with cache reads; the custom-components example on Gemini through LiteLLM, three calls with cache reads; the custom-components example on Anthropic through LiteLLM (`LITELLM_MODEL=anthropic/claude-haiku-5-5`, and `GEMINI_API_KEY` set too, since the example checks for it at startup), three calls;
- under `attach` on the borrowed 5173: the first screen through the tunnel shows the variables block, the line, the Copy button and the five `NAME=value` lines in mono; the restaurant finder restarted with the five printed variables set wrote a turn, sent from the browser through the tunnel, with four Gemini calls read in full. Spectra was stopped after, 5173 back to A2UIVerse.

The turns of the `run` checks sit under each sample's `.a2ui-spectra/turns` in the A2UI fork; the `attach` check's store was a scratch directory.

The last fix: the custom-components example closes the connection once it has the content, before the provider's last stream event with the finish reason and usage, on Gemini and on Anthropic alike. The model proxy now reads a reply on for five seconds after the agent's close and records the call complete when the reply ends by then; decision 16's agent-close row in the spec says so.

## What's left before 5.2 is ticked

The spec's recordings table asks for the anthropic SDK's request shape and auth recorded through an A2UIVerse agent on Claude. That support, ADK's `AnthropicLlm`, is only on a2uiverse-apps branch `phase-17/latency` (HEAD `6cb8e6c`), not on its `main`. Jioh decides: record from that branch's working tree and pin it in `conformance/README.md`'s roster, or drop the recording from 5.2's scope. Then tick 5.2 in `_dev/TODO.md`.

## Open threads

- The Copy button's checked icon was not seen through Claude-in-Chrome after its click; the clipboard write may need a real user activation. The browser test checks the block's lines, not the copy.
- A candidate A2UI finding, unverified and not written: the custom-components example's validation retry on "Catalog not found: inline_catalog" leads to an extra model call per turn. Decision 20 of the spec names `_dev/a2ui-findings.md` for it.
- Which layer leaves the stream early, ADK's `LiteLlm`, LiteLLM itself or the A2UI agent SDK, was not located; the README and the spec describe the observed behaviour only.
