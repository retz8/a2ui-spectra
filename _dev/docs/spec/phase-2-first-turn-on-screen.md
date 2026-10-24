# Phase 2 — First turn on screen

Covers Phase 2 of `_dev/TODO.md`: `a2ui-spectra run` and `a2ui-spectra attach`; the A2A adapter, with the wire proxy and the message box as host; captured turns in the local store; the viewer's turn list, raw messages, tree and data model; schema checks for v0.9, v0.9.1 and v1.0; built and run as the compiled binary from this phase on. The design authority is SPEC.md, in particular its "Framing", "Capture", "Turn record", "Replay and storage", "Adopter path" and "Engineering decisions" sections. The record is turn record v0.1 as sub-task 1.2 specifies it (`_dev/docs/spec/task-1.2-turn-record.md`).

## Scope

In scope:

- `a2ui-spectra run` and `a2ui-spectra attach`.
- The A2A adapter: the wire proxy, and the message box as host.
- Captured turns written as turn record v0.1 files in the local store.
- The local server: the viewer's files, its API and its live stream.
- The viewer: the turn list; the turn view with the input, the raw messages, the tree, the data model and the check results; the message box's UI.
- The schema check for v0.9, v0.9.1 and v1.0.
- The tool workspace and the viewer workspace, and the binary.
- `_dev/a2ui-findings.md`.
- SPEC.md's corrections: the adopter table's row on where the protocol version comes from, the upstream reference line, the coverage line and the coverage table's transport row.
- The coverage roster: the agents found and the agents built for the coverage gaps, whose recorded traffic the conformance action runs on.
- The tests: unit tests, the conformance action for the A2A capture path, the stub agent and the end-to-end test.

Out of scope:

- Redirection: the model providers' base-URL variables and the OpenTelemetry variables. Phase 4.
- Owning the agent's process beyond spawning it and ending it: restart, logs in the browser, restart on save. Phase 7.
- The config file. Phase 3, with the catalog path and the preview page's URL as its first settings; the agent URL joins it then.
- Actions, the data model sent by the host, and the preview. Phase 3.
- The platform matrix. Phase 8.
- A2A's task methods and push notifications attached to the turn they belong to. Backlog.
- A2UI v0.8.

## Locked decisions

### 1. Done line

The compiled binary runs each of the coverage line's three samples under `a2ui-spectra run` and, already running, under `a2ui-spectra attach`. A message from the message box produces a turn in the viewer with its raw messages, tree, data model and schema check, and a turn record v0.1 file in the local store. Upstream's Angular sample client, pointed at the wire proxy, produces the same turn. The custom-components sample is reached from the message box only; at the pin its turn is the failed turn the sample produces for a message that reaches its model. One A2A 1.0 agent from sub-task 2.3's coverage roster, AG2's `A2UIAgentExecutor` serving v1.0, also runs under `a2ui-spectra run` and `a2ui-spectra attach`, with a message from the message box producing its turn.

### 2. Upstream pin

Phase 2 reads upstream at `upstream/main` 020a9d6f (2026-10-23): the protocol schemas and basic catalogs it copies, the samples it records traffic from, and the dialects it documents. SPEC.md's upstream reference line moves to that commit. Packages installed from npm are taken at their published versions and are not covered by the pin.

### 3. What `run` does

`run` spawns the command, relays its stdout and stderr to Spectra's own terminal, waits until the agent card answers at the agent's URL, then does what `attach` does. It ends the child when Spectra exits. It sets no environment variables.

### 4. The agent's URL

The agent's URL is required input on both entry points: `attach`'s argument, and an option on `run`, with no default. While `run` waits for the card it says so, naming the URL and the option that changes it.

### 5. The wire proxy

One transparent reverse proxy with its own listener. It forwards every request to the agent's origin unchanged and relays request bodies, responses and server-sent event streams byte for byte, parsing a copy on the side for capture. The one edit it makes is to the agent card: its JSON-RPC endpoints, rewritten to the proxy's own address. The message box is an A2A client pointed at the proxy like any other host, so there is one capture path. The proxy handles A2A 0.3 and A2A 1.0 over JSON-RPC on HTTP. An agent whose card prefers another transport is reported at attach; one whose card lists no JSON-RPC interface is not proxied, and Spectra stops.

### 6. One turn per host message

A turn opens at a send or stream request — `message/send` or `message/stream` in A2A 0.3, `SendMessage` or `SendStreamingMessage` in A2A 1.0 — and closes with the JSON-RPC response, or when the server-sent event stream ends. The request is the wire input; the response, or each stream event, is one wire output in order. The conversation is the A2A `contextId`: a request without one opens a new conversation, named by the id the agent's reply assigns. The last task state the turn saw when it closed is the turn's outcome, whatever the `final` flag says: completed; waiting for input, for `input-required` and `auth-required`; cancelled; and failed, for `failed`, `rejected` and a turn that ends still `submitted`, `working` or `unknown`. A reply that is a message with no task is completed. A JSON-RPC error, a response that is not 2xx, or a connection that breaks is failed.

### 7. Which traffic becomes a turn

Only the send and stream methods of A2A 0.3 and A2A 1.0. Everything else passes through the proxy untouched and unrecorded: the card fetch, the task methods, push-notification configuration, and any other path the agent serves.

### 8. Which parts are A2UI

A data part is an A2UI part when its MIME type is `application/a2ui+json` or `application/json+a2ui`, whether the type sits in the part's metadata or on the part itself. Its content is kept as delivered, one message or an array. A data part with no A2UI MIME type is a plain data part, whatever it looks like. Acceptance of each form upstream emits is tied to the pin: each deviation from the extension spec is an entry in `_dev/a2ui-findings.md`, and when a pin move shows upstream no longer emitting one, Spectra stops accepting it. Accepting a spelling is not accepting a version: v0.8 stays out.

### 9. The turn's protocol version

The turn's version is the `version` field of the A2UI messages it carries, and the schema check validates each message against the version it declares. Messages of mixed versions in one turn are a finding. A turn with no A2UI messages takes its version from the response's extensions header, `X-A2A-Extensions` in A2A 0.3 and `A2A-Extensions` in A2A 1.0, else from the host's offered capabilities when they name one version, else records none and runs no schema check. SPEC.md's adopter table is corrected: the card names the versions the agent supports; the turn's version comes from its messages.

### 10. The message box's offer

The message box offers everything Spectra supports and lets the agent choose: the v0.9, v0.9.1 and v1.0 extension URIs in the extensions header, and capabilities in the message metadata under both the v0.9 and the v1.0 keys, naming each version's basic catalog. It follows the card fetched at start: a 0.3 card gets `message/stream` and `X-A2A-Extensions`; a 1.0 card gets `SendStreamingMessage`, `A2A-Extensions` and `A2A-Version: 1.0` at its first JSON-RPC interface; an agent whose card does not declare streaming gets its version's send method. It keeps the `contextId` per conversation with a control that starts a new one, sends the `taskId` back when the previous turn ended waiting for input, and sends no data model. A reply's text parts show in the box; its A2UI parts show as a count linking to the turn.

### 11. The local store

`.a2ui-spectra/` in the working directory Spectra was launched from, created with a git-ignore file inside it that ignores everything, with the turns under `.a2ui-spectra/turns/`. Each turn is one complete turn record v0.1 file, with the earlier turns of its conversation embedded, named so files sort by time within their conversation. The file is written once, atomically, when the turn closes, with the schema check's event already in it. A turn in flight lives in the server's memory and reaches the viewer live.

### 12. The server

One local HTTP server on its own port, next to the proxy's. It serves the viewer's built files; a JSON API lists turns and returns a record; two POST routes send a message and start a new conversation, performed by the server as the A2A client through the proxy; and one server-sent event stream pushes turn opened, each wire event as it arrives, and turn closed. Spectra opens the browser on launch and prints the URL. The viewer's port and the proxy's port each have a default and an option to change it.

### 13. The tree and the data model

The viewer feeds the turn's A2UI messages, in order, into upstream web core's message processor in its relaxed validation mode with the version's basic catalog registered, and shows each surface's component model as the tree and its data model as the data model. A message the processor rejects is listed with its error and the rest continue.

### 14. The schema check

The protocol schemas of v0.9, v0.9.1 and v1.0 are copied unchanged at the pin into Spectra and validated with Ajv on draft 2020-12, one instance per version, with strict mode off. Each A2UI message the agent sent in the turn is validated against the single-message envelope of the version it declares, with the envelope's catalog reference bound to a permissive stand-in that accepts any component, any function and any theme, a v1.0 component's own properties counted as evaluated; components are left to Phase 3's catalog check. The host's A2UI messages are not checked. The check runs in the server when the turn closes and writes one check event into the record, findings in A2UI's error shape. A turn with no A2UI messages from the agent and a protocol version records a check of zero messages, shown by the viewer as "no A2UI in this turn"; a turn with no protocol version records no check event.

### 15. The workspaces

Two: the tool, the package named `a2ui-spectra`, holding the CLI, the server, the A2A adapter, the store and the checks; and the viewer, a private workspace on React and Vite whose build output is an input of the tool's build. Node runs the tool in development and tests; Bun compiles it into the binary.

### 16. The binary

Bun compiles the tool for the host platform with the viewer's build embedded and served by the server, the automatic loading of `.env` and `bunfig.toml` switched off, minified with a source map, without bytecode. Bun is pinned to an exact version of at least 1.4.0. CI installs that version, builds the binary, and runs the end-to-end test against it as well as under Node.

### 17. Tests

Unit tests in the tool and the viewer under Node's test runner. A conformance action for the A2A capture path: recorded A2A traffic as the fixture, a HAR file of the requests and the responses or their stream events, captured once from every entry of sub-task 2.3's coverage roster, replayed through the wire proxy over HTTP, and the record the adapter must write from it. An end-to-end test that starts the tool against a small A2A agent in the test workspace, written on the A2A JavaScript SDK and serving A2A 0.3 and A2A 1.0, started in sub-task 2.3, that answers with canned A2UI, sends a message through the message box's API, and asserts a record lands in the store and validates. The done line is a manual run.

### 18. A2UI findings

`_dev/a2ui-findings.md`, in the shape of `_dev/otel-findings.md`, records issues in upstream A2UI's specifications and implementations found while building Spectra — implementations that deviate from the extension specification, the specifications' contradictions, and their gaps — each checked against the pin. Issues in other projects, such as ADK and the A2A SDKs, are not recorded there. Known at the start of the phase: the Python A2A extension writes the deprecated MIME type for v0.9; the Lit and React sample clients put the MIME type on the part rather than in its metadata; every sample agent and client sends one A2UI message per part where the spec says an array; the custom-components sample reads capabilities from inside a data part rather than from the message metadata.

## Invariants

- No credential is ever in the record. Wire events keep parts and metadata only; HTTP headers are not recorded.
- Nothing in the record is transport-specific.
- A record states what happened, and check events judge it. The viewer shows what the messages build; it does not judge them.
