# Sub-task 7.2 — The proxies in replay mode

The model proxy and the tool proxy answering from a record for the span of one replayed conversation: the one pool and how it is armed, the key for a model call, an HTTP tool and an MCP request, the reply as recorded, MCP's server side under both transports, the miss, `served_from` in the record, and the conformance replay suites. Sub-task 7.2 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, carrying out its decisions 2 to 6, the two modes' one difference, the miss, the key, the order and the pool, and the tool proxy as the server; its decision 8 as far as a served call; and the replay suite of its decision 17.

## Scope

- The arming surface the replay driver uses, and the pool it arms with.
- The key for a model call and an HTTP tool, and the key for an MCP request.
- The reply as recorded: a success, each shape of recorded failure, and the served reply's wire form.
- MCP's server side: housekeeping and the answers the protocol fixes, the session, the carriers under streamable HTTP and HTTP+SSE, the rewrites inside a served reply, and what is not replayed.
- The miss: what the agent gets, what the record holds, what the terminal says.
- Turn record v0.1: `a2ui.replay.served_from` and `replay_miss`.
- The conformance replay suites on the model and tool capture suites' data, the unit tests, and the documents.

Out of scope: the replay driver, the ids rewritten across a replayed conversation, the provenance on the turn event, the verdict, the fixtures folder and the API, sub-task 7.3; the two commands, sub-task 7.4; the viewer, sub-task 7.5; the tool proxy keeping session housekeeping it saw outside any turn, the Phase 7 spec's known limit under its decision 6, backlog unless the acceptance run meets it.

## Locked decisions

### 1. One pool, shared, and the arming surface

A replay module builds one pool from a turn record: every turn's `model_call` and `tool_call` events, in turn order and then start order, carrying the replay mode. Each proxy gains `arm(pool)` and `disarm()`; the driver arms both before the first send and disarms both after the last replayed turn closes. On a request, an armed proxy asks the pool, which answers with the recorded event to serve, a miss, or, in the live mode and for a model call only, that the request goes live; the proxy serves, or falls through to today's forwarding when unarmed or sent live. The pool is the one place that holds what has been consumed.

### 2. The key for a model call and an HTTP tool

The key is three of the exchange's recorded attributes, `http.request.method`, `url.full` and `a2ui.http.request.body`, compared by deep JSON equality: the recorded event's, against the live request's as the exchange's own reading would record them. A body the exchange leaves out, a content type neither JSON, text nor form-encoded, is absent on both sides, and such a request keys on method and URL alone. `url.full` carries the resolved target, so a record captured while a base-URL variable pointed at another original misses when replayed without it.

### 3. The key for an MCP request

An MCP request keys by its method and params with `id` and the whole of `params._meta` left out. This amends the Phase 7 spec's decision 6, which left out `params._meta.traceparent` alone.

### 4. The reply as recorded, failure by failure

A served reply is the recorded one, each shape of recorded failure reproduced: a status is served as recorded, body and all; an error carried inside a 2xx stream is served as its chunks; a stream that broke is served as its chunks and then the connection destroyed; a call with no response recorded, unreached or a miss, is served as the proxy's 502 plain-text line, the record's status message as its reason; an aborted call is served as its chunks and then a clean end.

### 5. The served reply's wire form

The served reply carries the recorded response headers minus three kinds: a header whose recorded value is `REMOVED`, `content-encoding`, and `content-length`, which is recomputed for the body as serialised; `content-type` and the rest go as recorded. A JSON body is serialised from the recorded value and a text body written as its text. A stream is one server-sent event per recorded chunk, `event:` and `id:` when the chunk recorded them and `data:` the chunk's body serialised, the headers flushed first, written as fast as the agent reads, with no reproduction of the recorded timing.

### 6. The miss

A request with nowhere to go is answered `502`, the status both proxies answer with when they cannot reach the target, with one plain-text line in the proxies' existing form: the proxy named, that it is replaying, that the request matched nothing in the record, and the method and target path with credentials removed. The record holds the call as today's unreached case: the request attributes, no response attributes, status code `2`, `error.type` `replay_miss`, the status message the same line. The terminal gets one line per miss naming the method and path. Under HTTP+SSE the POST itself gets the `502` and nothing is written on the carrier.

### 7. Housekeeping the record never saw

An answer the protocol fixes never misses: a notification gets `202 Accepted` with no body, a `ping` gets the empty result, and a JSON-RPC response the client posts gets `202 Accepted`, each whether or not the record holds the method. Every other method with no recorded exchange misses: `tools/list`, `resources/list`, `prompts/list` and `initialize`. An answer the proxy gives from the protocol carries no `served_from`, so housekeeping stands outside decision 9 of the Phase 7 spec, the rule that every call was served from the record: served or not, housekeeping never gates the verdict, and a miss on it still does. Sub-task 7.3 takes this.

### 8. Server-initiated messages are not replayed

An event the server initiated, `kind` `4`, is never re-sent: the carrier under HTTP+SSE carries only the replies to what the client posts, with the progress chunks attached to them. A `tools/call` that asked the client something is served its recorded result directly, and the model call the agent would have made for the sampling stays unconsumed in the pool. Under streamable HTTP a POST's stream is served as recorded, a server request inside it included, and the client's answering POST gets decision 7's `202`.

### 9. The two rewrites

Inside a served reply, two identifiers are rewritten to the live request's own: the response's `id`, and the `progressToken` of each `notifications/progress` chunk on the served event, rewritten to the live request's `_meta.progressToken`; when the live request asked for no progress, the chunk is written as recorded. Nothing else inside a served body is touched.

### 10. Reading a `GET` with no server to ask

An armed tool proxy reads a `GET` in this order: one whose key matches a recorded HTTP tool call is served as one; one carrying `Mcp-Session-Id` is a streamable HTTP carrier, `200` `text/event-stream`, held open, nothing written, closed when the client closes it or the proxy is disarmed; one whose path is the path of the `a2ui.mcp.stream.url` on a recorded `initialize` whose first chunk is an `endpoint` event is an HTTP+SSE carrier, `200` `text/event-stream`, that `endpoint` event written as recorded, relative, and the session registered under that endpoint as today so the POSTs to it find the carrier their replies are written on; anything else is a miss. The session id is served from the recorded `initialize`'s `http.response.header.mcp-session-id`; a `DELETE` is answered as the Phase 7 spec's decision 6 has it. The record decides the transport.

### 11. When the pool answers

An armed proxy consults the pool for every request, placed in a turn or not; placement decides only whether the call is recorded, as it does today. The pool is built once per arming and never grows: a model call that went live in the live mode is recorded without `served_from` and not added. Disarming drops the pool. A request arriving unarmed is forwarded as today, as is one the pool sends live.

### 12. The record

Turn record v0.1 gains `a2ui.replay.served_from`, the span id of the recorded event a call was served from, as an explicit optional property of the `model_call` and `tool_call` attribute blocks, in the prose's two tables and in its list of `a2ui.` attributes; and `replay_miss` in the two failed-call paragraphs, with what a miss is and that a miss carries no response. The turn-level provenance of the Phase 7 spec's decision 8 waits for sub-task 7.3, which writes it. Phase 1's shared fixtures are unchanged.

### 13. The replay suites

Two new suites in the conformance directory's convention: `conformance/model_replay/replay_v0_1.yaml` with `action: replay_model`, and `conformance/tool_replay/replay_v0_1.yaml` with `action: replay_tool`; `conformance_schema.json` gains the two actions. Each case names the same traffic and expected record, or scenario and expected record, as its capture twin, with a description of what replay exercises there. Each suite is the capture suite run against the record instead of the server: the proxies armed with the expected record; the agent's side receiving each reply as recorded, compared by server-sent events and JSON value, a broken-off reply breaking; then the events the armed proxy captured compared with the expected record by the capture suite's own comparison, `a2ui.replay.served_from` required on every served event, `kind` `4` events dropped from the expected side, and the proxy's protocol-fixed acks compared without their response headers. Then one changed request per case, built in the harness and not in data, the last text of the first read-in-full request altered, or a tool called with one argument changed, gets the `502` and a failed call with `replay_miss`. The tool records' `<origin>`, `<session-N>` and `<id-N>` placeholders are substituted with concrete values before arming. No new recordings. The live mode's fallback is a unit test on the model proxy against a local server.

### 14. Done line

Done when the two replay suites and the unit tests are green in CI: the key for a model call, an HTTP tool and an MCP request; the order and the pool across turns; housekeeping by method; the miss; the served reply's headers and stream; the reading of a `GET`; the live mode's fallback; and every record a replay suite captures validates against turn record v0.1 with `served_from` on each served event.

### 15. Other documents

- The Phase 7 spec, amended in place: decision 3 with the `502` and the miss's response side; decision 5 with the failure shapes and the served headers; decision 6 with the whole of `params._meta` out of the key, the protocol-fixed answers, `kind` `4` not replayed, the progress token rewritten and the reading of a `GET`; decision 9 with housekeeping outside its served-or-live rule; decision 17 naming the two suites.
- Turn record v0.1, prose and schema, as decision 12 has it.
- The tool's README: a "Replay" section with the proxies' rules — the key, the order and the pool, MCP's housekeeping and session, the miss, `served_from`, and the known limit of the Phase 7 spec's decision 6; the commands and the fixtures folder wait for sub-tasks 7.3 and 7.4.
- `conformance/README.md`: the two replay suites and how to add a case.
- `_dev/TODO.md`: the 7.2 line names this spec.
- No finding is expected for `_dev/a2ui-findings.md` or `_dev/otel-findings.md`.

## Invariants

- No credential is part of a replay key, and none is in a served reply.
- Everything-recorded means free: no call leaves the machine in that mode; a miss is an error, never a live call.
- The response's `id` and the progress token are the only changes inside a served body.
