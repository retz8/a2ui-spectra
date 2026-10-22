# Conformance Testing

Language-agnostic test data for the A2UI turn record, specified in [`specification/turn_record/`](../specification/turn_record). A fixture is a turn record.

## Suite Structure

Test suites are organized by area.

### Turn record (`turn_record/`)

- `turn_record/validator_v0_1.yaml`: validates each fixture against [`specification/turn_record/v0_1/json/turn_record.json`](../specification/turn_record/v0_1/json/turn_record.json). Every case uses `action: validate_turn_record`.
  - Must pass: one minimal fixture per event kind, `minimal_<kind>.json`, holding the turn event and one event of the kind with only the required fields (the `turn` kind's holds just the turn event); and two full records, each two turns of one of upstream's Python samples at 059b8d34, with every kind present and every optional part the sample produces:
    - `full_record_restaurant_finder.json`: a list, then a booking form whose model call is retried after a failed parse, with streamed responses. Its A2UI messages come from `samples/agent/adk/restaurant_finder/examples/0.9/`.
    - `full_record_custom_components.json`: a contact card with an org chart on the inline catalog, then the floor plan its `view_location` action reads over MCP with HTTP+SSE through the tool proxy. Its A2UI messages come from `samples/agent/adk/custom-components-example/examples/0.9/multi_surface.json` and from the floor plan `a2ui_examples.py` builds. Each JSON-RPC request is one `tool_call` event: its exchange is the POST, and its reply from the `GET /sse` stream is an `event: message` chunk on it. The stream's `endpoint` event is a chunk on `initialize`.
  - Must fail: a minimal fixture broken in one place, named for what it breaks. At least one case breaks each unit of the schema: the top level, each shared definition, each kind's rules, the turn's one turn event, and the rule on GenAI content.

All fixtures are located in `test_data/`, under `test_data/<area>/<version>/`, and are exempt from Prettier.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML case files. The harness validates each case file against it before running any case.

## Writing cases for `validate_turn_record`

| Field         | Required      | Meaning                                                            |
| ------------- | ------------- | ------------------------------------------------------------------ |
| `name`        | yes           | Unique name of the case.                                           |
| `description` | for must-fail | What the case verifies. For a must-fail case, the reason it fails. |
| `action`      | yes           | `validate_turn_record`.                                            |
| `fixture`     | yes           | Path of the fixture, relative to `conformance/`.                   |
| `expectError` | for must-fail | The failure the fixture must produce.                              |

A case without `expectError` passes when the fixture validates. A case with it passes when the fixture fails validation and every entry of `expectError.details` matches at least one reported error:

```yaml
- name: turn_without_outcome
  description: The turn event has no outcome.
  action: validate_turn_record
  fixture: test_data/turn_record/v0_1/turn_without_outcome.json
  expectError:
    category: ValidationError
    details:
      - path: /turns/0/events/0/attributes
        code: required
```

`path` is the JSON Pointer to the failing value in the fixture, and `code` is the keyword that failed, as JSON Schema 2020-12's output format names them. Ajv reports a failed `contains`, `minContains` and `maxContains` alike as `contains`, so the harness counts the matching items to name the one that failed.

The harness validates with Ajv 8's draft 2020-12 build in strict mode, with Ajv's `strictTypes` and `strictRequired` checks off. It loads the copied GenAI schemas under their addresses relative to `turn_record.json`'s `$id`, and the draft-07 meta-schema that `gen-ai-tool-definitions.json` references. `format` is an annotation and is not checked.

## Checks on the test data as a whole

- Every kind the schema defines appears in at least one must-pass fixture.
- Every file under `test_data/turn_record/` is named by a case.

## Commands

From `conformance/`:

- `yarn build`: compiles the harness in `tests/` into `dist/`.
- `yarn test`: builds, then runs the suites with Node's test runner.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
