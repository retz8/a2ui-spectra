# Sub-task 7.3 — The replay driver and the fixtures

The server replaying a record through the wire proxy as the host, the earlier turns first, the ids rewritten; the replayed turn's provenance and verdict in the record; the fixtures folder, save as fixture and the name; and the API the viewer and the commands use. Sub-task 7.3 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, carrying out its decision 1, the replay driver; decision 7, the ids across a replayed conversation; decision 8, what a replayed turn records; decision 9, the verdict; and decision 11, the fixtures folder, the file and the name; on the proxies sub-task 7.2 left armed and disarmed by the driver.

## Scope

- The driver: the message box re-sending a record's wire inputs through the wire proxy, the proxies armed around the conversation.
- The transport envelope and the A2A message rebuilt from the record's transport-neutral wire input.
- The `contextId`, `taskId` and `messageId` across the replayed conversation.
- The interlock between a replay, the box's sends and the turns of other hosts.
- The provenance and the verdict written on the replayed turn's turn event; what the verdict compares.
- A send that fails mid-replay; recorded calls the replay never asked for.
- The fixtures folder, its setting and default, the listing, save as fixture, the name rule, the slug and the clash.
- The HTTP API and the live stream events the viewer uses; the in-process entry the commands use.
- The unit tests, the end-to-end test on the existing stub, and the documents.

Out of scope: the two commands, sub-task 7.4; the viewer, sub-task 7.5; the stub agent's model-calling mode and the end-to-end test on the stand-in provider, sub-task 7.4; the tool proxy keeping session housekeeping seen outside a turn, backlog.

## Locked decisions

### 1. The message box is the driver

The box gains a replay entry: given a record, a mode and its source path, it runs one new conversation whose sends are the recorded wire inputs rebuilt, arming both proxies with the record's pool before the first send and disarming them after the last replayed turn closes. The replayed conversation is a box conversation like any other: the box's read route lists it, and once the replay ends the composer can continue it live. A replay is refused when the box is unavailable, the card speaking no A2A version the box does or a configured header's variable unset, with the box's own reasons.

### 2. The transport envelope comes from the live card

The record keeps no transport envelope. The A2A version and the choice of send or stream come from the live agent's card as the box chooses them today. The extensions header carries the URIs of the versions the recorded input's `a2ui.wire.capabilities` is keyed by; when the input carried no capabilities, the URI of the recorded turn's `a2ui.turn.protocol_version`; with neither, no extensions header. The recorded content goes inside. This amends the Phase 7 spec's decision 7, which had the header, the version and the method sent as recorded.

### 3. The A2A message rebuilt from the recorded parts

The recorded `a2ui.wire.message` is turned back into A2A parts by a mirror of the adapter's one-way part reading, in the live A2A version's form. The A2UI MIME type, dropped at capture, is re-sent as the canonical `application/a2ui+json`, in the part's metadata under A2A 0.3 and as the part's media type under A2A 1.0. The version-keyed capabilities are split back, the v0.9 and v0.9.1 entries under the client key and the v1.0 entries under the renderer key, each key present only when it has entries. The data model goes under the key its own version picks. The other recorded metadata goes back unchanged. An unknown part is re-sent as its content verbatim; a blob as a file part with bytes, a URI part as a file part with a URI; a text part's MIME type and name as A2A 1.0's media type and file name, and dropped under A2A 0.3. The message has the role `user` and a fresh `messageId`. The mirror has a round-trip unit test over the adapter's existing hand-written A2A 0.3 and 1.0 traffic; a part that cannot round-trip is a finding for the turn record, not a special case in the driver.

### 4. The ids

The first turn's request is sent with no `contextId`, so the agent opens a new conversation, and each later request carries the `contextId` the live agent's reply named. A recorded request that carried a `taskId` is sent with the live previous turn's task id when that turn ended waiting for input, and with none when it did not. A request recorded without a `taskId` is sent without one. `messageId` is fresh for each send. This amends the Phase 7 spec's decision 7 with the two cases it left open.

### 5. The interlock

A replay starts only when no turn is open anywhere, the box's conversations and other hosts' turns included, and only one replay runs at a time; a second is refused as the box refuses a send into an open turn. The box refuses every send while a replay runs. A host app's turn that arrives mid-replay is captured as any turn, its calls meeting the armed pool, and the terminal prints one line naming that turn and that the proxies were replaying; the replay's own verdict is not touched. The limit is documented. This amends the Phase 7 spec's decision 12, whose refusal was the box's per-conversation one.

### 6. Provenance and verdict on the turn event

Turn record v0.1's turn event carries five optional `a2ui.replay.` attributes. `a2ui.replay.source`, `a2ui.replay.turn` and `a2ui.replay.mode` as the Phase 7 spec's decision 8 has them, attached when the turn opens. `a2ui.replay.verdict`, `passed` or `failed`, and `a2ui.replay.reasons`, present when failed, a list of `code` and `message` in the check findings' style: one `REPLAY_MISS` per missed call naming its method and path, `OUTCOME_DIFFERS` with the two outcomes in its sentence, `A2UI_DIFFERS` naming the first message that differs. The verdict needs the closed turn, so it lands through the store's existing amend path, with a `turn_amended` on the live stream carrying the turn event. This amends the Phase 7 spec's decision 8.

### 7. What the verdict compares

The outcome check is `a2ui.turn.outcome` equal. The A2UI check compares the flattened sequence: each turn's A2UI messages are the `a2ui` parts of its `wire_output` events in delivery order, an array part contributing its elements in order; the two sequences must have the same length and equal members by JSON value, the message's `version` included. The first index that differs, or the length, names the message in the `A2UI_DIFFERS` sentence. This amends the Phase 7 spec's decision 9.

### 8. Recorded calls the replay never asked for

A recorded call left unconsumed in the pool when its replayed turn closes is not a verdict reason. The terminal line and the stream's turn-end event say how many of the recorded turn's calls were not asked for; nothing is written in the record.

### 9. A send that fails mid-replay

When a replayed turn cannot be sent, the box's own failure to reach the wire proxy or Spectra stopping, the replay stops there: the remaining recorded turns are not sent, each reported as not sent with the reason, the record fails, the proxies are disarmed, and the box's conversation is dropped as a failed send drops it today. The Phase 7 spec's decision 7, every turn sent whatever the outcome of the one before, is about the agent's outcomes, not Spectra's failure to deliver.

### 10. The fixture's name, the slug and the clash

The typed name follows the store's rule for a conversation folder, ASCII letters, digits, `-`, `_` and `.`, not starting with a dot. The name is the file's base name without `.json`. The slug prefilled in the viewer comes from the listing's input in brief: a text's collapsed text lowercased, every run of characters outside ASCII letters and digits one `-`, trimmed, cut to about forty characters at a `-`; an action's name slugged the same way; `turn` when nothing survives. A clash takes `-2`, then `-3`, appended to the typed name until the folder has no such file. A file dropped into the folder by hand under any name still lists and replays. This amends the Phase 7 spec's decision 11.

### 11. The listing and the saved time

The listing takes every `.json` under the folder recursively, as `test` does, a fixture's name being its path relative to the folder without `.json`. Save writes at the top of the folder only. A file that is not a valid turn record lists with its reason and no turns, the reason `test` fails it with. The saved time is the file's modification time, read when listed; the record carries none. This amends the Phase 7 spec's decision 11 and 12.

### 12. A store turn with no file

A store turn replays directly from its file, its source the store file's path relative to the working directory. A turn the store holds in memory after a failed write can be saved as a fixture from memory; a replay of it is refused, saying the turn's file was not written and to save it as a fixture first.

### 13. The API and the stream

The commands do not go through HTTP: headless, they call the box's replay entry in process. The viewer's API gains:

- `GET /api/fixtures`: `folder`, the folder's path relative to the working directory when under it; `fixtures` in path order, each with `name`, `path`, `savedAt` and `turns` in the turn listing's form, or `error` with the reason for a file that is not a turn record.
- `GET /api/fixtures/<name>`: the record; `404` for an unknown name, `422` with the reason for a file that does not read as one.
- `POST /api/fixtures`: `traceId` and `name`; `201` with `name` and `path`; `400` for a name outside the rule, `404` for an unknown turn, `409` for an open turn, `409` for a clash carrying `suggested`, the first free numbered name; a failed write `500` with the system's reason.
- `POST /api/replays`: `source`, a fixture by `fixture` name or a store turn by `traceId`, and `mode`, `recorded` or `model_live`; `202` once the first turn opens, with the first `traceId` and `turns`, the total; `409` while a turn is open anywhere or a replay runs, `422` when the box cannot send or for `recorded` on a record with nothing to serve, `404` for an unknown source, `502` as the box's send.
- `GET /api/message-box` gains `replay` while one runs, its `source`, `mode`, `turn` and `turns`. `GET /api/context` gains `fixturesFolder`.

The live stream gains `replay_started` with `source`, `mode` and `turns`; `replay_turn` with `traceId`, `recordedTurn`, `turn` and `turns`, as each turn opens; `replay_ended` with `verdict` and the turns, each with `traceId`, `recordedTurn`, `verdict` and `unconsumed`, a turn not sent carrying `notSent` with the reason instead; and `fixtures_changed`, a debounced nudge after which the viewer refetches the listing.

### 14. The tests

Unit tests on the parts mirror's round trip; the id rewriting, the first turn with no `contextId`, the live one after, and the `taskId`'s three cases; the verdict, a pass, a miss, an outcome difference, an A2UI difference naming its index, housekeeping outside; the folder, the name rule, the slug's cut and fallback, the suffix, the recursive listing, a bad file's reason, the default folder with and without a config file; the interlock; and the provenance and verdict attributes landing on the turn event and validating against turn record v0.1. An end-to-end test under Node on the existing stub agent's canned conversation: two turns sent through the box's API, the second saved as a fixture through the API, `recorded` refused with nothing to serve, `model_live` replayed and passing, which proves the task id rewrite since the stub completes only on its own task id; the three replay stream events and the verdict on both records; the fixture's recorded A2UI edited in the test and replayed again, failing with `A2UI_DIFFERS` naming the message; and `fixtures_changed` on a file dropped into the folder. The binary waits for sub-task 7.4. Done when all of it is green in CI.

### 15. Other documents

- The Phase 7 spec, amended in place: decision 1 with the box as the driver and the replayed conversation continuable; decision 7 with the envelope from the live card, the header rebuilt from the record, and the `taskId` rule; decision 8 with the verdict and reasons attributes; decision 9 with the flattened A2UI sequence and unconsumed calls as a note; decision 11 with the ASCII rule, the slug, the suffix, the recursive listing and the modification time; decision 12 with the hub-wide refusal, the mid-replay host turn as a known limit, and a memory-held turn refusing replay.
- Turn record v0.1, prose and schema: the five `a2ui.replay.` attributes of the turn event in its table, the attributes list and the reason codes. Phase 1's fixtures are unchanged.
- The tool's README: the config file's `fixtures` setting; a Fixtures section, the folder, the name rule, the slug, the listing and the saved time; the Replay section gaining the driver, the envelope, the ids, the verdict, the provenance, the interlock with its limit and the stop on a failed send; the message box section's continuable replayed conversation; the API table's three routes and two fields; the stream's four events.
- The config schema gains `fixtures`. `_dev/TODO.md`: the 7.3 line names this spec. No finding is expected for `_dev/a2ui-findings.md` or `_dev/otel-findings.md`.
- At start, Spectra prints the fixtures folder beside the turns directory, whether or not the folder exists yet.

## Invariants

- The replay sends the wire input as recorded; the envelope the record cannot hold comes from the live card, and the ids the agent assigns, and `messageId`, are the only rewrites.
- A replayed turn is a turn through the one capture path; what replay adds to its record is the `a2ui.replay.` attributes alone.
- The verdict is taken once, at the turn's close, and written; it does not change when the source record does.
- No turn shares the proxies with a replay by Spectra's own doing.
