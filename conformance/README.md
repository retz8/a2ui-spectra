# Conformance Testing

Language-agnostic test data for the A2UI turn record, specified in [`specification/turn_record/`](../specification/turn_record), and for the capture paths that write it. A fixture is a turn record.

## Suite Structure

Test suites are organized by area.

### Turn record (`turn_record/`)

- `turn_record/validator_v0_1.yaml`: validates each fixture against [`specification/turn_record/v0_1/json/turn_record.json`](../specification/turn_record/v0_1/json/turn_record.json). Every case uses `action: validate_turn_record`.
  - Must pass: one minimal fixture per event kind, `minimal_<kind>.json`, holding the turn event and one event of the kind with only the required fields (the `turn` kind's holds just the turn event); and two full records, each two turns of one of upstream's Python samples at 059b8d34, with every kind present and every optional part the sample produces:
    - `full_record_restaurant_finder.json`: a list whose first model request gets a `503` and is retried by the Gemini client, then a booking form whose model call is retried after a failed parse, with streamed responses. Its A2UI messages come from `samples/agent/adk/restaurant_finder/examples/0.9/`.
    - `full_record_custom_components.json`: a contact card with an org chart on the inline catalog, then the floor plan its `view_location` action reads over MCP with HTTP+SSE through the tool proxy. Its A2UI messages come from `samples/agent/adk/custom-components-example/examples/0.9/multi_surface.json` and from the floor plan `a2ui_examples.py` builds. Each JSON-RPC request is one `tool_call` event: its exchange is the POST, and its reply from the `GET /sse` stream is an `event: message` chunk on it. The stream's `endpoint` event is a chunk on `initialize`.
  - Also must pass: `prompt_generation_failed.json` and `chunk_with_id.json`, hand-written minimal fixtures holding the optional attributes of closed attribute sets that neither full record holds: a failed prompt generation's `error.type` with `a2ui.prompt.catalog_version`, and a chunk's `event` and `id`.
  - Must fail: a minimal fixture broken in one place, named for what it breaks. At least one case breaks each unit of the schema: the top level, each shared definition, each kind's rules, the turn's one turn event, and the rule on GenAI content.

### A2A capture (`a2a_capture/`)

- `a2a_capture/capture_v0_1.yaml`: replays A2A traffic recorded once from every entry of the coverage roster through the A2A capture path, and compares the turns it captures with the expected record. Every case uses `action: capture_a2a`. The data is under `test_data/a2a_capture/v0_1/<entry>/`: each conversation's recording as `<conversation>.har`, HAR 1.2, and its expected record as `<conversation>.json`, a turn record v0.1 file holding the conversation's turns.
- A harness starts a replay server that answers each recorded request with its recorded response, puts the capture path in front of it, and sends each recorded request in order. It checks that the host received each response as recorded, a card with only its JSON-RPC endpoints pointed at the capture path, and that the turns captured match the expected record. The comparison takes exact values for everything the traffic determines. The trace ids, span ids, times and the writer's version are Spectra's own: the expected record carries schema-valid stand-ins for them, which the comparison skips, and the harness checks instead that each turn's events share one well-formed trace id, that each wire event's parent is the turn event, and that the turn's start, its wire events and its end are in time order. Spectra's harness is `tools/spectra/src/a2a/capture.conformance.test.ts`.

#### The coverage roster

| Entry                                                                                              | Pinned at                       | How it was run                                                                                                                                                                                                                                                                                                                                                             | Recordings                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream's Python restaurant finder (`samples/agent/adk/restaurant_finder`)                        | upstream 020a9d6f               | `uv run . --port 10012`, Gemini, host: the Angular sample client                                                                                                                                                                                                                                                                                                           | `angular_client/python_restaurant_finder_booking`                                                                                                          |
| Upstream's Node restaurant finder (`samples/agent/node/restaurant_finder`)                         | upstream 020a9d6f               | `PORT=10012 STUB_LLM=true node dist/src/index.js`, no model; hosts: the request script and the React sample client                                                                                                                                                                                                                                                         | `node_restaurant_finder/stream_v1_0_booking`, `node_restaurant_finder/send_task_history_and_failed`, `react_client/node_restaurant_finder_text_and_action` |
| Upstream's custom-components sample (`samples/agent/adk/custom-components-example`)                | upstream 020a9d6f               | `uv run . --port 10014`, Gemini                                                                                                                                                                                                                                                                                                                                            | `custom_components/action_then_model_turn`                                                                                                                 |
| Upstream's community file-upload summarizer (`samples/community/agent/adk/file_upload_summarizer`) | upstream 020a9d6f               | `uv run . --port 10018`, Gemini                                                                                                                                                                                                                                                                                                                                            | `file_upload_summarizer/artifact_stream_and_send`                                                                                                          |
| A2UIVerse's CircleCI agent (`circleci/agent`)                                                      | a2uiverse-apps 208067d          | `uv run python -m app --mode deterministic --port 11014 --host 127.0.0.1 --state-dir <dir>`, no model; a token from `uv run python -m a2ui_agent_kit.preview_credential --url http://127.0.0.1:11014 --account retz8`, sent as `A2UIVERSE_TOKEN`                                                                                                                           | `a2uiverse_circleci/runs_then_confirm_rerun`                                                                                                               |
| AG2's `A2UIAgentExecutor`                                                                          | `ag2` 1.2.1 and `a2a-sdk` 1.2.3 | [`_dev/tools/ag2_a2ui_server.py`](../_dev/tools/ag2_a2ui_server.py) with AG2's scripted model: `--version v0.9.1 --reply card`, `--version v1.0 --reply function_call`, `--version v1.0 --reply fail`                                                                                                                                                                      | `ag2/send_v0_9_1_card`, `ag2/stream_v1_0_function_call`, `ag2/stream_v1_0_failed`                                                                          |
| filipw/strathweb-a2ui's BookingWizard                                                              | c92222f                         | `docker run --rm -v <clone>:/src -w /src -p 127.0.0.1:5202:5202 mcr.microsoft.com/dotnet/sdk:10.0@sha256:747cbade5bfd918a175ac32f8f1d931edec2c7d0d5397a3de72eaef1ac1f66d2 dotnet run --project samples/BookingWizard --urls http://0.0.0.0:5202`, no model; its card lists no interface, so the request file names its endpoint, `/a2a`, and Spectra does not attach to it | `strathweb_booking_wizard/send_then_stream`                                                                                                                |
| muncus/a2term's `cmd/examplesvc`                                                                   | 79426d3                         | `docker run --rm -v <clone>:/src -w /src -p 127.0.0.1:9002:9002 golang:1.27@sha256:f20d83a83e18dbd2a4714b8ffd4b30b287b6243962dd75608e86abcc63ba4efc go run ./cmd/examplesvc --host 0.0.0.0 --port 9002`, no model                                                                                                                                                          | `a2term_examplesvc/send_multipart_and_tagged_text`                                                                                                         |
| The stub agent ([`stub_agent/`](stub_agent/stub_agent.ts))                                         | this repository                 | `node dist/stub_agent/stub_agent.js --port 10013`, no model; `--flawed-booking` for the flawed booking conversation                                                                                                                                                                                                                                                        | `stub_agent/cancel_a2a_1_0`, `stub_agent/cancel_a2a_0_3`, `stub_agent/flawed_booking_a2a_1_0`                                                              |
| Upstream's Angular sample client (`samples/client/angular`), as host                               | upstream 020a9d6f               | `yarn build:renderer`, then `ng serve restaurant`, its `/a2a` route sent `{"query": …}` and `{"event": …}` bodies                                                                                                                                                                                                                                                          | `angular_client/python_restaurant_finder_booking`                                                                                                          |
| Upstream's React sample client (`samples/client/react/shell`), as host                             | upstream 020a9d6f               | `vite --port 5003`, its `/a2a` route sent a text body and an action body                                                                                                                                                                                                                                                                                                   | `react_client/node_restaurant_finder_text_and_action`                                                                                                      |

Both sample clients reach their agent at `localhost:10002`, where the recording proxy listened in front of the agent on 10012. Spectra's message box joins the hosts in sub-task 2.5.

The axes of SPEC.md's coverage line, and the entries that exercise each:

| Axis                  | Value                                  | Entries                                                                                                                                              |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2UI protocol version | v0.9                                   | the Python and Node restaurant finders, the custom-components sample, the file-upload summarizer, A2UIVerse's CircleCI agent, a2term, the stub agent |
|                       | v0.9.1                                 | AG2, strathweb-a2ui                                                                                                                                  |
|                       | v1.0                                   | the Node restaurant finder, AG2                                                                                                                      |
| A2A version           | 0.3                                    | upstream's samples, A2UIVerse's CircleCI agent, the stub agent                                                                                       |
|                       | 1.0                                    | AG2, strathweb-a2ui, a2term, the stub agent                                                                                                          |
| A2A SDK               | Python's `a2a-sdk`                     | the Python restaurant finder, the custom-components sample, the file-upload summarizer, A2UIVerse's CircleCI agent, AG2                              |
|                       | JavaScript's `@a2a-js/sdk`             | the Node restaurant finder, the stub agent                                                                                                           |
|                       | another language's: a2a-dotnet, a2a-go | strathweb-a2ui, a2term                                                                                                                               |
| Wire form             | a send                                 | the Node restaurant finder, the file-upload summarizer, AG2, strathweb-a2ui, a2term                                                                  |
|                       | a stream                               | every entry but a2term                                                                                                                               |
|                       | A2UI in a task's status message        | the Python and Node restaurant finders, the custom-components sample, A2UIVerse's CircleCI agent, AG2, the stub agent                                |
|                       | A2UI in an artifact                    | the file-upload summarizer                                                                                                                           |
|                       | A2UI in a plain message reply          | strathweb-a2ui, a2term                                                                                                                               |
|                       | one A2UI message per part              | upstream's samples, A2UIVerse's CircleCI agent, the stub agent                                                                                       |
|                       | an array per part                      | AG2, strathweb-a2ui, a2term                                                                                                                          |
|                       | the MIME type in the part's metadata   | every entry with A2UI but AG2                                                                                                                        |
|                       | the MIME type on the part              | AG2 and a2term in replies, the React sample client in requests                                                                                       |
| Turn outcome          | completed                              | every entry                                                                                                                                          |
|                       | waiting for input                      | the Python and Node restaurant finders, A2UIVerse's CircleCI agent (`auth-required`), AG2                                                            |
|                       | failed                                 | the Node restaurant finder (a failed task), the custom-components sample (a stream that breaks off), AG2 (a JSON-RPC error)                          |
|                       | cancelled                              | the stub agent                                                                                                                                       |
| Host                  | upstream's Angular sample client       | the Python restaurant finder                                                                                                                         |
|                       | upstream's React sample client         | the Node restaurant finder                                                                                                                           |

#### Recording

A recording is made once, at the entry's pinned commit or version. At each move of the upstream pin the roster is reviewed: an entry whose recordings hold only what Spectra no longer supports is retired with its recordings, and an axis left without an entry goes to an agent built for it.

- [`_dev/tools/record_a2a_traffic.py`](../_dev/tools/record_a2a_traffic.py) is the recording proxy: it relays each exchange between the host and the agent, rewrites the card it serves so the host's calls come back through it, and writes each exchange as the agent answered it. A recording keeps only `content-type`, `accept`, `A2A-Version`, `X-A2A-Extensions` and `A2A-Extensions`, so no credential is written. A response whose connection broke before it ended keeps the bytes that arrived and carries HAR's custom field `_brokenOff`.
- [`_dev/tools/send_a2a_requests.py`](../_dev/tools/send_a2a_requests.py) sends a conversation's requests, from its request file under [`_dev/tools/a2a_requests/`](../_dev/tools/a2a_requests/), for the entries no host reaches.
- [`_dev/tools/write_a2a_capture_records.py`](../_dev/tools/write_a2a_capture_records.py) writes each expected record from its recording, by the rules of `_dev/docs/spec/task-2.2-a2a-adapter.md`, sharing no code with the capture path.

All fixtures are located in `test_data/`, under `test_data/<area>/<version>/`, and are exempt from Prettier. The turn record v0.1 fixtures and their case list are written by [`_dev/tools/make_fixtures.py`](../_dev/tools/make_fixtures.py), which reads upstream's samples at 059b8d34 and computes the full records' component ranges, timings and repeated content.

`conformance_schema.json` at the root is the JSON schema that validates the structure of the YAML case files. The harness validates each case file against it before running any case.

## The stub agent

[`stub_agent/stub_agent.ts`](stub_agent/stub_agent.ts) is a small A2A agent on `@a2a-js/sdk` 1.3.0, serving A2A 1.0 and, through the SDK's compatibility layer, A2A 0.3 on one JSON-RPC endpoint. Run it from `conformance/` after `yarn build`, as `node dist/stub_agent/stub_agent.js`.

| Option             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`       | The port to listen on, on 127.0.0.1. Default: `$PORT`, or 10013.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--canned-a2ui`    | Holds the canned A2UI conversation instead of waiting for a cancel. A message that opens a task gets a surface asking for a name and ends waiting for input; a message carrying that task's id gets the name greeted and completes. It answers in the newest A2UI version the message's capabilities name under that version's metadata key, and echoes that version's extension URI in the reply's extensions header. On A2A 1.0 one data part holds the array of A2UI messages; on A2A 0.3 each message is its own data part.       |
| `--flawed-booking` | Is the Flawed Booking Agent instead of waiting for a cancel. A message gets a completed task whose status message holds a text part and a booking form in A2UI v0.9, whatever the host offers, each message its own data part, and the v0.9 extension URI in the reply's extensions header. The form carries mistakes the checks and web core's message processor find: a Button with a property the basic catalog does not define, an `updateComponents` to a surface never created, and an `updateDataModel` that names no surface. |
| `--a2a-0.3-first`  | Lists the A2A 0.3 interface before the A2A 1.0 one in the card's `supportedInterfaces`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Without `--canned-a2ui` or `--flawed-booking`, the stub waits for a cancel, the behaviour its roster row records: a message opens a task that sends a working status and stays open until the host cancels it, then gets a canceled status on the open stream. Spectra's end-to-end test, `tools/spectra/src/end_to_end.test.ts`, runs it with `--canned-a2ui`, once as it is and once with `--a2a-0.3-first`.

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

## Writing cases for `capture_a2a`

| Field         | Required | Meaning                                                      |
| ------------- | -------- | ------------------------------------------------------------ |
| `name`        | yes      | Unique name of the case.                                     |
| `description` | yes      | The roster entry and the axis values the recording verifies. |
| `action`      | yes      | `capture_a2a`.                                               |
| `traffic`     | yes      | Path of the HAR recording, relative to `conformance/`.       |
| `expect`      | yes      | Path of the expected record, relative to `conformance/`.     |

```yaml
- name: stub_agent_cancel_a2a_1_0
  description: 'The stub agent over A2A 1.0: a stream the host cancels while it is open, ending cancelled.'
  action: capture_a2a
  traffic: 'test_data/a2a_capture/v0_1/stub_agent/cancel_a2a_1_0.har'
  expect: 'test_data/a2a_capture/v0_1/stub_agent/cancel_a2a_1_0.json'
```

## Checks on the test data as a whole

- Every kind the schema defines appears in at least one must-pass fixture.
- Every file under `test_data/turn_record/` is named by a case.
- Every expected record of the A2A capture suite validates against the turn record schema.
- Every file under `test_data/a2a_capture/` is named by a case.

## Commands

From `conformance/`:

- `yarn build`: compiles the harness in `tests/` and the stub agent in `stub_agent/` into `dist/`.
- `yarn test`: builds, then runs the suites with Node's test runner.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
