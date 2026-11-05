# Sub-task 7.1 — The design artifact

Phase 7's boards on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which the later sub-tasks follow. Sub-task 7.1 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, whose decision 16 names the boards.

## Scope

- The boards decision 16 of the Phase 7 spec names: the rail with its Fixtures section and the fixture view with its header line and the Replay controls, the disabled state for a record with nothing to serve; a store turn's header with Save as fixture and the Replay controls, the name prompt and the line naming the file written; the replayed turn, its line passed and failed, a served call's detail, a model miss with the prefix break and a tool miss's list; the context bar's live status during a replay.
- Flow 7, saving a turn as a fixture and replaying it for free, then seeing where a prompt edit broke the request.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the boards go

"Turn view details" gains a row, "Fixtures and replay", with the detail boards: the fixture view with its header line and the Replay popover, and its disabled form; a store turn's header with Save as fixture, the name prompt open, and the done line naming the file written; a replayed turn passed; a replayed turn failed, its reasons as problems; a replayed turn in the live mode; a served call's detail; a model miss with the prefix break; a tool miss with its list. Flow 7 is a new row on the Flows page. The Screens row of "Screens and foundations" gains a pair, "The fixture view", light and dark; the States row gains the context bar while a replay runs. "Components and states" gains the Fixtures section and its rows, the Replay controls in their forms, the name prompt, the replayed line's forms, the Record tag and the miss block's two forms. "Icons" gains what the rail section and the controls need. One small-window board, 1,200 × 760 in light, draws the fixture view.

### 2. What the boards draw

| Board | Drawn from |
| --- | --- |
| The fixture view, its header line, the popover; the Screens pair; the small window | The Python restaurant finder's conversation, list then booking |
| Save as fixture, the prompt and the done line | The same turn |
| A replayed turn passed, a served call's detail | The same, replayed everything recorded |
| A replayed turn in the live mode, Record and bare rows mixed, "2 calls from the record" | The Node restaurant finder, its last call gone live |
| A model miss with the prefix break | The Python restaurant finder after the prompt edit |
| A tool miss with its list | The custom-components example, its `get_contact_info` call with a changed argument |
| A replayed turn failed on outcome and A2UI, the problems on the outcome step | The Python restaurant finder, illustrative |
| The disabled Replay rows, nothing recorded | The Python restaurant finder captured under `attach` |
| The context bar replaying, the composer refusing | The Python restaurant finder's conversation, turn 2 of 2 |

A value the records leave open, such as the edited line and the figures, is illustrative and settled on the canvas.

### 3. Flow 7, save a turn as a fixture and replay it for free, then see where a prompt edit broke the request

Four boards:

1. "Save as fixture: the name prefilled from the turn's input, the folder under it." The Python restaurant finder's booking turn, the second of its conversation, the popover open.
2. "In Fixtures: the fixture's two turns, and Replay's two modes with their cost." The fixture view, the popover open, "Up to $0.031" on the live row.
3. "The replay lands as new turns: every call from the record, passed, free." The replayed booking turn, Record on every row, the third line green.
4. "After a prompt edit, replay again: the first model call misses, and the prefix break points at the edited line." The replayed turn failed, the miss selected, the marker in the system prompt.

### 4. The rail switches the panels

Fixtures is the rail's second section. Turns shows the turn list and the turn view as today; Fixtures shows, in their places, the fixtures list and the fixture view. The context bar stays; the composer is not shown in Fixtures. A replay started from the fixture view switches the rail to Turns and follows the first replayed turn as it opens, as the box's send is followed; the fixture stays selected in Fixtures. The page address carries the fixture and the selected turn and step, so a replayed turn's line links straight to the source turn and Back walks between the two sections.

### 5. The fixtures list

Grouped like the turn list: one group per fixture, titled by its name, with its turn count and its recorded cost, its turns as rows in order, the fixture's own turn last, each row in the turn row's form. Selecting a row shows that turn in the fixture view, which is how the earlier turns are reached. The list has the same search, matching names and inputs, and collapses to the same strip.

### 6. The fixture view's header

The fixture view is the turn view's shape, its header leading with the turn's input as any turn's does. Above the turn header, a fixture line: "Fixture · find-italian-restaurants.json · 3 turns · recorded $0.031 · saved 2026-11-05 14:02", the file name a copy button, the cost priced as the turn header's second line prices it. On a fixture whose turns hold no model or tool call, "nothing recorded to serve" stands in place of the cost.

### 7. The Replay button and its popover

One Replay button in the header's action area, on the right, in the fixture view's header and in a store turn's header alike, a store turn replaying directly from its file. It opens a popover with the two modes as rows, each a button with a title and a cost label: "Everything recorded" over "Free · the model and the tools answer from the record", and "Tools recorded, model live" over "Up to $0.031 · a request that changed goes to the model". On a record with nothing to serve, the first row is greyed with "No model or tool calls were recorded" under it, and the second's label reads "Cost unknown · nothing recorded". While a turn is open the rows are disabled with "A turn is open" under them, and while a replay runs with "A replay is running"; there is no queue. A replay that cannot start, the agent gone or the file no longer readable, says so in the popover as Save's failure does, and nothing moves. Pressing a row starts the replay and closes the popover.

### 8. Save as fixture

A button beside Replay in a store turn's header, opening a popover anchored to it: a name field prefilled with the slug of the turn's input in brief, the folder under it in grey, "a2ui-spectra-fixtures/", the `.json` after the field, a Save button; Enter saves, Escape closes. A name with a character outside the allowed set, or one the folder already holds, is said in a line under the field, the clash offering the numbered name in one press. A quiet line states the turn count the fixture will hold, "3 turns, the earlier two embedded". On save the popover's content becomes one line, "Saved as a2ui-spectra-fixtures/find-italian-restaurants.json", the path a copy button, with "Open" as a teal link to the fixture view, and closes on the next click elsewhere. A failure to write stays in the popover as a problem-style line with the system's reason. There is no toast.

### 9. The replayed turn's line, and its reasons as problems

A third quiet line under the header, on a replayed turn only: "Replayed from find-italian-restaurants.json · turn 3 of 3 · everything recorded · passed", the fixture a teal link to its turn in Fixtures, "passed" in the green of a completed badge; a failed verdict reads "· failed" in red, and nothing more on the line. Each verdict reason of the Phase 7 spec's decision 9 joins the one count and the `n` key: a miss is the failed call's problem on its row; a different outcome and different A2UI are problems of the whole turn, on the outcome step as a failure reason is, each in Phase 3's problem block form, a plain sentence first, "The A2UI differs from the record: message 3 of 4 is not the recorded one." or "The turn ended failed; the record ended completed.", and the code second, "A2UI differs · replay", "Outcome differs · replay". The A2UI sentence's message is a link that selects that step, with the recorded message under it as a folded JSON block. The checks' findings stay as on any turn.

### 10. A served call

On the timeline row, a grey tag after the call's name, "Record", in the place and width the "Retry 1" tag takes; the live calls of a live-mode replay stay bare; a served retry carries both, "Retry 1 · Record". In the detail, under the title line where the retry's sentence sits, a grey sentence: "Served from the record · the call at +2.0 s in find-italian-restaurants.json", the call a teal link to the recorded call in Fixtures. The usage's estimated cost reads "Free · served from the record" in place of the figure, and the header's second line counts the live calls alone, adding "· 2 calls from the record". A tool call served has the same tag and sentence; a housekeeping row served carries the tag too, uncounted as ever. A served call keeps its step type's icon and its provider's colour.

### 11. A miss

The failed call's row carries the red mark and counts as one problem. Its detail opens with the problem block, "This request matched nothing in the record." first and the code second, "replay_miss · Gemini", the provider as the failed-call sentences name their API. Under it, for a model miss, the prefix break's own sentence and marker against the recorded request of the same model that shares the longest prefix with it, in the Phase 5 form: "Prefix breaks in the system prompt · against the recorded call at +2.0 s in find-italian-restaurants.json", the recorded call a teal link, the grey "Shared prefix ends" marker at the point in the request with the recorded text and this one's as the two short lines, the differing span tinted; on a model the record never called, "No recorded call of gemini-3.6-flash to compare with." For a tool miss, a short list, "Recorded requests of tools/call get_restaurants", one row per recorded call of the same method and tool name, each its arguments in brief and a link to it, an HTTP tool matched by method and path; with none, "No recorded request of this tool to compare with." The nearest recorded call is the viewer's choice from the fixture; nothing is recorded about it.

### 12. The context bar and the composer while a replay runs

The live status takes a third form: "Replaying find-italian-restaurants.json · turn 2 of 3" with the open turn's teal spinner, the fixture name a link, returning to "Live" when the last replayed turn closes. The composer shows "Can't send · a replay is running" in place of its line, Send disabled, in the form the unset-variable refusal uses, and comes back when the replay ends.

### 13. Dark twins, icons and keys

Dark twins: the Screens pair, the fixture view; the replayed turn with the miss selected; the Replay popover open. Icons: the Fixtures section's icon in the rail, a saved card; the Replay action's icon; the Record tag carries no icon. No new step icon. No new keys; Save as fixture and Replay are header actions reached by Tab, and the list of keys is unchanged.

### 14. What other sub-tasks and documents take from this

- Sub-task 7.3: the API lists the fixtures with, per fixture, its name, path, saved time and its turns in the turn listing's form, and serves a fixture's record for the fixture view, the recorded cost computed by the viewer as the header's second line is; save takes the name and answers the path written, the clash and the character errors as decision 8 names them; the live stream carries the replay's start, each turn's number of the total and its end; the verdict's reasons reach the viewer in the record, as decision 9's problems need.
- Sub-task 7.5: done when the artifact's Flow 7 row works in the viewer.
- The Phase 7 spec, amended in place: decision 12 gains the rail switching the panels, the fixtures list grouped per fixture, the one Replay button with its popover and the fixture line; decision 13 gains the verdict's reasons as problems, the Record tag and the served call's cost line; decision 16 gains Flow 7, the Screens pair and the small window.
- The Phase 3 spec's decision 3, the frame, amended in place: Fixtures switches the panels.
