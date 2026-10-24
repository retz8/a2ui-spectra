# Task 2.2 — The A2A adapter

Spec for sub-task 2.2 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the wire proxy for A2A 0.3 and 1.0, the turn and wire events it writes as turn record v0.1, the dialect acceptance and `_dev/a2ui-findings.md`, and the amendments to SPEC.md, the Phase 2 spec and the turn record prose. The Phase 2 spec's decisions on the wire proxy, one turn per host message, which traffic becomes a turn, which parts are A2UI and the turn's protocol version apply, as amended here. Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin.

## Scope

- The wire proxy and its listener, for A2A 0.3 and A2A 1.0 over JSON-RPC.
- The card rewrite, and the transport check at start.
- The turn and wire events, written as turn record v0.1 and handed out as turn notifications.
- The dialect acceptance and `_dev/a2ui-findings.md`.
- Unit tests on hand-written traffic, and the command-line test extended to the proxy.
- SPEC.md's amendments, the Phase 2 spec's amendments, and the turn record prose's `data` part.
- Not in scope: the coverage roster — the agents built for the coverage gaps, the traffic recorded once from every roster agent and the conformance action — which is sub-task 2.3; the store and the schema check, sub-task 2.4; the server's API and live stream and the message box, sub-task 2.5; the viewer, sub-task 2.6.

## Locked decisions

### 1. A2A versions

The adapter speaks A2A 0.3 and A2A 1.0, over JSON-RPC on HTTP. Both write the same turn record.

### 2. Which requests open a turn

Any POST, at any path, whose body is a JSON-RPC 2.0 request naming `message/send` or `message/stream` (A2A 0.3), or `SendMessage` or `SendStreamingMessage` (A2A 1.0), opens a turn. The method name gives the A2A version the request and its reply are read as, request by request. A body that is not a single JSON-RPC request object naming one of the four methods passes through untouched and unrecorded.

### 3. Forwarding

Every request goes to the agent's origin with its headers and body as received, except `Host`, which is set to the agent URL's host and port. No `X-Forwarded-*` headers are added. An `https` agent is reached over TLS with its certificate verified. A compressed body is relayed compressed; only the copy parsed for capture is decoded.

### 4. The card rewrite

The proxy rewrites every card it serves: at `/.well-known/agent-card.json`, at the deprecated `/.well-known/agent.json`, and the extended card returned by `agent/getAuthenticatedExtendedCard` (A2A 0.3) or `GetExtendedAgentCard` (A2A 1.0). It rewrites the card's `url` and the `url` of each JSON-RPC entry in `additionalInterfaces` (A2A 0.3) or `supportedInterfaces` (A2A 1.0); entries for other transports are left alone. Only the origin is replaced, by `http://127.0.0.1:<proxy port>`; the path is kept.

### 5. The transport check at start

Judged on the card fetched at start. When the card lists a JSON-RPC interface but not first, Spectra warns, naming the preferred transport, that hosts following the card's preference bypass capture, and keeps running. When the card lists no JSON-RPC interface, Spectra says it captures only A2A over JSON-RPC, names the transports the card lists, and exits with an error, ending the agent's process under `run` as on any exit.

### 6. What the adapter hands out

Turn notifications: turn opened, with the conversation id when known; each wire event as it is captured; and turn closed, carrying that one turn's turn event and wire events, without a check event. The adapter keeps no conversation history; the store assembles each record file. The adapter fills everything only it can see, the turn's protocol version included.

### 7. Wire outputs

One wire output per delivery: the JSON-RPC response of a send, or each event of a stream. It holds the parts the agent authored for this turn that the delivery carries:

- a `Message`: its parts;
- a status update: its message's parts;
- an artifact update: its artifact's parts;
- a `Task`: the agent's messages in `history` after this turn's request message, matched by `messageId`, then its status message unless already among them, then its artifacts' parts.

User-role messages never become wire output. A delivery with no such parts is a wire output with an empty parts list. The task state of each delivery is not recorded; only the turn's outcome is.

### 8. The turn's outcome

The last task state the turn saw when it closed, whatever the `final` flag says:

- `completed` → `completed`;
- `input-required` and `auth-required` → `waiting_for_input`;
- `canceled` → `cancelled`;
- `failed` and `rejected` → `failed`;
- a reply that is a `Message` with no task → `completed`;
- a stream that ends while the state is `submitted`, `working` or `unknown`, or that carried no state → `failed`;
- a JSON-RPC error, a non-2xx response or a connection that breaks → `failed`, with the error's message as the turn event's status message.

A2A 1.0's `TASK_STATE_*` names map the same way.

### 9. Parts

- Text → a `text` part.
- A file with bytes → a `blob` part; a file with a URI → a `uri` part. `modality` comes from the MIME type's top level — `image`, `video` or `audio`, else `document` — and `mime_type` is set when the file gives one.
- A data part with an A2UI MIME type → an `a2ui` part.
- Any other data part → a generic part, `{"type": "data", "content": <the data>}`.

A file's name stays on the part as `name`, and the part's metadata, less the A2UI MIME type once read, stays on the part as `metadata`.

### 10. Metadata

On a wire input, `a2ui.wire.capabilities` merges the version-keyed values of `a2uiClientCapabilities` and `a2uiRendererCapabilities` into one object keyed by version. `a2ui.wire.data_model` is the value of `a2uiClientDataModel` or `a2uiRendererDataModel` as sent; when both are present, the one matching the turn's version, with the other left in the metadata. Every other key of the message's metadata goes to `a2ui.wire.metadata` unchanged. On a wire output, `a2ui.wire.metadata` is the metadata of what carries the parts: the message for a `Message` or a status update, the artifact for an artifact update, the task for a `Task`.

### 11. The proxy in the running tool

The proxy's listener starts with the server once the card answers, and Spectra prints the proxy's address beside the viewer's URL as the address to point a host at. The transport check happens at the same moment. Until sub-tasks 2.4 and 2.5 consume them, the running tool drops the turn notifications.

### 12. A2UI findings

`_dev/a2ui-findings.md`, in the shape of `_dev/otel-findings.md`, records issues in upstream A2UI's specifications and implementations found while building Spectra: implementations that deviate from the extension specification, the specifications' contradictions, and their gaps. Each is checked against the pin before it goes in. Issues in other projects, such as ADK and the A2A SDKs, are not recorded there.

### 13. Tests

Unit tests on hand-written A2A 0.3 and A2A 1.0 traffic cover the wire outputs, the outcomes, the parts, the metadata, the card rewrite and which requests open a turn. The command-line test's in-test server grows into a small fake agent, and the test checks the card rewritten through the proxy, a JSON-RPC response and a server-sent event stream passed through byte for byte, the rewritten `Host`, and the transport check's warning and stop. It runs under Node and against the binary.

### 14. SPEC.md's amendments

- The adopter table's row on reaching the agent: the card names its transport and the versions the agent supports; the turn's version comes from its messages.
- The upstream reference line moves to `upstream/main` at 020a9d6f.
- The coverage line becomes the axes the coverage set jointly exercises — the A2UI versions v0.9, v0.9.1 and v1.0; A2A 0.3 and 1.0; A2A SDKs beyond Python's and JavaScript's; the wire forms; the outcomes; and the hosts, among them the message box, upstream's Angular sample client and CopilotKit's runtime as an A2A host — with upstream's three core samples as the headline targets. Agents found and agents built for the gaps fill it.
- The v1 coverage table's transport row reads A2A 0.3 and 1.0 over JSON-RPC, with A2A over gRPC and HTTP+JSON after v1.

### 15. The Phase 2 spec's amendments

- The decisions on the wire proxy, one turn per host message, which traffic becomes a turn and the turn's protocol version name both A2A versions: their methods, their card shapes, and both extension header names, `X-A2A-Extensions` and `A2A-Extensions`.
- The turn's outcome follows decision 8 above.
- The message box follows the card fetched at start: a 0.3 card gets `message/stream` and `X-A2A-Extensions`; a 1.0 card gets `SendStreamingMessage`, `A2A-Extensions` and `A2A-Version: 1.0` at its first JSON-RPC interface; an agent whose card does not declare streaming gets its version's send method.
- The done line adds one live A2A 1.0 agent from sub-task 2.3's roster, under `run` and `attach`, through the message box.
- The conformance action records traffic from sub-task 2.3's roster.
- The A2UI findings take decision 12's scope.

### 16. The turn record prose

One sentence in the wire events' section names the `data` part beside the `a2ui` part: a data part that is not A2UI is a generic part of type `data`, its `content` the data. The schema is unchanged.
