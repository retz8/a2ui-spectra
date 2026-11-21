---
name: a2ui-spectra
description: >-
  Sees, checks, debugs and regression-tests what an A2UI agent actually sends,
  with Spectra for A2UI (the `a2ui-spectra` command). Use when an A2UI agent's
  output needs to be verified or is wrong: a surface that does not render, is
  missing or shows the wrong data, an A2UI validation, schema or catalog error,
  a parse failure or retry in the agent SDK, an action or button press the
  agent does not answer, or a need to see the exact model request, the tool
  calls or the A2UI messages of a turn. Also use to save a turn as a fixture,
  replay it without paying for the model, or run `a2ui-spectra test`, and
  whenever Spectra, a2ui-spectra, a2ui-spectra.json or a turn record is
  mentioned. Works with any agent that serves A2UI over A2A, in any language.
license: Apache-2.0
---

# Spectra for A2UI

Spectra runs beside an A2UI agent and records each turn: the A2UI messages on the wire, the model and tool calls, and four checks of the A2UI against its schema and catalog. A person reads turns in its viewer, in a browser. You read the same turns over HTTP with `curl`, so you can see what the agent really sent instead of guessing from its code.

Spectra works with agents that serve A2UI over A2A, the Agent2Agent protocol, on JSON-RPC. For another transport, tell the person Spectra does not cover it yet.

## Rules

1. **Ask before installing.** Ask the person before installing Spectra, or adding the wrapper or a preview adapter, to their repository.
2. **Never say how a surface looks.** The checks say whether the A2UI is valid. Only the person, looking at the preview in the viewer, can say it looks right.
3. **Stop what you started.** When the work is done, stop the Spectra process you started; that stops the agent under it. Leave a Spectra you did not start running.
4. **Ask before committing a fixture.** A fixture holds the prompt, the model's replies and the tools' results. Credentials are never in it. Whether it is safe to commit is the person's call.
5. **Say what a step costs.** A live turn and a replay with the model live spend model tokens. A replay with everything recorded and `a2ui-spectra test` are free; prefer them to check a fix again. For one live turn, say so and go on. Before a loop of many live turns, ask.
6. **Trust the binary over this file.** Where `a2ui-spectra <command> --help` or an answer from the API differs from this file, the binary is right.
7. **Report from the record.** When you say a turn passed or failed, quote its outcome and its problems from the record.

## Before the loop

- **Is Spectra installed?** `a2ui-spectra --version` prints a version. If the command is missing, see [Setting Spectra up](#setting-spectra-up).
- **Is Spectra already running?** `curl -s http://localhost:9820/api/context` answers when it is. Use that one, and do not start a second or stop it.
- **What you need to know:** the command that starts the agent, and the address it serves A2A on, such as `http://localhost:10002`. An `a2ui-spectra.json` in the agent's folder may already name the address as `agent.url`; then leave `--agent-url` out.
- **Keep your own files out of the agent's folder.** Spectra restarts the agent when a file in that folder is saved. Write logs and saved answers under `/tmp/a2ui-spectra`, as the commands below do.

- **On Windows,** read [references/windows.md](references/windows.md) first: the same loop, with the commands that PowerShell writes differently.

Every address below is the viewer's port, 9820 by default. Every `POST` needs `-H 'content-type: application/json'`. A refusal is one line, `{"error": "…"}`, written to be read: read it.

## The loop

### 1. Start the agent under Spectra

From the agent's folder, in the background. If your harness has its own way to run a command in the background, use it with the same command.

```sh
mkdir -p /tmp/a2ui-spectra
nohup a2ui-spectra run --no-open --agent-url <agent-url> -- <agent-command> > /tmp/a2ui-spectra/spectra.log 2>&1 &
echo $! > /tmp/a2ui-spectra/spectra.pid
```

Wait until the agent's card has answered:

```sh
for i in $(seq 1 60); do
  curl -s http://localhost:9820/api/agent | grep -q '"state":"running"' && break
  sleep 1
done
curl -s http://localhost:9820/api/agent
```

If the state is not `running`, read `/tmp/a2ui-spectra/spectra.log`: a port that is taken, a wrong `--agent-url` and a command that exits each say so there. The agent's own output is at `curl -s http://localhost:9820/api/agent/logs`.

For an agent the person already has running and wants left alone, `a2ui-spectra attach <agent-url>` watches it without owning its process. It sees the wire only, unless the variables it prints are set in the agent's shell.

### 2. Send a message

```sh
curl -s -X POST http://localhost:9820/api/message-box/messages \
  -H 'content-type: application/json' -d '{"text": "<message>"}'
```

It answers as soon as the turn opens, with the turn's id: `{"traceId":"<trace-id>"}`. It does not wait for the agent's reply. `422` means the agent is not ready; the line says why.

### 3. Wait for the turn, and read its problems

The turn has no record until it closes; until then the route answers `409`.

```sh
for i in $(seq 1 180); do
  code=$(curl -s -o /tmp/a2ui-spectra/turn.json -w '%{http_code}' http://localhost:9820/api/turns/<trace-id>)
  [ "$code" != 409 ] && break
  sleep 1
done
echo "$code"
```

`200` means `/tmp/a2ui-spectra/turn.json` is the turn record. Start with the summary:

```sh
curl -s http://localhost:9820/api/turns
```

It lists every turn, newest first. On this turn's row:

| Field            | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `outcome`        | `completed`, `waiting_for_input`, `failed` or `cancelled`                      |
| `findings`       | How many problems the four checks found. `0` means the A2UI is valid           |
| `rejections`     | A2UI messages the renderer's core refuses that no finding points at            |
| `failedCalls`    | Model or tool calls that failed. Absent when none did                          |
| `a2uiStepErrors` | Parse or validation errors inside the agent SDK. Absent when none, or not seen |

Then the record. It is `{"version", "turns": [...]}`: the conversation's earlier turns first, this turn last. A turn is `{"events": [...]}`, and every event says what it is in `attributes["a2ui.event.kind"]`:

| Kind                        | What to read in `attributes`                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn`                      | `a2ui.turn.outcome`, `a2ui.turn.protocol_version`, and `a2ui.turn.capture_paths`: how deep Spectra saw, of `wire`, `model_proxy`, `tool_proxy`, `otel_receiver`, `a2ui_step`            |
| `wire_input`, `wire_output` | `a2ui.wire.message`: what the host sent and what the agent replied. A part of type `a2ui` holds the A2UI messages; a part of type `text` holds text                                     |
| `check`                     | `a2ui.check.name`, one of `schema`, `catalog`, `structural`, `binding`; `a2ui.check.passed`; `a2ui.check.findings`; and `a2ui.check.skipped`, the surfaces it could not judge, with why |

A finding is `{"code", "message", "path", "surfaceId"}`. Its `message` says what is wrong. Its `path` is a JSON pointer into this turn, such as `/events/2/attributes/a2ui.wire.message/parts/5/content/updateDataModel`: follow it to the exact message or component.

- `schema`: a message does not match the schema of its A2UI version.
- `catalog`: a component or a property is not in the catalog. The basic catalog is built in; the agent's own catalog is checked only when `a2ui-spectra.json` lists it under `catalogs`.
- `structural`: a child id that names no component, no root, a loop, or a surface never created.
- `binding`: the UI binds to a path the data model does not fill.

### 4. Read inside the turn

When a check does not explain the fault, read how the turn was made. These events are in the record only when that capture path reached the agent; `a2ui.turn.capture_paths` says which did.

| Kind                | What to read in `attributes`                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_call`        | `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.tool.definitions`: the exact request. `gen_ai.output.messages`: the model's raw reply. `gen_ai.usage.*`: tokens. `a2ui.retry.attempt`: a retry. `http.response.status_code`: the provider's answer, when the call failed |
| `tool_call`         | `gen_ai.tool.name`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`                                                                                                                                                                                                             |
| `parse`             | `a2ui.parse.input`: the raw text the agent SDK was given. `a2ui.parse.messages`: the A2UI it became. `a2ui.parse.inference_format`. A failed parse has `status.code` `2` and its error in `status.message`                                                                              |
| `prompt_generation` | `a2ui.prompt.ui_section`: the part of the prompt the agent SDK wrote from the catalog                                                                                                                                                                                                   |

An event with `status.code` `2` failed. No `model_call` at all means the agent's model client does not read the base-URL variable Spectra sets, or calls Vertex AI. No `parse` means the wrapper is not on. Both are in [Setting Spectra up](#setting-spectra-up).

### 5. Send an action

To test what happens after a button press, send the A2UI action as the next turn of the same conversation. The conversation's id is in `curl -s http://localhost:9820/api/message-box` once its first turn has closed.

```sh
curl -s -X POST http://localhost:9820/api/message-box/messages \
  -H 'content-type: application/json' -d '{
    "action": {"version": "<a2ui-version>", "action": {"name": "<action-name>", "surfaceId": "<surface-id>",
      "sourceComponentId": "<component-id>", "timestamp": "<iso-8601-time>", "context": {}}},
    "conversationId": "<conversation-id>"}'
```

Build it from the surface the agent sent: the component's action gives the name and the context, and `version` is written as the agent's own A2UI messages write theirs. For a surface the agent created with `sendDataModel`, add `"dataModel": {"version": "<a2ui-version>", "surfaces": {"<surface-id>": {…}}}` beside `action`, holding the surface's data as the form would leave it. Then wait and read as in step 3.

### 6. Fix, and send again

Edit the agent's code. Under `run`, saving a file in the agent's folder restarts the agent. To restart it by hand:

```sh
curl -s -X POST http://localhost:9820/api/agent/restart -H 'content-type: application/json' -d '{}'
```

Wait for `running` as in step 1, then send the same message again and read the new turn. A restarted agent has usually lost its conversations: send the first message again, not an action into an old conversation.

### 7. Keep the fix: a fixture, and the test command

Once a turn is right, save it as a fixture. The name takes letters, digits, `-`, `_` and `.`.

```sh
curl -s -X POST http://localhost:9820/api/fixtures \
  -H 'content-type: application/json' -d '{"traceId": "<trace-id>", "name": "<fixture-name>"}'
```

It answers `201` with the file's `path`, under `a2ui-spectra-fixtures/` in the agent's folder unless the config file names another folder.

`replay` and `test` start the agent themselves and use Spectra's ports, so stop the Spectra you started first:

```sh
kill "$(cat /tmp/a2ui-spectra/spectra.pid)"
```

Then replay every fixture with the model and the tools answered from the record, free:

```sh
a2ui-spectra test --agent-url <agent-url> -- <agent-command>
```

It prints one line per fixture and exits `0` when every one passes. A fixture passes when every call was served from its record and the agent sent the same A2UI. One fixture alone:

```sh
a2ui-spectra replay <fixture-path> --agent-url <agent-url> -- <agent-command>
```

- A miss after a prompt change is expected: the request no longer matches the record. `a2ui-spectra replay <fixture-path> --model-live` calls the model only from the request that changed, and costs those tokens.
- A record with no model call and no tool call in it cannot be replayed from the record.
- `test` is the regression check to leave behind: it fits CI as it is.

## Setting Spectra up

Ask first, under rule 1. Spectra is one binary and adds nothing to the agent's code. Any of these gives the same command:

- With Node 22 or later, no install: `npx a2ui-spectra`, used in place of `a2ui-spectra` in every command above.
- With uv, no install: `uvx a2ui-spectra`, used the same way.
- On macOS or Linux: `curl -fsSL https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.sh | sh`
- On Windows: `irm https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.ps1 | iex`

With nothing more, Spectra sees the wire, the checks on the basic catalog, and the model calls of an agent whose model client reads `GOOGLE_GEMINI_BASE_URL`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GEMINI_API_BASE` or `ANTHROPIC_API_BASE`. API keys stay where they are, in the agent's environment. Each further step is optional and adds to what a turn's record holds:

- **Checks against the agent's own catalog, and tool calls:** `a2ui-spectra.json` in the agent's folder, with `catalogs`, `tools` and `agent.url`. See [the config file](https://github.com/retz8/a2ui-spectra/blob/main/tools/spectra/README.md#the-config-file).
- **`parse` and `prompt_generation` events:** the wrapper, for an agent on upstream's agent SDK, and a changed launch command. `uv add --dev a2ui-spectra-instrumentation` in [Python](https://github.com/retz8/a2ui-spectra/blob/main/python/a2ui_spectra_instrumentation/README.md), `npm install --save-dev a2ui-spectra-instrumentation` in [TypeScript](https://github.com/retz8/a2ui-spectra/blob/main/typescript/instrumentation/README.md).
- **The agent framework's own spans:** an OTLP exporter over HTTP in the agent. See [OpenTelemetry](https://github.com/retz8/a2ui-spectra/blob/main/docs/design/opentelemetry.md).
- **The person's own components in the preview:** a preview adapter and its page, in the catalog's app. See [the preview](https://github.com/retz8/a2ui-spectra/blob/main/docs/design/preview.md).

Every route, with its answers and refusals, is in [The API](https://github.com/retz8/a2ui-spectra/blob/main/docs/design/api.md). Every field of a record is in [the turn record's specification](https://github.com/retz8/a2ui-spectra/blob/main/specification/turn_record/v0_1/docs/turn_record.md).
