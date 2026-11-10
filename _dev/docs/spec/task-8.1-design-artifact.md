# Sub-task 8.1 — The design artifact

Phase 8's boards on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which the later sub-tasks follow. Sub-task 8.1 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, whose decision 13 names the boards.

## Scope

- The boards decision 13 of the Phase 8 spec names: the context bar with Restart and Logs and the live status's forms, starting, waiting for the card, running, restarting, and down with its exit line; the logs drawer with its lines, restart dividers and turn markers; the turn list's restart divider; Re-run in the header with its disabled notes and the re-run turn's header line; the preview pane's reloading and stopped-answering states; the agent popover's catalog line after a failed read.
- The first screen while the agent is starting and while it is down, and the composer's refusals while the agent cannot be sent to.
- Flow 8, edit, save, restart, re-run, see.
- Dark twins and one small-window board at 1,200 × 760.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the boards go

The canvas has three pages, "Screens and foundations", "Flows" and "Turn view details"; "Components and states" and "Icons" are boards on the Foundations row of "Screens and foundations". "Turn view details" gains a row, "The dev loop", with the detail boards of decision 14. Flow 8 is a new row on the Flows page. The Screens row of "Screens and foundations" gains a pair, the viewer with the logs drawer open, light and dark. The States row gains the context bar in its live status forms, as two boards, the agent restarting and the agent down, the waiting form being on Flow 8's first board and the first screen's starting board; and the first screen's two boards of decision 12. The "Components and states" board gains the Restart and Logs controls, the live status's forms, the drawer's line forms, the two dividers, Re-run's forms and the composer's refusals. The "Icons" board gains Restart, Logs and Re-run. One small-window board, 1,200 × 760 in light, draws the viewer with the drawer open.

### 2. What the boards draw

| Board | Drawn from |
| --- | --- |
| The drawer, the Screens pair, the small window, the context bar's forms, the turn list's dividers, Re-run, the first screen's forms, Flow 8 | The Python restaurant finder's two-turn conversation, list then booking, under `run`: uvicorn's and ADK's startup lines on stderr, a restart divider after a save of its agent file, the turn markers of its two turns |
| A crash after a save | The same, the exit line "exited with code 1" after a save that left a Python traceback in the logs |
| The preview pane reloading and stopped answering | The custom-components example, its page served by its dev server: the contact card, in the basic catalog, held while the page reloads; the floor plan of the `view_location` press, in the example's `inline_catalog`, which only that page claims, when it stops answering |
| The agent popover's failed catalog read | The custom-components example, its `inline_catalog_0.9.json` broken by an edit |

Illustrative values, the log lines' text, the times and the file names, are settled on the canvas. The finder is launched in its folder as `uv run .`, its README's command, and the saved file is `prompt_builder.py`, whose booking line the edit extends to title the form "Reserve a table at <restaurant name>". The terminal's words are the binary's: a stop under `uv run` reads "exited with code 143", the card wait's reason "connection refused", a command that cannot start "could not start: Executable not found in $PATH: "uv"", and the catalog reader's error "JSON Parse error: Property name must be a string literal".

### 3. Flow 8, edit, save, restart, re-run, see

Four boards. The crash is not in the flow; it is a detail board.

1. "Save the agent file: Spectra restarts the agent, and the logs name the file." The context bar's live status in its waiting form, the restart still under way, the drawer open with the restart dividers naming `prompt_builder.py` and uvicorn's first startup lines after them.
2. "The card answers: capturing again, Re-run enabled, the turn list marking where the agent restarted." The live status back to running, the turn list's divider naming the changed file, the booking turn in view with Re-run in its header.
3. "Re-run the last turn: the conversation is sent again, every call live, and lands as new turns." The re-run turn open, its header line reading as a re-run of its source, the live status in the replaying form, "Replaying “Book a table for 2 at the first one tonight at 7pm” · turn 2 of 2", and the composer refusing while it runs, "Can't send · a replay is running".
4. "See: the new reply, drawn from the edited prompt." The re-run turn closed, its preview with the changed surface, the form's new title, the edited line visible in the model call's request.

### 4. The Restart and Logs controls

Two quiet buttons, icon and label, in the form the turn header's actions take, Restart left of Logs at the context bar's right end after the proxy's address, drawn only under `run`; under `attach` the bar ends with the wire proxy's address as today. Logs toggles the drawer and shows a pressed state while it is open; no count on it. Restart's tooltip says what the press will end: "Restart the agent" normally, "Restart the agent · ends the open turn" while a turn is open, "Restart the agent · stops the replay, 1 turn not sent" while a replay runs, the count the remaining turns; the button is otherwise unchanged and there is no confirmation. While a restart runs, Restart is disabled with its label kept and no spinner of its own, the live status carrying the spinner. While the agent is down Restart stays enabled. Both are reached by Tab.

### 5. The live status's forms

Running stays "Capturing", unchanged. Two spinner forms, in the colour the replaying form uses: "Starting the agent" from the launch until the first card attempt, then "Waiting for the agent's card · connection refused", the reason the terminal's own, the full terminal line as the tooltip when the reason is cut. "Restarting the agent" with the spinner during the cut and the stop, then the waiting form during the card wait, so a restart walks the status through restarting, waiting, capturing. Down takes the red dot: "Agent down · exited with code 1 · Logs", the exit line the terminal's words after "The agent's process", and "Logs" a teal link that opens the drawer; the other two exit lines read "was ended by SIGTERM" and "could not start: Executable not found in $PATH: "uv"", cut with the full line as the tooltip. A card that fails the transport check leaves the status at "Capturing", the check's line being the composer's refusal, "Can't send · the agent's card lists no interface to reach it at", in the form the replay refusal takes. "Not connected to Spectra · reconnecting" outranks every form.

### 6. The logs drawer

The drawer rises from the bottom of the page over the panels and the composer, under the context bar, a third of the window tall by default, its top edge a draggable divider remembered in the browser like the others. Its header: "Logs" in the panel label style, the agent's command after it in grey monospace, "uv run .", a muted line count, "412 lines · 1,000 kept", and a close button at the right; Logs in the bar closes it too. Lines in 12 px monospace, one per line: the time first in muted grey as "18:36:26.412", then a two-letter stream tag in muted grey, "out" or "err", then the text; no colour by stream. ANSI escape codes are stripped for display, the buffer keeping them as written for the terminal echo. When the reader scrolls up, a "Jump to latest" button appears at the drawer's bottom edge in the form the live turn uses, and following resumes on press or at the bottom. Empty, it reads "No output yet."

### 7. The drawer's restart dividers and turn markers

Restart dividers are full-width rules with text, in the divider style the turn list shares: "Stopped · prompt_builder.py changed · exited with code 143" and "Started · uv run ."; a press's stop divider names "Restart pressed"; a crash's stop divider reads "Stopped · exited with code 1" with no cause. Turn markers are quieter, dashed rules: "Turn opened · Book a table for 2 at the first one tonight at 7pm", the input a teal link to the turn, and "Turn closed · completed · 9.9 s".

### 8. The turn list's restart divider

A slim full-width rule row with centred muted 12 px text, the divider style the drawer's restart dividers use. One row per event, by time: a save reads "Restarted · prompt_builder.py changed", a press "Restarted · Restart pressed", and a death "Agent exited with code 1", the exit line as the status shows it; a death followed by a press is two rows. The row sits where time puts it, between two groups or between two turn rows inside a group; inside a collapsed group it is not shown. The strip shows each divider as a thin rule between its icons, with the wording as the tooltip. Under "All agents" in the picker the dividers stay. Nothing is drawn under `attach`.

### 9. Re-run in the header

Re-run sits between Save as fixture and Replay, a 28 px bordered button with its own icon, labelled "Re-run live", its tooltip "Sends the conversation again up to this turn · every model and tool call goes live". In the fixture view, where Save as fixture is absent, the header reads Re-run live then Replay. Disabled, it keeps its label in muted text and its tooltip carries the note under its first line: "A replay is running", "A turn is open", "Save it as a fixture first" for a turn held in memory only, "The agent is down" and "The agent is restarting". A press starts the re-run and the viewer follows the new turns as it follows a replay, the live status and the composer in the replay's forms.

### 10. The re-run turn's header

The third line reads "Re-run of find-italian-restaurants.json · turn 2 of 2 · live", the source a teal link into Fixtures, or "Re-run of “Book a table for 2 at the first one tonight at 7pm” · turn 2 of 2 · live" for a store-turn source, linking into Turns, with no verdict and no colour; a source gone keeps the replayed line's plain-text rule. The second line counts every call as live, with a price, and no "from the record".

### 11. The preview pane reloading, and stopped answering

Reloading: the surface stays drawn as it was, and the Preview header's quiet note reads "http://localhost:5174/spectra-preview · reloading" with the open spinner before it in the note's muted grey, nothing over the frame; a page whose ready arrives within the five seconds returns the note to the URL alone, the surface redrawn in place. Stopped answering: the existing no-preview state unchanged, "No preview for catalog" with the id, the adapter hint and the line "http://localhost:5174/spectra-preview has not answered"; no new wording. The header's note reads the configured page's URL on these boards.

### 12. The first screen while the agent is starting or down

Two boards on the States row, "First screen: the agent starting" and "First screen: the agent down before its card answered". Until a card has answered, the heading and the context bar's name button read the agent's command in monospace, "uv run .", the popover holding Address and Mode alone; after a restart they keep the last card's name while waiting. Starting: the mark, the command, the live status in its waiting form, the muted line "The message box opens when the agent's card answers.", no example prompts, the proxy line staying, the composer disabled. Down: the red dot with "Agent down · exited with code 1", then the last twelve lines of output in a tinted monospace block in the form the `attach` variables block takes, with the times and stream tags the drawer uses, "Open Logs" as a teal link under it, and a Restart button beside the link as the screen's main action, the same action as the context bar's.

### 13. The composer while the agent cannot be sent to

Four lines in the replay refusal's form: "Can't send · the agent is starting", "Can't send · waiting for the agent's card", "Can't send · the agent is restarting" and "Can't send · the agent is down". No link and no Restart in the composer. Typed text stays in the disabled box and is sendable again when the card answers; a pending action stays with Send grey and Discard live. The placeholder keeps the agent's name, or the command before any card answered. The four lines join the composer's states on the "Components and states" board, and the down form is drawn in place on the boards where the agent is down.

### 14. The agent popover's catalog line after a failed read

Under the catalog's name on its Catalog row, two muted lines in grey with the grey failed icon: "./inline_catalog_0.9.json did not read at 14:58:31 · checking against the definition read at 14:50:12", the file's path as the config names it, then the reader's own error in monospace, "JSON Parse error: Property name must be a string literal". The lines go when a later read succeeds. A configured file whose id the card does not advertise gets a Catalog row of its own while its read stands failed. Nothing shows outside the popover.

### 15. The detail row's boards

Eight boards on the row "The dev loop", light:

1. "The logs drawer: the agent's lines, a restart after a save, and the turns marked in them."
2. "A crash after a save: the agent down with its exit line, the traceback in the logs, and Re-run refusing." The composer's down refusal, under the drawer here, is drawn on the States row's board of the agent down, with typed text kept.
3. "The turn list's restart dividers: a save, a press, and the agent's exit."
4. "Re-run live in a store turn's header and in the fixture view's." One board, the two headers one above the other, each with Re-run's tooltip.
5. "A re-run turn: its third line, every call live."
6. "The preview page reloading: the surface held."
7. "The preview page stopped answering."
8. "The agent popover: a catalog file that did not read, the last good definition in force."

Restart's tooltip with a turn open and with a replay running, and Re-run's five disabled notes, are forms on the "Components and states" board.

### 16. Dark twins, icons and keys

Dark twins: the Screens pair, the viewer with the drawer open, and the crash after a save. The small window is light only. Icons: Restart, a circular arrow distinct from Replay's; Logs, a terminal prompt; Re-run, Replay's shape with a live dot; the dividers and the stream tags carry no icon. No new step icon. No new keys, Escape included: the drawer closes by its close button or by Logs, and the list of keys is unchanged.

### 17. What other sub-tasks and documents take from this

- Sub-task 8.2: the API and the stream carry the agent's command as launched; the process's state as starting, waiting with the wait's reason, running, restarting, or down with the exit line in the terminal's words; and each restart event with its time and its cause, the changed file's path, the press, or the exit. What a press will end is worked out by the viewer from the open turns and the replay progress it already holds.
- Sub-task 8.3: each line carries its arrival time to the millisecond, its stream and its text as written, the viewer stripping the ANSI codes; the stop and start dividers carry the cause, the exit line and the command; the route gives the count held and the cap.
- Sub-task 8.4: the refusals reach the viewer with the reasons the five notes need.
- Sub-task 8.5: the catalog listing carries, per configured file, its path as the config names it, the time of the definition in force, and for a failed read its time and the reader's error, a file whose id the card does not advertise included.
- Sub-task 8.6: done when the artifact's Flow 8 row works in the viewer.
- The Phase 8 spec, amended in place: decision 1 gains the command standing for the name until a card answers; decision 5 gains the first screen's last twelve lines with "Open Logs" and Restart; decision 12 gains the Catalog row for a file the card does not advertise; decision 13 gains the first screen's two boards, the composer's four refusals, the Screens pair and the crash board.
- The Phase 3 spec, amended in place: decision 3, the frame, has Restart and Logs after the proxy's address under `run` only; decision 16, the first screen, gains the starting and down forms.
- `_dev/TODO.md`: the 8.1 line names this spec.
