# Task 3.2 — The foundations, the frame and the turn view

Spec for sub-task 3.2 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the foundations, the frame and the turn view of a finished turn, following the design canvas "Spectra viewer UI". The Phase 3 spec's decisions apply, as amended here.

## Scope

- The foundations: the colour tokens in light and dark, Inter and JetBrains Mono bundled, the type scale, the icon set and the mark, the theme switch and motion.
- The frame: the rail, and the context bar with the live status, connected and disconnected.
- The turn list, grouped by conversation, with its search and its groups collapsing.
- The turn view of a finished turn: the header, the timeline of steps, the result pane and the step's detail; the problems from the schema check, the processor and a failed turn's reason; the cancelled outcome.
- The composer docked under the turn view.
- The listing API's added fields, the context bar's fields, and the server counting the processor's rejections.
- This spec's additions to the design, drawn on the design canvas.
- The unit tests, the Phase 3 spec's amendments and `_dev/TODO.md`.
- Not in scope: the first screen, the agent popover, the live turn and the turn list following the newest turn (sub-task 3.3); the count as a filter, a turn opening on its first problem and the offending JSON line (3.4); the composer continuing the conversation in view and saying when the agent waits for input (3.5); the turn list's strip and overlay, remembered dividers, the keys and the step in the page address (3.6).
- Done when a finished turn matches the design artifact in light and dark.

## Locked decisions

### 1. The composer

The message box is the composer docked under the turn view, drawn as the design artifact draws it, with the message box's behaviour today: it sends, offers New conversation, and is disabled while a turn is open. The chat column is gone. The composer continues the message box's own conversation. Its label reads "Continue" with that conversation's first message, "New conversation" when the box has none, and "A turn is open" while one is.

### 2. The problems

A turn's problems are the schema check's findings, the processor's rejections and a failed turn's reason. Their count shows on the turn's row and in its header, each step with a problem carries a mark and its count, and the step's detail shows its problems as blocks, a plain sentence and then its code.

### 3. The header's check state

The header's count always reads a state: the number of problems, "No problems", or "Not checked" with its reason — no A2UI in this turn, or no schema check. A tooltip on it lists each check that ran, with its protocol version and its result. The clean states are grey. A row in the turn list shows a count only when its turn has problems.

### 4. The rejection count

The server counts each closed turn's processor rejections by feeding its conversation through web core's message processor, as the viewer does, for the turns closing and for the turns already in the store. The listing carries the count beside the schema check's findings. Rejections stay out of the turn record.

### 5. The listing and the context bar

The listing adds each turn's agent name and duration. The API gives the context bar the agent's name, the mode, `run` or `attach`, and the wire proxy's address.

### 6. The outcome step

The timeline's last step is the turn's outcome: completed, waiting for input, cancelled or failed. A failed turn's step carries its reason and a problem mark, and the reason counts among the turn's problems.

### 7. The Data and File steps

A data part that is not A2UI is a Data step, and a file part is a File step, each with its own icon shape. A Data step's detail shows its JSON. A File step's detail shows its name, its MIME type, and its size or its URI.

### 8. The delivery

A delivery's row, shown when one delivery carries several parts, is selectable. Its detail shows the delivery as the turn record holds it: its parts in order, each with its metadata, and the delivery's metadata. Every step's detail ends with a folded Delivery section holding the delivery the step arrived in. The Input step's detail shows the request as sent, with the host's capabilities and data model.

### 9. JSON

Every JSON block has a copy button and folds its objects and arrays: the step's message, the delivery, the request, and the data model in Structure.

### 10. Structure

Tree nodes expand in place to their properties. Components no parent reaches are listed under "Not under the root", and a surface with a component of a stand-in catalog — a catalog other than the basic catalogs, registered with no component schemas — lists its components in the order they came under "Nested once the catalog's schemas are known", each a small-capital section in the tree column. The surface switcher shows each surface's catalog id, lists the surfaces the turn touched first and then those not changed in this turn, and shows a surface the turn deleted as deleted.

### 11. The turn list's groups and search

Each conversation's group collapses and expands. The whole list collapses only on small screens, in sub-task 3.6. A turn with no conversation id is a group of its own. The search matches each turn's input in brief, its conversation's title and agent, and a trace or conversation id, whole or in the short form the header shows. A group with a match shows only its matching rows.

### 12. The design canvas

Each addition this spec makes to the design is drawn on the design canvas before it is built: the selectable delivery row and the delivery's detail, the Input step's request, the Data and File steps and their icons, the header's check state and its tooltip, Structure's sections and the surface switcher's states, and the JSON blocks' copy button and folding.

### 13. Tests

Unit tests under Node's test runner cover the viewer's new logic — the turns grouped by conversation, the steps and deliveries built from the wire events with the Data and File steps, the problems placed on their steps, the header's check state and the surfaces' states — fed with sub-task 2.3's recordings. The tool's unit tests cover the listing's added fields. Components have no unit tests; the rendering is checked live through the tunnel against the design artifact's boards, in light and dark.

### 14. The Phase 3 spec's amendments

- The turn list: while the newest turn is selected, a new turn from any host is selected as it opens; selecting an older turn stops following, and selecting the newest again resumes it. The search matches as in decision 11, each group collapses and expands, and a row shows its problem count when it has problems.
- The steps: data parts and file parts are steps, and the turn's outcome is the last step.
- The step's detail: the delivery, the Input step's request, and JSON blocks copied and folded, as in decisions 8 and 9.
- The result pane: Structure's facts and the surface switcher's states, as in decision 10.
- The problems: the header's check state, as in decision 3.
- The scope: the listing's added fields, the context bar's fields, and the server counting the processor's rejections.

### 15. `_dev/TODO.md`

- 3.2 gains the composer docked under the turn view, the problem count on the rows and in the header, the marks on the steps and the problem blocks, and a failed turn's reason as its last step, and names this spec.
- 3.3 loses the composer and gains the turn list following the newest turn.
- 3.4 keeps the count as a filter, a turn opening on its first problem, and the offending JSON line in the step's detail.
- The Backlog gains the wire proxy keeping each delivery's raw exchange beside the turn record, for the viewer.

## Invariants

- The viewer states what the messages build — placeholders, components not under the root, rejections, unchanged and deleted surfaces — as facts; judging them is the checks'.
