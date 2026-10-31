# Task 5.2 — Redirection, placement and the model proxy: close-out notes

Spec: `_dev/docs/spec/task-5.2-redirection-placement-model-proxy.md`. Ticked on 2026-10-31.

## How the done line was verified

With the binary, the keys shown as `REMOVED` and no credential string in the served record:

- under `run`: the Python restaurant finder on Gemini, three streamed calls read in full with cache reads; the custom-components example on Gemini through LiteLLM, three calls with cache reads; the custom-components example on Anthropic through LiteLLM (`LITELLM_MODEL=anthropic/claude-haiku-5-5`, and `GEMINI_API_KEY` set too, since the example checks for it at startup), three calls;
- under `attach` on the borrowed 5173: the first screen through the tunnel shows the variables block, the line, the Copy button and the five `NAME=value` lines in mono; the restaurant finder restarted with the five printed variables set wrote a turn, sent from the browser through the tunnel, with four Gemini calls read in full.

The turns of the `run` checks sit under each sample's `.a2ui-spectra/turns` in the A2UI fork.

The recording of the anthropic SDK through an A2UIVerse agent on Claude was dropped from the scope: that support, ADK's `AnthropicLlm`, is only on a2uiverse-apps branch `phase-17/latency`, not on its `main`.

## Open threads for later sub-tasks

- The custom-components example closes the connection once it has the content, before the provider's last stream event, on Gemini and on Anthropic alike; the model proxy reads the reply on for five seconds, decision 16. Which layer leaves early, ADK's `LiteLlm`, LiteLLM itself or the A2UI agent SDK, was not located.
- The Copy button's checked icon was not seen through Claude-in-Chrome after its click; the clipboard write may need a real user activation. The browser test checks the block's lines, not the copy.
- A candidate A2UI finding, unverified and not written: the custom-components example's validation retry on "Catalog not found: inline_catalog" leads to an extra model call per turn. Decision 20 of the spec names `_dev/a2ui-findings.md` for it.
