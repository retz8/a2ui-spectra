# Spectra — Dev TODO

## Phase 0 — Spec [done]
Grill `spectra-brainstorming.md` into the first version of `SPEC.md`: project structure, tech stacks, roadmap, v1 coverage in detail, and more.

## Phase 1 — Foundation [done]
The repo shaped like an upstream tool, Apache 2.0, CI; the turn record spec's first version, its OpenTelemetry attribute names and shared test data.
Spec: `_dev/docs/spec/phase-1-foundation.md`.

- [x] **1.1** The workspace — the root Yarn 4 workspace with upstream's tooling, the LICENSE file, the test workspace with the five canonical targets and no tests yet, the one-job CI workflow, SPEC.md's upstream reference line; the gates green in CI. Spec: `_dev/docs/spec/task-1.1-workspace.md` (parallel with 1.2)
- [x] **1.2** The turn record spec's first version — the schema, the prose, the `a2ui.` attribute names, the GenAI conventions pin; grilled on its own first. Spec: `_dev/docs/spec/task-1.2-turn-record.md` (parallel with 1.1)
- [x] **1.3** The shared test data — the case list, the hand-written fixtures, and the validation harness filling the test workspace; whether the fixtures are exempt from Prettier, as upstream's conformance test data is; the harness loads the draft-07 meta-schema and accepts the `binary` format the copied GenAI schemas use; a tool result that is not a JSON object stays out of `gen_ai.tool.call.result`. Spec: `_dev/docs/spec/task-1.3-shared-test-data.md` (after 1.1 and 1.2)

## Phase 2 — First turn on screen [done]
`a2ui-spectra run` and `a2ui-spectra attach`; the A2A adapter, with the wire proxy and the message box as host; captured turns in the local store; the viewer's turn list, raw messages, tree and data model; schema checks for v0.9, v0.9.1 and v1.0. Built and run as the compiled binary from this phase on.
Spec: `_dev/docs/spec/phase-2-first-turn-on-screen.md`. The done line — the three core samples under both entry points, upstream's Angular sample client through the wire proxy, and one A2A 1.0 agent from the coverage roster — is the phase's acceptance run at wrap-up.

- [x] **2.1** The workspaces and the binary — the tool and viewer workspaces, the CLI with `run` and `attach` and their options, the server skeleton, the Bun build, CI building and running the binary. Spec: `_dev/docs/spec/task-2.1-workspaces-and-binary.md` (first)
- [x] **2.2** The A2A adapter — the wire proxy for A2A 0.3 and 1.0 over JSON-RPC, the card rewrite and the transport check, the turn and wire events written as turn record v0.1, the dialect acceptance and `_dev/a2ui-findings.md`, unit tests and the command-line test against the proxy; SPEC.md's amendments (the protocol-version row, the upstream reference line at the pin, the coverage line as axes, the transport row), the Phase 2 spec's amendments, the turn record prose's `data` part. Spec: `_dev/docs/spec/task-2.2-a2a-adapter.md` (after 2.1)
- [x] **2.3** The coverage roster — the found agents and the hosts, the stub agent started for the cancelled outcome, traffic recorded once from every roster entry as HAR files with the tools under `_dev/tools/`, the conformance action for the A2A capture path replaying it through the wire proxy, the roster in `conformance/README.md`, the A2UI findings the recordings show; SPEC.md's coverage-line hosts, the Phase 2 spec's done line and tests. Spec: `_dev/docs/spec/task-2.3-coverage-roster.md` (after 2.2)
- [x] **2.4** The store and the schema check — the local store, the copied protocol schemas and the schema check, connected to the running tool, tested against Phase 1's fixture records and sub-task 2.3's recordings. Spec: `_dev/docs/spec/task-2.4-store-and-schema-check.md` (after 2.3)
- [x] **2.5** The server and the message box as host — the API and the live stream, the message box's A2A client following the card's first JSON-RPC interface at A2A 0.3 or 1.0 with its offer, one conversation and one open turn at a time, the stub agent's canned A2UI conversation, the end-to-end test on both A2A versions under Node and against the binary. Spec: `_dev/docs/spec/task-2.5-server-and-message-box.md` (after 2.4)
- [x] **2.6** The viewer — the turn list, the turn view with the input, the raw messages, the tree, the data model and the check results, the message box's UI. Spec: `_dev/docs/spec/task-2.6-viewer.md` (after 2.5)

## Phase 3 — The viewer's UI [WIP]
The viewer's frame, layout and visual design, drawn first as a design artifact that the build follows: Spectra's mark and the attached agent's live status; turns grouped by conversation; the turn view as a timeline of the turn's steps beside its result, with the problems on the steps; the message box docked under the turn view.
Spec: `_dev/docs/spec/phase-3-viewer-ui.md`.

- [x] **3.1** The design artifact — every screen and state of the phase spec, in light and dark, that the later sub-tasks follow.
- [x] **3.2** The foundations, the frame and the turn view — the colour tokens in light and dark, Inter and JetBrains Mono bundled, the 2px type scale, the icon set and the mark, the theme switch and motion; the rail and the context bar with the live status, connected and disconnected; the turn list grouped by conversation, with search and its groups collapsing; the turn view of a finished turn: the header led by its input with its check state, the timeline of steps with deliveries grouped, the Data and File steps and the outcome as the last step, the result pane with its reply strip, Structure tab and surface switcher, and the step's detail split with the delivery each step arrived in; the problem count on the rows and in the header, the marks on the steps and the problem blocks, from the schema check, the processor's rejections counted on the server and a failed turn's reason as its last step; the composer docked under the turn view; the cancelled outcome. Spec: `_dev/docs/spec/task-3.2-foundations-frame-turn-view.md`. Done when a finished turn matches the design artifact in light and dark. (after 3.1)
- [x] **3.3** Flow 1, the first turn — the API serving the agent card's details and skill examples, and the agent popover; the first screen; the live turn following the newest step, Jump to latest, and landing on the first problem or the final state when it closes; the step's detail collapsed until a step is selected; the turn list following the newest turn. Spec: `_dev/docs/spec/task-3.3-flow-1-first-turn.md`. Done when the artifact's Flow 1 row works in the viewer. (after 3.2)
- [ ] **3.4** Flow 2, finding what went wrong — the count as a filter, a turn opening on its first problem, and the offending JSON line in the step's detail. Done when the artifact's Flow 2 row works in the viewer. (after 3.3)
- [ ] **3.5** Flow 3, continuing the conversation — the message box sending to a conversation it started, the API saying which conversations the box started, and the composer naming the conversation it continues and saying when the agent is waiting for input. Done when the artifact's Flow 3 row works in the viewer. (after 3.4)
- [ ] **3.6** Small screens, the keyboard and the page address — the turn list's strip and overlay below about 1,300px, draggable dividers remembered in the browser, the composer growing as you type; the keys; the page address holding the turn and the step. (after 3.5)
- [ ] **3.7** The acceptance run — the real viewer with the restaurant finder, the flawed booking agent and AG2's agent through the three flows and the artifact's other boards, in light and dark, at the small window size and with the keyboard; what it finds is fixed within the sub-task. (after 3.6)

## Phase 4 — Checks and preview
Catalog and structural checks; the preview protocol and its core; the built-in basic catalog preview; the React, Lit and Angular preview adapters; the preview you can press; preview widths; the message box sending the agent's credentials from the shell, never recorded.

## Phase 5 — Inside the turn
The model proxy (Gemini read in full, other providers recorded raw) and the tool proxy (MCP over both HTTP transports), reached by redirection, with credentials stripped; the OTLP/HTTP receiver translating each producer's dialect; the exact model request, tokens and the timeline. `full_record_custom_components.json` in the shared test data records MCP over HTTP+SSE as one `tool_call` event per JSON-RPC request, its exchange the POST and its reply from the `GET /sse` stream an `event: message` chunk on it, with the stream's `endpoint` event a chunk on `initialize`.

## Phase 6 — The A2UI step
The Python and TypeScript wrappers as OpenTelemetry instrumentation; retries and parse errors; raw text linked to the components it became. Upstream changes after the Phase 1 pin, unreleased on 2026-10-22: the agent SDKs default to Express instead of Direct JSON (#3365); TypeScript's `Parser` is stateless, with a `ResponseStream` (#3279). `a2ui-adk`'s `SendA2uiToClientToolset` takes A2UI as the argument of a `send_a2ui_to_client` tool call, parsed by `parse_and_fix` and checked by `validate_payload` from the agent SDK.

## Phase 7 — Fixtures and replay
Save as fixture; replay with everything recorded and with tools recorded and the model live, each labelled with its cost; `a2ui-spectra replay`; `a2ui-spectra test` for CI.

## Phase 8 — The dev loop
Agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server.

## Phase 9 — Shipping
The binary on npm, PyPI and GitHub releases, with the curl script.

## Phase 10 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; a README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
- A2A's task methods (`tasks/get`, `tasks/cancel`, `tasks/resubscribe`) and push notifications attached to the turn they belong to: a non-blocking send collected by polling, a resumed stream, a cancel as the turn's outcome, and the push webhook proxied.
- Under `a2ui-spectra run`, discovering the agent's URL from the child's output, confirmed by fetching the card, as an addition to the required option.
- A protocol-version selector in the message box, to force an agent that serves several versions onto one.
- The wire proxy keeping each delivery's raw exchange beside the turn record, for the viewer: the JSON-RPC envelope, the HTTP status, where the A2UI sat in the A2A message, and its MIME type tag.
