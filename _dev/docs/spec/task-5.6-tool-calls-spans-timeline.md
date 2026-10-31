# Sub-task 5.6 — Tool calls, spans and the timeline in the viewer

Tool call rows and their detail, received spans as the section "From the agent's spans" and as calls read from spans only, the time lane with its bars, dots and durations, the header's tool call count, failed tool calls and failed spans as problems, and `turn_amended` on the live stream. Sub-task 5.6 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, carrying its decision 12, one call seen by two capture paths, into the viewer, and building the tool call, span and timeline boards of the 5.1 design spec, `_dev/docs/spec/task-5.1-design-artifact.md`, that sub-task 5.5's decision 1 left to it.

## Scope

- The time lane on every row, with the bar of a call, the dot of a step or a delivery, the duration beside it and the in-flight bar.
- Tool call rows, full and housekeeping, and the tool call's detail.
- Received spans: a linked pair as one row, a chain with no exchange as one row, the section "From the agent's spans", and a call read from spans only.
- Failed tool calls and failed spans as problems, in the viewer and in the server's listing.
- The header's second line's tool call count, and span-only calls in its totals.
- The live stream: tool calls' `call_started`, `call_chunk` and `call_ended`, and `turn_amended`.
- The narrow timeline and the small-window board with calls.
- The viewer's tests on the tool capture suite's and the receiver capture suite's records and on hand-written ones.

Out of scope: the acceptance run through the tunnel, sub-task 5.7; the wrapper's spans, Phase 6; any change to how the proxies or the receiver record. The server changes only in its listing's count.

## Locked decisions

### 1. The rows

Model calls and tool calls are rows among the steps by start time, as the 5.1 spec's decision 4 has them, and framework spans have no rows. A proxy event and the received spans linked to it are one row. Nested received spans of one kind, `model_call` or `tool_call`, that each contain the next are one chain and one row, the rule the receiver's linking uses, whether or not an exchange is linked to them. A row's sections — the usage, the request, the response, the model id, the provider — are filled by the proxy's reading when there is one, else from the chain's spans, each section by the first span, walking from the innermost outward, that carries it. The title line names every source in the row, such as "Model proxy · ADK spans · OpenInference spans". A pair left unlinked is two rows.

### 2. The lane's range

Every lane runs from the turn's start, the request's arrival at the wire proxy, to the latest of the turn's end and every row's end, so that a span placed after the agent's last reply is never clipped. On a live turn the end is the present, and the scale grows as the turn runs.

### 3. A call without a first token

A tool call's bar and a span-only model call's bar are drawn in the darker tone from start to end; the lighter tone means waiting for the first token and nothing else. The header's "First token", when the first model call is read from spans only, runs to that call's end, 5.5's rule for a call that did not stream. In flight, a tool row's duration counts up and its bar grows as a model row's does; its detail shows the Arguments from `call_started`, the Result at `call_ended` and the exchange's chunks as they arrive; a server-initiated notification, sent as `call_started` and `call_ended` back to back, appears at once.

### 4. What "N tool calls" counts

The header's second line counts the full tool rows: `tools/call`, `resources/read`, `prompts/get`, HTTP tools and tool calls read from spans only. Housekeeping rows — `initialize`, `notifications/initialized`, `tools/list`, `ping`, `DELETE`, a standalone `response`, a server's notifications and requests — stay on the timeline uncounted. The canvas's two MCP boards, which counted every tool row, have their header strings amended to "1 tool call", and the 5.1 spec's decision 20 gains the rule.

### 5. The source on a span-only row

A model call read from spans only carries its source in the row's muted target, `Gemini · ADK spans`; a proxied call's row stays `Gemini`, linked or not. A tool call read from spans only has `in the agent` as its muted target, as the canvas draws it, and its title line reads "in the agent · ADK spans". The canvas's spans-only board gains the suffix on its model rows.

### 6. Provider and price for a call read from spans

The provider comes from the chain under decision 1's innermost-first rule. Its display and its table provider: `gcp.gemini` shows as Gemini and prices as `gemini`; `gcp.gen_ai` as Google and `gemini`; `openai` as OpenAI and `openai`; `anthropic` as Anthropic and `anthropic`; any other value shows as written and has no table provider. A chain with no provider shows none, its row reading `gemini-3.6-flash · ADK spans`, and has no price. The title line names the API the provider implies — "Gemini API", "Anthropic Messages", "OpenAI", "Google" — since a span does not say which API was called.

The price match gains one clause: the entry of the call's provider whose key, as written or less the `gemini/` prefix, equals the model id, so that a LiteLLM span's `gemini/gemini-3.6-flash` meets its own key. Nothing is stripped from or added to a model id, and the row shows it as the agent requested it. 5.5's decision 4 and the Phase 5 spec's decision 14 carry the clause.

### 7. Failed calls as problems

One problem per row: a row is a problem when any of its sources has status `2`, the proxy event or any span of its chain, so a linked pair where both sides failed is one problem. Framework spans have no rows and their status is never a problem; a failed span above a call shows its status in the spans section's chain and nothing more. A tool's own `isError` is shown in the Result and not counted, as the 5.1 spec's decision 19 has it.

The problem block takes 5.5's three-line form, a plain first line, the code and the source on the second, the recorded status message quietly third:

| Case | First line | Second line |
| --- | --- | --- |
| A JSON-RPC error | "The tool server answered a JSON-RPC error." | "JSON-RPC -32602 · MCP" |
| An HTTP error, unreachable, a broken stream, closed early | 5.5's four sentences, "the tool server" in place of "the model API" and "the provider" | "HTTP 404 · HTTP", "HTTP 502 · MCP" |
| `cancelled` | "The agent cancelled the request before it was answered." | "cancelled · MCP" |
| `aborted` | "The connection closed before the request was answered." | "aborted · MCP" |
| A span-only call whose span has error status | "The agent's span ended in error." | "Span status error · ADK spans" |
| A linked pair, both failed | The proxy's sentence; the span's status message joins the third line | |

The server's listing replaces `failedModelCalls` with one field, `failedCalls`: the count of failed rows, model and tool, proxy and span-only, under the rule above, a span-only chain counted once and a span linked to a proxy event not counted beside it. The viewer mirrors the rule, as it mirrors `failedModelCalls` today; both are pinned by tests on the same records.

### 8. `turn_amended` in the viewer

For a turn whose record the viewer holds, each event in a `turn_amended` is replaced or added by span id and everything that hangs off the record is recomputed: the timeline, the header's second line, the problems and the turn list's row fields. Rows may appear, and a span-only row merges into a proxy row when its link arrives. On a live turn, following stays on the newest row by start time; a late span with an earlier start does not move it. For a turn the viewer does not hold, its record is fetched once and its list row recomputed. Nothing is announced.

A row is addressed, in the page address and the selection, by the proxy event's span id when it has one, else by its innermost span's id. When a row's identity changes under an amendment, the selection and the page address follow it.

The listing's cached fields reflect an amended record; how is settled in the implementation.

### 9. The spans section

The section "From the agent's spans" holds, in the 5.1 spec's order:

- One source line per distinct source and scope in the chain, such as "ADK spans · gcp.vertex.agent 2.8.0" then "OpenInference spans · openinference.instrumentation.litellm 0.1.52". A received call span with no dialect is named "Received spans" with its scope.
- "Above this call": every ancestor of the row's spans by `parentSpanId` within the turn, root first, the turn event itself not listed, then the row's own chain outermost to innermost, each of those marked "this call"; every span with its name and duration, folding open to its received attributes; a span whose status is an error adds "· status error" after its duration.
- "Translated": each translated name once, the innermost span's value winning.
- "Events": the span events of the row's chain in time order, each with its time, its name and "log record" when it carries the `a2ui.received.log.` names, folding open to its attributes and body.
- "As received": one folded block per span of the chain, labelled with the span's name and its attribute count.

### 10. What is built as the 5.1 spec and the canvas have it

The row forms and labels of the 5.1 spec's decision 6, a `DELETE` or a standalone `response` labelled by the event's name; the tool call's detail of its decision 16 as the canvas draws it — the title line, Arguments, Result with its meta line, the exchange folded on MCP and open on an HTTP tool, the "MCP" pairs block after the exchange, "From the agent's spans" last, a housekeeping request's params and result in the same places; a call read from spans only as its decision 18 has it, "· from ADK spans" on the labels and the grey sentence when the span carries no content; the lane's forms of its decision 5; the narrow timeline of its decision 7; following the newest row of any kind and selecting a call showing the surfaces as they stood at its end, its decision 8. Tool rows and housekeeping rows are addressed by span id, the problems-only filter keeps failed rows, and there are no new keys. A span-only call's tokens count in the header's totals. A span-only call is neither compared for the prefix break nor a candidate, 5.5's decision 8.

### 11. Tests

- On the two suites' records, read as JSON as the A2A capture suite's are: the tool capture suite's — the full and housekeeping rows of its tools case, `tools/call missing` a problem and `tools/call fail` not, `DELETE` and `sampling/createMessage` as housekeeping rows, `GET /missing` a problem among the HTTP rows; the receiver capture suite's — linked pairs as one row and `get_restaurants` as `in the agent` on `adk_time_window`, the chain of three as one row with two source lines on `openinference` and `openllmetry`, one span linked to two exchanges as two rows on `several_exchanges`, no provider and no price on `adk_operation_details`. The viewer's test runner takes the two suites' directories among its inputs.
- Hand-written, with 5.5's builders extended: a span-only chain with no exchange, filled innermost first and priced through `gcp.gen_ai` with the `gemini/` id; an unlinked pair, `Gemini` against `Gemini · ADK spans`; a proxy tool call linked to a received tool span, which no fixture holds; the failed-call sentences in their forms; the header's second line with "1 tool call" and span-only tokens in its totals; the lane's bars and dots against decision 2's range.
- The viewer's `failedCalls` rule against the server's, on the same records in each workspace's tests.
- The live-stream consumer's first test, scoped to this sub-task: `turn_amended` on a held record, rows appearing and a span-only row merging into a proxy row with the selection following, and on an unheld turn, fetched once; tool calls' `call_started`, `call_chunk` and `call_ended`.

### 12. Done line

Done when, through the tunnel with the real binary: under `run`, the Python restaurant finder on Gemini, launched under `opentelemetry-instrument` with the bootstrap set, shows model call, `get_restaurants · in the agent`, model call as rows with bars and durations among the steps' dots, the first model call's bar changing tone at its first token, the header's second line reading "… · 2 model calls · 1 tool call · …"; a model call selected shows "Gemini API · Model proxy · ADK spans" and the spans section with `invocation › agent_run restaurant_agent › call_llm` and a log record among the events; `get_restaurants` selected shows its arguments and result from the span under "in the agent · ADK spans". The custom-components example on Gemini through LiteLLM with its floor plan server, on a floor plan press, shows `initialize` and `notifications/initialized` as housekeeping rows and `resources/read` as a full row, the header reading "1 tool call", the Result the floor plan's HTML with its meta line and the exchange folded as "202 · reply on GET /sse"; the same example under OpenInference shows a model call's spans section with two source lines and the chain of three marked "this call". Under `attach`, the restaurant finder restarted with the three receiver exports set and the model variables unset: every model row reads `gemini-3.6-flash · Gemini · ADK spans`, the usage reads "Tokens · from ADK spans" with a price, the request comes from the span's content, and with the viewer kept open on a turn as it closes, its spans arrive seconds later without a reload. In light and dark: the calls timeline, a linked model call's detail and the small window at 1,200 × 760 against their boards, the two MCP boards' header strings amended on the canvas.

Not live: a failed tool call and an HTTP tool, covered on the tool capture suite's records in the tests; MCP over streamable HTTP, CircleCI's in sub-task 5.7.

### 13. Other documents

- The Phase 5 spec, amended in place: decision 14 gains decision 6's clause on the key as written.
- The 5.1 design spec, amended in place: decision 4 gains the chain rule and the source in a span-only model row's muted target; decision 5 the lane's range and the one tone for a call without a first token; decision 6 the span-only tool row's `in the agent` and the label of a `DELETE` or a standalone `response`; decision 17 decision 9's five points; decision 18 decision 6's provider and API table; decision 19 the one-problem-per-row rule and the tool sentences; decision 20 the count of full rows only. The canvas: the two MCP boards' header strings, and the spans-only board's model rows gaining `· ADK spans`.
- 5.5's spec: decision 4 gains the same clause as the Phase 5 spec's decision 14.
- The tool's README: the listing's `failedCalls` in place of `failedModelCalls`, with its rule. The viewer's README: tool rows and housekeeping rows, the lane and the durations, the tool call's detail, the spans section, a call read from spans only, the header's tool count, `turn_amended` handled.
- `_dev/TODO.md`: the 5.6 line names this spec and gains the done line; the backlog gains a view of a turn's whole received span tree, framework spans included.
- Unchanged: SPEC.md, the turn record prose and schema, the config schema, `conformance/README.md`. The findings files gain nothing unless the run finds something.

## Invariants

- The record states what happened. Rows, counts, the hit ratio, the cost and the prefix break are computed in the viewer when shown and never stored.
- The viewer draws every received attribute as received beside the translated names; merging spans into one row hides nothing the record holds.
- A span that is neither a call nor above one is not shown in v1; the backlog carries the view of the whole received tree.
