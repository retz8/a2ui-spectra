# Task 5.7 — The acceptance run: handoff

Spec: `_dev/docs/spec/task-5.7-acceptance-run.md`. Its sections 18 to 23 hold what the run fixed, the canvas's amendment, the findings and the two A2UIVerse sessions.

## Where it stands

Every session has been through its part, every Phase 5 board seen in light and dark, Flows 1 to 4 walked once. Jioh's feedback on the Linear session is fixed and committed, not yet seen live: a message part with nothing in it draws no block, and the turn list shows the connected agent's turns with an agent picker in its header. The canvas gained the picker on the turn list's header and two boards, light and dark, with its menu open. Model ids stay as the request named them.

Since the fixes, the viewer's unit tests, lint, format check and build pass. Nothing that opens a port has run, at Jioh's word that the ports are not free.

## Next

- When Jioh says the ports are free: Spectra on 5173 through the tunnel against the run's store, the "Open A2U-5" turn's model call with no empty boxes, and the agent picker in light and dark, then Spectra stopped.
- `yarn test:all` and `SPECTRA_BINARY=dist/a2ui-spectra yarn test` in `tools/spectra`, then the done commit and the tick.

The run's store is in the previous session's scratchpad, `/private/tmp/claude-501/-Users-jiohin-Desktop-future-of-sw-a2ui-spectra/90a0925e-7fdc-44cf-b8c6-d36f355d504e/scratchpad/run/store/.a2ui-spectra/turns`, which the system may clear; any store with turns of two agents shows the picker.

## Open threads

- For A2UIVerse's backlog, not written there since the a2uiverse session 18.6 held its `_dev/TODO.md`: the kit hands the model an MCP tool's `content` alone, so CircleCI's `list_runs`, whose runs sit in `structuredContent` under a `content` of "Found 5 run(s)", shows the agent nothing to open.
- The Chromium end-to-end test of the React sample wants port 9831, the port Spectra's own tool server takes in `conformance/README.md`; a tool server left running fails it.
- The viewer showed "Not connected to Spectra · reconnecting" twice through the tunnel on 2026-10-31; it reconnected each time. Not reproduced locally.
- The 5.6 spec's "reply on the SSE stream" line, its decision 10, still reads the old wording; the 5.1 spec's decision 16 carries the new one.
