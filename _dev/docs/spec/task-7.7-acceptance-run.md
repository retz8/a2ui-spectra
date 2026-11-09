# Task 7.7 — The acceptance run

Spec for sub-task 7.7 of Phase 7 — Fixtures and replay (`_dev/docs/spec/phase-7-fixtures-and-replay.md`), carrying out its decision 17, the acceptance run: the real binary, through the tunnel, on the three samples at the pin `9e8a9bac5`, the Python restaurant finder, the Node restaurant finder and the custom-components example with its MCP server over HTTP+SSE; each saved as a fixture and replayed in both modes from the viewer, one with its prompt edited to see the miss and the prefix break, `replay` and `test` from the terminal in both agent forms, every Phase 7 board in light and dark; what the run finds is fixed within the sub-task. It also takes the six checks sub-tasks 7.3, 7.5 and 7.6 deferred to it.

## Scope

- The sessions: which sample runs under which entry point, and what each is for.
- The store the run starts with, the tunnel's port, the preview and the fixtures folder.
- The model and the turns sent.
- The floor plan press and the tool miss on the custom-components example.
- The prompt edits and the two replays after them.
- The commands from the terminal.
- The six checks the earlier sub-tasks deferred.
- The boards, the wrapper, the earlier flows, the keyboard, dark and the window sizes.
- What counts as a finding, and where each finding goes.
- The other documents, the worktree after the run, and the done line.

## Locked decisions

### 1. The sessions

Every target runs from the `a2ui-upstream` worktree at `9e8a9bac5`, as 6.6 left it, with the wrappers installed beside the samples. Four sessions, in order, from one store:

| # | Target | Entry point | What it is for |
| --- | --- | --- | --- |
| 1 | The Python restaurant finder | `run` | the fixture view, Save as fixture, the replay passed and free, the prompt edit's miss and prefix break, Flow 7, the Screens pair, the small window, 7.6's repaint check |
| 2 | The Python restaurant finder | `attach`, nothing set in its shell | the disabled Replay rows and "Cost unknown", a live-mode replay of a record with nothing to serve |
| 3 | The Node restaurant finder | `run` | the live mode after a prompt edit, the live call's "Went to the model" sentence |
| 4 | The custom-components example with the floor plan server | `run`, the server configured as a tool server | the MCP exchange over HTTP+SSE served from the record, its housekeeping rows tagged Record, the tool miss |

One `attach` session, as 6.6 had one. The commands from the terminal ride on sessions 1 and 3, as decision 8 has it.

### 2. The store, the port, the preview and the fixtures folder

The run starts from an empty store in a folder of its own, outside this repo and the worktree; every Spectra start is launched from that folder with the session's config passed by `--config`, so the store builds up across the sessions, each later session showing the earlier sessions' turns. One borrowed port, 5173, for the viewer, once Jioh confirms A2UIVerse's client is idle on it. No preview page and no configured catalog: the two finders draw in the built-in preview, the example shows "No preview for catalog". One fixtures folder for every session. Before `test` runs on an agent's fixtures, they are moved by hand into a sub-folder of the folder per agent, and `test` is pointed at that sub-folder; the move is the listing's recursive names, the watched list taking a file moved in by hand, and every agent's fixtures listing together without a picker, seen live.

### 3. The model and the turns sent

`gemini-3.6-flash` on all three targets, the samples' defaults at the pin as 6.6 ran them, the key from the Linear agent's `.env` passed to the agent's process and never printed or written. Each turn is the sample's own or one an earlier run used; none is invented.

- Session 1: "Top 3 Chinese restaurants in New York", then Book pressed in the preview, the finder reading the box's v0.9 action. The two-turn conversation is the fixture; the booking turn is Flow 7's subject and 7.6's check.
- Session 2: the same question in Korean, one turn. The saved name prefills `turn`, the record holds no calls, and the live-mode replay with "Cost unknown" runs against the model unrecorded; its A2UI most likely differs, giving the failed verdict's "A2UI differs" problem on the outcome step from a real sample.
- Session 3: the card's example, "Find me the top 10 chinese restaurants in the US", then Book pressed, as 6.6 did; saved and replayed free, then the prompt edit and the live mode.
- Session 4: "Who is Alex Jordan?", then the `view_location` press on Alex Jordan from the second host of decision 4; saved and replayed free.

### 4. The floor plan press

The example's only MCP traffic, `initialize` and `resources/read` over HTTP+SSE, happens inside a `view_location` press turn, and the example reads an action from v0.8's `userAction` key alone (finding 12), which the message box does not send. The press is sent as a second host: a hand-made A2A request carrying the `userAction` part, through the wire proxy into the box's conversation, the route the Phase 5 run took. No sample changes for it. At replay the driver re-sends the recorded press as it re-sends every recorded wire input.

### 5. The tool miss

The saved fixture of session 4 is edited by hand, the recorded `resources/read` request's URI changed, so the live read matches nothing and the miss's list shows the one recorded request of that method. The example catches the failure and answers "Failed to load floor plan data" as text, so the replayed turn fails on the miss and on its A2UI together. Editing the file while the fixture is in view is 7.5's fixture-rewritten-under-the-view case from a real record: the saved time updates and the selected turn stays by its trace id.

### 6. The prompt edits

One change in each finder's prompt source in the worktree, the agent restarted, reverted after the run. Both finders send one system prompt on every model call, so the Python finder's everything-recorded replay after its edit misses on the first model call and fails there, and the Node finder's live-mode replay after its edit sends every model call live, no row served. Both are accepted as they will be. The 7.1 board's mixed replay, Record and bare rows together, is content no sample at the pin produces; it stays pinned by 7.5's unit tests and the done commit names it as not seen live.

### 7. The commands from the terminal

A headless command takes the proxies' default ports, so the viewer's Spectra stops before it runs, and an agent `run` launched stops with it; `--agent-url` is given an agent started by hand in a shell with the printed variables set. Six invocations, after each session's viewer part:

- Session 1, the `--` form, the command launching the Python finder from the worktree: `replay` on its fixture, passed, exit 0, one line per turn and the closing line naming the conversation folder; `test` on the Python finder's sub-folder, every fixture passed, exit 0.
- Session 3, the `--agent-url` form, the Node finder restarted by hand with the variables set: before the edit, `replay` passed, exit 0, and `replay --model-live` passed and free, every call served; after the edit, `replay` failed with `REPLAY_MISS` naming the Gemini method and path, exit 1, and `test` on the Node finder's sub-folder failed with that reason under the fixture and the summary's counts, exit 1.

Status on stderr with the prefix and results on stdout alone, checked once with the two streams redirected apart. The usage errors and exit 2 stay with the command-line test.

### 8. The six deferred checks

- **A host app's turn arriving mid-replay** (7.3): once, in session 4. While the example's free replay runs, the "Who is Alex Jordan?" turn is sent through the wire proxy as a host in a fresh context. Expected: the turn captured as any turn, the terminal's line naming it and that the proxies were replaying, its model call meeting the armed pool. What that does to the replay's verdict is the documented limit, not a finding.
- **The MCP session opened before the first turn** (7.3's known limit): no sample at the pin does it, the example connecting inside the press turn. Not checked; the done commit says so and the README's line stands.
- **A store turn replayed from its file** (7.3): session 1, the booking turn's Replay from its own header in Turns, before any fixture is saved; its third line names the source as a store turn, by its input in brief, linking into Turns. The source-gone form comes at the end of session 4 by removing the fixture file: the fixture line reads "no longer in the folder", Replay fails in the popover, and the replayed turns' lines fall to plain text.
- **The Korean slug** (7.3): session 2, as decision 3 has it.
- **The tunnel's lag and the 1200 × 760 frame** (7.5): observed, not decided; a fast replay reading open for up to about two seconds is content, and the frame is the same-origin frame 7.5 used.
- **The repaint without `COMPONENT_UNREACHABLE`** (7.6): session 1's booking turn, live and replayed, its checks carrying no structural finding.

### 9. The boards

Every board Phase 7 added, as the 7.1 spec's decision 1 places them: the "Fixtures and replay" row of "Turn view details", Flow 7's four boards, the Screens pair "The fixture view", the States row's context bar while a replay runs, the additions to "Components and states" and to "Icons", the small-window board, and the three dark twins. Each is checked live where a session produces it. One junk `.json` is dropped into the folder by hand for the list's "not a turn record" row and the fixture line's reason form. Not producible at the pin, named in the done commit: the mixed live replay; "No recorded call of <model> to compare with"; "No recorded request of this tool to compare with"; a served retry's "Retry 1 · Record" tag, if the turn does not retry.

### 10. The wrapper

On for session 1 only, under `opentelemetry-instrument` with 6.6's recipe and no source edit, so a replayed Python turn carries its parse rows beside Record-tagged model calls and, if the first turn retries as finding 31 has it, the served retry shows both tags. Off in session 2, where nothing is set, and for the Node finder and the example.

### 11. The earlier flows

Flows 1 to 5 walked once on session 3's Node conversation, as 6.6 did, Flow 4 on the built-in preview and Flow 5 on the two turns, each judged for whether the flow still works and not board by board. Flow 6 once on session 1's retry when it happens, else named as not walked. Flow 7 on session 1.

### 12. The keyboard

Flow 7 once by the keyboard alone, in light at full width, on session 1 after its pass with the mouse: the booking turn reached in the list, Save as fixture reached by Tab and opened by Enter, the name typed and saved by Enter, "Open" followed by Tab and Enter into Fixtures, Replay reached by Tab, a mode row reached and pressed by Enter; then, on the replay after the edit, the missed call reached by the arrows in the timeline and its prefix break's link followed by Tab and Enter. A step that cannot be done without the mouse is a finding, fixed with no new key; the 7.1 spec's decision 13 keeps the list of keys unchanged.

### 13. Dark

3.7's rule: in dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light. The three dark twins, the fixture view's Screens pair, the replayed turn with the miss selected and the Replay popover open, are checked board by board. Every session is seen in both themes.

### 14. The window sizes

The fixture view at 1200 × 760 in the same-origin frame against the small-window board; a replayed turn's timeline narrowed by the divider to 380 px and to 340 px, where the Record tag and the miss's problem mark keep their width while the muted targets give way. No tall-window check.

### 15. What counts as a finding

6.6's rules, unchanged where they apply: any difference of design between the viewer and a board, the layout, an element missing or extra, the wording, a state, spacing, colour, behaviour, is a finding, fixed in the viewer or, where the board is wrong, amended on the design canvas; a difference of content between a real agent's turn and a board's is not a finding, nor is a feature of a later phase; a route of the run that does not work is a finding; a fault in a sample or in upstream's SDK goes to `_dev/a2ui-findings.md` and is not fixed here; a fault in an OpenTelemetry producer goes to `_dev/otel-findings.md`.

Four destinations join them:

- A miss on an unchanged agent, a request field that varies between runs, is fixed in the matcher as the per-provider exclusion the Phase 7 spec's decision 4 reserved, the request recorded into the model or tool capture suite so the replay suite carries the case, and decision 4 amended with the exclusion.
- A recorded wire input the mirror does not re-send as the agent needs it, the `userAction` part foremost, is a finding for the turn record's shape, as the 7.3 spec's decision 3 has it, fixed there and in the mirror and pinned by the round-trip test.
- A wrong verdict on a real record, such as an `A2UI_DIFFERS` from an id the agent assigns, is fixed in the verdict with a unit test on the record's shape, as 6.6 fixed the viewer's computed rules.
- The tool proxy's HTTP+SSE replay failing against the real server, the carrier, the `endpoint` event or the session, is fixed in the proxy with a case in the conformance tool replay suite on the existing HTTP+SSE recordings. A command's line or exit code wrong is fixed with the command-line test.

### 16. Other documents

- The Phase 7 spec: decision 17 stands as written; decision 18's pin stays at `9e8a9bac5` unless the run forces a move; decision 4 is amended only if a per-provider exclusion is met. Before the phase closes, decision 18's list is read against the documents once, so nothing an earlier sub-task owed is left open.
- `_dev/TODO.md`: the 7.7 line names this spec and gains its done line at the tick; Phase 7 is marked done.
- `_dev/a2ui-findings.md` and `_dev/otel-findings.md`: as decision 15 has it.
- The tool's README, the viewer's README, `conformance/README.md`, SPEC.md and the turn record are unchanged unless a fix touches what they describe.
- This spec gains, after the run, what the run fixed, the design canvas's amendments, the findings recorded, the sessions with their trace ids, and what was content and not a finding, as 6.6's did.

### 17. The worktree after the run

`a2ui-upstream` is left at `9e8a9bac5` with the two prompt edits reverted and the wrappers' installs in place. The run's store, configs, fixtures folder and launch scripts live in the run's own folder outside the repo and the worktree.

### 18. Done when

- Every session of decision 1 has been through its part; every board of decision 9 is seen in light and dark, apart from the forms named as not producible; Flows 1 to 5 are walked once, Flow 6 when the turn retries, Flow 7 by the mouse and by the keyboard; the six commands of decision 7 have run with their exit codes.
- Every finding has gone where decision 15 sends it.
- The unit tests, the turn record validator, the capture and replay suites, and every end-to-end test pass after the fixes, under Node and against the binary, locally and in CI.
- This spec carries decision 16's last item.
- The done commit names the forms not checked live, the worktree's ref `9e8a9bac5` with the installed versions of the four Python SDK packages, `@a2ui/agent`, google-adk, LiteLLM, the MCP Python SDK, the OpenTelemetry distro and Node, and the model.

## Invariants

- No sample's code changes for the run beyond the two prompt edits, each reverted after it.
- No credential is printed, written into a record, a fixture, a config or a commit.
