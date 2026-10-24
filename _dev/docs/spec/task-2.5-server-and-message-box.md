# Task 2.5 — The server and the message box as host

Spec for sub-task 2.5 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the server's API and live stream, the message box's A2A client and its offer, the stub agent's canned A2UI answers, and the end-to-end test. The Phase 2 spec's decisions on the wire proxy, the message box's offer, the server and the tests apply, as amended here. Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin; A2A from its specification v1.0.1.

## Scope

- The server's JSON API and its live stream.
- The message box's server side: its routes, its conversation, and its A2A client.
- The stub agent's canned A2UI conversation and its options.
- Unit tests, and the end-to-end test under Node and against the binary.
- The Phase 2 spec's amendments, `_dev/TODO.md`'s, the tool's README and `conformance/README.md`.
- Not in scope: the viewer and the message box's UI, sub-task 2.6; the message box sending the agent's credentials, Phase 4.

## Locked decisions

### 1. The box's A2A version and endpoint

The message box follows the card fetched at start, read by interface. When the card has `supportedInterfaces`, the first JSON-RPC entry whose `protocolVersion` is 0.3 or 1.0, compared on major.minor, gives the A2A version the box speaks and the path it sends to at the wire proxy. A card without `supportedInterfaces` is spoken to as A2A 0.3 at its `url`. On A2A 1.0, each request carries the chosen interface's `tenant`, and none when the interface sets none (A2A specification v1.0.1, section 8.3.2). The card fetch at start is unchanged.

### 2. A card the box cannot speak to

When the card lists JSON-RPC interfaces but none at 0.3 or 1.0, Spectra warns at start that the message box cannot send to the agent, naming the versions the card lists, and keeps running. The send route refuses with the same message. Hosts pointed at the wire proxy are unaffected.

### 3. What the box sends

One text part per message, with the offer the Phase 2 spec gives. No data model and no actions.

### 4. The A2A client

Written by hand on `fetch`, reading replies with the adapter's own readers. The tool gains no dependency. The client reads each reply only for the `contextId` and the `taskId` it carries into the next send.

### 5. The send route

The send route answers once the wire proxy opens the turn for the box's request, with the turn's trace id and the conversation id when known. What the box shows of the conversation comes from the record, through the API and the live stream.

### 6. The box's conversation

The server holds one current conversation for the message box: its `contextId`, taken from the conversation its turn was recorded in when the reply broke off before naming it, and the `taskId` to send back after a turn that ended waiting for input. The send route continues it, the new-conversation route clears it, and a read route returns its conversation id, or none yet, the trace ids of the turns the box sent in it, and the trace id of its open turn when it has one. Each run of Spectra starts with no conversation, and every browser tab shares it.

### 7. One turn at a time

While the current conversation's last turn is open, the send route refuses with 409, saying a turn is still open. Starting a new conversation is always allowed; the open turn goes on and is captured.

### 8. The listing

The API lists turns newest first, each with its trace id, conversation id and start time, the fields the store's file names give. The listing merges the store's turns with the server's memory: open turns, marked open, and closed turns kept in memory after a failed write. Sub-task 2.6 adds what its turn list shows.

### 9. The record route

The record route returns a closed turn's record, from disk or, for a turn whose write failed, from memory. An open turn has no record, and the route says so.

### 10. The live stream

A new subscriber first receives each open turn's turn opened and its wire events so far, then live events. Turn closed is sent once the turn's schema check and its write have finished, whether or not the write succeeded, and carries that turn's own events with its check event.

### 11. The stub agent's behaviours

A start option picks the run's behaviour. With none, the stub waits for a cancel, as in sub-task 2.3. With the option, it holds the canned A2UI conversation: a message that opens a task gets canned A2UI and ends waiting for input, and a message carrying that task's id completes it. The card's skill describes the behaviour running. A second option lists the stub's A2A 0.3 interface first.

### 12. The stub's A2UI version

The stub reads the host's offered capabilities as the extension specs describe and answers in the newest A2UI version they name, echoing that version's extension URI in its response's extensions header. Its code shares nothing with the tool.

### 13. The stub's wire form

Each A2A version's own part type, with the MIME type `application/a2ui+json` in each A2UI part's metadata. On A2A 1.0, one data part holds an array of A2UI messages, as the extension specs say. On A2A 0.3, whose data part holds an object, each A2UI message is its own data part, as finding 11 of `_dev/a2ui-findings.md` proposes.

### 14. Tests

- Unit tests: the interface choice; the request for each A2A version, with the offer; the `contextId` and `taskId` carried forward; the refusal while a turn is open; the listing's merge and the record route; the stream's catch-up, and turn closed after the write.
- The end-to-end test lives in the tool workspace, whose test target depends on the conformance workspace's build, and runs under Node and against the binary. It starts the stub with its canned A2UI conversation, once with A2A 1.0 first and once with A2A 0.3 first, and sends a two-turn conversation through the box's API on each. Each turn lands a record in the store that validates against the turn record schema with a passing schema check, appears in the listing, is returned by the record route, and was sent on the stream as turn opened, its wire events and turn closed. The second turn completes.

### 15. The Phase 2 spec's amendments

- The message box's offer: the box speaks the version of the card's first JSON-RPC interface at A2A 0.3 or 1.0; a card with JSON-RPC at neither is warned about at start, and the box does not send.
- The server: the send route answers with the turn's trace id once the turn opens; the server holds the box's one conversation and refuses a send while its last turn is open.
- Tests: the end-to-end test runs the stub on both A2A versions, with a two-turn conversation on each.

### 16. Other documents

- `_dev/TODO.md`: the 2.5 line names this spec; Phase 4's line gains the message box sending the agent's credentials from the shell, never recorded.
- The tool's README: the API, the live stream and the message box.
- `conformance/README.md`: the stub's two options.
- SPEC.md and `_dev/a2ui-findings.md` are unchanged.
