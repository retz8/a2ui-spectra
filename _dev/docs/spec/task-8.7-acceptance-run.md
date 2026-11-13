# Task 8.7 — The acceptance run

Spec for sub-task 8.7 of Phase 8 — The dev loop (`_dev/docs/spec/phase-8-the-dev-loop.md`), carrying out its decision on the acceptance run: the real binary, through the tunnel, on the three samples at the pin `9e8a9bac5`, the Python restaurant finder, the Node restaurant finder and the custom-components example; the loop on each, edit, save, restart, re-run, see; a crash at launch and after a save, with the logs; the preview reload on the React, Lit and Angular sample pages; a catalog definition change; every Phase 8 board in light and dark; the documents; what the run finds is fixed within the sub-task. It also takes the first-launch check the sub-task 8.3 spec, `_dev/docs/spec/task-8.3-logs-and-save-watcher.md`, left to it, and the hand check through the tunnel the sub-task 8.5 spec, `_dev/docs/spec/task-8.5-the-catalogs-loop.md`, left to it.

## Scope

- The sessions: which target runs under which entry point, in which order, and what each is for.
- Where Spectra is launched from, the store, the config files and the fixtures folders.
- The tunnel's ports.
- The loop on each sample: the turns sent, the file edited, the re-run, and what "see" is judged on.
- The crashes and how each is recovered from.
- The restart's edges and Re-run's forms beyond the loop.
- The preview reload on the three sample pages and the stopped-answering state.
- The catalog definition change.
- The wrapper, the earlier flows, the boards, the keyboard, dark and the window sizes.
- The terminal and the headless command.
- What counts as a finding, and where each finding goes.
- The documents, what is left behind, and the done line.

## Locked decisions

### 1. The sessions

Every upstream target runs from the `a2ui-upstream` worktree at `9e8a9bac5`. Five sessions, in order:

| # | Target | Entry point | What it is for |
| --- | --- | --- | --- |
| 1 | The Python restaurant finder | `run` | Flow 8 as the canvas draws it; the drawer, the dividers, the turn markers; the crash at launch, the crash after a save, the command that cannot start, the kill from outside; the first screen's forms; the first-launch check; five of the restart's edges; the fixture re-run; Flow 7; the keyboard; the small window; the terminal with its streams apart; the headless `test` |
| 2 | The Node restaurant finder | `run` | the loop on a TypeScript agent with a build step; the build failure after a save; a save during a card wait; Flows 1 to 5 |
| 3 | The custom-components example with its floor plan server | `run` | the loop on the third sample, its re-run a host app's turn; the catalog file's broken read and its fix; a save of the config file |
| 4 | The stub agent's canned conversation in the sample catalog | `attach` | the preview reload on the React, Lit and Angular sample pages in turn; the stopped-answering state; the definition's effect on the checks and the `catalogId` change; what `attach` does not draw; a re-run under `attach` |
| 5 | The Python restaurant finder under `opentelemetry-instrument` | `run` | the wrapper start: a turn and its re-run carrying the A2UI step; the long command cut; the remembered drawer after `attach`; the cross-agent rules on the full store |

The React, Lit and Angular sample pages are this repo's `samples/preview/` apps, which implement Spectra's sample catalog; the stub agent's canned conversation is what draws a surface in that catalog.

### 2. Where Spectra is launched from, and the store

Each `run` session starts Spectra in the sample's own folder, with the sample's README's command and the default watch: `uv run .` for the Python restaurant finder and for the custom-components example. The store, `.a2ui-spectra/`, lands in that folder and is moved by hand from one session's folder to the next before each session, so each later session shows the earlier sessions' turns. Session 4 is launched from the run's own folder, a folder outside this repo and the worktree, and the run starts from an empty store.

### 3. The Node restaurant finder's command

`yarn start` in the sample's folder: a save of a `src/*.ts` file restarts the agent, the build runs again, and the new code runs, the card wait covering the build.

### 4. The config files and the fixtures folders

- Sessions 1, 2 and 5: no config file. The fixtures folder is the default, `a2ui-spectra-fixtures/` in the sample's folder, absent at launch.
- Session 3: an `a2ui-spectra.json` in the example's folder, naming `./inline_catalog_0.9.json` and the floor plan server as a tool server.
- Session 4: one config copy per sample page in the run's folder, naming the page by its tunnel URL and a copy of the sample catalog in the run's folder. The samples' committed config files and `samples/preview/catalog.json` are unchanged.

### 5. The first-launch check

On session 1, under the binary on macOS, with the fixtures folder absent at launch: a source save restarts the agent; Save as fixture creates the folder and the fixture lists; a source save straight after still restarts the agent; a `.json` dropped into the folder by hand lists.

### 6. The tunnel's ports

Two borrowed ports. 5173 carries Spectra's viewer in every session, once Jioh confirms A2UIVerse's client is idle on it. A second port, named by Jioh when the run starts, once its A2UIVerse server is idle, is used in session 4 only: each sample app's dev server is started on it in turn, React, then Lit, then Angular, Spectra restarted between them with that page's config copy. The apps' fixed ports stay as committed.

### 7. The model and the turns sent

`gemini-3.6-flash` on the three upstream targets, the samples' default at the pin, the key from the Linear agent's `.env` passed to the agent's process and never printed or written. Each turn is the sample's own or one an earlier run used:

- The Python restaurant finder: "Top 3 Chinese restaurants in New York", then Book pressed in the preview.
- The Node restaurant finder: the card's example, "Find me the top 10 chinese restaurants in the US", then Book pressed.
- The custom-components example: "Who is Alex Jordan?", then the `view_location` press on Alex Jordan as a second host, the hand-made A2A request carrying the `userAction` part, as the sub-task 7.7 spec's decision on the floor plan press has it.

### 8. The loop on each `run` session

| Session | The save | Re-run |
| --- | --- | --- |
| The Python restaurant finder | `prompt_builder.py`, the board's edit to `UI_DESCRIPTION`'s booking line, the form titled "Reserve a table at <restaurant name>" | the booking turn, both turns sent again |
| The Node restaurant finder | its prompt source under `src/`, the same instruction in its own wording | the booking turn |
| The custom-components example | its `prompt_builder.py`, one instruction with a visible effect on the contact card | the press turn, a host app's conversation, the floor plan read live from the tool server |

The wording of the Node restaurant finder's and the example's edits is chosen at the run and recorded in this spec after it.

"See" is judged in two parts. It must hold that the edited line is in the re-run turn's model request and that its first model call's prefix break against the source's call lands on that line. The surface changing as the edit asks is expected, and content when it differs.

### 9. The crashes

1. **At launch, the Python restaurant finder.** Spectra's first start of session 1 has a syntax error already saved in `prompt_builder.py`: the first screen's down form, the command as the heading, the traceback's last twelve lines, Open Logs and Restart. Restart is pressed once and the agent goes down again. The file is fixed by a save: the agent starts with no press, the card answers, and the heading becomes the card's name.
2. **After a save, the Python restaurant finder.** After the loop, the same syntax error is saved: the crash board's forms, the live status's down form with its exit line, the traceback in the drawer under the stop divider, the turn list's divider, Re-run's note, and the composer's refusal with typed text kept. Fixed by a save.
3. **After a save, the Node restaurant finder.** A type error saved in a `src/*.ts` file, the build failing and the agent never starting: the build's error lines in the drawer and the exit line as the binary words it. Fixed by a save.
4. **A command that cannot start.** One extra start of session 1 with the command misspelled: the could-not-start exit line and the down form with no output block.
5. **A kill from outside.** The Python restaurant finder's process killed by hand mid-session, then Restart pressed: the exit line of a process ended by a signal, and a death followed by a press as two rows in the turn list.

### 10. The restart's edges

Each once:

- A restart while a turn is open: Restart pressed while the New York question is streaming, session 1.
- A restart while a replay runs: a save while a replay of the saved fixture is on its first turn, session 1.
- A save during a card wait: a second save while the build of the first is under way, session 2.
- A run of saves with no turn between: three quick saves, session 1, the one row and the strip's one rule.
- The page not connected to Spectra: Spectra stopped by Ctrl-C with the page open, then started again, session 1. In the terminal, the agent's process is gone with Spectra and Spectra's exit code is its own.
- A viewer opened later: a second tab at the end of session 1, the log buffer and the restart events as they stand.

### 11. Re-run's forms beyond the loop

Checked live:

- A fixture turn re-run from the fixture view, session 1, its third line naming the fixture and linking into Fixtures.
- The re-run conversation continued from the composer.
- Re-run's disabled notes, each seen when its state comes up: "A turn is open", "A replay is running", the box's reasons during the restarts and the crashes, "Not connected to Spectra"; the Replay popover's two rows carrying the same note each time.
- A re-run under `attach`: the stub agent's turn, session 4.
- A re-run whose source has gone: the fixture file removed after its re-run, the third line falling to plain text.

Not checked live, named in the done commit: the note "Save it as a fixture first", and the refusal popover under Re-run and under Restart.

### 12. The preview reload

On each of the three sample pages, while the stub's surface is drawn, the slider's source is edited with one visible change and saved, and the dev server does what it does. On a page that loads a new document: the Preview header's reloading note when the reload lasts 200 ms, the surface drawn again with the change, the note back to the URL alone. On a page that swaps the module in place, as the React page is expected to: the change in place with no note, then a second edit, to `src/main.tsx` on the React page, that forces a full page load, so the pairing of load and ready is seen through all three adapters. This spec records what each dev server did.

On the Lit page, the dev server is stopped and the frame reloaded by hand: the reloading note, then "No preview for catalog" with the line that the page has not answered, then the surface again once the server is started.

The two preview boards are judged on design, the stub's surface standing for the contact card and the floor plan.

### 13. The catalog definition change

- **Session 3, under `run`.** The example's `inline_catalog_0.9.json`, edited in place. One save breaks the JSON: the two failed-read lines in the agent popover, the last good definition in force, the error in the terminal, and the agent restarted with the file named in the drawer and the turn list. A second save fixes it and the lines go.
- **Session 4, under `attach`.** The copy of the sample catalog in the run's folder. One save adds a required property to `CustomSlider`: the next canned turn gains the catalog finding, the earlier turn keeps its check events as written, and the turn list's rejection count and Structure follow the new definition for both. A second save changes the `catalogId` and the message box's offer follows. Neither save causes a restart or a divider.

On session 3, one save of the `a2ui-spectra.json` Spectra read: nothing restarts, and the terminal says to stop and start Spectra.

### 14. What `attach` does not draw

On session 4, the drawer having been left open at the end of session 3: the context bar ends with the wire proxy's address, no Restart and no Logs; no drawer; no restart divider. The stub agent is stopped once by hand: the send goes out and the turn is captured as failed, the composer giving no refusal.

### 15. The wrapper start

The wrapper is off in sessions 1 to 4, each sample launched with its README's command alone. Session 5 launches the Python restaurant finder under `opentelemetry-instrument` with the sub-task 6.6 spec's recipe and no source edit, and sends one turn and one re-run of it: the re-run turn carrying its parse rows, the long command cut in the context bar and in the composer's placeholder, and the retried turn's `Failed to detach context` lines of A2UI finding 46 in the drawer.

On the same session, the store holding every session's turns: the drawer open from the remembered choice; the turn list's agent filter switched to another agent and to every agent, the dividers going and returning; no turn marker for the earlier sessions' turns.

### 16. The earlier flows

Flows 1 to 5 walked once on session 2's conversation, each judged for whether the flow still works and not board by board. Flow 7 once on session 1, on the fixture the first-launch check saves, replayed with everything recorded and passed. Flow 6 on session 5 when its turn retries, else named in the done commit as not walked. Flow 8 on sessions 1, 2 and 3.

### 17. The boards

Every board Phase 8 added, as the sub-task 8.1 spec's decision on where the boards go places them: the row "The dev loop" of "Turn view details", Flow 8's four boards, the Screens pair with the drawer open, the States row's context bar restarting and down and the first screen's two boards, the additions to "Components and states" and to "Icons", the small-window board, and the two dark twins. Each is checked on the session that produces it. A form no session produces is named in the done commit.

### 18. The keyboard

Flow 8 once by the keyboard alone, in light at full width, on session 1 after its pass with the mouse: Logs reached by Tab and opened by Enter, the opened marker's link followed to the turn, Re-run live reached by Tab and pressed by Enter, Restart reached and pressed the same way, and, on the down form, the first screen's Restart reached by Tab. A step that cannot be done without the mouse is a finding, fixed with no new key.

### 19. Dark

Sub-task 3.7's rule: in dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light. The two dark twins, the Screens pair and the crash after a save, are checked board by board. Every session is seen in both themes.

### 20. The window sizes

The viewer with the drawer open at 1,200 × 760 in a same-origin frame, against the small-window board; the drawer's top edge dragged and its height remembered after a page reload; the context bar narrowed until the command is cut, on session 5's command.

### 21. The terminal and the headless command

Each of Spectra's Phase 8 lines is read in the terminal on the session that produces it: the start line about saves, the restart lines with their file, the exit reports and the card wait on session 1; the catalog lines and the config-file line on session 3.

Once, on session 1, Spectra is started with its two streams redirected apart: after a turn and a restart, the agent's stdout lines are on stdout and its stderr lines on stderr, as the agent wrote them, and Spectra's own lines carry their prefix.

Once, after session 1's viewer part, `a2ui-spectra test` in its `--` form on the session's fixtures folder: passed, exit 0, stdout holding the result lines alone, and a source file saved while it runs restarting nothing.

### 22. What counts as a finding

The sub-task 7.7 spec's rules, unchanged where they apply: any difference of design between the viewer and a board is a finding, fixed in the viewer or, where the board is wrong, amended on the design canvas; a difference of content between a real agent's turn and a board's is not a finding, nor is a feature of a later phase; a route of the run that does not work is a finding; a fault in a sample or in upstream's SDK goes to `_dev/a2ui-findings.md` and is not fixed here; a fault in an OpenTelemetry producer goes to `_dev/otel-findings.md`.

Phase 8's destinations join them:

- The restart failing on a real process tree, a child surviving the stop or the port still held at the next start, is fixed in the agent's process handling, with a command-line case on the fake agent shaped like the failure.
- A real line the buffer or the drawer mishandles is fixed with a unit test on the bytes seen.
- A catalog re-read or a terminal line that is wrong is fixed with the command-line test.
- A file a sample writes beside its source that restarts the agent again and again: the default ignore list gains an entry only when a named reloader ignores that file, the entry carrying that source. Otherwise the default stays, the session takes a `watch` exclusion in a config file, the README's restart-on-save section gains the sample's case as its example, and this spec records it.
- The pairing of load and ready misreading a sample page: a misread that also happens on the home machine without the tunnel is fixed in the pairing with a unit test. A misread from the tunnel's delay alone is content, recorded in this spec with the timings seen and added to the backlog item of the preview page saying which document it is; the windows stay as they are.

### 23. The documents

- This spec gains, after the run, what the run fixed, the design canvas's amendments, the findings recorded, the sessions with their trace ids, what each dev server did on a save, the wording of the prompt edits, and what was content and not a finding.
- The Phase 8 spec's decision on the documents is read against the documents once, and SPEC.md's "The dev loop" features and its "Browser, terminal, editor" section are read against what was built; anything owed is written.
- `_dev/TODO.md`: the 8.7 line names this spec and gains its done line at the tick.
- The READMEs, the canvas, `_dev/a2ui-findings.md` and `_dev/otel-findings.md` change only where a fix or a finding touches them.

### 24. What is left behind

`a2ui-upstream` is left at `9e8a9bac5` with every edit reverted, the three prompt sources, the example's catalog file and the saved errors; its untracked store, fixtures folders and config file are moved to the run's folder or removed; the wrappers' installs stay in place. This repo's `samples/preview/` is left with every edit reverted. The run's folder holds the store, the configs and the fixtures.

### 25. Done when

- Every session of decision 1 has been through its part; every Phase 8 board is seen in light and dark, apart from the forms named as not producible; the flows are walked as decision 16 has them, Flow 8 by the mouse and by the keyboard.
- Every finding has gone where decision 22 sends it.
- The unit tests, the turn record validator, the capture and replay suites, and every end-to-end test pass after the fixes, under Node and against the binary, locally and in CI.
- This spec carries decision 23's first item.
- The done commit names the forms not checked live, the worktree's ref `9e8a9bac5` with the installed versions, and the model.

## Invariants

- No sample's code changes for the run beyond the edits this spec lists, each reverted after it.
- No credential is printed, written into a record, a fixture, a config or a commit.

### 26. What the run fixed

- A replay stopped by the end of the agent's process keeps the model proxy and the tool proxy answering from its record until that process has stopped; they had been disarmed at the cut. On session 1 a save restarted the Python restaurant finder during the first turn of a replay with everything recorded, and a model call the finder made on its way out, ADK's run going on after the cut, went to the provider, unrecorded, under the terminal's line "was not placed in a turn: no turn is open". The fake agent gains `--model-call-on-stop`, and the command-line test a case on it; the message box's unit test pins the rule. The Phase 8 spec's decision on a restart while a turn is open or a replay runs and the tool's README follow.
- The turn listing counts a listed turn's rejections again once a catalog definition was read again; its cache had followed the store's file alone. On session 4, after `CustomSlider` gained a required property, the earlier canned turn's header read "1 problem" and its row in the turn list none. The catalog registry counts its replaced definitions, and the command-line test gains the case.
- A recorded call of a store-turn source is named by the turn that holds the call, in a prefix break against the record and in a served call's sentence; it had been named by the turn the replayed turn stands for. On sessions 1 and 2 the first call of a re-run conversation read "against the recorded call at +57 ms in “Top 3 Chinese restaurants in New York”", the call at +57 ms being the booking turn's; it reads "in Action “book_restaurant”". A unit test pins the shape. The sub-task 7.5 spec's decision on where the provenance links point and the viewer's README follow.
- Under `run` the viewer reads the agent's process with the session, the two entering the page in one change, and the live status reads "Connecting" until the session has been read; the agent's route had been asked once the session was on screen. Through the tunnel the viewer's first seconds under `run` read "The agent" and "Capturing" with no Restart and no Logs. Unit tests pin what the route's answer makes of the agent held and the live status before the session. The viewer's README follows.

### 27. The design canvas

No amendment. Each Phase 8 board was opened on the canvas in its play view, at version `1794480982-eff9`, and the viewer held beside it through the tunnel:

- On the Python restaurant finder under `run`: the four boards of Flow 8; the viewer with the logs drawer open, in light and dark; the logs drawer's detail board; the crash after a save, in light and dark; the turn list's restart dividers; the agent down with the typed text kept; the small window with the drawer open, the viewer in a 1,200 × 760 frame; Re-run live in a store turn's header and in the fixture view's; the re-run turn, on a stored re-run of a fixture.
- On the tool's fake agent under `run`, its stop delayed with `--stop-delay` and its card held with `--hold-card-until-file`: the restarting form, with a turn on screen and on the first screen; the first screen while the agent is starting; the first screen with the agent down before its card answered; the agent popover with a catalog file that did not read.
- The preview page reloading and the preview page stopped answering were opened on the canvas and held against session 4's record, the board pass having one borrowed port.

The dev loop's section of "Components and states" was read on the canvas. The small-window board is laid out at its own size in the play view's Fit mode alone; in Fill it takes the window's width.

### 28. A2UI findings

Finding 46, the Python restaurant finder abandoning ADK's run generator when its stream fails, gains what this run saw: the `Failed to detach context` traceback after retried turns of the finder launched as `uv run .`, eight times across two starts, where the drawer showed it on session 1, and after neither retried turn of session 5 under `opentelemetry-instrument`.

### 29. OpenTelemetry findings

None.

### 30. The sessions

All from the `a2ui-upstream` worktree at `9e8a9bac5`, on `gemini-3.6-flash`, the viewer through the tunnel on 5173 and session 4's sample pages on 11001, the store moved along from folder to folder.

1. The Python restaurant finder under `run`, `uv run .`. The first start had the syntax error saved: the first screen's down form with the traceback's last lines, Restart pressed once and down again, then the save that fixed it, the agent started with no press and the heading the card's name. "Top 3 Chinese restaurants in New York" with Restart pressed while it streamed, trace `d9f497e0306f7a9edc803e22bb62e2fc`, failed 4.9 s in with the divider above it; the question again, trace `4c58140e29b74543a1de8ba9dd23118b`, then Book pressed, trace `7893e0d858ad9a1bea1a4edac6487dbb`. The first-launch check held on the binary on macOS: a save restarted the agent, Save as fixture made the folder and listed `book-restaurant.json`, the next save restarted the agent, and a copy dropped in by hand listed with no restart. Flow 7 on `book-restaurant.json`, passed and free, traces `d5df1142dbfce786301a3419c446bf51` and `4c170c31f795e01b95cabcac03ffba1e`. A save timed onto the first turn of a replay of that fixture, trace `5f16f168a9f12ef49b30859038af5b8d`, failed, the second turn not sent; three saves with no turn between drew as "Restarted 3 times · prompt_builder.py changed last". The loop: the edit of decision 32, the restart, Re-run live on the booking turn, traces `f8ff61e215c24fb7829d5affd75f812f` and `f7e0929c33c418db826ac882a0ebdb56`, the form titled "Reserve a table at Xi'an Famous Foods", the edited line in the request and the first call's prefix break on it. The re-run conversation continued by Submit Reservation, trace `ec28f62c461a09ef07f0941d83fc42fb`, completed. The hand-dropped fixture's booking turn re-run from the fixture view, traces `9f4893ee926841887a5e0b36792238f1` and `d9a4fc808f55500090314f95dfe4f8e4`; a record from outside the store, the conformance record `full_record_restaurant_finder.json` dropped in as `from-elsewhere.json`, its first turn re-run, trace `ce4324418d2e9fb10526839420ca8ffe`, and its file removed, the third line reading "Re-run of from-elsewhere.json · turn 1 of 1 · live" as plain text. The crash after a save and its fix by a save; the command's own process killed with SIGKILL, "was ended by SIGKILL", then Restart, two rows. Spectra stopped by an interrupt with the page open: the not-connected forms, the agent gone with it, exit code 130; started again, the page reconnected with the new buffer and no divider of the earlier start. Flow 8 by the keyboard, its re-run trace `1905ac1a50f96eb4d0d97630800462b2`; the viewer with the drawer open in a 1,200 × 760 same-origin frame, which also stood for the viewer opened later; the drawer dragged to 485 px and that height kept after a reload. The command misspelled as `uvv run .`: "could not start: Executable not found in $PATH: "uvv"", the divider and the drawer's "No output yet.", and, from an empty folder, the first screen's down form with no output block, its Restart reached by Tab. The two streams apart on the first start: the agent's stdout lines and Spectra's prefixed lines on stdout, the agent's stderr lines on stderr with Spectra's error lines. `a2ui-spectra test --agent-url http://localhost:10002 -- uv run .` on the session's fixtures folder, with the prompt edit reverted: "book-restaurant: passed", "1 fixture: 1 passed", exit 0, stdout those two lines alone, a save during it restarting nothing.
2. The Node restaurant finder under `run`, `yarn start`. The card's example, trace `367e4cea96ddebafb21a12639fd1708f`, then Book pressed, trace `6815330a293c090100d9e90d0790c3b2`, both in A2UI v1.0; Flows 1, 3, 4 and 5 walked on the two, Flow 2 on session 1's failed replay turn, the finder's turns having no problem. The edit of decision 32, and a second save 1.5 s later while the build ran: the first build killed, the command started again, the card answered. Re-run live on the booking turn, traces `fcb8ff5899d57db50a7c07c332e6f736` and `c445ee420bdf365900f38ad7d8b1358b`, the form titled "Reserve a table at Xi'an Famous Foods", the prefix break on the edited line. The type error `export const BROKEN: number = 'not a number';` saved in `src/prompt.ts`: `tsc`'s `TS2322` lines in the drawer with their colour codes stripped, "exited with code 1", fixed by a save.
3. The custom-components example under `run`, `uv run .`, with `./inline_catalog_0.9.json` and the floor plan server configured. "Who is Alex Jordan?", trace `4ff7a3131e72a3184d659908f2b558e5`, then the `view_location` press on Alex Jordan as a second host, trace `8ef2aa4d7febfa1e7c1538d39c743a74`, its `initialize`, `notifications/initialized` and `resources/read` through the tool proxy. The edit of decision 32; Re-run live on the press turn, traces `5cfd5a662e4e134ee80daf1d962a8604` and `f220d151e7f6cb0bd676578de7dc11e6`, the name written "ALEX JORDAN", the prefix break on the inserted line, and the floor plan read live. The catalog file broken by a save: "JSON Parse error: Expected '}'" in the terminal and on the agent popover's Catalog row, the definition read before in force, the agent restarted with the file named in the drawer and the turn list; mended by a save, the lines gone. A save of `a2ui-spectra.json` restarted nothing and gave the terminal's line.
4. The stub agent's canned conversation under `attach`, from the run's folder, the three sample pages in turn on 11001. The context bar ended with the wire proxy's address, with no Restart, no Logs, no drawer and no divider, the drawer's remembered choice kept. On the React page: trace `bec6f592c2cd6825e9726f444966e495`; `CustomSlider` given a required `step` in the catalog copy, the next turn, trace `fa813e352e64e939d96c0fd65eee1203`, carrying "must have required property 'step'", the earlier turn's check events as written; the `catalogId` changed, the terminal naming both ids and the next message offering the new one, trace `d9b5e09c203c3541b5149741e8a79d58`; neither save a restart or a divider. A re-run under `attach`, traces `9606a86acdb1dacb0bda70c71b61e7ca` and, from the header on the Lit page, `ce452a4a0dce108dfde1d9b8ee4bb18b`. The stub agent stopped by hand: the send went out and the turn was captured as failed, "connect ECONNREFUSED 127.0.0.1:10013", trace `4462a16528f06de38b691d8b422023ed`. On the Lit page, trace `751db7092d3c92ddffb126a35c823c3f`, and on the Angular page, trace `4b66bf054a9a9045ed357a5ec2ce298b`.
5. The Python restaurant finder under `run` and `opentelemetry-instrument`, the wrapper on, launched as `uv run --with opentelemetry-distro --with opentelemetry-exporter-otlp-proto-http --with-requirements otel-requirements.txt opentelemetry-instrument python .` with the Click instrumentation off. The drawer open from the remembered choice; "Top 3 Chinese restaurants in New York", trace `16d55d7962a168154874d95f5b10814a`, finding 31's retry, Flow 6 walked on it; its re-run, trace `6d91ed68bb0fe87bfd59ab25b06e1db4`, carrying its parse rows. The agent filter on the Contact Lookup Agent, no divider; on every agent and on the connected agent, the divider back; no turn marker for the earlier sessions' turns. With the syntax error saved before a start, the command stood for the name, cut at 384 px in the context bar and in the composer's placeholder, and held in a 1,200 × 760 frame. On the binary rebuilt with decision 26's fixes: a re-run of session 1's booking turn, traces `de7e3873144fd1fd99489e4d9a1d259c` and `9ef591ed13db53f886be7bd665e180a9`, its first call reading "the recorded call at +57 ms in Action “book_restaurant”"; and a save timed onto a replay with everything recorded, trace `b6699e0129ca43a0236a776cd5d1f69c`, failed at the cut, with no call leaving the machine.

Every session was seen in light and dark; the dark twin of the crash after a save was seen on session 1, the drawer open in dark on sessions 2 and 3. Not checked live: the note "Save it as a fixture first"; the refusal popover under Re-run and under Restart; the composer's refusal under `attach`; the live status's starting form, which lasts until the first card attempt; Restart's tooltips for several open turns and for a replay on its last turn; the composer's long refusal wrapped onto a second line; finding 46's lines on session 5.

### 31. What each dev server did on a save

- **React**, Vite 8.3.5: the slider's source could not be swapped in place, `"CustomSlider" export is incompatible`, the module exporting the component's API beside the component, and the page was reloaded; `src/main.tsx` reloaded the page too. The ready came 10 ms and 9 ms after the frame's load, no note. With the slider's markup moved for the check into a module of its own that exports the component alone, `src/SliderBody.tsx`, a save of it was swapped in place, "hmr update /src/SliderBody.tsx": the surface took the new border and label colour with no load of the frame and no note, the slider kept the value it had been dragged to, 76, and the Button's action carried it, on the turn with trace `db4166e8a90d197388d9ca2bef93bda2`; the sample was put back as it was.
- **Lit**, Vite 8.3.5: the page was reloaded, the ready 8 ms after the load, no note. With the dev server stopped and the frame reloaded by hand: the tunnel's error page loaded after 187 ms, the reloading note showed 219 ms after that load, and "No preview for catalog" with the has-not-answered line 5.02 s after it; the tunnel's error page loaded again about every 5 seconds, and the surface was drawn at the first load after the server started.
- **Angular**, Angular CLI 21.2.29: the slider's style was swapped in place, "Component update sent to client(s).", the surface changed with no load and no note. A comment added to `src/main.ts` changed no output; a statement added to it reloaded the page, "Page reload sent to client(s).", the ready 28 ms after the load.

### 32. The prompt edits

- The Python restaurant finder, `prompt_builder.py`, the booking line of `UI_DESCRIPTION`: "…you MUST use the `BOOKING_FORM_EXAMPLE` template, titled "Reserve a table at <restaurant name>"."
- The Node restaurant finder, `src/prompt.ts`, the booking line of `UI_DESCRIPTION_DIRECT_JSON`, the same clause.
- The custom-components example, `prompt_builder.py`, a line added under "For finding contacts" in `UI_DESCRIPTION`: "e.  On the Contact Card, you MUST write the contact's name in upper case (e.g., "ALEX JORDAN")."

### 33. Content, not findings

- On a restart through the tunnel the composer's line follows the live status: it read "the agent is down" for 0.5 s after the status read "Waiting for the agent's card", and "waiting for the agent's card" for 0.3 s after the status read "Agent down".
- A configured catalog file inside the working folder is a watched file too: its save restarts the agent, "Restarting the agent: catalog.json changed.", beside the definition being read again.
- Under `attach` a stopped agent gives the composer no refusal: Spectra knows nothing of that process, the send goes out and the turn is captured as failed.
- A source gone numbers its replayed turn by the turns that were sent, "turn 1 of 1", where a source still there numbers it in the source, "turn 1 of 2".
- A fixture that has left its folder while its recorded turns are in the store falls to the store turn, not to plain text.
- A recorded replay of the Python restaurant finder's two turns takes 113 ms and 48 ms, and a save restarts the agent 116 ms to 289 ms after it.
- Through the tunnel a sample page's first load outlasts the five-second window, 16.7 s on the Lit page and 7.7 s on the Angular page, so the pane reads "No preview for catalog" with the has-not-answered line until the load and its ready arrive; the pairing of load and ready misread nothing.
- With a store that holds turns, the viewer opens the latest turn, so the first screen's forms show from an empty store or on an agent with no turn.
- A preview frame keeps the document it holds across a restart of Spectra on the same page URL; the React page's document stood in the frame after the Lit page's server took the port, until the viewer was loaded again.
- Under `opentelemetry-instrument` the receiver left three `opentelemetry.instrumentation.starlette` spans of each card request unrecorded, their start in no turn's range.
