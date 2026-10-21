# Spectra — Dev TODO

## Phase 0 — Spec [done]
Grill `spectra-brainstorming.md` into the first version of `SPEC.md`: project structure, tech stacks, roadmap, v1 coverage in detail, and more.

## Phase 1 — Foundation [WIP]
The repo shaped like an upstream tool, Apache 2.0, CI; the turn record spec's first version, its OpenTelemetry attribute names and shared test data.

## Phase 2 — First turn on screen
`a2ui-spectra run` and `a2ui-spectra attach`; the A2A adapter, with the wire proxy and the message box as host; captured turns in the local store; the viewer's turn list, raw messages, tree and data model; schema checks for v0.9, v0.9.1 and v1.0. Built and run as the compiled binary from this phase on.

## Phase 3 — Checks and preview
Catalog and structural checks; the preview protocol and its core; the built-in basic catalog preview; the React, Lit and Angular preview adapters; the preview you can press; preview widths.

## Phase 4 — Inside the turn
The model proxy (Gemini read in full, other providers recorded raw) and the tool proxy (MCP over both HTTP transports), reached by redirection, with credentials stripped; the OTLP/HTTP receiver translating each producer's dialect; the exact model request, tokens and the timeline.

## Phase 5 — The A2UI step
The Python and TypeScript wrappers as OpenTelemetry instrumentation; retries and parse errors; raw text linked to the components it became.

## Phase 6 — Fixtures and replay
Save as fixture; replay with everything recorded and with tools recorded and the model live, each labelled with its cost; `a2ui-spectra replay`; `a2ui-spectra test` for CI.

## Phase 7 — The dev loop
Agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server.

## Phase 8 — Shipping
The binary on npm, PyPI and GitHub releases, with the curl script.

## Phase 9 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; a README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
