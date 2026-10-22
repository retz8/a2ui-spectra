# Task 1.3 — The shared test data

Spec for sub-task 1.3 of Phase 1 — Foundation (`_dev/docs/spec/phase-1-foundation.md`): the case list, the hand-written fixtures and the validation harness filling the test workspace. The Phase 1 spec's decision on the shared test data applies, and the record is turn record v0.1 as sub-task 1.2 specifies it (`_dev/docs/spec/task-1.2-turn-record.md`). Upstream's conventions are read from `upstream/main` at 059b8d34, the Phase 1 pin.

## Scope

- The case list for turn record v0.1, and the schema for case files.
- The hand-written fixtures, must-pass and must-fail.
- The validation harness in the test workspace, run by its test target in CI.
- The test workspace's README.
- Whether the fixtures are exempt from Prettier, left open by sub-task 1.1.

## Locked decisions

### 1. The case list's format

YAML, in upstream's case vocabulary. Each case has a name, a description, an action and the path of its fixture. A must-fail case also carries `expectError`.

### 2. Where the files live

A `turn_record/` area, beside the areas upstream groups its suites by. The suite is `conformance/turn_record/validator_v0_1.yaml`. The fixtures are in `conformance/test_data/turn_record/v0_1/`, and a case names its fixture by a path relative to `conformance/`. Later phases add their capture-path suites to `turn_record/`. The harness's tests are in `conformance/tests/`.

### 3. The case schema

`conformance/conformance_schema.json`, in JSON Schema draft 2020-12, defines the fields a case may use. The harness validates the case file against it before running any case. A must-fail case must have a description. Later phases add their actions to it.

### 4. The case action

`validate_turn_record`.

### 5. What a must-fail case pins

`expectError` holds `category: ValidationError` and `details`, a list of `path` and `code`. `path` is the JSON Pointer to the failing value and `code` is the keyword that failed, as JSON Schema 2020-12's output format reports them. The case passes when validation fails and each detail matches at least one reported error. The description gives the reason in words.

### 6. Must-fail fixtures

Each is a small, complete file: a minimal record of one turn, holding the turn event and only the events the broken rule needs, broken in exactly one place.

### 7. Must-pass fixtures

One minimal fixture per kind, nine in all: a one-turn record holding the turn event and one event of the kind, with only the required fields. The turn kind's fixture holds just the turn event. One full record: two turns, an earlier one and the recorded one, with every kind present and every optional part filled in, including links, streamed chunks, a received span with its original attributes, a retry, and failing checks with findings. The must-fail fixtures are the minimal fixtures, each broken in one place.

### 8. Must-fail coverage

At least one must-fail case per unit of the schema:

- the top level: the version value, and an empty turn list;
- each of the 13 shared definitions;
- each of the nine kinds' rule branches;
- the turn's one turn event, broken with zero turn events and with two;
- the prose's rule on GenAI content: a tool result that is not a JSON object, in `gen_ai.tool.call.result`.

### 9. Checks on the test data as a whole

The harness fails when a kind the schema defines appears in no must-pass fixture, and when a file under `conformance/test_data/turn_record/` is named by no case.

### 10. Fixture content

The full record's A2UI messages come from upstream's restaurant finder examples for v0.9 (`samples/agent/adk/restaurant_finder/examples/0.9/`) at 059b8d34, recorded as v0.9. Its failing checks point at real paths in those messages. The minimal fixtures carry the smallest message their part needs, written by hand.

### 11. Fixture names

Descriptive, all in the one `v0_1/` directory: `minimal_<kind>.json` for the minimal fixtures, `full_record.json` for the full record, and each must-fail fixture named for what it breaks.

### 12. Prettier

The fixtures are exempt from Prettier, as upstream's `conformance/test_data/**` is. The case file, the case schema and the harness are formatted.

### 13. The harness

TypeScript, compiled by `tsc` and run by Node's built-in test runner, reading YAML with `js-yaml`, as upstream web core's expression parser conformance test does. The test workspace's build becomes the TypeScript compile, and its lint becomes ESLint with the root ESLint preset.

### 14. The validator

Ajv 8, its draft 2020-12 build, in strict mode, with the draft-07 meta-schema loaded for the copied GenAI schema that declares it. `format` is an annotation and is not checked.

### 15. The README

`conformance/README.md`, in upstream's shape: the `turn_record/` area and its suite, the `validate_turn_record` case vocabulary, where fixtures live and how cases name them, the two checks on the test data as a whole, and the build, lint and test commands.
