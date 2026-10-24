# Task 2.6 — The viewer

Spec for sub-task 2.6 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the viewer's turn list, its turn view with the input, the raw messages, each surface's tree and data model and the check results, and the message box's UI. The Phase 2 spec's decisions on the tree and the data model, the message box and the tests apply, as amended here; the API and the live stream are sub-task 2.5's (`_dev/docs/spec/task-2.5-server-and-message-box.md`). Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin.

## Scope

- The viewer: the page, the turn list, the turn view, the message box's panel and the connection state.
- The listing API's added fields for the turn list.
- The viewer's unit tests, and the tool's for the listing's added fields.
- The Phase 2 spec's amendments, SPEC.md's viewer row, a new entry in `_dev/a2ui-findings.md`, the tool's and the viewer's READMEs, and `_dev/TODO.md`.
- Not in scope: the preview, actions and the data model sent by the host, Phase 3.

## Locked decisions

### 1. The page

Three resizable columns: the turn list on the left, the selected turn's view in the middle, and the message box on the right. The theme follows the system's light or dark setting.

### 2. The selection

The selected turn is in the page address's hash, `#/turns/<trace id>`, so a reload or a pasted link opens it. A turn sent from the message box is selected as it opens. A turn another host opens appears in the list without moving the view. A page opened with no turn in its address selects the newest.

### 3. The turn list

One flat list, newest first. Each row shows the start time; the outcome, or open; the host's input in brief — its first text part, else the action's name, else the part's type; the schema check as a mark — passed, its number of findings, or none; and the conversation's short id. The listing API gains these fields, from the closed records and from the open turns in memory.

### 4. The turn view's header

The outcome, with the turn status's reason beside a failed turn that has one; the start time and the duration; the protocol version; the schema check — passed, its number of findings, "no A2UI in this turn", or "no schema check" for a turn with no protocol version; the agent's name; and the conversation id and the trace id, each copyable. An open turn reads open in place of an outcome and a duration.

### 5. The tabs

Four: Input, Raw messages, Surfaces and Checks.

### 6. The wire events

The Input tab shows the wire input and the Raw messages tab the wire outputs in order, one card per wire event with the time since the turn's start. Each part shows by its type: text as text; an A2UI part as JSON, each message of an array numbered by the index the findings' paths use; any other part as JSON. Then come the event's metadata and, on the input, its capabilities and data model, each under its own label. JSON shows as a collapsible view, and each A2UI message has a copy button. The events' span fields are not shown.

### 7. The conversation replay

The Surfaces tab shows what the conversation's A2UI builds up to the turn. The agent's A2UI messages of the earlier turns embedded in the record, then the turn's own, are fed in order into web core's message processor in its relaxed validation mode, with the basic catalogs of v0.9, which also serves v0.9.1, and of v1.0 registered. Each other catalog id the messages name — a surface's, and in v1.0 a component's or a function call's — is registered as a permissive stand-in catalog with no component schemas.

### 8. Which surfaces show

Every surface live after the turn. The surfaces the turn's messages touched come first, expanded; the others follow collapsed, marked "not changed in this turn". A surface the turn deleted shows as one line, "deleted in this turn".

### 9. A surface

Each surface, labelled with its surface id and catalog id, shows its tree, then its data model as a collapsible JSON view. The tree is nested from the surface's root: each node reads its component's type and id and expands to its properties; a child id with no component shows as a placeholder naming the id; components no parent reaches are listed after the root's tree, under "not under the root". A surface with a component of a stand-in catalog lists its components in the order they came, under "nested once the catalog's schemas are known", in place of the tree.

### 10. Rejected messages

The turn's messages the processor rejects head the Surfaces tab; those of earlier turns are not listed. Each shows web core's error code, its message and the surface id, and links to its message in the Raw messages tab, whose card reads "rejected by the processor" and links back. Rejections are not recorded.

### 11. The Checks tab

One section per check event, with its name, passed or failed, and its protocol version. Each finding shows its code, its message, its surface id and the path inside its message, and links to its message in the Raw messages tab, where an A2UI message with findings carries their number, linking back.

### 12. An open turn

Its row appears at turn opened, its input in brief filled from its first wire event. The Raw messages tab grows as wire events arrive, and the Surfaces tab re-runs the replay after each one, with the earlier turns taken from the conversation's latest closed record. The Checks tab reads "runs when the turn closes". At turn closed, the view takes the closed turn's events.

### 13. The message box's panel

A chat built from the records of the turns the box sent in its conversation: each turn shows the text sent, then the reply's text parts in order, then the number of its A2UI messages, linking to the turn, and its outcome when it is not completed — waiting for input, failed with its reason, or cancelled. An open turn shows a spinner. While a turn is open, the input is disabled, reading "waiting for the turn to close". When the box cannot send, the reason replaces the input. A refused send shows its error under the input. New conversation clears the panel; the turn list keeps every turn. After a reload, the panel rebuilds the box's turns from their records.

### 14. The connection

While the live stream is down, a bar reads "Not connected to Spectra" and the box's input is disabled. A stream whose heartbeat stops counts as down. On reconnect, the viewer refetches the listing, the box's state and, when it closed meanwhile, the selected turn's record, then takes the stream's catch-up.

### 15. The stack

shadcn/ui components in A2UI Composer's configuration at the pin — the new-york style, the neutral base colour, CSS variables and lucide icons, on Radix — on Tailwind through its Vite plugin. Web core, `@a2ui/web_core`, comes from npm at its published version, 0.14.0.

### 16. Tests

Unit tests under Node's test runner on the viewer's logic — the conversation replay into surfaces, the row's input in brief, the links of findings and rejections to their messages, and the box's chat built from records — fed with the records of sub-task 2.3's recordings in the conformance workspace. The viewer's test target moves from Vitest to Node's test runner. Components have no unit tests; the rendering is checked live. The tool's unit tests cover the listing's added fields.

### 17. The Phase 2 spec's amendments

- The tree and the data model: the agent's A2UI messages of the conversation up to the turn are fed in, and each catalog id other than the basic catalogs' is registered as the permissive stand-in.
- The message box's offer: the box also shows a turn's outcome when it is not completed.

### 18. Other documents

- SPEC.md's "Engineering decisions" viewer row: "TypeScript, React, Vite; shadcn/ui components on Tailwind; upstream's web core for the tree and the data model."
- `_dev/a2ui-findings.md`: finding 17, the TypeScript restaurant finder's mode without a model creating `stub-notice` again in every turn of a conversation, against the v0.9 and v1.0 protocols' rule that a surface id is unique for the renderer's lifetime, reproduced by sub-task 2.3's recording `node_restaurant_finder/stream_v1_0_booking`.
- The tool's README: the listing's added fields.
- The viewer's README: what it shows, its stack and its tests.
- `_dev/TODO.md`: the 2.6 line names this spec.

## Invariants

- The viewer states what the messages build — placeholders, components not under the root, rejections, unchanged and deleted surfaces — as facts; judging them is the checks'.
