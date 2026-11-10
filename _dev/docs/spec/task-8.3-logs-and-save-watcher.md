# Sub-task 8.3 — Logs and the save watcher

The agent's output under `a2ui-spectra run`, echoed, kept and given to the viewer, and the watcher that restarts the agent on a save. Sub-task 8.3 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, carrying out its decision on the logs and its decision on restart on save, on the process the sub-task 8.2 spec, `_dev/docs/spec/task-8.2-agent-process.md`, describes. It gives the viewer what the sub-task 8.1 spec, `_dev/docs/spec/task-8.1-design-artifact.md`, takes from this sub-task: each line with its arrival time to the millisecond, its stream and its text as written, the stop and start dividers with the cause, the exit line and the command, and the route's count held and cap.

## Scope

- Under `run`: the agent's output piped, echoed to the terminal, kept in the buffer with its dividers, on a route and the stream.
- The buffering variable in the agent's environment.
- The save watcher: what is watched and what is ignored, a save in each state of the process, the cause, the `watch` setting, the terminal's lines, a watch that fails.
- The fixtures folder watcher's test, "watches the folder, once it exists, and says once when files join or leave it" in `tools/spectra/src/fixtures/fixtures.test.ts`, diagnosed and fixed.
- The tests and the documents.

Out of scope: the viewer's code, sub-task 8.6; the catalog files' watch, sub-task 8.5; re-run, sub-task 8.4; the headless commands, `replay` and `test`, which stay as they are; applying a changed config file.

## Locked decisions

### 1. The echo

Under `run` both of the agent's streams are piped. Each chunk the agent writes is passed to Spectra's same stream as it arrives, untouched, stdout to stdout and stderr to stderr, without Spectra's prefix. The split into lines is the buffer's alone and changes nothing in the terminal.

### 2. A line

Each stream is split on its own. A line ends at a newline, a carriage return just before it dropped; everything else stays as written, ANSI codes and a bare carriage return included. The text is decoded as UTF-8, a character split across two chunks joined. An unfinished line is held until its newline arrives or the stream ends, and is then entered as a line. A line that reaches 16 KiB is entered as it stands and what follows continues as the next line, the split never falling inside a character and the split line carrying no mark; 16 KiB is where Docker's log copier splits a line, `defaultBufSize = 16 * 1024` in moby's `daemon/logger/copier.go`.

### 3. The buffer's entries

The buffer is one ordered list of three kinds of entry: an output line, with its stream and its text; a stopped divider; a started divider. Every entry carries the moment it entered the buffer, to the millisecond, a line's being the moment it was completed, so times in the buffer never go backwards. The cap of 1,000 counts output lines alone; a divider leaves the buffer when the lines before it have left.

### 4. The dividers

- **Started:** written at every start of the command, the first launch included, with the command as launched.
- **Stopped:** written once for each process that ended, with the exit line in the terminal's words. It carries the cause when a restart stopped the process, the press or the changed file, and no cause when the agent exited on its own. A command that cannot start reads a started divider followed by a stopped divider with its could-not-start line. Nothing is written when Spectra itself is stopping.
- **Position:** the stopped divider follows that process's last line. A restart does not wait on a stream that something outside the process group still holds open, the case of the sub-task 8.2 spec's decision on a process the stop cannot reach: the divider waits a quarter of a second at most for the streams to end, and lines arriving later are kept and echoed as they come.

### 5. The route and the stream

| What | Name |
| --- | --- |
| The route giving the entries held, oldest first, the count of output lines held and the cap | `GET /api/agent/logs` |
| The stream event carrying the entries one read of the agent's output produced | `agent_log` |

Each entry carries its own number in the buffer's order, starting at 1 for the session, apart from the numbers on the process's states and events, so what the route and the stream both gave merges. Every entry one chunk of the agent's output produced travels together, as a list in one event; a divider travels alone. Each event also carries the number of the oldest entry still held, and the viewer drops everything below it. The route is read on every stream open, as the other routes are. Under `attach` it answers `404` with the line the two agent routes use, that Spectra did not start this agent.

### 6. The agent's environment

Under `run` Spectra sets `PYTHONUNBUFFERED=1` in the agent's environment, unless Spectra's own environment sets the variable. Python block-buffers stdout when it is not a terminal, so a bare `print()` would otherwise not appear as it is written. Nothing is set for colour, which is each tool's own decision for a pipe: uvicorn 0.49.0 colours only when its stdout is a terminal and reads neither `FORCE_COLOR` nor `NO_COLOR`. The headless commands, `replay` and `test`, set nothing.

### 7. What is watched, and how

On by default under `run`: the working directory, recursively, every file outside the default ignore list. The watch is one recursive `fs.watch` per watched folder, the ignore list applied to the events. A single file listed in `watch` is watched through its folder, since a save that replaces the file would end a watch on the file itself. The debounce is a quiet spell: the restart comes 100 ms after the last change, as the fixtures folder watcher's does. Only a file is a save: a folder made or removed restarts nothing. macOS reports a change of a watched folder itself under the folder's own name, as a file of that name inside it; such a path that is not on the disk is the folder, and no save.

On Linux the recursive watch walks into the ignored folders, one watch per folder under Bun and one per file and folder under Node 22, against inotify's per-user limit; narrowing `watch` cuts it.

### 8. The default ignore list

| Ignored | Source |
| --- | --- |
| Every folder whose name starts with a dot | tsx, Air, uvicorn's reload |
| `node_modules`, `dist`, `build`, `__pycache__`, `venv` | The Phase 8 spec's names that the rule does not cover |
| Files ending `.pyc`, `.pyo`, `.pyd` | watchfiles |
| vim's swap files, names ending `.sw` and one more character | watchfiles |
| Backup files, names ending `~` | watchfiles |
| JetBrains' safe-write files, names ending `.___jb_tmp___` and its two siblings | watchfiles |
| Emacs' lock files, names starting `.#`, and autosave files, `#name#` | watchfiles, watchexec |
| `.DS_Store` | watchfiles, watchexec |
| `flycheck_` files | watchfiles |
| Spectra's store and its fixtures folder, by their paths | The Phase 8 spec |

Hidden files are watched: only folders fall under the dot rule, so a save of `.env` restarts the agent. `.gitignore` is not followed.

### 9. A save in each state

A save calls the restart a press calls.

| State when the save lands | What the save does |
| --- | --- |
| Running | The full sequence: the cut, the stop, the spawn, the wait for the card. |
| Starting, or waiting for the card | The starting process is stopped and the command spawned again. |
| Restarting, during the cut and the stop | Nothing new: the spawn that follows the stop reads the files as the save left them, and the restart's cause stays the one that began it. |
| Down | The save starts the agent. |

### 10. The cause

A restart's cause gains the save, carrying one path and no count: the first changed path of the window that still exists when the window closes, or the first path when none exists. The path is relative to the working directory when under it, otherwise absolute, the rule the fixtures folder's shown path follows. The word is always "changed", for a file written, created or removed. The terminal reads "Restarting the agent: prompt_builder.py changed.", and the same cause is on the restart event and on the stopped divider.

### 11. The `watch` setting

- `true` is the default spelled out; `false` and an empty list watch nothing.
- A list is everything that is watched: `["src"]` narrows the watch to one folder, `[".", "../shared"]` widens it.
- An entry is a folder, watched recursively, or a single file, relative to the config file.
- The ignore list applies inside every listed folder. An entry that itself names an ignored folder is watched, the ignore list applying below it.
- An entry starting with `!` is excluded from the watch: `[".", "!sessions.db", "!data"]`. It is a path, a file or a folder, relative to the config file, not a pattern.
- The deepest entry covering a path decides: `[".", "!data", "data/prompts"]` watches `data/prompts` and nothing else under `data`.
- A listed path that does not exist at start stops Spectra with an error naming it, as a configured catalog file that does not exist does. An exclusion that does not exist is not an error.
- Under `attach`, `replay` and `test` the setting is validated with the rest of the file and has no effect.

### 12. A save of the config file

A save of the config file Spectra read, the default file or the one `--config` named, when it lies in a watched folder, does not restart the agent. The terminal says, once per change: "a2ui-spectra.json changed. Spectra reads it at start, so stop Spectra and start it again to apply it." A config file outside every watched folder is not watched for this.

### 13. The terminal's lines at start

One line, after the address lines and before "Starting the agent".

- **On:** "A save in <folder> restarts the agent. Set watch to false in the config file when the agent reloads itself." A `watch` list prints each path. Paths are absolute, as the start lines for the turns folder and the fixtures folder are.
- **Off, by `false` or an empty list:** "Restart on save is off: watch is false in <config file>."

The viewer shows nothing about the watcher itself; it shows each restart, with the changed file in the dividers.

### 14. A watch that fails

- A watch that cannot be set up at start, such as when the system's limit is reached, does not stop Spectra. The terminal names the path and the system's reason, says restart on save is off for it, and says to narrow `watch`.
- A watch that fails while Spectra runs gets the same line. Spectra carries on, and the Restart control still works.
- A listed folder that is removed while Spectra runs is no longer watched. The terminal says so and says to stop and start Spectra. It is not picked up again when it reappears.

### 15. The watchers on macOS

Bun, which compiles the binary, has two open issues on macOS: opening or closing one watcher drops events for the others while the stream is rebuilt, oven-sh/bun issue 44385, and a non-recursive watch nested inside a recursive one makes the recursive one lose events, issue 44780. The first holds under Node 22 as well, found in this sub-task: with the fixtures folder's watch reopened as the folder first appeared, a save written in the same moment never reached the save watcher, about one run in two. The second is Spectra's situation at a first launch: the fixtures folder does not exist yet, so its watcher watches the working directory non-recursively, inside the save watcher's recursive watch of the same directory.

So no watcher is opened or closed while Spectra runs, where restart on save watches the folder that holds the fixtures folder: the save watcher's own watch tells the fixtures folder's changes, each once after its quiet spell, and the fixtures folder has no watch of its own. Where no watched folder holds it, under `attach`, with `watch` off or narrowed away from it, the fixtures folder keeps its own watch.

The save-restart case runs against the binary as well as under Node. The first-launch case, a save while the fixtures folder does not exist yet and as it appears, is a command-line case, run on macOS under Node and against the binary; CI runs it on Linux.

### 16. The fixtures folder watcher's test

The failure is reproduced under load first, and its cause found. The fix goes where the cause is: the watcher, when it misses or doubles a change; the test, when its counts depend on the machine's speed, rewritten to assert what the watcher promises, one call per quiet spell, with no count that rests on a timing margin. Done when the cause is written down and the test no longer rests on a margin. The save watcher's own tests hold to the same standard: they assert the restart and its cause, never a count of restarts that depends on how fast the machine delivered the events.

The cause, as found: the test changed the folder before the watch was in place. The watcher sets its watch up after a look at the disk, and returned before that; and on macOS a watch reports nothing for a moment after it is set up, with no sign of when it begins, nodejs/node issue 52601. On a loaded machine the folder's first file was written inside that gap and never told, one run in twelve. The watch now says when it is in place, the test waits for that and makes each change again until it is told, and the promise of one call per quiet spell is tested on the quiet spell itself, with the clock in the test's hands. The exact counts of calls are gone.

### 17. The tests

The rules are tested without any file event; real saves appear only in the command-line cases.

The command-line test, under `run`, under Node and against the binary, with the fake agent or a one-line command playing each case; a case that saves a file saves it again until Spectra says so:

1. The output: the fake agent writes to both streams; the terminal carries each on its own stream, byte for byte, without Spectra's prefix; the route gives the entries after a started divider; the `agent_log` events merge with the route by number.
2. An unfinished line shows in the terminal at once and enters the buffer at its newline, or as a last line when the process ends.
3. The dividers: a press writes stopped, with the press and the exit line, then started; an exit the agent took on its own writes stopped with no cause; a command that cannot start reads started, then stopped.
4. The cap: past 1,000 lines the oldest are gone, and the route's count and the event's oldest number follow.
5. `PYTHONUNBUFFERED` is in the agent's environment, and a value from Spectra's own environment is kept.
6. A save restarts the agent: the cause names the file on the restart event, in the terminal's line and on the stopped divider.
7. An ignored write, then a watched one, with the fixtures folder appearing between them: every restart names the watched file, and the stream says the fixtures folder changed.
8. A save while down starts the agent; a save during a card wait stops the starting process and starts again.
9. `watch: false`: the off line at start, and a save restarts nothing, shown by a press afterwards being the only restart event.
10. A save of the config file: no restart, and the terminal's line.
11. A `watch` path that does not exist stops Spectra at start with its error.

Without file events:

- The quiet spell: one call, the spell after the last notice.
- The line split: newline and carriage return, a character across two chunks, the 16 KiB split.
- The buffer: the cap, and a divider leaving with its lines.
- The path decisions: the dot rule, each name on the list, an explicit entry winning, an exclusion, the deepest entry deciding, the file named for a window.
- The `watch` setting and its schema: `true`, `false`, a list, an empty list, a missing exclusion accepted.

Beside these: `attach` answers `404` on the logs route; the existing `replay` and `test` cases stay green unchanged, with nothing set in their agent's environment; the fixtures folder watcher's test, with its cause removed. A watch that fails and a listed folder that is removed are not tested end to end; their lines are covered where the failure is handed in directly.

### 18. The documents

- The tool's README:
  - `run`'s paragraph: the agent's streams are pipes, echoed as written on the stream the agent wrote to; `PYTHONUNBUFFERED=1` is set unless Spectra's environment sets it; colour is each tool's own decision for a pipe.
  - The agent's process section gains the logs: the buffer, the line rules, the dividers, the route `GET /api/agent/logs` and the `agent_log` event.
  - The same section gains restart on save: what is watched, the default ignore list, the quiet spell, a save in each state, the cause, the lines at start, the config file's line, a watch that fails, a removed folder, and the Linux cost with the advice to narrow `watch`.
  - The config file's example and its list gain `watch`.
  - The fixtures section: the fixtures folder's changes told by the save watcher's watch.
  - The layout's entries for the new files and the new cases.
- The config schema gains `watch`.
- `run`'s help text gains a sentence on restart on save and the `watch` setting.
- The Phase 8 spec, amended in place: its decision on restart on save gains the dot rule and the editors' files in place of the named caches, `true` and the `!` exclusions on the setting, a save while the agent is down starting it, and a save of the config file; its decision on the logs gains the 16 KiB split and the buffering variable.
- `SPEC.md`, the sub-task 8.1 spec, the sub-task 8.2 spec and the canvas "Spectra viewer UI": no change.
- `_dev/TODO.md`: the 8.3 line names this spec; the backlog gains the save watcher passing its ignore list to `fs.watch`'s `ignore` option, once the Node used in development and the pinned Bun release both have it, Node having it from 24.14.0 and 25.5.0.
- No finding is expected for `_dev/a2ui-findings.md` or `_dev/otel-findings.md`.

### 19. What other sub-tasks take from this

- Sub-task 8.5, the catalog's loop: its catalog file watchers sit in the same tree as the save watcher, so decision 15 applies to it: a catalog file in a watched folder is told through the save watcher's watch, and any watch of its own is opened at start, never while Spectra runs. A save of a catalog file in a watched folder restarts the agent as any file does.
- Sub-task 8.6, the viewer: the route and the event as decision 5 sets them, the save's cause on the restart event, and the buffer's first entry being a started divider. Whether the drawer draws that first divider is for the canvas to say.
- Sub-task 8.7, the acceptance run: the first-launch check under the binary on macOS. For the Node restaurant finder, what is watched depends on the directory Spectra is launched from.

## Invariants

- The echo changes no byte the agent wrote.
- Times in the buffer never go backwards.
- The cap is the server's: the viewer never applies the 1,000-line rule itself.
- A save does what a press does, in every state.
- The headless commands stay as they are: nothing kept, nothing set, nothing watched.
- No test asserts a count that depends on the machine's speed.

## Open items

- Symbolic links on Linux. On macOS a link inside a watched folder is not followed, under Node 22 and in the binary alike, checked in this sub-task: a write in a linked folder, by its real path or through the link, and a write to a linked file's target are not told. Linux is not checked. The README says so, with the advice to list a linked folder in `watch` by its real path.
