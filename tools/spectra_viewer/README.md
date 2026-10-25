# Spectra viewer

Spectra's viewer: a React app built with Vite. The `a2ui-spectra` tool in [`../spectra/`](../spectra) copies its build and serves it, with the API and the live stream its README describes.

## The page

The page follows the design canvas "Spectra viewer UI": https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2. A left rail holds Spectra's mark and name, the Turns section and, at its foot, the theme: System, Light or Dark, remembered in the browser. A context bar shows the agent's name, the mode, whether the page hears Spectra's live stream, and the wire proxy's address with a copy button. Under it, the turn list and the turn view sit side by side as panels, with a divider between them.

- **The selection** is in the page address, as `#/turns/<trace id>`. A turn sent from the composer is selected as it opens; a turn another host opens joins the list without moving the view. A page opened with no turn in its address selects the newest.
- **The turn list** groups the turns by conversation, newest first. Each group is titled by its conversation's first message and its agent, with its number of turns and problems, and opens and closes; a turn with no conversation is a group of its own. Each row shows the turn's status, its time, its input in brief, its duration and its problem count. The search, which `/` focuses, matches a turn's input, its conversation's title and agent, and a trace or conversation id, whole or by its start.
- **The turn's header** leads with the turn's input. Beside it are the outcome and the check state: the number of problems, "No problems", or "Not checked" and why, with each check that ran, its protocol version and its result in a tooltip. One line below holds the start, the duration, the A2UI version, the agent, and the trace and conversation ids with copy buttons.
- **The timeline** lists the turn's steps in the order they came: the input, each status update, text part, data part, file part and A2UI message, and the outcome last, each with its own icon. A delivery that carries several steps has a row of its own with the steps under it. Each step with a problem carries a red mark and its count.
- **The problems** are the schema check's findings, each on the message its path names; the messages web core's message processor rejects; and a failed turn's reason, on the outcome. A finding that names no message is on the outcome too.
- **The result** shows the agent's reply text in a strip, then the Structure tab: the selected surface's tree and its data model, side by side, as they stood right after the step selected. The agent's A2UI messages of the conversation's earlier turns, then the turn's own up to the step, go one by one into upstream web core's message processor in its relaxed validation mode, with the v0.9 and v1.0 basic catalogs registered and a stand-in catalog with no component schemas under any other catalog id the messages name. Each tree node opens to its properties; a child id no component has shows as missing; the components no parent reaches are listed under "Not under the root". A surface with a component of a stand-in catalog lists its components in the order they came instead, since its catalog's schemas, which say which properties hold child ids, are not known. The surface switcher lists the surfaces the turn touched, then those it did not change, each with its catalog id and its problems, and the surfaces the turn deleted.
- **The step's detail**, in a split under the result that can be resized and collapsed, shows the step's problems, then what it holds: an A2UI message or a data part as JSON, a text part as text, a file part's name, MIME type and size or URI, each with its part's metadata. It ends with the delivery the step arrived in, folded. A delivery's row shows the delivery as the turn record holds it: its parts in order and its metadata. The Input step shows the host's message, its capabilities and its data model. Every JSON block has a copy button and folds its objects and arrays.
- **The composer**, docked under the turn view, sends in the message box's conversation: it names the conversation by its first message, waits while a turn is open, and offers a new conversation.
- While the live stream is down, or silent past its heartbeat, the context bar says so; when it comes back, the page reads the listing, the box and the selected turn again.

## Stack

React, with Radix primitives and the resizable panels shadcn/ui wraps, on Tailwind in A2UI Composer's configuration (`components.json`), and `@a2ui/web_core` from npm for the surfaces. Inter and JetBrains Mono are bundled from Fontsource, so the page fetches nothing from outside Spectra.

## Layout

- `src/model/`: what the viewer reads from turn records: the timeline of steps, the problems on them, the check state, the turn list's groups and search, the conversation replay into surfaces, bindings and JSON lines as the tree and the JSON blocks show them, the input in brief, the A2UI messages and where findings point, and the turn's summary. Each test is beside its source as `*.test.ts`.
- `src/state/`: the page's store, fed by the API and the live stream, what each pane reads from it, with the composer's view tested beside it, and the theme.
- `src/components/`: the rail, the context bar, the turn list and the turn view's parts.
- `src/testing/`: reads the A2A capture suite's recordings from the conformance workspace for the tests.

## Commands

From `tools/spectra_viewer/`:

- `yarn build`: type-checks the app and builds it into `dist/`.
- `yarn test`: type-checks the tests and runs them under Node's test runner, on the recordings in `../../conformance/test_data/a2a_capture/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset and React's hooks rules.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
