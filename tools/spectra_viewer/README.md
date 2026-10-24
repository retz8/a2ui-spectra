# Spectra viewer

Spectra's viewer: a React app built with Vite. The `a2ui-spectra` tool in [`../spectra/`](../spectra) copies its build and serves it, with the API and the live stream its README describes.

## The page

Three columns, which can be resized: the turn list, the selected turn, and the message box. The page follows the system's light or dark setting.

- **The selection** is in the page address, as `#/turns/<trace id>`. A turn sent from the message box is selected as it opens; a turn another host opens joins the list without moving the view. A page opened with no turn in its address selects the newest.
- **The turn list** holds every turn, newest first: its start time, its outcome or open, the host's input in brief, the schema check as a mark, and its conversation's short id.
- **The turn's header** shows the outcome, with a failed turn's reason; the start time and the duration; the A2UI version; the schema check; the agent's name; and the conversation and trace ids, each with a copy button.
- **Input** and **Raw messages** show the host's message and what the agent sent back, one card per wire event with its time since the turn's start: text as text, each A2UI message as JSON with a copy button, any other part as JSON, then the metadata and, on the input, the capabilities and the data model.
- **Surfaces** shows what the conversation's A2UI builds up to the turn. The agent's A2UI messages of the conversation's earlier turns, then the turn's own, go one by one into upstream web core's message processor in its relaxed validation mode, with the v0.9 and v1.0 basic catalogs registered and a stand-in catalog with no component schemas under any other catalog id the messages name. The turn's messages the processor rejects come first. Then every surface live after the turn, those the turn touched first; each shows its tree from the root, with any child id no component has and the components not under the root, and its data model. A surface with a component of a stand-in catalog lists its components in the order they came instead, since its catalog's schemas, which say which properties hold child ids, are not known. A surface the turn deleted is one line.
- **Checks** shows each check event and its findings.
- Each finding and each rejection links to its message in Raw messages, and the message links back.
- **An open turn** shows its wire events as they arrive, and its surfaces build up with each one.
- **The message box** shows the turns it sent in its conversation as a chat built from their records: the text sent, the reply's text parts, the number of A2UI messages linking to the turn, and the outcome when it is not completed, or a spinner while the turn is open. Its input waits while a turn is open. "New conversation" starts a new one.
- While the live stream is down, or silent past its heartbeat, a bar says so; when it comes back, the page reads the listing, the box and the selected turn again.

## Stack

React, with [shadcn/ui](https://ui.shadcn.com) components on Radix and Tailwind in A2UI Composer's configuration (`components.json`), and `@a2ui/web_core` from npm for the surfaces. The components are in `src/components/ui/`.

## Layout

- `src/model/`: what the viewer reads from turn records: the conversation replay into surfaces, the input in brief, the A2UI messages and where findings point, the turn's summary and the message box's chat. Each test is beside its source as `*.test.ts`.
- `src/state/`: the page's store, fed by the API and the live stream, and what each pane reads from it, with the message box's chat tested beside it.
- `src/components/`: the panes.
- `src/testing/`: reads the A2A capture suite's recordings from the conformance workspace for the tests.

## Commands

From `tools/spectra_viewer/`:

- `yarn build`: type-checks the app and builds it into `dist/`.
- `yarn test`: type-checks the tests and runs them under Node's test runner, on the recordings in `../../conformance/test_data/a2a_capture/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset and React's hooks rules.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
