# Sub-task 8.4 — Re-run

The replay driver's third mode, `live`, with no pool armed and no verdict; the fixture source naming a turn; the mode on the API, on the stream and on the terminal; and `live` in the turn record. Sub-task 8.4 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, carrying out two of its decisions: that re-run is replay with nothing recorded, the driver re-sending the conversation from its first turn up to and including the turn in view, into a fresh conversation, every model and tool call live; and what a re-run records, `a2ui.replay.mode` gaining `live`, the turn carrying source and turn as any replayed turn does, and no verdict and no reasons.

## Scope

- The driver's `live` mode.
- The fixture source's `turn`, and the record cut after it.
- `POST /api/replays` with `live` and `turn`, and its answers; `replay.mode` on the message box's route.
- The stream's three replay events under `live`.
- The terminal's line for a re-run turn; a host app's turn that arrives while a re-run runs.
- Turn record v0.1, prose and schema.
- The unit tests, the end-to-end case and the documents.

Out of scope: the viewer's code, sub-task 8.6; `a2ui-spectra replay --live`, backlog; the commands `a2ui-spectra replay` and `a2ui-spectra test`, which stay as they are.

## Locked decisions

### 1. The fixture source names the turn

`POST /api/replays` takes a fixture source as `{fixture, turn}`, `turn` the recorded trace id of one of the fixture's turns, as the fixture address names a turn inside a fixture. The record is cut after that turn before the driver gets it, in every mode, so the turns sent are the fixture's from its first up to and including the one named. `turn` is optional: without it the whole fixture is sent, as today, and the viewer's Replay keeps sending none. A store turn's source stays `{traceId}`, its record ending at that turn.

### 2. The stream under `live`

`replay_started`, `replay_turn` and `replay_ended` keep their names. `replay_started` and `replay_turn` keep their shape, `mode` reading `live` and `turns` counting the turns sent. Under `live`, `replay_ended` carries `source`, `mode` and `turns`, and no `verdict`; a turn sent is `traceId` and `recordedTurn`, with no `verdict` and no `unconsumed`; a turn the replay stopped before stays `recordedTurn` and `notSent` with the reason.

### 3. The terminal's line

One line for each re-run turn as it closes, the turn's outcome where a replay's verdict sits: `Re-run of <path>, turn 2 of 2: completed.`, the outcome in the words the verdict's sentences use, completed, failed, cancelled, waiting for input.

### 4. A host app's turn while a re-run runs

It is an ordinary turn. No proxy is armed, so its calls go live, nothing is printed for it, and it is no limit. Two turns open at once fall under SPEC.md's placement rule, as for any two hosts.

### 5. The schema

In turn record v0.1's schema the `a2ui.replay.mode` enum gains `live`. That a `live` turn carries no verdict and no reasons is said in the prose alone, as the other relations among the `a2ui.replay.` attributes are, and the driver's unit test asserts it.

### 6. The turn record's prose

The prose describes `live` as a mode of replay and does not say "re-run". The `a2ui.replay.mode` row gains `live`, nothing served from the record, every model and tool call live. The `a2ui.replay.verdict` and `a2ui.replay.reasons` rows are narrowed to the `recorded` and `model_live` modes. The paragraph "A replayed turn" gains one sentence: a turn replayed in the `live` mode carries its source, its turn and its mode, and no verdict and no reasons. No reason is argued.

### 7. Where `live` is asked for

Through `POST /api/replays` alone, under `run` and `attach` alike. Under `attach` it sends as Replay does, and the agent-down and agent-restarting refusals do not arise, there being no process state. The commands `a2ui-spectra replay` and `a2ui-spectra test` are untouched: their options, help text and reports stay as they are, and neither passes `live`.

### 8. The route's answers

`mode` accepts `live`. `turn` is accepted beside `fixture` only; a source carrying `turn` beside `traceId` is `400`, as any body outside the shape. A `turn` the fixture's record does not hold is `404`, naming the fixture. `202`'s `turns` counts the turns sent, after the cut. The nothing-to-serve `422` stays `recorded`'s alone and is judged on the cut record; `live` never gets it. The `409` and `422` sentences are unchanged, replay's words under `live` too. `GET /api/message-box`'s `replay.mode` reads `live` while a re-run runs.

### 9. The tests

Unit tests on the driver: a `live` replay arms no proxy; writes source, turn and `live` as the turn opens; writes no verdict and no reasons; prints the outcome line; says nothing for a host app's turn; ends with `replay_ended` in the shape decision 2 gives it under `live`; stops with its remaining turns not sent when the agent's process ends; is refused while a replay runs, while a turn is open anywhere and when the box cannot send; and is not refused on a record with nothing to serve. On the route: `live` accepted; `turn` cutting the record in every mode; an unknown `turn` `404`; `turn` beside `traceId` `400`. On the record: a turn event carrying `live` validates against turn record v0.1.

One end-to-end case on the stub agent in its model-calling form against the stand-in provider, under Node and the binary: two turns sent through the box's API with the stand-in running, the second saved as a fixture; a `live` re-run of the fixture's first turn by `{fixture, turn}`, sending one turn; a `live` re-run of the second store turn by `{traceId}`, sending both; every model call of the re-run turns reaching the stand-in and carrying no `a2ui.replay.served_from`; the records carrying `live` and no verdict; the stream events in their shapes. Done when all of it is green in CI.

### 10. The documents

- The tool's README: the Replay section gains the `live` mode, no proxy armed, every model and tool call live, no verdict, the terminal's line, and a host app's turn being an ordinary turn, its known limit staying worded for the two modes that arm the proxies; the API table and the stream's entries gain `live`, the fixture source's `turn` with its `404` and `400`, `replay.mode` on the message box's route and `replay_ended` under `live`; the API is named as the way in, the sentence on the viewer's Re-run button being written with sub-task 8.6.
- Turn record v0.1, prose and schema, as decisions 5 and 6 have them.
- `_dev/TODO.md`: the 8.4 line names this spec.
- SPEC.md, the config schema, the commands' help text and the Phase 8 spec are unchanged.

## Invariants

- The `recorded` and `model_live` modes behave as before: a replay that names no `turn` sends what it sent, with the events, the lines and the answers it had.
- Under `live` a verdict is absent, never a third value: on the turn event, on `replay_ended` and on each turn it lists.
