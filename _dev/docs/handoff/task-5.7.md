# Task 5.7 — The acceptance run: close-out notes

Spec: `_dev/docs/spec/task-5.7-acceptance-run.md`. Ticked on 2026-11-01; its sections 18 to 23 hold what the run fixed, the canvas's amendment, the findings and the two A2UIVerse sessions.

## How the done line was verified

Sessions 1 to 3 on 2026-10-31 overnight, sessions 4 and 5 on 2026-11-01 with Jioh, every board of decision 5 seen in light and dark and Flows 1 to 4 walked once, with the real binary through the tunnel on 5173. `yarn test:all` green, and `SPECTRA_BINARY=dist/a2ui-spectra yarn test` in `tools/spectra` green; CI runs when `main` is pushed, which is Jioh's call.

The run's store, configs, launch scripts, logs and the scratch copies of the two sign-in stores lived in this session's scratchpad, `/private/tmp/claude-501/-Users-jiohin-Desktop-future-of-sw-a2ui-spectra/90a0925e-7fdc-44cf-b8c6-d36f355d504e/scratchpad/run/`, which the system clears; nothing in it is needed again.

## Open threads

- For A2UIVerse's backlog, not written there from this session since the a2uiverse session 18.6 held `_dev/TODO.md`: the kit hands the model an MCP tool's `content` alone, so CircleCI's `list_runs`, whose runs sit in `structuredContent` under a `content` of "Found 5 run(s)", shows the agent nothing to open.
- The Chromium end-to-end test of the React sample wants port 9831, the port Spectra's own tool server takes in `conformance/README.md`; a tool server left running fails it.
- The viewer showed "Not connected to Spectra · reconnecting" twice through the tunnel on 2026-10-31; it reconnected each time. Not reproduced locally.
- The 5.6 spec's "reply on the SSE stream" line (its decision 10) still reads the old wording; the 5.1 spec's decision 16 carries the new one.
