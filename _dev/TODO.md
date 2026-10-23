# Spectra — Dev TODO

## Phase 0 — Spec [done]
Grill `spectra-brainstorming.md` into the first version of `SPEC.md`: project structure, tech stacks, roadmap, v1 coverage in detail, and more.

## Phase 1 — Foundation [done]
The repo shaped like an upstream tool, Apache 2.0, CI; the turn record spec's first version, its OpenTelemetry attribute names and shared test data.
Spec: `_dev/docs/spec/phase-1-foundation.md`.

- [x] **1.1** The workspace — the root Yarn 4 workspace with upstream's tooling, the LICENSE file, the test workspace with the five canonical targets and no tests yet, the one-job CI workflow, SPEC.md's upstream reference line; the gates green in CI. Spec: `_dev/docs/spec/task-1.1-workspace.md` (parallel with 1.2)
- [x] **1.2** The turn record spec's first version — the schema, the prose, the `a2ui.` attribute names, the GenAI conventions pin; grilled on its own first. Spec: `_dev/docs/spec/task-1.2-turn-record.md` (parallel with 1.1)
- [x] **1.3** The shared test data — the case list, the hand-written fixtures, and the validation harness filling the test workspace; whether the fixtures are exempt from Prettier, as upstream's conformance test data is; the harness loads the draft-07 meta-schema and accepts the `binary` format the copied GenAI schemas use; a tool result that is not a JSON object stays out of `gen_ai.tool.call.result`. Spec: `_dev/docs/spec/task-1.3-shared-test-data.md` (after 1.1 and 1.2)

## Phase 2 — First turn on screen [WIP]
`a2ui-spectra run` and `a2ui-spectra attach`; the A2A adapter, with the wire proxy and the message box as host; captured turns in the local store; the viewer's turn list, raw messages, tree and data model; schema checks for v0.9, v0.9.1 and v1.0. Built and run as the compiled binary from this phase on.
Spec: `_dev/docs/spec/phase-2-first-turn-on-screen.md`. The done line — the three core samples under both entry points, and upstream's Angular sample client through the wire proxy — is the phase's acceptance run at wrap-up.

- [ ] **2.1** [WIP] The workspaces and the binary — the tool and viewer workspaces, the CLI with `run` and `attach` and their options, the server skeleton, the Bun build, CI building and running the binary. Spec: `_dev/docs/spec/task-2.1-workspaces-and-binary.md` (first)
- [ ] **2.2** The A2A adapter — the wire proxy, the turn and wire events written as turn record v0.1, the dialect acceptance and `_dev/a2ui-findings.md`, the conformance action with traffic recorded from the three samples, SPEC.md's corrections (the protocol-version row, the upstream reference line at the pin). (after 2.1; parallel with 2.3)
- [ ] **2.3** The store and the schema check — the local store, the copied protocol schemas and the schema check, built and tested against Phase 1's fixture records. (after 2.1; parallel with 2.2)
- [ ] **2.4** The server and the message box as host — the API and the live stream, the A2A client and its offer, the stub agent and the end-to-end test under Node and against the binary. (after 2.2 and 2.3)
- [ ] **2.5** The viewer — the turn list, the turn view with the input, the raw messages, the tree, the data model and the check results, the message box's UI. (after 2.4's spec; parallel with 2.4's implementation)

## Phase 3 — Checks and preview
Catalog and structural checks; the preview protocol and its core; the built-in basic catalog preview; the React, Lit and Angular preview adapters; the preview you can press; preview widths.

## Phase 4 — Inside the turn
The model proxy (Gemini read in full, other providers recorded raw) and the tool proxy (MCP over both HTTP transports), reached by redirection, with credentials stripped; the OTLP/HTTP receiver translating each producer's dialect; the exact model request, tokens and the timeline. `full_record_custom_components.json` in the shared test data records MCP over HTTP+SSE as one `tool_call` event per JSON-RPC request, its exchange the POST and its reply from the `GET /sse` stream an `event: message` chunk on it, with the stream's `endpoint` event a chunk on `initialize`.

## Phase 5 — The A2UI step
The Python and TypeScript wrappers as OpenTelemetry instrumentation; retries and parse errors; raw text linked to the components it became. Upstream changes after the Phase 1 pin, unreleased on 2026-10-22: the agent SDKs default to Express instead of Direct JSON (#3365); TypeScript's `Parser` is stateless, with a `ResponseStream` (#3279). `a2ui-adk`'s `SendA2uiToClientToolset` takes A2UI as the argument of a `send_a2ui_to_client` tool call, parsed by `parse_and_fix` and checked by `validate_payload` from the agent SDK.

## Phase 6 — Fixtures and replay
Save as fixture; replay with everything recorded and with tools recorded and the model live, each labelled with its cost; `a2ui-spectra replay`; `a2ui-spectra test` for CI.

## Phase 7 — The dev loop
Agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server.

## Phase 8 — Shipping
The binary on npm, PyPI and GitHub releases, with the curl script.

## Phase 9 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; a README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
- A2A's task methods (`tasks/get`, `tasks/cancel`, `tasks/resubscribe`) and push notifications attached to the turn they belong to: a non-blocking send collected by polling, a resumed stream, a cancel as the turn's outcome, and the push webhook proxied.
- Under `a2ui-spectra run`, discovering the agent's URL from the child's output, confirmed by fetching the card, as an addition to the required option.
- A protocol-version selector in the message box, to force an agent that serves several versions onto one.
