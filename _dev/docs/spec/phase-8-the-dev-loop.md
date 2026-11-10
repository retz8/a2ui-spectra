# Phase 8 — The dev loop

Agent restart and logs, restart on save, re-run the last turn, the preview reloading from the catalog's dev server. Phase 8 of SPEC.md's roadmap, between Phase 7, fixtures and replay, and Phase 9, upstream v1.0 and supported versions. The design authority is SPEC.md, in particular its "Features" ("The dev loop") and "Browser, terminal, editor" sections: under `a2ui-spectra run` Spectra owns the agent's process, restart, logs and reload on file change, and under `attach` it watches but does not own; Spectra watches the agent's files and restarts it on save unless the agent's own dev server already reloads; the preview reloads when the catalog changes, when its page is served by the catalog's dev server; re-running the last turn is one press. Re-run is the third mode Phase 7 left to this phase, re-sending the wire input with nothing recorded. The Phase 3 spec reserved Re-run in the turn header and Restart and Logs in the context bar, the logs as a drawer at the bottom of the page.

## Scope

In scope:

- The agent's process under `run`: Spectra outliving it, the restart, the card read again, the process's state in the viewer.
- The agent's logs: kept, echoed to the terminal, shown in the drawer.
- Restart on save: the watcher, its ignore list, the `watch` setting.
- The turn list's restart divider.
- Re-run: the replay driver's third mode, in the header, in the record.
- The preview page's reload and the catalog definition read again.
- The design canvas's Phase 8 boards and the acceptance run.

Out of scope:

- Discovering the agent's URL from the child's output under `run`. Backlog, as it is.
- Anything under `attach` beyond what the record gives: no restart, no logs, no watching, since Spectra does not own that process.
- Clicking a component or a prompt section to open the source file in the editor. After v1, as SPEC.md has it.
- The agent's own hot reload, which stays the agent's.
- `a2ui-spectra replay --live`, the third mode on the command line. Backlog.
- A change to `a2ui-spectra.json`, which still needs Spectra relaunched.

## Locked decisions

### 1. Spectra outlives the agent under `run`

Under `run`, an exit of the agent's process, of any kind, leaves Spectra serving: the viewer shows the agent down with its exit line and a Restart control, the box refuses to send with that reason, and the terminal keeps its one-line report of the exit. Only the user stops Spectra, by Ctrl-C or a signal, and that stop takes the agent with it as today. Spectra's exit code under `run` is its own, as under `attach`, no longer the agent's. The headless commands, `replay` and `test`, keep today's rule: an agent that exits mid-run is a failed run. Under `run` the wire proxy, the box and the viewer start with the launch rather than after the card: until the card answers the box is unavailable with the wait's reason, the first screen shows the agent as starting, or as down with its exit line and its logs when it died before answering, and Restart is there. Until a card has answered, the agent's command, as launched, stands for its name in the viewer. `attach` keeps its card gate, the card wait there being how a wrong URL shows.

### 2. The restart, and what it reads again

A restart first cuts the open turns' connections at the wire proxy, then stops the process group as the stop does today, SIGTERM then SIGKILL after the grace, then spawns the same command with the same environment, Spectra's ports and so the redirection variables being unchanged, then waits for the card with no limit, the viewer showing the wait and its reason as the terminal does. The cut comes first because it ends the wait of uvicorn, which every Python target runs on, for a streaming turn on SIGTERM; a non-streaming send is waited for until the grace. The card is read again on every restart and the session follows it: the context the viewer holds is rebuilt from the new card, the box's rewritten card and its choice of send or stream with it, and the viewer learns of the change through the stream. A card that fails the transport check leaves the agent up and the box unable to send, with the check's line as the reason. Nothing the agent does ends Spectra under `run`.

### 3. A restart while a turn is open or a replay runs

A restart from either source, the control or the watcher, happens at once. Every open turn fails with the status the wire proxy already writes for a broken agent connection, a running replay stops with its remaining turns not sent, as a failed send already stops it, and the control says what the press will end. The hub-wide refusal while a turn is open stays Replay's alone.

### 4. The logs

Under `run` both of the agent's streams are piped and kept: split into lines, each with the time it arrived and the stream it came from, in memory for the session, in a buffer capped at 1,000 lines, the oldest dropped, the cap being a terminal's default scrollback, VS Code's integrated terminal's. Nothing goes into the turn record: the record is the turn's and transport-neutral, the output is the process's. Each line is echoed to the terminal unchanged, on the stream the agent wrote it to, as today, Spectra's own lines keeping their prefix; the tool's README, which says the agent's output goes to stderr with the prefix, is corrected. The headless commands keep their rule, the agent's output on stderr so stdout holds the result lines alone. The buffer survives a restart, with a divider line for each stop and start carrying the exit line. Under `attach` there is no process, so no logs and no Logs control.

### 5. The logs drawer

The drawer at the bottom of the page shows the lines in order, stderr told from stdout, each with its time, following the tail until the reader scrolls up; the restart dividers; and turn markers, a divider where each turn opened and where it closed, the opened one naming the turn and linking to it, placed by time from the turn events the viewer already holds, so the server adds nothing for them. On connect the viewer receives the buffer as it stands and then each line live. When the agent goes down the live status takes an agent-down form carrying the exit line and a link that opens the drawer; the drawer does not open itself. Down before any card has answered, the first screen shows the last twelve lines of output, with Open Logs and Restart. No search, no filter and no new key: the browser's find serves search, and Phase 7's rule holds that header and bar controls are reached by Tab.

### 6. The terminal stays non-interactive

Restart lives in the browser and in the watcher. Spectra reads nothing from its stdin: SPEC.md's "Browser, terminal, editor" table gives the terminal launching Spectra once, secrets and CI, and puts restarting the agent in the browser.

### 7. Restart on save

On by default under `run`: Spectra watches the agent command's working directory recursively, every file, with a default ignore list, `.git`, `node_modules`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, the cache folders Python tools write, and Spectra's own store and fixtures folders. Changes within one debounce window, the 100 ms the fixtures watcher uses, restart once, and the terminal names the file that caused each restart. The config file gains `watch`: `false` for an agent whose own dev server reloads, or a list of paths relative to the config file, as `catalogs` and `fixtures` are, narrowing or widening what is watched. A save during a card wait stops the starting process and starts again. The headless commands watch nothing.

### 8. The turn list marks where the agent restarted

Under `run` the turn list gets a divider between turns at each restart, naming its cause, the changed file, the Restart control pressed, or the exit line when the process died, drawn from the same restart events the drawer uses, placed by time, never written into the record. A viewer opened later gets the session's restart events with the same catch-up that gives it the log buffer.

### 9. Re-run is replay with nothing recorded

Re-run acts on the turn in view: the replay driver re-sends the turn's conversation from its first turn up to and including this one, into a fresh conversation as replay does, with no pool armed, so every model and tool call is live. The result is a new conversation in the store with the turn's provenance pointing at its source, continuable from the composer. It works on any store turn and any fixture turn, after a restart or not, from the box's or a host app's conversation, and for a conversation of several turns it pays for each of them.

### 10. Where re-run sits, and what it records

Re-run is its own button in the turn header, one press, on a store turn's header and a fixture turn's header alike; the Replay popover keeps its two rows. Its label names the cost as the popover rows do, that every model and tool call goes live, in the design artifact's wording. It takes replay's refusals unchanged: refused while a replay runs or any turn is open, with the same notes, and refused on a turn held in memory only, with the same "save it as a fixture first". It is disabled while the agent is down or restarting, with that as its note, and enabled when the card answers; the composer is in the same state for the same reason. The turn record's `a2ui.replay.mode` gains a third value, `live`, beside `recorded` and `model_live`; the re-run turn carries source and turn as any replayed turn does, and no verdict and no reasons, the verdict's first clause, every call served from the record, being unable to hold. The header's replayed-from line reads as a re-run of its source. The turn record spec and schema are amended.

### 11. A preview page that reloads itself

The viewer listens to each preview iframe's load event. A load after ready puts the page back to waiting, shown as reloading, and re-arms the five-second timer, so a page that never answers again becomes unanswered with the line the pane already has for it. While it waits it holds the surface, as a page waiting at start does under the 4.4 spec's decision 9, and the fresh ready re-sends the current render as today. The preview protocol stays at version 1 and the adapters are unchanged; a hot module swap with no page load, React's Fast Refresh, needs nothing, the surface redrawing in place.

### 12. A changed catalog definition

Each configured catalog file is watched, under `run` and `attach` alike. On a change Spectra reads the file again, replaces the definition, says so in the terminal, and tells the viewer through the stream, which refetches the catalog listing. Turns captured from then on are checked against the new definition; turns already recorded keep their check events as written. A file that fails to read keeps its last good definition, with the error in the terminal and on the viewer's catalog list. A configured file whose id the card does not advertise gets a Catalog row of its own in the agent popover while its read stands failed. The config file stays read once at start.

### 13. The design artifact comes first

Phase 8's boards are drawn first on the design canvas "Spectra viewer UI", in light and dark, and the build follows them: the context bar with Restart and Logs and the live status's forms, starting, waiting for the card, running, restarting, and down with its exit line; the logs drawer with its lines, restart dividers and turn markers; the turn list's restart divider; Re-run in the header with its disabled notes and the re-run turn's header line; the preview pane's reloading and stopped-answering states; the agent popover's catalog line after a failed read; the first screen while the agent is starting and while it is down; the composer's four refusals while the agent cannot be sent to; the viewer with the drawer open as a Screens pair; a crash after a save; the Flow row, edit, save, restart, re-run, see; dark twins and one small-window board at 1,200 × 760.

### 14. The acceptance run

The last sub-task, through the tunnel, on the three samples at the pin, the Python restaurant finder, the Node restaurant finder and the custom-components example: the loop on each, edit, save, restart, re-run, see; a crash at launch and after a save, with the logs; the preview reload on the React, Lit and Angular sample pages; a catalog definition change; every board in light and dark; and the documents.

### 15. The documents

- The tool's README: the agent's output written as it is, under decision 4; the `watch` setting.
- The config schema gains `watch`.
- Turn record v0.1, prose and schema, carry decision 10's `live`.
- `_dev/TODO.md`: the Phase 8 line names this spec; the backlog gains `a2ui-spectra replay --live`, the driver's third mode on the command line, refused by `test`.

## Invariants

- Nothing of the agent's process, its output, its exits or its restarts, goes into the turn record.
- Under `run`, nothing the agent does ends Spectra.
- A re-run is a replay: the one driver, the one capture path, the one provenance, replay's rules.
- The preview protocol stays at version 1.
- A recorded check event is what Spectra judged at capture; no definition change rewrites it.
