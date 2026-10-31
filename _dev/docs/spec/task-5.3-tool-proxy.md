# Sub-task 5.3 — The tool proxy

The tool proxy: MCP over streamable HTTP and over HTTP+SSE, HTTP tools recorded raw, reached by redirection through the tool servers the config names; Spectra's own tool server and the tool capture suite in `conformance/`; A2UIVerse's CircleCI agent reading its MCP URL from a variable. Sub-task 5.3 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, carrying out its decision 8, the tool proxy, and its decisions 4, 5 and 17, placing a call in its turn, what cannot be placed and the turn record, as they apply to tool calls.

## Scope

- The config's tool servers, the tool proxy's ports, the values `run` sets and `attach` prints, and the API's list of them.
- The tool proxy: each request read for what it is, MCP over both HTTP transports, HTTP tools recorded raw, the carrier streams, messages a server sends on its own, the MCP attributes and names, failed calls, credentials, placement, the live stream and the `tool_proxy` capture path.
- Spectra's own tool server and the tool capture suite in `conformance/`.
- The CircleCI agent's MCP URL read from a variable, in a2uiverse-apps.
- The turn record prose's amendments for `tool_call` events.

Out of scope: tool calls, spans and the timeline in the viewer, sub-task 5.6; the OTLP/HTTP receiver and the links between received spans and the proxies' events, sub-task 5.4; the acceptance run through the tunnel, sub-task 5.7; MCP over stdio, after v1; rewriting an HTTP+SSE server's absolute endpoint URL, backlog.

## Locked decisions

### 1. Declaring a tool server

The config gains a top-level `tools` key: a list of tool servers, each `{variable, url}`, the variable the one the agent reads the server's URL from and the URL the original. It is read strictly like the rest of the file: the variable a POSIX name, the URL starting with `http://` or `https://`, a repeated variable an error at start, and a tool variable named like one of the five model variables an error at start too. When Spectra's own environment sets the variable, to a value that is not blank and not the tool proxy itself, that value replaces the config's URL as the original, the rule the model proxy applies to a base-URL variable already set. A value pointing at the tool proxy itself, left over from an earlier `attach`, counts as unset.

### 2. The tool proxy's address

Each configured tool server has its own listener on loopback, standing for the original's origin: a request to `http://127.0.0.1:<port>/<path>` is forwarded to the original's origin followed by the same path and query. `--tool-proxy-port` names the first tool server's port, default 9823, and each further tool server takes the next port in config order, under the rules the other ports follow: command line only, a taken port an error at start, no two of Spectra's ports the same. The variable's value is the proxy's origin followed by the original's path and query, so `FLOOR_PLAN_SERVER_URL` becomes `http://127.0.0.1:9823/sse` for an original of `http://127.0.0.1:8000/sse`. Relative URLs in replies, MCP's `endpoint` event included, resolve against the proxy's origin and stay on the proxy with no state and no rewrite. Under `attach`, the printed values stay stable while the config order does.

### 3. An absolute endpoint URL

An HTTP+SSE server that announces an absolute endpoint URL, on its own origin, is passed on unchanged, and the terminal says once that the server at that address announces an absolute endpoint and that its calls will not pass through the tool proxy. The rewrite of such a URL to the proxy's origin goes to the backlog.

### 4. Each request read for what it is

Traffic on a tool server's port is read per request, by its content, with nothing declared in the config:

| Request | Read as |
| --- | --- |
| A body that is one JSON object with `"jsonrpc": "2.0"` | An MCP message |
| A `GET` answered with `text/event-stream` whose first event is `endpoint`, or whose request carries `Mcp-Session-Id` | A carrier stream: not an event of its own; its messages attach to the events they answer |
| A `DELETE` carrying `Mcp-Session-Id` | MCP's session end |
| Anything else, a JSON-RPC batch array included | An HTTP tool request, recorded raw |

One server may mix, an MCP endpoint beside a `/health` route. A server that speaks JSON-RPC 2.0 but not MCP is read as MCP, its method under `mcp.method.name`; this is accepted.

### 5. One event per MCP message

A `tool_call` event lasts from the request to the response, whichever side asks. For a client request or notification, the event is the POST's exchange: under streamable HTTP the reply is on the POST itself, a JSON body as the response body or an SSE stream as chunks; under HTTP+SSE the exchange is the POST with its `202 Accepted`, and the reply, arriving on the carrier, is a chunk on the event, the shape the shared test data's custom-components record already has.

A message the server sends on its own, on a carrier or inside a POST's own SSE reply, is placed in this order: a JSON-RPC response attaches to the event of the pending request with that id in its session; a `notifications/progress` whose `progressToken` matches a pending request's `_meta.progressToken` attaches to that request's event as a chunk; every other server message arriving on a carrier is its own event named by its method, a notification starting and ending at its arrival with the message as its one chunk and no exchange of its own, a server request starting at its arrival and ending when the client's POST carrying the response with that id arrives, that POST's exchange recorded on the event, so the client's response POST is not an event of its own. A message inside a POST's own SSE reply is a chunk on that POST's event, whatever its method.

A proxy's event has `kind` `3`; an event the server initiated has `kind` `4`, the client's view of a server-initiated operation in the pinned MCP conventions.

### 6. The carriers

A carrier stream is not an event. Under HTTP+SSE the session's `initialize` event starts when its carrier opens, so the `endpoint` chunk lands inside it, as the fixture has it; a carrier that closes before any request was posted leaves no event and one terminal line. A `DELETE` carrying `Mcp-Session-Id` is a `tool_call` event named `DELETE`, with `mcp.session.id` and the exchange and no `mcp.method.name`, which the viewer's rule for an MCP request other than `tools/call`, `resources/read` and `prompts/get` draws as a housekeeping row. A resumed `GET`, one carrying `Last-Event-ID`, is a carrier like any other: a replayed response attaches to its request's event when that event is still pending, and otherwise stands as its own event named `response`; a POST's SSE reply that breaks after the server sent an event id leaves the request's event pending for that reply rather than ending it broken, and one that breaks with no event id ends the event as the model proxy ends a broken stream.

### 7. The MCP attributes and the name

The pinned MCP conventions' names, with two added to the turn record prose's `tool_call` table, `rpc.response.status_code` and `gen_ai.prompt.name`:

| Point | Rule |
| --- | --- |
| `mcp.method.name` | The JSON-RPC method; absent on `DELETE` and on a standalone `response` |
| `jsonrpc.request.id` | The id as a string, on requests; not on notifications |
| `mcp.session.id` | Under streamable HTTP, `Mcp-Session-Id` once the server assigned it; under HTTP+SSE, the endpoint URL's `session_id` or `sessionId` parameter when it has one |
| `mcp.protocol.version` | The version the session's `initialize` result negotiated, which the proxy remembers per session from everything it forwards whether or not it records it; else the request's `MCP-Protocol-Version` header; else absent |
| `tools/call` | `gen_ai.operation.name` `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.arguments` when the params' `arguments` is an object, and `gen_ai.tool.call.result`, the JSON-RPC `result` object, only when `isError` is not set |
| `resources/read` | `mcp.resource.uri` |
| `prompts/get` | `gen_ai.prompt.name` |
| Left out | `gen_ai.tool.type`, which has no value for an MCP tool, and `gen_ai.tool.call.id`, the model's id, which the proxy never sees; the `network.*` attributes, the exchange carrying the HTTP facts |
| `server.address`, `server.port` | The original server's, as the conventions ask behind an intermediary |
| Name | `{mcp.method.name} {target}`, the target the tool name, the prompt name or the resource URI, the URI deliberately included since a record is not a metric; `{mcp.method.name}` alone otherwise |

### 8. Failed calls

| Case | Recorded |
| --- | --- |
| A JSON-RPC error | Status code `2`; `error.type` and `rpc.response.status_code` both the code as a string; the status message the error's `message` |
| A `tools/call` result with `isError` | `error.type` `tool_error`; the status code stays `1`, which keeps it out of the problem count as the 5.1 design decided |
| The server answers 400 or above, cannot be reached, or its stream breaks; the agent closes early | The model proxy's failed-call table, sub-task 5.2's decision 16, unchanged, the `502` line naming the tool proxy |
| A pending request the client cancels with `notifications/cancelled` naming its id | Ends at the notification, `error.type` `cancelled` |
| A pending request whose carrier closes, or that Spectra's stop cuts off | Ends then, `error.type` `aborted` |

### 9. The HTTP tool event

The model proxy's raw event under `tool_call`: the exchange only, a streamed reply as `a2ui.http.response.chunk` per server-sent event, a `4xx` or `5xx` as status code `2` with `error.type` the status as a string, a WebSocket upgrade tunnelled unrecorded with one terminal line. It is named `{method} {path}`, the path without its query so that a credential in a parameter never reaches the name. It carries no `gen_ai.` or `mcp.` attributes: the proxy knows no tool name.

### 10. Placement and the wait

The model proxy's placer, reused. Trace context is read from the `traceparent` header first, then from `params._meta.traceparent` in an MCP message, the carrier the pinned MCP conventions define; an event the server initiated is placed by its message's `_meta` context, else by the one-open-turn window at its arrival. A turn waits for its tool calls as it does for its model calls, without a cap. MCP housekeeping before any turn is open is forwarded and not recorded, one terminal line per message as the Phase 5 spec's decision 5 has it, while the proxy still remembers the session's protocol version and id from it.

### 11. Credentials

The model proxy's rule, sub-task 5.2's decision 15, unchanged, with one addition shared by both proxies: a request whose form-encoded body carries `grant_type` is an OAuth token request, passed on unrecorded with one terminal line, which generalises the model proxy's rule for Anthropic's fixed token path to the request's shape, and the model proxy adopts the same test. `Mcp-Session-Id` and HTTP+SSE's `session_id` parameter are kept: they are not credentials, they expire with the session, and `mcp.session.id` needs them. `WWW-Authenticate` is kept. An OAuth discovery fetch of `/.well-known/oauth-protected-resource` through the proxy is an ordinary HTTP tool request, recorded raw.

### 12. What `run` and `attach` say, and the capture path

Under both commands, Spectra prints one line per tool server at start, with the port it listens on and where it forwards, as it prints its other addresses. Under `attach`, each configured tool server adds one POSIX `export` line after the five model lines, in config order, ending in the comment naming where it forwards with credentials removed, and the intro line reads "To see model and tool calls, set these in the agent's shell and restart it:", matching the canvas board. `GET /api/context` lists the tool variables with the model ones, so the viewer's first-screen block needs no change. Under `run`, every turn lists `tool_proxy` in `a2ui.turn.capture_paths` when at least one tool server is configured; under `attach`, only a turn with a call through the tool proxy does.

### 13. Tool calls on the live stream

The three events of sub-task 5.2's decision 18, with no new names: `call_started` at a request's start, or at the carrier's opening for `initialize` under HTTP+SSE; `call_chunk` for each chunk of a POST's own SSE reply and for each carrier message that attaches to the event, so an HTTP+SSE reply arrives as a chunk on its request's row; `call_ended` with the complete event. A server-initiated notification sends `call_started` and `call_ended` back to back; a server request sends `call_started` at its arrival and `call_ended` at the client's response. The catch-up for a new subscriber covers them like model calls.

### 14. Spectra's own tool server and the tool capture suite

One process in `conformance/`, beside the stub agent and the stand-in provider: Spectra's own tool server on the TypeScript MCP SDK, serving MCP over streamable HTTP and over HTTP+SSE and a few plain HTTP routes on one port, so that decision 4's per-request reading is exercised on a mixed server. Its MCP side is small and fixed: a tool that echoes its arguments, one that answers with `isError`, one that sends `notifications/progress` and `notifications/message` while it runs, one that asks the client through `sampling/createMessage`, a resource, a prompt, and the JSON-RPC error an unknown tool gets. Its HTTP side: a JSON route for `GET` and `POST`, a server-sent-event route and a `404`.

The tool capture suite mirrors the model capture suite in form, cases in a YAML listing each scenario and its expected record, but a case's traffic is a named client scenario the harness runs with the SDK's own client through the tool proxy to the live server, over each transport in turn; the events are compared with the expected record after times, span ids, session ids and request ids are normalised. The expected records join the shared test data and validate against the turn record schema like the others. No HAR is recorded for tools.

### 15. The change in a2uiverse-apps

In `circleci/agent/app/mcp.py`, `CIRCLECI_MCP_URL` becomes the environment variable's value with the hosted URL as its default; the sign-in module's copy of the URL, the OAuth resource, is untouched, so the token's audience stays the real address; a test that the variable is read joins the one asserting the default; the agent's README's configuration table gains the variable. One bare conventional commit on a2uiverse-apps `main`. Spectra's config for the agent, the `tools` entry naming that variable, is not committed in a2uiverse-apps: the acceptance run passes it from outside the repo, and committing a Spectra config there waits for Phase 9, as the preview page does.

### 16. Done line

Done when, with the real binary: under `run`, the custom-components example on Gemini with its floor plan server, a floor plan request writes a turn whose record, served by `GET /api/turns/<trace id>`, holds `initialize`, `notifications/initialized` and `resources/read` in the shared test data's shape, the resource's HTML in the reply chunk; under `attach`, the same example restarted with the printed `FLOOR_PLAN_SERVER_URL` writes the same turn, and `GET /api/context` lists that variable with the five model ones; and A2UIVerse's CircleCI agent in live mode on Gemini, from a2uiverse-apps `main` with decision 15's change, signed in, under `run` with a config naming `CIRCLECI_MCP_URL`, writes a turn whose `tools/call` events over streamable HTTP carry the tool name, arguments and result, the bearer token `REMOVED`, no credential string in the record. If the A2UIVerse platform cannot be brought up for the CircleCI check, the handoff says so and the check falls to sub-task 5.7. The tunnel is sub-task 5.7's.

### 17. Other documents

- The Phase 5 spec, amended in place: decision 8 gains the `tools` config list of `{variable, url}` with the environment's value winning, a loopback port per tool server from `--tool-proxy-port`, and reading per request; the invariants gain that an absolute endpoint URL is passed on unchanged with a terminal line.
- SPEC.md: Capture's Redirection bullet on MCP gains the URL beside the variable and a port per server; the adopter-path table's "Tool servers" row gains the URL.
- The turn record prose: the `tool_call` section's table gains `rpc.response.status_code` and `gen_ai.prompt.name`; the name rule of decision 7; the HTTP+SSE shape the shared test data has, written out as a rule, with `initialize` starting at its carrier's opening; messages a server sends on its own, as decision 5 has them; `DELETE` as a housekeeping event; `kind` `4` for an event the server initiated; the two error rules of decision 8, a JSON-RPC error as status `2` with the code and `isError` as `tool_error` with the status kept.
- The tool's README: the config file's `tools` key; `--tool-proxy-port` and the port per server; the tool lines under Redirection and in what `attach` prints; a section on the tool proxy; the start-up line per server; the token-request line now shared by both proxies; `GET /api/context`'s list. The config schema served at `GET /api/config.schema.json` gains `tools`.
- `conformance/README.md`: Spectra's own tool server, the tool capture suite, and how to write a `capture_tool` case.
- `_dev/TODO.md`: the 5.3 line names this spec and gains the done line; the backlog gains the rewrite of an HTTP+SSE server's absolute endpoint URL.
- `_dev/otel-findings.md`, a candidate: the pinned conventions' transport table has `mcp.protocol.version` `2024-11-05` or older under HTTP+SSE, while the shared test data has the floor plan server negotiating `2025-11-25` over it; the fixture was written by hand in Phase 1, so the finding is written only if the done line's live run shows the real server doing it, beside finding 7, which faults the same table for leaving out `2025-03-26`.
- a2uiverse-apps: decision 15's change, with its README line.

## Invariants

- The proxies forward requests and responses unchanged, and pass a streamed response on chunk by chunk as it arrives. The trace context on A2A turn requests is the one change Spectra makes to traffic; an absolute endpoint URL is passed on as the server sent it.
- No credential is ever in a record or on the live stream, MCP's `Authorization` tokens included.
- Nothing committed in A2UIVerse depends on this repo.
