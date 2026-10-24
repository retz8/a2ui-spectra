# Task 2.3 — The coverage roster

Spec for sub-task 2.3 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the agents and hosts Spectra is tested against, the traffic recorded once from each of them, and the conformance action for the A2A capture path that replays it. SPEC.md's coverage line names the axes the roster jointly exercises. The A2A adapter is sub-task 2.2's (`_dev/docs/spec/task-2.2-a2a-adapter.md`), and its decisions on wire outputs, the turn's outcome, parts and metadata are the rules the expected records follow. Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin. The survey behind the roster is `_dev/docs/handoff/task-2.3.md`.

## Scope

- The roster: the found agents, the hosts, and the stub agent built for the cancelled outcome.
- The recording tools under `_dev/tools/`: the recording proxy, the request script and its request files, the expected-record writer, and the AG2 server.
- The traffic recorded once from every roster entry, as HAR files, and the expected record of each.
- The conformance action for the A2A capture path: its suite in `conformance/`, its harness in the tool workspace.
- The roster written in `conformance/README.md`.
- The A2UI findings the recordings show.
- SPEC.md's amendment to the coverage line's hosts, the Phase 2 spec's amendments, and `_dev/TODO.md`'s.
- Not in scope: the stub agent's canned A2UI answers and the end-to-end test, which are sub-task 2.5's; whether the message box asks an agent for its A2A 1.0 card, sub-task 2.5's; the store, sub-task 2.4's.

## Locked decisions

### 1. The roster

Agents:

| Entry                                                   | Pinned at                                                        | How it runs                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `samples/agent/adk/restaurant_finder`                   | upstream 020a9d6f                                                | Gemini                                              |
| `samples/agent/node/restaurant_finder`                  | upstream 020a9d6f                                                | `STUB_LLM=true`, no key                             |
| `samples/agent/adk/custom-components-example`           | upstream 020a9d6f                                                | Gemini                                              |
| `samples/community/agent/adk/file_upload_summarizer`    | upstream 020a9d6f                                                | Gemini                                              |
| A2UIVerse's CircleCI agent (`a2uiverse-apps/circleci`)  | a2uiverse-apps 208067d                                           | deterministic mode, with a token the agent issues   |
| AG2's `A2UIAgentExecutor`                               | `ag2` 1.2.1 and `a2a-sdk` 1.2.3 from PyPI                        | AG2's scripted test model, no key                   |
| `filipw/strathweb-a2ui`, its BookingWizard sample       | c92222f                                                          | Docker, .NET SDK 10, no key                         |
| `muncus/a2term`, its `cmd/examplesvc`                   | 79426d3                                                          | Docker, Go, no key                                  |
| The stub agent                                          | this repo                                                        | no key                                              |

Hosts: upstream's Angular sample client (`samples/client/angular`) and upstream's React sample client (`samples/client/react/shell`), both at 020a9d6f. The message box joins the hosts in sub-task 2.5.

### 2. Where the roster is written

In `conformance/README.md`, in the A2A capture suite's section. Each entry has a row: its source and the commit or version pinned, how it was run (the command, the mode, the model or none), and its recording files. Beside the rows, a table of the coverage line's axes names the entries that exercise each.

### 3. What each entry records

The fewest conversations that exercise every axis value the entry's row lists. Each recording is one conformance case, and its description names the axis values it verifies. A host records a text turn and an action turn.

### 4. What sends the requests

A host sends the requests to the agents it reaches: upstream's Angular and React sample clients to the restaurant finders, whose port 10002 both clients hardcode. Every other entry's requests come from the request script: one request file per conversation, holding its JSON-RPC requests and the headers they need, sent in order through the recording proxy, with each reply's `contextId` and `taskId` carried into the next request. Every conversation begins with the card fetch. A request file names the JSON-RPC path when the card lists no interface.

### 5. The recording proxy

A reverse proxy under `_dev/tools/` that shares no code with Spectra. It relays each exchange between the host and the agent, rewrites the card it serves so the host's JSON-RPC calls come back through it, and writes each exchange as the agent answered it, the card unrewritten, to the conversation's HAR file.

### 6. The recording format

HAR 1.2: one log per conversation, one entry per exchange. An entry keeps the request's method, URL, body and the headers the replay needs (`content-type`, `accept`, `A2A-Version`, and the extensions header, `X-A2A-Extensions` or `A2A-Extensions`), and the response's status, the same headers and the decoded body. No credential is ever written: no `Authorization`, cookie or other header outside that list. HAR's required fields that the replay does not read take HAR's empty values. A response whose connection broke before it ended keeps the bytes that arrived and carries the custom field `_brokenOff`; the recording proxy passes the break on to the host, and the replay server reproduces it.

### 7. Recordings are frozen

A recording is made once, at the entry's pinned commit or version, and is not made again. At each pin move the roster is reviewed: an entry whose recordings hold only what Spectra no longer supports is retired with its recordings, and an axis left without an entry goes to an agent built for it.

### 8. The stub agent

The small A2A agent in the test workspace, `conformance/`, on `@a2a-js/sdk` 1.3.0 with its A2A 0.3 compatibility layer on, so one endpoint serves A2A 0.3 and A2A 1.0. In this sub-task it holds one behaviour: a stream that opens the task, sends a working status, and stays open until the host's cancel request arrives, then delivers a canceled status on the open stream and closes it. The cancel is recorded once on each A2A version. Sub-task 2.5 adds the canned A2UI answers its end-to-end test needs.

### 9. Outside toolchains

strathweb-a2ui and a2term run from clones at their pinned commits inside the official .NET SDK 10 and Go images, at named tags, with their ports published. Their roster rows give the `docker run` command.

### 10. The conformance action

`capture_a2a`, one case per recording. The harness starts a replay server standing in for the agent, which answers each request with the next recorded response, and the wire proxy pointed at it, with the agent name the recorded card gives. It sends each recorded request to the proxy in order and asserts two things:

- the host received each recorded response as recorded: the body unchanged, and the card with only its JSON-RPC endpoints pointed at the proxy;
- the turns the adapter handed out match the case's expected record.

The suite is `conformance/a2a_capture/capture_v0_1.yaml`, and its data is under `conformance/test_data/a2a_capture/v0_1/`, one folder per roster entry.

### 11. The expected record

A turn record v0.1 file holding the conversation's turns in order. The comparison takes exact values for everything the traffic determines: the parts, the metadata, the outcome, the protocol version, the conversation id, the agent name, and the order and number of wire events. For what Spectra generates, the harness checks rules instead: every event of a turn shares one well-formed trace id; every span id is well formed and every wire event's parent is the turn event; and the turn's start, its wire input, its wire outputs in order and its end are in time order. The expected record carries schema-valid stand-ins for the trace ids, span ids, times and the writer's version, which the comparison skips.

### 12. The expected-record writer

A script under `_dev/tools/` that derives each expected record from its HAR file by sub-task 2.2's rules, sharing no code with the adapter. When the adapter and the writer disagree, one of them is fixed, and a rule found ambiguous is settled in sub-task 2.2's spec.

### 13. The harness

In the tool workspace, which finds the suite by walking up from the test file, and runs under Node only. The conformance workspace validates the capture suite against `conformance_schema.json` and each expected record against the turn record schema, and checks that every file under `test_data/a2a_capture/` is named by a case.

### 14. The done line's A2A 1.0 agent

AG2's `A2UIAgentExecutor` serving v1.0 on Gemini, from the AG2 server under `_dev/tools/`, with AG2's scripted test model in place of Gemini if Gemini does not run through AG2.

### 15. A2UI findings

`_dev/a2ui-findings.md` gains, each checked against the pin:

- upstream's Angular and Lit sample clients send an action as `{"userAction": …}`, v0.8's shape, where v0.9's extension spec has an array of `{"version", "action"}`;
- upstream's custom-components sample fails every v0.9 turn that reaches the model, because ADK's instruction templating reads the v0.9 basic catalog's `${expression}` as a state variable;
- any other deviation from the extension specs the recordings show.

### 16. SPEC.md's amendment

The coverage line's hosts become Spectra's message box, upstream's Angular sample client and upstream's React sample client.

### 17. The Phase 2 spec's amendments

- The done line's A2A 1.0 agent is AG2's `A2UIAgentExecutor` serving v1.0, and the custom-components sample's turn from the message box is the failed turn it produces at the pin.
- The conformance action replays HAR recordings of every roster entry through the wire proxy over HTTP. The stub agent, started in sub-task 2.3, serves A2A 0.3 and A2A 1.0.

### 18. `_dev/TODO.md`

The 2.3 line names this spec. The 2.5 line's stub agent becomes the stub agent's canned A2UI answers.
