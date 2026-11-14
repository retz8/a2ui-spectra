# Spectra — Dev TODO

## Done — Phases 0–9
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
- **Phase 9 — Upstream v1.0 and supported versions** · done 2026-11-14 · spec `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`

## Phase 10 — Shipping [WIP]
Spectra made release-ready, nothing published: the binary for five platforms, packaged for npm, PyPI and GitHub releases, with the install scripts; the release workflow and its rehearsal; the install steps in the root README. The packages' READMEs as a DX product, their details moved to design docs in `docs/design/`, as A2UIVerse has them. Turn record `v0.1`'s closing review.
Spec: `_dev/docs/spec/phase-10-shipping.md`.

- [ ] **10.1** The five binaries, and CI on the four POSIX platforms — the binary built for macOS arm64, macOS x64, Linux x64, Linux arm64 and Windows x64; the binary test run on the four POSIX platforms on every push and pull request. (parallel with 10.4, 10.8 and the design docs of 10.9)
- [ ] **10.2** Windows x64 — Spectra working on Windows, the agent's process tree started, restarted and ended; the binary test run on a Windows runner. (after 10.1)
- [ ] **10.3** The binary's packages — the npm launcher with one package per platform, the PyPI wheel per platform, the release archives with their checksums; the third-party notices file in each. (after 10.1)
- [ ] **10.4** The libraries' published form — the preview core, the React, Lit and Angular preview adapters and the TypeScript and Python wrappers publishable: one version set in one place for all seven packages, each with its licence, none referring to the workspace. (parallel with 10.1, 10.8 and the design docs of 10.9)
- [ ] **10.5** The install scripts — the shell script and the PowerShell script, behaving as upstream's `a2ui` CLI's do. (after 10.3)
- [ ] **10.6** The release workflow — the workflow started by hand and its dry run: built once, tested, those files published, trusted publishing, checksums and a build provenance attestation; the release notes; the procedure for the steps done by hand. (after 10.3 and 10.4)
- [ ] **10.7** The install check — an adopter's install on all five platforms from stand-in registries, through `npx`, `uvx` and the install script. (after 10.5 and 10.6)
- [ ] **10.8** The contracts at release — turn record `v0.1`'s closing review and its amendments; the newer-record rule; the preview mismatch line naming the side to upgrade. (parallel with 10.1, 10.4 and the design docs of 10.9)
- [ ] **10.9** The documents — the root README with the install steps behind its status line; the packages' READMEs as a DX product; the design docs in `docs/design/`; the viewer's hint for switching on a wrapper; a stable public URL for the config file's schema. (the design docs parallel with 10.1, 10.4 and 10.8; the install text after 10.5)
- [ ] **10.10** The acceptance run — the rehearsal: the dry run and the install check on all five platforms, the READMEs' install commands run as written. (last)

## Phase 11 — The release
`0.1.0` published, started when the upstream check reports the npm release of `@a2ui/web_core`, `@a2ui/react` and `@a2ui/markdown-it` carrying the pin's state: those three local patches removed and the suites run on published upstream; the npm and PyPI accounts and their trusted publishers; turn record `v0.1` closed; the install check against the real registries; the root README's status line deleted. A2UIVerse's CircleCI preview page committed in A2UIVerse, on the published React adapter, once A2UIVerse's CircleCI catalog is on `@a2ui/react` `^0.15.0`.

## Phase 12 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; the demo in the root README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
- A2A's task methods (`tasks/get`, `tasks/cancel`, `tasks/resubscribe`) and push notifications attached to the turn they belong to: a non-blocking send collected by polling, a resumed stream, a cancel as the turn's outcome, and the push webhook proxied.
- Under `a2ui-spectra run`, discovering the agent's URL from the child's output, confirmed by fetching the card, as an addition to the required option.
- A protocol-version selector in the message box, to force an agent that serves several versions onto one.
- The wire proxy keeping each delivery's raw exchange beside the turn record, for the viewer: the JSON-RPC envelope, the HTTP status, where the A2UI sat in the A2A message, and its MIME type tag.
- The message box sending the configured catalogs inline when the agent's card accepts inline catalogs.
- v1.0's `callAgentFunction` and `rendererFunctionResponse`, the agent-function round trip, shown and answered from the preview.
- A hover link between a tree node, the message's lines and the drawn component in the preview, once the renderers mark the DOM with component ids; upstream's React, Lit and Angular renderers do not at `0888f88b2`.
- A recording of real OpenAI traffic, Chat Completions and Responses, once there is an OpenAI key, beside the stand-in provider's responses built from OpenAI's API reference.
- An HTTP+SSE tool server's absolute endpoint URL, on its own origin, rewritten to the tool proxy's origin, so that its calls pass through the tool proxy; until then it is passed on unchanged with a terminal line.
- The OTLP/HTTP receiver passing each export on to the adopter's own collector, the endpoint Spectra's environment set before `run` replaced it.
- A view of a turn's whole received span tree, framework spans included, beside the spans a call's detail shows.
- The A2UI step for A2UIVerse's agents, once they move to `a2ui-agent-sdk` 0.11.0 or later, the Python wrapper's floor; they are on PyPI's `a2ui-agent-sdk` 0.9.0, which the wrapper does not support.
- A second SDK API shape in the wrappers: a hook table per shape, chosen by the pinned-API check, each with its own floor and capture records.
- A rejected block's failing message marked within it in the raw text, the messages a stream accepted and sent before it left plain.
- A JUnit or other report format for `a2ui-spectra test`, for the CI systems that read one; v1 prints plain terminal lines.
- The tool proxy keeping the MCP session housekeeping it saw outside any turn, such as an `initialize` an agent sends at start, in the record it writes next, so that a replay of that agent serves its `initialize`; at the Phase 7 pin the targets connect inside the turn.
- The turn record fixture generator, `_dev/tools/make_fixtures.py`, brought up to date so that it writes every committed v0.1 fixture and case again, the hand edits since Phase 5's documents included.
- A static check of a literal `pattern` in a v1.0 `regex` call against the A2UI regex dialect, which the v1.0 basic catalog's `regex` function states in its `pattern` argument's description and web core enforces only when the function runs.
- The save watcher passing its ignore list to `fs.watch`'s `ignore` option, so that the watch no longer walks into the ignored folders on Linux, once the Node used in development and the pinned Bun release both have it; Node has it from 24.14.0 and 25.5.0.
- The viewer's Express and Atom readers held against upstream's own compile cases, `conformance/agent/express/compiler.yaml`, the Express cases of `conformance/agent/multi_catalog_formats.yaml` and `conformance/agent/atom/compiler.yaml`, as listed copies of their texts, catalogs and expected messages with a harness in the viewer's tests; at `0888f88b2` the readers name the expected components of 87 of the 88 cases that hold expected messages, the 66 that expect an error not compared, and the one left is the split token below.
- The viewer's Structure drawing a parse's own messages at its step when the turn delivered none, so that the parse's raw text and its components select each other on a record holding the A2UI step alone, as a wrapper capture case's expected record does; until then such a record draws no surface.
- The rename of v1.0's child references and actions to `@child`, `@action` and `@functionCall` (issue #2791), in the checks, the viewer and the preview, once upstream merges it: PR #4170, reading both forms, and PR #4171, emitting the new one, are open at `3ed960186`; issue #4168 removes the old form.
- The Express reader reading a token split across a line break as the compiler repairs it, an identifier or a path joined before it parses, as Python's `_normalize_express_source` does at `0888f88b2`; until then the reader stops at the split, as on upstream's compile case `test_compile_express_split_identifier_and_split_path_repaired`.
