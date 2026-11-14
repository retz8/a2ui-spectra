# Sub-task 9.6 — The recordings

The coverage roster's v1.0 recordings made again: the Node restaurant finder's booking stream at the pin, and AG2's two v1.0 streams on `ag2` 1.3.1. Sub-task 9.6 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 12, the backlog, by which the coverage roster's v1.0 axis recorded again at the pin enters the phase. The roster, its recordings and the A2A capture suite that replays them are sub-task 2.3's, `_dev/docs/spec/task-2.3-coverage-roster.md`.

The upstream check at this sub-task's start, on 2026-11-14, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, the documentation site's landing page (#4235), touching none of the areas Spectra uses; every copied file unchanged; no new release on npm or PyPI; `specification/versions.json` unchanged; the five watch-list items open; no commit on a held-by finding's paths: none of the three events of the Phase 9 spec's decision 2.

The roster at the pin, before the sub-task:

- Three recordings hold A2UI v1.0: the Node restaurant finder's `node_restaurant_finder/stream_v1_0_booking`, made at upstream `020a9d6f`, and AG2's `ag2/stream_v1_0_function_call` and `ag2/stream_v1_0_failed`, made on `ag2` 1.2.1. Their messages declare `"version": "v1.0"`, as before upstream's bare `1.0`: the schema check answers `SCHEMA_VERSION_UNSUPPORTED` and web core rejects every message. Every other recording holds v0.9 or v0.9.1.
- The Node restaurant finder at the pin keeps its stub mode, `STUB_LLM=true`, serving its canned examples through the SDK's streaming parser and validation. It declares the bare `1.0` and reads the host's capabilities under the key `"1.0"`. Its canned v1.0 examples carry no envelope key on a component, in either form.
- AG2's recordings are scripted: `_dev/tools/ag2_a2ui_server.py` gives AG2's scripted test model a reply the tool writes, so the version string and the function call's shape in the recording are the script's, validated and sent by AG2.
- PyPI's `ag2` 1.3.1 (2026-11-10), its latest, writes `1.0` on the wire for v1.0, as read off the wheel's source and not run. Finding 22 of `_dev/a2ui-findings.md`, "AG2's v1.0 function call is not in v1.0's shape", is fixed in AG2 from 1.2.2: v1.0's `callRendererFunction`, named with `@call`.
- Of the axis values in `conformance/README.md`'s table, v1.0 alone rests on these three recordings; each other value they exercise keeps a recording that stands.
- The re-pin procedure's move, `_dev/re-pin-procedure.md`, has no step that reads the roster. Sub-task 9.2's handover to this sub-task was that nothing is marked and the capture and replay suites pass at the pin; the tests that open the three recordings expect their rejection.
- Eleven test files of the tool and the viewer open the three recordings, beside the capture suite's cases. Some assert the rejection itself: the unsupported version's finding, the rejection counts, a refused message of an earlier turn.
- The stub agent's v1.0 booking form, sub-task 9.3's, in its `@` form, its bare form and its both-forms form, is not recorded in the roster; three browser end-to-end tests drive it live.

## Scope

In scope:

- The three v1.0 recordings made again, their expected records, and their capture cases.
- The recording tools as the new recordings need them: the AG2 server and the request files.
- The tests that open the three recordings.
- The rule on when a recording is made again, and the roster's review in the re-pin procedure.
- The roster's review at the pin `0888f88b2`.
- The documents of decision 12.

Out of scope:

- The model, tool, receiver and wrapper capture recordings.
- A real model on either agent, and any look through the viewer. Sub-task 9.8's, the acceptance run.
- A recording carrying the v1.0 component envelope keys, under decision 8.
- `@child`, `@action` and `@functionCall`, unmerged upstream, under the Phase 9 spec's decision 6.

## Locked decisions

### 1. The recordings made again

Three: the Node restaurant finder's booking stream, AG2's function-call stream and AG2's failed stream. AG2's two leave the backlog, a release of AG2 now sending the bare `1.0`.

### 2. Replaced in place

The new recordings take the old case names and file names. The old HAR files and expected records are deleted.

### 3. When a recording is made again

A standing rule, in place of "is not made again". A recording stays as made while it holds something Spectra supports. At the roster's review, a recording that holds only what Spectra no longer supports is recorded again when its entry still runs and now sends a supported form, and is retired otherwise.

### 4. The roster's review in the re-pin procedure

The re-pin procedure's move gains a step: each roster recording is judged at the new pin as standing, to be recorded again, or to be retired, and the judgement goes in the move's outcome under the sub-task that owns the recordings. The recording itself is outside the move.

### 5. The review at this pin

The three v1.0 recordings are recorded again. Every other recording stands as made, the Node restaurant finder's two v0.9 recordings at upstream `020a9d6f` and AG2's v0.9.1 card on `ag2` 1.2.1 among them; the Node restaurant finder's and AG2's roster rows each name two pins.

### 6. AG2's two streams

On `ag2` 1.3.1 with the `a2a-sdk` it resolves, both named in the roster row. The scripted model answers, as before, its script rewritten for 1.3.1: the bare `1.0`, and the function call as `callRendererFunction` named with `@call`. The script's function call is written to the pin's v1.0 agent-to-renderer schema and passes AG2's own validator.

### 7. The Node restaurant finder's booking stream

From the `a2ui-upstream` worktree at `0888f88b2`, in stub mode, in Direct JSON, sent by the request script. The conversation is the old recording's, its two requests with only the version spellings changed: the capabilities key and the action's version, each the bare `1.0`.

### 8. No recording of the envelope keys

The roster stays on the axes of SPEC.md's coverage line. The stub agent's v1.0 booking form is not recorded; the envelope keys stay with the end-to-end tests that drive it.

### 9. A recording is kept as the agent sent it

A recording is kept as the agent answered at its version. Its case description, its roster row and the axis table are written from it. A deviation from the pin's specifications becomes a finding in `_dev/a2ui-findings.md`, read against the pin. If AG2 1.3.1 cannot be made to send a v1.0 stream, or sends one the pin's schema rejects, the work stops there and is brought to Jioh.

### 10. The tests on the old recordings

Each test that opened the old recordings keeps its subject, on the new data or on a hand-written case. A message declaring an unsupported version is a hand-written unit case, declaring `v1.0`.

### 11. The done line

- The three recordings are made at their pins and their expected records written by the expected-record writer.
- The three A2A capture cases pass on them.
- The schema check passes every A2UI turn of the three; of the roster's recordings, only the stub agent's flawed booking fails it.
- Every test that opened the old recordings holds under decision 10.
- Everything CI runs is green from a clean build.

Nothing is looked at through the viewer.

### 12. The documents

- `conformance/README.md`: the roster rows, the axis table, the rule of decision 3, and the paragraph on the v1.0 recordings declaring `v1.0` removed.
- The task 2.3 spec's decision 7, "Recordings are frozen", amended in place to decision 3's rule.
- `_dev/re-pin-procedure.md`: the step of decision 4.
- The Phase 9 spec's decision 12 and the 9.6 line of `_dev/TODO.md`, naming AG2's two streams; the backlog's line on AG2's recording removed.
- Finding 22's standing line in `_dev/a2ui-findings.md`, which has the recording staying on `ag2` 1.2.1.
- The 9.2 spec's outcome line saying the same is left as the record of that move.

## Invariants

- Every recording but the three, its HAR file and its expected record, is unchanged.
- A roster recording holds what its agent sent, not what an earlier case description said.

## Open items

- What becomes of AG2's v1.0 recordings and the backlog's line if `ag2` 1.3.1 gives no usable v1.0 stream: settled when it is known why.
