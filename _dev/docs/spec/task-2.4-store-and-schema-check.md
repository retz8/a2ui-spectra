# Task 2.4 — The store and the schema check

Spec for sub-task 2.4 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the local store, the copied protocol schemas and the schema check, connected to the running tool. The Phase 2 spec's decisions on the turn's protocol version, the local store and the schema check apply, as amended here. The record is turn record v0.1 (`specification/turn_record/v0_1/`). Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin.

## Scope

- The local store: its directory, its layout and names, the earlier turns each file embeds, the listing, and its failures.
- The copied protocol schemas of v0.9, v0.9.1 and v1.0, and the schema check.
- The store and the check connected to the running tool: each closed turn is checked and written.
- Unit tests of the check and the store, and the command-line test extended to the store.
- The Phase 2 spec's amendments, `_dev/TODO.md`'s, the tool's README, the copied schemas' README, and two entries in `_dev/a2ui-findings.md`.
- Not in scope: the server's API and live stream and the message box, sub-task 2.5; the viewer, sub-task 2.6.

## Locked decisions

### 1. Connected to the running tool

On each turn-closed notification, the running tool runs the schema check and writes the turn's record file to the store. After this sub-task, a host pointed at the wire proxy leaves files in the store.

### 2. The agent's messages only

The schema check covers the A2UI messages the agent sent, in the wire outputs. The host's A2UI messages, in the wire input, are recorded and not checked.

### 3. The catalog stand-in

The schemas' catalog reference is bound to a stand-in that accepts any component, any function and any theme: every reference the pinned schemas make into `catalog.json`, `anyComponent`, `anyFunction` and `theme`. In v1.0, accepting a component means its own properties count as evaluated, so the protocol schema's `unevaluatedProperties: false` on a component does not reject them. What the protocol schema itself requires of a component stays checked: v1.0's `ComponentCommon` fields, and that a component is not `Surface`.

### 4. Ajv's strict mode

The schema check's Ajv instances run with strict mode off, as upstream's own schema tests do (`specification/v*/test/run_tests.py`, `--strict=false`).

### 5. Messages without a supported version

A message from the agent with no `version`, with a version other than v0.9, v0.9.1 and v1.0, or that is not a JSON object, is a finding, and the check fails.

### 6. The check's protocol version

The check event's protocol version is the version the agent's first A2UI message declares, in the record's version form; when no agent message declares one, it is the turn's protocol version. Mixed versions count the agent's messages only: one finding naming the versions seen, with each message still validated against its own version. A turn with no A2UI from the agent and a known version records a passing check of zero messages. A turn with no version from anywhere records no check event.

### 7. A finding's path

A finding's `path` is a JSON Pointer from the turn object to the offending value, through the wire output, its part, the part's content and, for an array, the message's index. This convention is written in the tool's README; the turn record prose is unchanged.

### 8. From Ajv's errors to findings

Pass or fail comes from the version's single-message envelope. When a message fails, its findings are the errors of the one message type whose key it carries, one finding per error. A message carrying no message type key, or more than one, is one finding saying so. A finding's `message` is Ajv's text, naming the property for an additional or unevaluated property.

### 9. Finding codes

| Code                         | When                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `VALIDATION_FAILED`          | A message declaring v0.9, v0.9.1 or v1.0 fails its schema, including one that names no message type or several |
| `SCHEMA_VERSION_MISSING`     | An object with no `version` string                                                                           |
| `SCHEMA_VERSION_UNSUPPORTED` | A `version` other than v0.9, v0.9.1 and v1.0                                                                 |
| `SCHEMA_NOT_AN_OBJECT`       | Content, or an element of an array, that is not a JSON object                                                |
| `SCHEMA_VERSIONS_MIXED`      | The agent's messages in one turn declare more than one version                                               |

A finding carries `surfaceId` when its message names a surface.

### 10. The copied schemas

Only the files the check loads are copied, unchanged, at the pin: `server_to_client.json` for v0.9 and v0.9.1, and `agent_to_renderer.json` and `common_types.json` for v1.0. They live in the tool workspace, one folder per version, with a README naming each file's source path, the pin and upstream's Apache 2.0 licence.

### 11. The store's directory

`.a2ui-spectra/` in the working directory Spectra was launched from, with the git-ignore that ignores everything at its top, and the turns under `.a2ui-spectra/turns/`. The git-ignore is written only when Spectra creates the directory.

### 12. Layout and names

One folder per conversation: `turns/<conversation>/<time>_<trace id>.json`. `<time>` is the turn's start in UTC to the millisecond, written to sort as text and without colons, such as `2026-10-24T15-30-12.123Z`. `<trace id>` is the turn event's trace id. `<conversation>` is the conversation id as is when it uses only letters, digits, `-`, `_` and `.` and does not start with a dot, and percent-encoded otherwise.

### 13. Earlier turns come from disk

A turn's file is the conversation's latest file, its turns, then this turn. A conversation carried on after a restart keeps its history. The store writes one conversation's files one at a time.

### 14. Turns with no conversation

A turn with no conversation id is a file directly in `turns/`, `turns/<time>_<trace id>.json`, holding only that turn.

### 15. The listing

The store lists every turn on disk, earlier runs included, newest first, from the file names.

### 16. When the store cannot be written

When the store's directory cannot be created at start, Spectra stops with an error naming the directory and the reason. When one turn's file fails to write mid-run, Spectra prints an error naming the file and the reason, keeps running, and keeps the turn in this run's memory.

### 17. Stopping

When Spectra stops, it waits for in-flight writes before it exits. A turn cut off by the stop closes as failed and is written.

### 18. Tests

- The check: unit tests run it over Phase 1's full records, reproducing their recorded schema checks; over sub-task 2.3's expected capture records, passing everywhere except AG2's v1.0 function call, which is one finding; and over hand-written messages, for each finding code, the findings of the named message type, the paths and the check's protocol version.
- The store: unit tests of the directory and its git-ignore, the layout and names, the earlier turns from disk, turns with no conversation, the listing, and the failures at start and mid-run.
- The command-line test: a turn sent through the proxy to the fake agent lands a file in the store that validates against the turn record schema and carries a schema check event, under Node and against the binary.

### 19. The Phase 2 spec's amendments

- The turn's protocol version and the schema check: a check of zero messages is recorded when the turn has a version; a turn with no version records no check event.
- The schema check: the agent's messages only; the stand-in accepts any component, any function and any theme, with a v1.0 component's own properties evaluated; Ajv with strict mode off.
- The local store: `.a2ui-spectra/turns/`.

### 20. Other documents

- `_dev/TODO.md`: the 2.4 line names this spec, and its tests are Phase 1's fixture records and sub-task 2.3's recordings.
- The tool's README: the store — its place, layout, names, listing and failures — and the schema check — its codes and the `path` convention.
- `_dev/a2ui-findings.md`, each checked against the pin: v0.9.1's schemas declare v0.9's `$id`s; `client_to_server.json` declares no `$id` in v0.9 and v0.9.1.
- SPEC.md and the turn record prose are unchanged.
