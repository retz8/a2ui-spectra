# Spectra — Dev TODO

## Done — Phases 0–8
Each phase's full section, its sub-tasks and what landed, as it closed: `_dev/TODO-done.md`.

- **Phase 0 — Spec** · done 2026-10-17
- **Phase 1 — Foundation** · done 2026-10-22 · spec `_dev/docs/spec/phase-1-foundation.md`
- **Phase 2 — First turn on screen** · done 2026-10-24 · spec `_dev/docs/spec/phase-2-first-turn-on-screen.md`
- **Phase 3 — The viewer's UI** · done 2026-10-25 · spec `_dev/docs/spec/phase-3-viewer-ui.md`
- **Phase 4 — Checks and preview** · done 2026-10-30 · spec `_dev/docs/spec/phase-4-checks-and-preview.md`
- **Phase 5 — Inside the turn** · done 2026-11-01 · spec `_dev/docs/spec/phase-5-inside-the-turn.md`
- **Phase 6 — The A2UI step** · done 2026-11-04 · spec `_dev/docs/spec/phase-6-the-a2ui-step.md`
- **Phase 7 — Fixtures and replay** · done 2026-11-09 · spec `_dev/docs/spec/phase-7-fixtures-and-replay.md`
- **Phase 8 — The dev loop** · done 2026-11-13 · spec `_dev/docs/spec/phase-8-the-dev-loop.md`

## Phase 9 — Upstream v1.0 and supported versions
The upgrade to upstream's v1.0 as its current version; which protocol versions and which upstream SDKs Spectra supports; the basic root README.
Spec: `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`.

- [ ] **9.1** The design artifact — the legacy form's marking for a v1.0 component's bare envelope keys, on the existing canvas, in light and dark.
- [ ] **9.2** The re-pin procedure and the move — the upstream check and the pin's move as one procedure; its first run, to `0888f88b2`: the copied schemas and catalog definitions, the copied conformance catalogs, the `a2ui-upstream` worktree, the upstream packages patched locally to the pin's state; the findings in `_dev/a2ui-findings.md` read again at the pin.
- [ ] **9.3** The checks at v1.0 — the `@` envelope keys read, `@catalogId` choosing the catalog; the bare keys judged as upstream judges them during the transition, marked as the legacy form; the v1.0 rules that come with the pin's schemas. (parallel with 9.4, 9.5 and 9.6, after 9.2)
- [ ] **9.4** The viewer and the preview — the viewer, the preview core, the React, Lit and Angular adapters, the built-in basic catalog preview and the sample pages on the pin's web core and renderers; the legacy form's marking in the viewer; the smoke check on the published renderers. (parallel with 9.3, 9.5 and 9.6, after 9.1 and 9.2)
- [ ] **9.5** The wrappers — the Python wrapper's hook table and floor at `a2ui-agent-sdk` 0.11.0; both wrappers' capture suites at the pin; the smoke check on the published agent SDKs. (parallel with 9.3, 9.4 and 9.6, after 9.2)
- [ ] **9.6** The recordings — the coverage roster's v1.0 axis recorded again at the pin, the Node restaurant finder's booking stream. (parallel with 9.3, 9.4 and 9.5, after 9.2)
- [ ] **9.7** The documents — SPEC.md's upstream facts at the pin; the basic root README; the packages' READMEs; the backlog's text.
- [ ] **9.8** The acceptance run — after an upstream check, through the tunnel: the three samples as Phase 8's run left them, a v1.0 turn with the `@` envelope keys, a v1.0 turn with the bare keys marked as the legacy form, the smoke check on each package's published latest.

## Phase 10 — Shipping
The binary on npm, PyPI and GitHub releases, with the curl script; the install steps in the root README. Turn record `v0.1` closed at the first release. A2UIVerse's CircleCI preview page committed in A2UIVerse, on the published React adapter.

## Phase 11 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; the demo in the root README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
- A2A's task methods (`tasks/get`, `tasks/cancel`, `tasks/resubscribe`) and push notifications attached to the turn they belong to: a non-blocking send collected by polling, a resumed stream, a cancel as the turn's outcome, and the push webhook proxied.
- Under `a2ui-spectra run`, discovering the agent's URL from the child's output, confirmed by fetching the card, as an addition to the required option.
- A protocol-version selector in the message box, to force an agent that serves several versions onto one.
- The wire proxy keeping each delivery's raw exchange beside the turn record, for the viewer: the JSON-RPC envelope, the HTTP status, where the A2UI sat in the A2A message, and its MIME type tag.
- The message box sending the configured catalogs inline when the agent's card accepts inline catalogs.
- v1.0's `callAgentFunction` and `rendererFunctionResponse`, the agent-function round trip, shown and answered from the preview.
- A hover link between a tree node, the message's lines and the drawn component in the preview, once the renderers mark the DOM with component ids; upstream's React and Lit renderers do not at 409ded29c.
- A recording of real OpenAI traffic, Chat Completions and Responses, once there is an OpenAI key, beside the stand-in provider's responses built from OpenAI's API reference.
- An HTTP+SSE tool server's absolute endpoint URL, on its own origin, rewritten to the tool proxy's origin, so that its calls pass through the tool proxy; until then it is passed on unchanged with a terminal line.
- The OTLP/HTTP receiver passing each export on to the adopter's own collector, the endpoint Spectra's environment set before `run` replaced it.
- A view of a turn's whole received span tree, framework spans included, beside the spans a call's detail shows.
- The A2UI step for A2UIVerse's agents, once they move to `a2ui-agent-sdk` 0.10.0 or later, the release carrying the wrappers' pinned API; they are on PyPI's `a2ui-agent-sdk` 0.9.0, which the wrappers do not support.
- A second SDK API shape in the wrappers: a hook table per shape, chosen by the pinned-API check, each with its own floor and capture records.
- AG2's recording on the coverage roster's v1.0 axis, its messages declaring the bare `1.0`, once a release of AG2 sends it.
- A rejected block's failing message marked within it in the raw text, the messages a stream accepted and sent before it left plain.
- A JUnit or other report format for `a2ui-spectra test`, for the CI systems that read one; v1 prints plain terminal lines.
- The tool proxy keeping the MCP session housekeeping it saw outside any turn, such as an `initialize` an agent sends at start, in the record it writes next, so that a replay of that agent serves its `initialize`; at the Phase 7 pin the targets connect inside the turn.
- The save watcher passing its ignore list to `fs.watch`'s `ignore` option, so that the watch no longer walks into the ignored folders on Linux, once the Node used in development and the pinned Bun release both have it; Node has it from 24.14.0 and 25.5.0.
