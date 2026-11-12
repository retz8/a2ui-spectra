# Sub-task 7.5 — The viewer

The viewer's fixture side: the Fixtures section and the fixture view, Save as fixture and Replay in the headers, the replayed turn's line and its reasons, a served call, a miss, the live status and the composer's refusal. Sub-task 7.5 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, carrying out its decision 12, the viewer's fixture side, decision 13, the replayed turn's view and a miss shown, and decision 14's controls on a record with nothing to serve; built as the 7.1 design spec, `_dev/docs/spec/task-7.1-design-artifact.md`, and the canvas "Spectra viewer UI" draw them, on the API, the box's state and the stream events sub-task 7.3 left. Done when Flow 7 on the canvas, save a turn as a fixture and replay it for free, then see where a prompt edit broke the request, works in the viewer.

## Scope

- The rail's Fixtures section switching the panels; the fixtures list, watched; the fixture view with its fixture line.
- Save as fixture and the Replay popover in a store turn's header, Replay in the fixture view's header, the cost labels and the disabled rows.
- The replayed turn's third line; the verdict's reasons as problems; the Record tag and the served call's detail; a model miss with the prefix break and a tool miss's list; a live call in a live-mode replay.
- The context bar's live status during a replay and the composer's refusal.
- The page address of the Fixtures section and the links between the two sections.
- The four stream events and `replay` on the box's state in the viewer.
- The canvas's amendments, the tests, the live check and the documents.

Out of scope: the three samples through the tunnel, sub-task 7.7.

## Locked decisions

### 1. The address

The Fixtures section's address is `#/fixtures/<name>/turns/<trace id>`, followed by the step and the node as the Turns address carries them; the name is encoded, being the fixture's path under the folder; the turn inside the fixture is named by its recorded trace id, the one `a2ui.replay.turn` carries. A bare `#/fixtures` opens the most recently saved fixture on its own turn, and a fixture address with no turn opens that fixture's own turn. With an empty folder, "No fixtures yet." stands in the view's place.

### 2. The two sections in the history

Each section remembers the address it was last on for the session, so the Turns selection survives a visit to Fixtures and back. Switching sections adds a history entry, as changing the turn does; selecting a fixture turn adds one; a step or a node replaces it. Back walks between the sections.

### 3. Where the provenance links point

The replayed turn's third line, a served call's sentence, a model miss's prefix break and each row of a tool miss's list resolve their target from `a2ui.replay.source` and `a2ui.replay.turn` in this order: a listed fixture at the recorded path, then a store turn carrying the recorded trace id, then gone. A fixture source is named by its file and links into Fixtures. A store-turn source is named as the turn list names the turn, by its input in brief, a text in quotation marks, and links into Turns, its record read through the turn route when needed. A recorded call of a store-turn source, in a served call's sentence and in a prefix break against the record, is named by the turn that holds the call. A gone source leaves the text as plain text, the recorded path's base name, with no link and no further wording; the served sentence stays unlinked, and the miss's block takes its "nothing to compare with" form. The context bar's status names and links the source by the same rule.

### 4. A press in the fixture view's preview

The press is dropped: the renderer fires the action, the viewer takes nothing from it, and nothing changes on screen.

### 5. The fixture in view changing under it

When the fixture in view is removed from the folder, the view keeps what it holds, its row gone from the list, "no longer in the folder" in the saved time's place on the fixture line, and Replay fails in the popover as the 7.1 spec has it for a file no longer readable. When it is rewritten, its record is read again and the view follows it: the selected turn stays by its trace id when the new record still holds it, else the fixture's own turn; the selected step stays by its id when still present, else is dropped, the address replaced; the saved time updates. When it no longer reads as a record, the list shows the reason in place of its rows, and the view is treated as removed, with the reason in the saved time's place. Nothing is announced.

### 6. A live call in a live-mode replay

The row stays bare, as drawn. The detail gains one grey sentence where "Served from the record" sits on a served call, "Went to the model · matched nothing in the record", and its prefix break's candidates widen to the source record's calls of the same model, so the first call of the conversation reads "Prefix breaks in the system prompt · against the recorded call at +2.0 s in find-italian-restaurants.json", the miss's own form without the problem block. A re-run turn's model call, a turn replayed in the `live` mode, takes the source's calls of the same model as candidates by the same rule, beside its own conversation's, and carries no grey sentence.

### 7. The recorded calls never asked for

The count `replay_ended` carries is not shown in the viewer. The event ends the live status and the composer's refusal, and nothing more.

### 8. What the viewer reads and computes

Every fixture's record is read when the listing arrives, and read again when its saved time changes, for the group titles' recorded cost. The name prefilled at save is the server's slug of the turn's input in brief, computed in the viewer by the same rule. The disabled everything-recorded row mirrors the server's nothing-to-serve rule, no model call and no tool call event across the record's turns; the server's refusal is the authority and is shown in the popover as it answers. The two rows are off with a note under their label, the first that applies: "Not connected to Spectra"; "Save it as a fixture first", on a turn whose record was not written to the store, which the turn listing marks; the message box's reason it cannot send, without "Can't send · " and capitalised, the one line of the box's that does not start so shown whole; "A replay is running"; "A turn is open". The turn listing gains `replayDifferences`, a replayed turn's different outcome and different A2UI, so the list row counts what the header counts. The recorded cost prices every ended model call of the record, a served call's recorded tokens included.

### 9. Every fixture lists

The fixtures list shows every fixture in the folder, whatever agent recorded it, with no agent picker.

### 10. The canvas's amendments

Drawn before the build: a detail board for the live call of a live-mode replay, decision 6, in the "Fixtures and replay" row of "Turn view details"; and on "Components and states", the third line's forms for a store-turn source and for a source gone, the fixture line's forms with "no longer in the folder" and with the reason a file does not read as a record, the served sentence's unlinked form, the live call's sentence, and the fixtures list's row for a file that is not a turn record.

### 11. The tests and the live check

Unit tests under Node's test runner beside their sources: the fixtures list's groups from the listing and the records, the own turn last and the cost once read, the search over names and inputs; the address with the fixture, the bare forms, and which changes add or replace a history entry; the section's last address remembered; what each of the four stream events and `replay` on the box's state change in the store, the live status's three forms and the composer's refusal; the verdict's reasons as problems, a miss on its row, a different outcome and different A2UI on the outcome, the A2UI reason's link and recorded message; the served call's tag, sentence, free cost and the header's second line; the miss's nearest recorded call by longest shared prefix from the source record, the tool miss's list by method and tool name, and both no-candidate forms; the live-mode live call's sentence and widened candidates; the provenance link's resolution in decision 3's order; the slug against the server's cases; the fixture changing under the view as decision 5 has it.

The live check, through the tunnel on the real binary, on the stub agent's model-calling mode against the stand-in provider and the conformance MCP server: Flow 7 end to end, save, replay free, change the stub's prompt, replay again to the miss and the prefix break; the live mode with the stand-in for the live call's sentence; a tool miss by editing a recorded `echo` argument in the fixture file by hand; a store turn replayed from its header; every board in light and dark at 1200 × 760 and on the small window. The samples wait for sub-task 7.7.

Done when Flow 7 works in the viewer and the tests are green in CI.

### 12. Other documents

- The viewer's README: the Fixtures section, the fixture view, the headers' controls, the replayed turn, the served call, the miss, the live call, the live status and the composer, the address.
- The Phase 7 spec, amended in place: decision 12 with the address, the sections remembered, the fixture changing under the view and every fixture listing; decision 13 with the provenance links' resolution, the live call's sentence and the never-asked-for count not shown.
- The 7.1 design spec, amended in place: decision 4 with the address's form and the sections remembered; decision 10 with the live call's sentence; decision 13's boards gaining decision 10's.
- `_dev/TODO.md`: the 7.5 line names this spec.

## Invariants

- The build follows the canvas; a form the canvas lacks is drawn before it is built.
- The server is the authority on a refusal; the viewer's disabled states mirror its rules, and its answer is shown as it is.
- The fixture view reads what was recorded; sending belongs to the replayed conversation in Turns.
