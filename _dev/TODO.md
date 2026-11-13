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
- The save watcher passing its ignore list to `fs.watch`'s `ignore` option, so that the watch no longer walks into the ignored folders on Linux, once the Node used in development and the pinned Bun release both have it; Node has it from 24.14.0 and 25.5.0.
- `a2ui-spectra replay <file> --live`, the replay driver's third mode on the command line, every call live, refused by `test` as `--model-live` is.
- The preview page saying which document it is, its ready message naming its document in a later version of the preview protocol, with the core and the three adapters changed for it, so that the viewer no longer pairs each iframe's load with a ready by their order and timing: the five-second window, the one-second margin for a second ready of the same document, and the two cases the pairing misreads. Through the tunnel a sample page's first load outlasted the five-second window at the sub-task 8.7 run, 16.7 s on the Lit page and 7.7 s on the Angular page, the pane reading "No preview for catalog" until the load and its ready arrived.
- The first screen while the message box cannot send and the agent is running, as when its card fails the transport check, under `run` and `attach` alike: it still reads "Send a message to start your first turn." over the wire proxy's line, which starts with "or"; new wording that leads with the host app pointed at the wire proxy, drawn on the canvas first.
