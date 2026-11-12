# Sub-task 8.6 — The viewer

The viewer's side of the dev loop: Restart and Logs in the context bar, the live status's forms, the logs drawer with its dividers and turn markers, the turn list's restart divider, Re-run in the header with its notes and the re-run turn's lines, the first screen's forms and the composer's refusals. Sub-task 8.6 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, built as the sub-task 8.1 spec, `_dev/docs/spec/task-8.1-design-artifact.md`, and the canvas "Spectra viewer UI" draw them, on the routes and the stream events the sub-task 8.2 spec, `_dev/docs/spec/task-8.2-agent-process.md`, the sub-task 8.3 spec, `_dev/docs/spec/task-8.3-logs-and-save-watcher.md`, and the sub-task 8.4 spec, `_dev/docs/spec/task-8.4-re-run.md`, left. Done when Flow 8 on the canvas, edit, save, restart, re-run, see, works in the viewer.

## Scope

- Under `run`: Restart and Logs in the context bar, the live status's forms, the logs drawer, the turn list's restart divider, the first screen's forms.
- Re-run in a store turn's header and in the fixture view's, its notes, the re-run turn's lines and its model call's comparison.
- A refused press of Re-run or Restart.
- The composer's refusal, under `run` and `attach`, and the Replay popover's rows taking Re-run's notes.
- One change on the tool's side: the turn listing's mark for a turn whose record was not written.
- The canvas's amendments, the tests, the hand pass and the documents.

Out of scope: the three samples through the tunnel, sub-task 8.7.

## Locked decisions

### 1. A refused press

A press of Re-run or of Restart that the server refuses, or whose request fails, shows the server's sentence in a popover that opens only then, anchored under the button, in the failure line the Replay popover uses. It closes on a press outside, on Escape, or on the next press of the button.

### 2. A turn held in memory only

The turn listing marks a turn whose record was not written to the store, with one optional mark on its entry. The listing is read again each time a turn closes, so the mark has no event of its own. On such a turn Re-run is disabled with the note "Save it as a fixture first", and the Replay popover's two rows are off with the same note.

### 3. The note when the message box cannot send

Re-run is off whenever the message box cannot send, and its note is the box's reason without "Can't send · ", capitalised: "The agent is starting", "Waiting for the agent's card", "The agent is restarting", "The agent is down", "The agent's card lists no interface to reach it at", and so for the box's other lines. The one line of the box's that does not start with "Can't send · " is shown whole. The Replay popover's rows take the same note.

### 4. The notes' order

On Re-run and on the Replay popover's rows alike, the first that applies shows:

1. "Not connected to Spectra"
2. "Save it as a fixture first"
3. The box's reason
4. "A replay is running"
5. "A turn is open"

### 5. Not connected to Spectra

While the page is not connected to Spectra, Restart, Re-run and the Replay popover's rows are disabled. Restart's tooltip reads "Restart the agent · not connected to Spectra". Logs still opens and closes the drawer, which keeps what it held and takes what the logs route gives once the stream is open again.

### 6. The live status's order

Not connected; then the agent's state when it is down, restarting, starting or waiting; then replaying; then capturing.

### 7. The composer's refusal

One form for every reason the box cannot send, under `run` and `attach` alike: the line above the field carries the box's reason, the field stays disabled with its text kept, and the paragraph that stood in the field's place is gone. A reason too long for the line wraps onto a second line. The unset header variable keeps its own form. When several apply, the line shows the box's reason first, then the replay, then the open turn.

### 8. Restart's tooltip

| When | Tooltip |
| --- | --- |
| Nothing open, no replay | Restart the agent |
| One turn open, no replay | Restart the agent · ends the open turn |
| Several turns open, no replay | Restart the agent · ends the 2 open turns |
| A replay with turns still to send | Restart the agent · stops the replay, 1 turn not sent |
| A replay on its last turn | Restart the agent · stops the replay |

The count of turns not sent is the replay's total less the number of the turn it is on, so before its first turn opens it is every turn. While the page is connected, Restart is disabled in the restarting state alone and enabled during every card wait, as the sub-task 8.2 spec's decision on what a Restart press does in each state has it.

### 9. The drawer's open state

Whether the drawer is open is remembered in the browser, as the turn list's collapse is. Under `attach`, where there is no drawer, the remembered choice shows nothing and is kept for the next `run`.

### 10. The drawer draws the buffer as it stands

Every divider the buffer holds is drawn, the session's first started divider included. "No output yet." shows under the dividers for as long as no output line is held.

### 11. The turn markers

- **Which turns.** Every listed turn, whatever agent the turn list is showing, replayed and re-run turns included. A marker is drawn only when its moment is not earlier than the oldest entry the buffer holds: turns from earlier runs get none, and a turn whose opening has left the buffer keeps its closed marker alone.
- **When.** The opened marker sits at the turn's start, the closed marker at its start plus its duration. An open turn has its opened marker alone until it closes.
- **Ties.** Among entries of the same millisecond, an opened marker comes before them and a closed marker after them.
- **Naming.** The opened marker names the turn as the turn list does: its input in brief, `Action “submit_booking”` for an action, "A turn" when it has none. The closed marker gives the outcome in the header's words, lower-case, and the duration as the turn list formats it.
- **The link.** It selects the turn in Turns, from either section, and leaves the drawer open.

### 12. A line that holds carriage returns

The drawer shows the text after the line's last carriage return, what a terminal would leave. The first screen's lines follow the same rule.

### 13. Where the turn list's divider sits

A divider sits directly above the first turn, reading down the list, that started before its restart, so every turn above a divider ran after that restart. A restart with no earlier turn in the list sits at the list's bottom, and several dividers keep their order by time.

### 14. A run of saves

Restarts caused by a save, with no turn and no other event between them, draw as one row naming the count and the latest file, such as "Restarted 6 times · prompt_builder.py changed last", its wording settled on the canvas. A press and a death always keep their own row. The strip draws one rule for the row.

### 15. When the dividers are not drawn

- With text in the search, no divider is drawn.
- Dividers are drawn when the list shows the connected agent or every agent, and not when it shows another agent.
- With no turn row, no divider is drawn, and the list reads "No turns yet." alone.
- A divider above turns from earlier runs only, with no turn of this run yet, is drawn.

### 16. The first screen's forms

- Three forms under `run`, chosen by the agent's state alone: ready, as today, while the agent is running; not ready, the starting board's form, in the starting, waiting and restarting states, the live status reading as the context bar's does; down, the down board's form.
- The heading is the latest card's name once any card has answered, and the command in monospace until then, in every form.
- The down form's lines are the output lines written since the latest start, the last twelve of them, dividers not counted.
- With no such line, as when the command could not start, the block is left out, and the status, "Open Logs" and Restart stand alone.

### 17. A re-run turn's model call

A re-run turn's model call takes the source's calls of the same model as candidates for its prefix break beside its own conversation's, by the rule the sub-task 7.5 spec, `_dev/docs/spec/task-7.5-viewer.md`, set for a live call in a live-mode replay. The conversation's first call then reads "Prefix breaks in the system prompt · against the recorded call at +2.0 s in “Book a table for 2 at the first one tonight at 7pm”", linking to the source as that form does. It carries no grey sentence.

### 18. The canvas's amendments

Drawn before the build, on the canvas "Spectra viewer UI":

| Where | What |
| --- | --- |
| "Components and states" | The refusal popover under Re-run and under Restart |
| "Components and states" | Re-run's notes as the box's reason, with "Not connected to Spectra" first; the Replay popover's rows with the same notes and "Save it as a fixture first" |
| "Components and states" | The composer's long refusal wrapped onto a second line |
| "Components and states" | The row for a run of saves, and its rule in the strip |
| "Components and states" | Restart's two new tooltips and its not-connected form |
| "Components and states" | The first screen's down form with no output block |
| The drawer boards whose top is in view | The first "Started · uv run ." divider |
| The detail board "A re-run turn" | Its first model call with the prefix break against the source |
| Flow 8's first board | Restart drawn enabled during the card wait |

### 19. The tests, the browser cases and the hand pass

- Unit tests on the rules of this spec, from the notes' order to the divider's placement, and a test on the tool's side for the listing's mark.
- In the viewer's own browser test, in Chromium, on the fake agent under `run`: Flow 8 walked, a save, the restart in the live status, the drawer and the turn list, a re-run, the new turn with the changed surface; a crash, with the down forms and Restart; a refused press.
- One hand pass through the tunnel on the binary with the fake agent: every Phase 8 board set against the canvas in light and dark, at 1,200 × 760 and on the small window.

The three samples wait for sub-task 8.7.

### 20. The documents

- The viewer's README: everything this sub-task builds.
- The tool's README: the turn listing's mark for a turn whose record was not written; the Replay section's sentence on the viewer's Re-run button, which the sub-task 8.4 spec left to this sub-task.
- The Phase 8 spec, amended in place: its decision on the logs drawer takes decisions 9 to 12 and the first screen's lines of decision 16; its decision on the turn list marking where the agent restarted takes decisions 13 to 15; its decision on where re-run sits takes decisions 1 to 5 and 17.
- The sub-task 8.1 spec, amended in place: its decision on the Restart and Logs controls takes decisions 1, 5 and 8; its decision on the live status's forms takes decision 6; its decisions on the logs drawer and on the drawer's dividers and markers take decisions 9 to 12; its decision on the turn list's restart divider takes decisions 13 to 15; its decision on Re-run in the header takes decisions 1 to 5; its decision on the first screen takes decision 16; its decision on the composer takes decision 7; its detail board of a re-run turn takes decision 17.
- The Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, the sub-task 7.1 spec, `_dev/docs/spec/task-7.1-design-artifact.md`, and the sub-task 7.5 spec, amended in place: the Replay popover's rows taking the notes of decisions 2 to 5, and the live call's comparison reaching a re-run.
- `_dev/TODO.md`: the 8.6 line names this spec.
- `SPEC.md`, the turn record and the config schema: no change.

## Invariants

- The build follows the canvas; a form the canvas lacks is drawn before it is built.
- The server is the authority on a refusal: the viewer's disabled states mirror its rules, and its answer is shown as it is.
- A reason the box cannot send for is the server's line wherever the viewer shows it, on the composer and in the notes.
- Every turn above a restart divider ran after that restart.
