# Spectra — Dev TODO

## Done — Phases 0–7
Each phase's full section, its sub-tasks and what landed, as it closed: `_dev/TODO-done.md`.

- **Phase 0 — Spec** · done 2026-10-17
- **Phase 1 — Foundation** · done 2026-10-22 · spec `_dev/docs/spec/phase-1-foundation.md`
- **Phase 2 — First turn on screen** · done 2026-10-24 · spec `_dev/docs/spec/phase-2-first-turn-on-screen.md`
- **Phase 3 — The viewer's UI** · done 2026-10-25 · spec `_dev/docs/spec/phase-3-viewer-ui.md`
- **Phase 4 — Checks and preview** · done 2026-10-30 · spec `_dev/docs/spec/phase-4-checks-and-preview.md`
- **Phase 5 — Inside the turn** · done 2026-11-01 · spec `_dev/docs/spec/phase-5-inside-the-turn.md`
- **Phase 6 — The A2UI step** · done 2026-11-04 · spec `_dev/docs/spec/phase-6-the-a2ui-step.md`
- **Phase 7 — Fixtures and replay** · done 2026-11-09 · spec `_dev/docs/spec/phase-7-fixtures-and-replay.md`

## Phase 8 — The dev loop [WIP]
Agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server.
Spec: `_dev/docs/spec/phase-8-the-dev-loop.md`.

- [x] **8.1** The design artifact — Phase 8's boards on the existing canvas, in light and dark: the context bar with Restart and Logs and the live status's forms, starting, waiting for the card, running, restarting, down with its exit line; the logs drawer with lines, restart dividers and turn markers; the turn list's restart divider; Re-run in the header with its disabled notes and the re-run turn's header line; the preview pane's reloading and stopped-answering states; the agent popover's catalog line after a failed read; the Flow row, edit, save, restart, re-run, see; the 1,200 × 760 board. Spec: `_dev/docs/spec/task-8.1-design-artifact.md`. (parallel with 8.2, 8.4 and 8.5)
- [ ] **8.2** The agent's process under `run` — Spectra outliving the agent, the viewer, the wire proxy and the box starting with the launch; the restart with the cut of open turns, the stop of the group and the card read again, the session following the card; the process's state and events on the API and the stream; the Restart route; the terminal lines; the README's line on the agent's output corrected. (parallel with 8.1, 8.4 and 8.5)
- [ ] **8.3** Logs and the save watcher — the output buffer, its echo to the terminal, its route and events, the restart dividers; the watcher on the working directory with the ignore list and the debounce, the `watch` setting and its schema, the file named in the terminal. (after 8.2)
- [ ] **8.4** Re-run — the replay driver's third mode with no pool armed and no verdict; `live` in the turn record's prose and schema; the API's mode. (parallel with 8.1, 8.2 and 8.5)
- [ ] **8.5** The catalog's loop — each configured catalog file watched and read again, its stream event and the viewer's refetch, a bad read keeping the last good definition; the preview pane's reload handling on the iframe's load event. (parallel with 8.1, 8.2 and 8.4)
- [ ] **8.6** The viewer — Restart and Logs in the context bar, the live status's forms, the logs drawer with its dividers and turn markers, the turn list's restart divider, Re-run in the header with its states and the re-run turn's line, the first screen's starting and down forms, the composer's state while the agent is down. (after 8.1, 8.2, 8.3 and 8.4)
- [ ] **8.7** The acceptance run — the Python restaurant finder, the Node restaurant finder and the custom-components example through the tunnel at the pin: the loop on each, edit, save, restart, re-run, see; a crash at launch and after a save, with the logs; the preview reload on the React, Lit and Angular sample pages; a catalog definition change; every board in light and dark; the documents. (last)

## Phase 9 — Upstream v1.0 and supported versions
The upgrade to upstream's v1.0 as its current version; which protocol versions and which upstream SDKs Spectra supports; the basic root README.

## Phase 10 — Shipping
The binary on npm, PyPI and GitHub releases, with the curl script; the install steps in the root README. A2UIVerse's CircleCI preview page committed in A2UIVerse, on the published React adapter.

## Phase 11 — The case
The demo, with the restaurant finder in Python and in TypeScript producing the same view and a real misfit found and fixed in minutes; the demo in the root README; the contribution rule; the proposal as a GitHub Discussion.

## Backlog
- A2A's task methods (`tasks/get`, `tasks/cancel`, `tasks/resubscribe`) and push notifications attached to the turn they belong to: a non-blocking send collected by polling, a resumed stream, a cancel as the turn's outcome, and the push webhook proxied.
- Under `a2ui-spectra run`, discovering the agent's URL from the child's output, confirmed by fetching the card, as an addition to the required option.
- A protocol-version selector in the message box, to force an agent that serves several versions onto one.
- The wire proxy keeping each delivery's raw exchange beside the turn record, for the viewer: the JSON-RPC envelope, the HTTP status, where the A2UI sat in the A2A message, and its MIME type tag.
- The message box sending the configured catalogs inline when the agent's card accepts inline catalogs.
- v1.0's `callAgentFunction` and `rendererFunctionResponse`, the agent-function round trip, shown and answered from the preview.
- A `--header` option on the command line, curl-style, beside the config file's headers.
- A hover link between a tree node, the message's lines and the drawn component in the preview, once the renderers mark the DOM with component ids; upstream's React and Lit renderers do not at 409ded29c.
- A recording of real OpenAI traffic, Chat Completions and Responses, once there is an OpenAI key, beside the stand-in provider's responses built from OpenAI's API reference.
- An HTTP+SSE tool server's absolute endpoint URL, on its own origin, rewritten to the tool proxy's origin, so that its calls pass through the tool proxy; until then it is passed on unchanged with a terminal line.
- The OTLP/HTTP receiver passing each export on to the adopter's own collector, the endpoint Spectra's environment set before `run` replaced it.
- A view of a turn's whole received span tree, framework spans included, beside the spans a call's detail shows.
- The A2UI step for A2UIVerse's agents, once they move to `a2ui-agent-sdk` 0.10.0 or later, the release carrying the wrappers' pinned API; they are on PyPI's `a2ui-agent-sdk` 0.9.0, which the wrappers do not support.
- A second SDK API shape in the wrappers: a hook table per shape, chosen by the pinned-API check, each with its own floor and capture records.
- The re-pin procedure: the wrapper capture suite run against the new pin.
- The coverage roster's v1.0 axis recorded again at the pin, its messages declaring the bare `1.0`: the Node restaurant finder's booking stream, and AG2's once a release of AG2 sends it.
- A rejected block's failing message marked within it in the raw text, the messages a stream accepted and sent before it left plain.
- A JUnit or other report format for `a2ui-spectra test`, for the CI systems that read one; v1 prints plain terminal lines.
- The tool proxy keeping the MCP session housekeeping it saw outside any turn, such as an `initialize` an agent sends at start, in the record it writes next, so that a replay of that agent serves its `initialize`; at the Phase 7 pin the targets connect inside the turn.
- `a2ui-spectra replay <file> --live`, the replay driver's third mode on the command line, every call live, refused by `test` as `--model-live` is.
