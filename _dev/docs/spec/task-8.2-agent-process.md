# Sub-task 8.2 — The agent's process under `run`

The agent's process under `a2ui-spectra run`: the launch, Spectra serving whatever the process does, the restart, the card read again, and the process's state and events on the API, the stream and the terminal. Sub-task 8.2 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, carrying out three of its decisions: that Spectra outlives the agent under `run`, with the viewer, the wire proxy and the box starting with the launch; the restart, which cuts the open turns' connections, stops the group, spawns the same command and reads the card again; and a restart happening at once while a turn is open or a replay runs. It gives the viewer what the sub-task 8.1 spec, `_dev/docs/spec/task-8.1-design-artifact.md`, takes from this sub-task: the command as launched, the state, and each restart event with its time and cause.

## Scope

- Under `run`: the launch's order, the process's states, the restart in every state, the card read again and the session following it.
- The state and the session's events on the API and the stream, and the Restart route.
- The message box's refusals while the agent cannot be sent to, and what it keeps across a restart.
- The terminal's lines and the wording of the card wait's reason.
- The tests and the documents.

Out of scope: the agent's output kept and echoed, and the save watcher, sub-task 8.3, the output staying written straight to Spectra's terminal here; re-run, sub-task 8.4; the viewer's code, sub-task 8.6.

## Locked decisions

### 1. The launch

Under `run` every listener binds before the agent's command starts: the model proxy, the tool proxy, the OpenTelemetry receiver, the wire proxy and the viewer. A taken port stops Spectra with today's error before the command has started. Then the address lines print, the same lines as today, the command starts, and the browser opens at once on the first screen in its starting form, without waiting for the card. `attach`, `replay` and `test` keep today's order, the card first.

### 2. The states

Five, named as the sub-task 8.1 spec words them: `starting`, from the command's start until the first card attempt; `waiting`, carrying the wait's reason, until the card answers; `running`, the process alive and its card answered once; `restarting`, during the cut and the stop of a restart; `down`, carrying the exit line in the terminal's words. The card is read at each start of the process and not asked for again until the next restart. A card that fails the transport check leaves the state at `running`.

### 3. Down

When the command's own process exits, Spectra stops what is left of its process group with today's stop, the stop signal then the force-kill after the grace, then reports down. Down means nothing of the group Spectra made is running. A command that cannot start leaves Spectra serving, down with its could-not-start line.

### 4. A process the stop cannot reach

Spectra stops the process group it made. A command that puts the agent in a group of its own is stopped only through that command's own relay of the signal: wireit 0.15.0-pre.2 does this under the Node restaurant finder's README command, `yarn workspace @a2ui/agent-restaurant-node run start`, starting the agent's `node` detached and relaying the stop to it. When such a command is force-killed after the grace, or dies before relaying, the agent stays on its port: the old agent answers the next card wait, the new process cannot bind the port and exits, and the state reads down with the bind error in the agent's output. This is a known limit. The tool's README says so, names wireit, and says to launch the agent's own command directly where the relay is in doubt.

### 5. What a Restart press does in each state

The press reaches Spectra through one route, from the context bar's Restart and the first screen's alike.

| State when pressed | What the press does |
| --- | --- |
| Running | The full sequence: the cut, the stop, the spawn, the wait for the card. |
| Down | The spawn, then the wait for the card. |
| Starting or waiting for the card, at launch or after a restart | The starting process is stopped and the command spawned again, as a save does. |
| Restarting | Nothing new: the restart underway is the one asked for, and none is queued behind it. |

The route answers at once that the restart is accepted and never waits for the card; progress reaches the viewer through the stream. The sub-task 8.1 spec's "While a restart runs, Restart is disabled" means the restarting state alone: during every card wait Restart is enabled.

### 6. The cut reaches the wire only

The restart's cut ends the open turns' connections at the wire proxy and nothing at the model proxy or the tool proxy; a cut turn's calls end by the rules they have. Two waits follow, and the README states both. With a non-streaming send open on a uvicorn agent the stop runs to the 10-second grace: uvicorn 0.49.0 goes on waiting for the request's task, which runs until the turn finishes, where a streaming turn's cut ends its wait. The message box streams whenever the card declares streaming, as the three samples' cards do, so this is a host app that sends without streaming, or an agent whose card does not declare it. And a cut turn can stay open up to five seconds after the process has gone, the model proxy reading the provider's reply on as it does for any agent that closes its side, during which Replay and Re-run refuse as for any open turn.

### 7. The wire proxy while no agent is listening

The wire proxy stays transparent and knows nothing of the process's state. It forwards as always: with no agent listening the host gets today's `502` line, and a turn request is captured as a failed turn, as under `attach` when the agent is unreachable. A captured turn's agent name is the latest card's, and a turn captured before any card has answered carries none.

### 8. What the box keeps across a restart

The message box keeps each conversation's id and drops its task id whenever the agent's process ends, by a restart or on its own. The next send carries the conversation id alone. A task id names state that lived in the stopped process: the A2A Python SDK, 0.3.25, refuses a send naming a task its store does not hold, and the Python restaurant finder keeps its tasks and sessions in memory and ends most turns waiting for input.

### 9. The box's refusals

The server owns every line. The box's route carries the reason and a send or a replay is refused with it, the first that applies winning, in this order:

| When | The box's reason |
| --- | --- |
| Starting | Can't send · the agent is starting |
| Waiting for the card | Can't send · waiting for the agent's card |
| Restarting | Can't send · the agent is restarting |
| Down | Can't send · the agent is down |
| Running, the card lists no interface | Can't send · the agent's card lists no interface to reach it at |
| Running, the card lists no JSON-RPC interface | Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC |
| Running, the card lists JSON-RPC only at versions the box does not speak | Today's line, unchanged |
| A configured header's variable is not set | Today's line, unchanged |

In the sixth line the transports the card does list stand in place of GRPC.

A replay running when the agent stops being sendable has its open turn cut, which fails, and its next send refused, so its remaining turns are reported not sent. Their reason is a sentence: "The agent was restarted." for a restart, and the terminal's exit sentence for an exit, such as "The agent's process exited with code 1."

### 10. The session following the card

Each state event is sent once the context and the box's state reflect it, so on a state event what the context route and the box route give is current. The context has no event of its own. The context keeps the last card's details until a later card replaces them, and carries none before any card has answered. An agent whose own dev server reloads it keeps the card Spectra last read until Restart is pressed.

### 11. The API and the stream

| What | Name |
| --- | --- |
| The route giving the command as launched, the state as it stands and the session's events | `GET /api/agent` |
| The Restart route | `POST /api/agent/restart` |
| The stream event carrying the state whole, at each change | `agent_state` |
| The stream event for a restart, with its time and its cause | `agent_restarted` |
| The stream event for an exit the agent took on its own, with its time and its exit line | `agent_exited` |

The session's events are of those two kinds, a restart and an exit the agent took on its own, kept in memory for the session, every one, the log buffer's cap being the buffer's alone. A restart's cause in this sub-task is the press; sub-task 8.3 adds the changed file. Each state and each event carries a number in order, so what the route and the stream both gave merges. The route is read on every stream open, as the listing, the box, the context and the catalogs are. Sub-task 8.3's log lines reach the viewer the same way, a route plus stream events. Under `attach` both routes answer `404` with a line saying Spectra did not start this agent.

### 12. The terminal's lines

- "Starting the agent: uv run ." at the launch and at every restart, the command and its arguments as given.
- "The agent's card answered: <name>." each time a card answers, with the card's name when it has one. Today's lines about the card follow it whenever they apply to the new card: that it prefers another transport, or that the box cannot send to it.
- A card that fails the transport check prints today's error line for it, and Spectra carries on.
- "Restarting the agent: Restart was pressed in the viewer." naming the cause; sub-task 8.3 adds the changed file's form.
- The exit line is today's sentence followed by "Restart it from the viewer.", printed for an exit the agent took on its own and not for the stop a restart makes.
- The wait line's hint about the agent's URL is said only until a card has answered once; later waits print the line without it.
- "The agent's process did not stop within 10 seconds, so it was force-killed." whenever the grace runs out, at a restart and at Spectra's own stop alike.
- The stop signal's lines stay as they are.

### 13. The wait's reason

Spectra words the two common causes itself, from the error's code, the same under Node and under the binary: "connection refused" for a refused connection, and "no answer within 2 seconds" when the attempt times out, the two seconds being the attempt's limit. Any other failure keeps today's form with the runtime's message. The terminal's wait line and the state's reason read the same words, wherever the card is waited for, under `attach`, `replay` and `test` too.

### 14. The tests

The command-line test, under Node and against the binary, with the fake agent extended to play each case. Under `run`:

1. Before the card: the viewer and the wire proxy answer while the agent is still starting; the state walks starting, waiting, running on the route and the stream; the box refuses with its waiting line; the context gains the card's details when it answers.
2. A taken viewer or wire proxy port stops Spectra before the agent's command has started.
3. The agent exits on its own, before its card and after it: Spectra keeps serving, the state is down with the exit line, the exit is among the session's events, and Spectra's exit code on a stop signal is its own. Today's case of exiting with the agent's exit code is replaced.
4. A group member outlives the command: it is stopped, and the state is down.
5. A restart with a streaming turn open, against a fake agent that waits for its open requests on the stop signal as uvicorn does: the turn is written as failed with the broken-connection status, the process is gone well inside the grace, and the state walks restarting, waiting, running with the press among the events.
6. A press in the other states: from down it spawns, during a card wait it stops the starting process and starts another, and during the stop it adds nothing.
7. The card changed between launches: the context, the box's choice of send or stream, and the agent's name on new turns follow it.
8. A card that fails the transport check after a restart: Spectra carries on, the box refuses with its line, and a later restart with a good card clears it.
9. A conversation waiting for input, then a restart: the next send carries the conversation id and no task id.
10. A replay running at a restart: it stops, its remaining turns not sent with "The agent was restarted."
11. The wait's reason reads "connection refused" under Node and under the binary.

Beside these, `attach` refuses Restart and reports no process, and the existing `replay` and `test` cases stay green unchanged. The non-streaming wait running out the full grace is not tested end to end, the force-kill being covered by today's case for an agent that ignores the stop signal. Done when all of it is green in CI.

### 15. The documents

- The tool's README: `run`'s order at launch and that it serves before the card answers; under `run`, Spectra outliving the agent with its own exit code, the restart's sequence and what it ends, the two waits of decision 6 and the limit of decision 4; the wire proxy's card check no longer stopping Spectra under `run`; the message box following the latest card, what it keeps across a restart and its refusals; the two routes, the three stream events and the context's card details read at each card; a restart stopping a running replay; the headless commands' paragraph saying the launched agent's own output goes to stderr as the agent wrote it, without the `a2ui-spectra:` prefix; the layout's entries for the fake agent's options and the new cases.
- `run`'s help text: its sentence on exiting with the command's exit code and its opening sentence on the card, corrected.
- The Phase 8 spec, amended in place: its restart decision's sentence on why the cut comes first says that the cut ends uvicorn's wait for a streaming turn, and that a non-streaming send is waited for until the grace.
- The sub-task 2.1 spec stays as written.
- `SPEC.md`: no change.
- `_dev/TODO.md`: the 8.2 line names this spec. No finding is expected for `_dev/a2ui-findings.md` or `_dev/otel-findings.md`.

## Invariants

- Under `run`, nothing the agent does ends Spectra, and Spectra's own stop ends the agent in whatever state it is, nothing being spawned once the stop has begun.
- Nothing of the agent's process goes into the turn record: a turn the restart cut holds only what the wire saw.
- The wire proxy knows nothing of the process's state.
- The server owns every line the box refuses with.
- `attach`, `replay` and `test` keep their order and their rules.
