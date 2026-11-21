# Sub-task 10.8 — The contracts at release

The two contracts a release rests on, before `0.1.0` ships them: turn record `v0.1`'s closing review and the amendments it makes while `v0.1` is a draft; the newer-record rule, for a record file and for a producer's spans; and the preview mismatch line naming the side to upgrade. Sub-task 10.8 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 13, turn record `v0.1` before it closes, and its decision 14, the preview protocol is matched exactly, under SPEC.md's "Turn record" and "Preview". Nothing is published, and `v0.1` stays a draft: closing it is Phase 11's.

The upstream check at this sub-task's start, on 2026-11-21, read `upstream/main` at `5ff1b05f0` (2026-11-20), 50 commits after the pin `0888f88b2`, five after the reading the 10.7 spec opens with, and found no event: npm and PyPI carry no new release of an upstream package; the three v1.0 schemas and the v1.0 basic catalog are unchanged, `specification/versions.json` is unchanged and the five watch-list items are open; of the two commits on a held-by finding's paths, `97d0cfe83`, rejecting an out-of-range number in Direct JSON, on finding 36's, that no inference format names itself, and `5f2245c53`, a message processor taking a catalog after it is built, on finding 42's, the duplicate-id error carrying the id as a plain string, neither is its fix; no OpenTelemetry release inside a stated range is newer than the lockfiles resolve; and upstream's two install scripts and their test are unchanged since the pin.

As read on 2026-11-21:

- **Spectra's own code and record.**
  - A record file is read by one function, `readRecord` in `tools/spectra/src/fixtures/fixtures.ts`, for the `replay` command, the `test` command and the fixtures folder. It refuses any `version` other than `v0.1` with "The file is not a turn record v0.1: its version is v0.2." The local store, `tools/spectra/src/store/store.ts`, checks no version: the server hands a stored record to the viewer as it is, and a new turn of a conversation takes its earlier turns from the conversation's latest stored record that reads as one and writes them into a file stamped `v0.1`.
  - A span of the A2UI step carries `a2ui.event.kind` and its kind's attributes, and states no version. Both wrappers' tracer scope is named `a2ui-spectra-instrumentation` and carries the package's version. A span of the step missing a required attribute is written as a framework span, and the terminal names the missing attribute.
  - The viewer's switch-on hint, on a turn with no A2UI step, reads "No A2UI step recorded · switch the wrapper on to see which text became which component".
  - The preview protocol is at 2. A page's ready message carries its `type`, `a2ui-spectra-preview/ready`, its `protocol` number and its claims; the viewer recognises it by the `type` alone and compares the number. The mismatch line reads "preview page speaks protocol 1, this Spectra speaks 2". The preview core's README names the ready message's version and says nothing of the message across versions.
  - `a2ui.turn.capture_paths` is a closed list of `wire`, `model_proxy`, `tool_proxy`, `otel_receiver` and `wrapper`; `wrapper` joins it when a `prompt_generation` or `parse` event is placed in the turn, whoever produced it.
  - `a2ui.replay.source` is written with the platform's own path separator.
  - The record's prose gives a wire message's role by direction: "The host's input has the role `user`. The agent's output has the role `assistant`." The copied GenAI schema allows `system`, `user`, `assistant`, `tool` or any other string. Nothing in Spectra branches on the role.
  - The tool proxy writes span kind `4` on a tool call the server initiated, the record's prose resting it on "the pinned MCP conventions"; the replay pool and the viewer tell such events apart by the kind.
  - The model proxy writes `gen_ai.response.time_to_first_chunk` as the seconds from the request to the first server-sent event of any kind.
  - The receiver reads a structured attribute of the step from its JSON text alone.
  - `run` sets `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` to `true` unless Spectra's own environment sets it, and `attach` prints it.
  - The schema's `$id` is the raw GitHub address of `turn_record.json` on this repository's `main`. A record carries its `version` and never the `$id`.
  - Of the 200 committed turn records under `conformance/test_data/`, 107 hold a span of the A2UI step, 84 wrapper capture records, 19 turn record fixtures and 4 receiver capture records; 106 name the capture path `wrapper`; 2 hold a `data` part and 18 an `a2ui` part; 3 events carry `rpc.response.status_code`, 2 events have kind `4`, and 39 events in 12 files carry `gen_ai.response.time_to_first_chunk`.
- **AG-UI**, `ag-ui-protocol/ag-ui` at `a6f2539a2ad9ba016129217637b83b7068adc6c1` (2026-11-20), AG-UI 1.0, with `@ag-ui/a2ui-middleware` 0.0.16 in the same repository.
  - A run ends with `RUN_FINISHED`, whose outcome is `success`, `interrupt` or `cancelled`, an absent outcome meaning success, or with `RUN_ERROR`. A stream that breaks has no outcome.
  - `RunAgentInput` holds `threadId`, `runId`, `parentRunId`, `state`, `messages`, `tools`, `context`, `forwardedProps` and `resume`. Of `messages`: "A producer MUST treat it as the complete history it is being shown — the protocol has no side channel through which earlier turns arrive".
  - A text message's start event carries `role`, one of `developer`, `system`, `assistant` and `user`; a tool result event carries `tool`.
  - The middleware carries A2UI as `ACTIVITY_SNAPSHOT` events of `activityType` `a2ui-surface`, each snapshot cumulative and replacing the one before, its content `{ a2ui_operations: [...] }`; a user's action travels in `forwardedProps.a2uiAction`.
- **OpenTelemetry's GenAI conventions**, `open-telemetry/semantic-conventions-genai`, from the record's pin `8538971b` (2026-10-21) to the head `0f338529` (2026-11-21), 67 commits.
  - `v0.1.0` was released on 2026-11-21 at `d0e74ba6`: "First standalone release of the GenAI semantic conventions… Depends on semantic-conventions v1.45.0." The head differs from it in the manifest's version string alone. Every GenAI and MCP name the record uses is at Development level.
  - Core conventions `v1.45.0` rename `rpc.response.status_code` to `rpc.status_code` and deprecate the old name; the MCP conventions switched on 2026-11-20 (#732).
  - Four of the eight copied schemas changed, `gen-ai-input-messages.json`, `gen-ai-output-messages.json`, `gen-ai-system-instructions.json` and `gen-ai-tool-definitions.json`. The catch-all part now excludes the eleven names the conventions define, and a part carrying one of them must meet that type's definition. Neither `a2ui` nor `data` is among the eleven. On a part the conventions do not define: "When recording a provider-specific part, it is RECOMMENDED to prefix the value with `gen_ai.provider.name` (for example `anthropic.search_result`) to avoid name collisions with current or future part types defined by semantic conventions."
  - Validated against the record's schema with the release's four files in place, the same 44 of the 200 committed turn records fail as with the pin's, the cases written to fail.
  - A content attribute: at the pin, "it MAY be recorded as a JSON string if structured format is not supported"; at `v0.1.0`, "This attribute MUST be recorded as an AnyValue conforming to its JSON schema."
  - `gen_ai.response.time_to_first_chunk`: at the pin, "Time to first chunk in a streaming response, measured from request issuance, in seconds"; at `v0.1.0`, a chunk is "a decoded provider stream event carrying new, non-empty output", and "Instrumentations MUST NOT treat empty start events or events carrying only usage, roles, IDs, signatures, keep-alives, progress/status updates, or end markers as chunks".
  - `docs/gen-ai/mcp.md`, at the pin and at `v0.1.0` alike, defines a client span, kind client, "reported by the MCP client when it initiates the request or notification or by the MCP server when server initiates the operation", and a server span, kind server, "reported by the MCP server when client initiates the request (or notification) or by the MCP client when server initiates the operation". It defines no producer span.
  - The `turn` event's span name, kind and `gen_ai.operation.name` match the conventions' remote agent invocation at `v0.1.0`, which adds A2A conventions beneath it.
  - The content capture switch at `v0.1.0`: "the environment variable MUST be named `OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT`", with the values `NO_CONTENT`, the default, `SPAN_ONLY`, `EVENT_ONLY` and `SPAN_AND_EVENT`, each of which an instrumentation "MUST support".
- **Who reads which capture switch.** GitHub's code search over the default branches finds the new variable in no file of `open-telemetry/opentelemetry-python-contrib`, `open-telemetry/opentelemetry-js-contrib`, `google/adk-python` and `google/adk-js`, and the old one in 31, 16, 11 and 6. `google-adk` 2.15.0, `opentelemetry-util-genai` 0.4b0 and `opentelemetry-instrumentation-openai-v2` 2.4b0, as installed, read the old one alone.
- **What a wrapper can send.** `@opentelemetry/api` 1.9.1 types an attribute value as a string, a number, a boolean or an array of those. OpenTelemetry Python widened its attribute value type in 1.45.0, and the Python wrapper's floor is 1.39.0.
- **Upstream's v1.0 protocol document at the pin**, `specification/v1_0/docs/a2ui_protocol.md`. Under "Transport bindings" it gives AG-UI, A2A and MCP a paragraph each and SSE with JSON-RPC, WebSockets and REST a line each; `specification/v1_0/extensions/` holds A2A's binding alone. Under "Transport Interaction Patterns", a renderer sends `rendererFunctionResponse` in the middle of an exchange, and on a bidirectional stream "either party can send protocol messages asynchronously".
- **The MCP specification**, its revision of 2026-07-28. It names stdio and Streamable HTTP as its standard transports, and speaks of "a legacy version that requires an `initialize` handshake". Of stdio: "All request metadata for the stdio transport is carried inline in the JSON-RPC message body", and "There is no header layer."

## Scope

- The closing review of turn record `v0.1`, what it read and what it judged.
- The amendments to turn record `v0.1` the review makes.
- The newer-record rule, for a record file wherever one is read and for a producer's spans, and the line that says a record is newer.
- The preview mismatch line, and the one part of the preview protocol that holds in every version.
- The viewer's changes that follow, on the "Spectra viewer UI" canvas and in the build.
- The content capture switch `run` sets.
- The documents' statements of all of these, and the backlog.

Out of scope: closing turn record `v0.1`, Phase 11's; publishing anything; a stable public URL for the record's schema, with the config file's schema in sub-task 10.9; the switch-on hint's own text, sub-task 10.9; anything AG-UI, MCP as a transport or MCP over stdio would add to the record; the fixture generator, `_dev/tools/make_fixtures.py`, which stays in the backlog.

## Locked decisions

### 1. The closing review is recorded here

The review is this spec: the readings above, the amendments of decisions 6 to 15, and the judgements of decision 16. It read turn record `v0.1`'s schema and prose against AG-UI's shapes, the backlog items that touch the record, the GenAI conventions since the record's pin, SPEC.md's after-v1 list, the hook proposal, and the record's own closedness.

### 2. A reader refuses every version it does not know

A release refuses a record of any version it does not know, a version that differs in its third part alone included. A record whose `version` is missing or not of the record's form is not a turn record, and is not called newer. The record's Versions section states the reader's rule.

### 3. Where the rule holds

The rule holds wherever a record file is read: the `replay` command, the `test` command, the fixtures folder, and the local store.

In the store, a record of a newer version is refused wherever it is read. Its turn stays in the turn list with the newer line in place of its summary, and is not opened, saved as a fixture or replayed. The store never takes its turns as a new turn's earlier turns, and passes it over for the latest record it reads.

### 4. The spans of the A2UI step state their version

Every span of the A2UI step carries `a2ui.record.version`, the turn record version it follows, `"v0.1"`. It is required: a span of the step without it is half-formed. Both wrappers write it.

The receiver reads it before the kind's attributes. A span of a version the receiver does not know is kept as a framework span with nothing translated, and the terminal says so in the form of the half-formed line. The viewer says so too: on a turn holding such a span, the switch-on hint's place says that the A2UI step was reported under a newer turn record. The viewer works this out when the turn is shown, from the framework span's received attributes, and nothing is written to the record for it.

### 5. What the newer line names

The line names three things: the version met, the version this Spectra reads, and Spectra as the side to upgrade. It rests on the record's top-level `version`, or the span's `a2ui.record.version`, and on nothing deeper. It says so for a record file, in the receiver's terminal line, and in the viewer's hint. The exact strings are settled in the build and held by tests.

### 6. The capture path `a2ui_step`

The capture path `wrapper` is renamed `a2ui_step`: the A2UI step was reported, by any producer.

### 7. `a2ui.replay.source` is written with forward slashes

`a2ui.replay.source` is written with forward slashes on every platform, and the record's prose says so. The terminal's own lines keep the platform's separators.

### 8. A wire message's role

The event's kind, `wire_input` or `wire_output`, is the delivery's direction. `role` is the role the delivery states. Where the transport states none, or states a direction alone as A2A does, it is `user` on a host's input and `assistant` on an agent's output.

### 9. The GenAI pin moves to the conventions' release

The record pins `open-telemetry/semantic-conventions-genai` at its release `v0.1.0`, `d0e74ba6` (2026-11-21), and OpenTelemetry's core conventions at `v1.45.0`. The four changed schemas are copied again from the release, in both places Spectra holds them. `rpc.response.status_code` becomes `rpc.status_code` wherever the record, the tool proxy and the replay reader name it.

The receiver keeps reading the names the release removed, as a producer on older conventions still sends them.

### 10. Either wire form for a structured attribute

A producer of the A2UI step sends an attribute the record holds as an array or an object as a string holding its JSON text or as the structured value, and the receiver reads both: `a2ui.prompt.catalogs`, `a2ui.parse.catalogs`, `a2ui.parse.messages`, `a2ui.parse.components`, `a2ui.parse.error.details` and `gen_ai.tool.call.result`. The wrappers send JSON text.

### 11. Time to first chunk

`gen_ai.response.time_to_first_chunk` has the meaning the pinned conventions give it. For the four APIs the model proxy reads in full, it is the time to the first event that carries output. On a call recorded as a raw exchange the attribute is not written. The record's sentence on the time to the first token reads the first chunk that carries output.

### 12. A tool call the server initiated has span kind `2`

An event for an operation the server initiated has `kind` `2`, server, as the pinned MCP conventions have the client's view of it.

### 13. The data part is `a2ui.data`

A data part that is not A2UI is a part of type `a2ui.data`. The A2UI part keeps the type `a2ui`.

### 14. The preview mismatch line

On a mismatch the line names the two protocol numbers and the side to upgrade: the page's preview packages, `a2ui-spectra-preview` and its adapter, when the page speaks the lower number, and `a2ui-spectra` when the page speaks the higher. When the page is the older side it also names this Spectra's version as the version of the preview packages to move to. The judgement stays on the protocol number alone.

### 15. The preview protocol's fixed point

In every version of the preview protocol a page announces itself with a message of the type `a2ui-spectra-preview/ready` carrying its `protocol` number. Everything else in the protocol may change with the number. The preview core's README states it, and a test holds that the viewer reports a mismatch for a ready message carrying those two fields alone. A ready message whose `protocol` is not a number is not a ready message.

### 16. What the review found no amendment in

| Held against | What it needs of the record | Judgement |
| --- | --- | --- |
| AG-UI: the whole history sent with every run, with tools, state, context and resume entries | New attributes on `wire_input` | An addition |
| AG-UI: an activity snapshot that replaces the one before | A mark on a wire output and a rule for reading it, which the replay verdict's comparison gains with it | An addition |
| AG-UI: the run id and the parent run id | New attributes on the turn | An addition |
| AG-UI: argument fragments, reasoning, steps, subagents, raw and custom events | Parts or metadata | Fits |
| AG-UI: a stream that breaks with no outcome | `failed`, as the A2A adapter has a broken connection | Fits |
| AG-UI: the four endings of a run | `completed`, `waiting_for_input`, `cancelled` and `failed` | Fits |
| The backlog: A2A's task methods and push notifications | A cancel is an outcome the record has; a host's cancel is a wire input with empty parts | Fits |
| The backlog: each delivery's raw exchange kept beside the turn record | Outside the record | Fits |
| The backlog: v1.0's agent-function round trip | Several wire inputs in one turn, which the schema does not bound | Fits |
| The backlog: MCP session housekeeping from outside any turn | The schema ties no event's time to its turn's | Fits |
| The backlog: a second SDK API shape, and a rejected block's failing message marked | A new entry point value, and a new attribute on the exception span event | An addition |
| The backlog: the rename to `@child`, `@action` and `@functionCall`, and the static check of a `regex` pattern | The record does not validate A2UI content, and a finding's code is an open string | Fits |
| After v1: MCP over stdio | A place for the bare JSON-RPC message | An addition |
| After v1: fixture editing and fixture to test | New fields | An addition |
| After v1: MCP as a transport, REST and WebSockets | Upstream's protocol document gives each a sentence and no binding | No misfit found; not judged further until a binding exists |
| Closedness: the closed lists | A new value is a compatible version | An addition |
| Closedness: `a2ui.check.legacy_form`, required on the catalog check | Relaxing a requirement keeps every record valid | An addition |
| Closedness: a link's meaning read from the kinds of its two ends | A later link type states its own type | An addition |
| Closedness: each record holding its earlier turns in full | A fixture replays alone | Kept |
| Closedness: the schema's `$id` | A record does not carry it | Not an amendment |

Three sentences of the record's prose are written again, none an amendment: the agent's name without "from its card"; that a turn may hold several wire inputs; and `a2ui.mcp.stream.url` in the table of the `a2ui.` attributes.

### 17. The committed records

The wrapper capture records are written again by the harness from what the amended wrappers send. The receiver capture records of the A2UI step and the turn record fixtures, made by hand, take the amendments' edits from a one-off script. A check holds that the test data's whole diff is the amendments' edits and nothing else.

### 18. The viewer's changes on the canvas

The two new states are drawn on the "Spectra viewer UI" canvas first, Jioh reviews the drawing, and the build follows it: the switch-on hint's place on a turn whose A2UI step was reported under a newer turn record; and a stored turn refused as newer, its row in the turn list and what selecting it shows.

The two reworded lines, the preview pane's line for a mismatched page and a fixture listed as unreadable for being newer, are brought in line on the canvas where it shows the old text, with no review.

### 19. The content capture switch

`run` sets `OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT` to `SPAN_ONLY` beside `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`, each unless Spectra's own environment sets it, and `attach` prints both.

### 20. The documents

- `specification/turn_record/v0_1/`: the schema, the prose and the README, as decisions 2 to 13 and 16 have them.
- SPEC.md: "Turn record", the spans' version and the reader's rule; "Preview", the mismatch line; "Redirection", both capture variables; the GenAI conventions' release in place of "with no release yet".
- The tool's README, the two wrappers' READMEs, the preview core's README, `conformance/README.md` and the root `CHANGELOG.md`'s `0.1.0` section, each where it states what this sub-task changes.
- `_dev/TODO.md`: the 10.8 line names this spec and gains its done line; the Backlog gains decision 21's lines.

### 21. The backlog

- The tool proxy against a server on the MCP specification's revision of 2026-07-28.
- The model proxy's readers prefixing an unhandled provider part type with the provider's name, as the GenAI conventions recommend from `v0.1.0`.

### 22. Done

Sub-task 10.8 is done when, with no test skipped or marked:

- turn record `v0.1`, still a draft, carries the amendments of decisions 4 and 6 to 13, and every committed record validates as before;
- a record of a newer version is refused in each place of decision 3, and a span of a newer version as decision 4 has it, each held by a test;
- the mismatch line reads as decision 14 has it in both directions, and decision 15's test passes;
- the check of decision 17 passes;
- CI passes on one commit, the binary test run on all five platforms among them, the forward slashes of decision 7 held on Windows;
- the two new states are on the canvas, and Jioh has seen a screenshot of each built state beside its drawing;
- the documents read as decision 20 has them.

The done line carries the CI run, its commit and the counts.

## Invariants

- Nothing is published, and turn record `v0.1` is not closed.
- Nothing in Spectra compares package versions.
