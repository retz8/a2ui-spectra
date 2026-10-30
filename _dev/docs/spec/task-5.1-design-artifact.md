# Sub-task 5.1 — The design artifact

Phase 5's boards on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which the later sub-tasks follow. Sub-task 5.1 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, whose decision 18 names the boards.

## Scope

- The boards decision 18 of the Phase 5 spec names: a model call read in full, with its exact request, its response, its tokens, cache use and hit ratio, its estimated cost and its prefix break; a call recorded raw; tool calls, MCP and HTTP; received spans and their links to the proxies' events; the timeline, with the time to the first token, the time to the first component and each tool call's duration.
- The first screen under `a2ui-spectra attach` with the variables to set, and Flow 5.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the boards go

The new boards join the canvas's existing pages. Flow 5 is a new row on the Flows page. "Turn view details" gains three rows: "Model calls", with a call read in full, the prefix break, a call recorded raw and a call read from spans only; "Tool calls", with MCP over HTTP+SSE and its housekeeping rows, MCP `tools/call` over streamable HTTP, and an HTTP tool; "The agent's spans", with a linked pair's span section and a failed call as a problem. The live turn with calls and the first screen under `attach` join the States row of "Screens and foundations". "Components and states" gains the call rows, the lane's bar and dot forms, an in-flight row, the Maximize button and the header's second line in its forms, plain, unpriced and recorded raw. "Icons" gains the new step types' icons. The list of keys gains `m`, in light and dark. One small-window board, 1,200 × 760 in light, draws the restaurant finder's timeline. Dark twins are drawn for the timeline with calls and for a model call read in full.

### 2. What the boards draw

| Board | Drawn from |
| --- | --- |
| The timeline and a linked model call | The Python restaurant finder: model call, `get_restaurants` seen through ADK's spans only, model call, then the A2UI steps; each model call a linked pair, "Model proxy · ADK spans" |
| A model call read in full, with cache read and write | The custom-components example on Anthropic's Messages, the second turn of a conversation, both cache figures non-zero, the prefix shared whole |
| The prefix break | The same, with a break; the span that differs is illustrative, settled on the canvas |
| A call recorded raw | The custom-components example pointed at OpenRouter |
| MCP over HTTP+SSE, with the housekeeping rows | The custom-components example's floor plan press: `initialize`, `notifications/initialized`, then `resources/read` |
| MCP over streamable HTTP, `tools/call` | A2UIVerse's CircleCI agent with CircleCI's MCP server |
| An HTTP tool | Spectra's own HTTP endpoint in `conformance/`, its path illustrative |
| A failed call counted as a problem | A Gemini 429 the SDK retried, on the restaurant finder |
| A live turn | The restaurant finder's second model call streaming |
| The first screen under `attach` | The restaurant finder under `attach`, with the variables block |

### 3. Flow 5, finding out why a turn cost what it did

Four boards: the turn's header line shows its estimated cost and a low share from the cache; selecting the second model call shows its hit ratio and the prefix break's sentence, the prefix breaking in the system prompt; the marker in the request shows what changed; the sentence's link selects the earlier call it was compared with.

### 4. Calls on the timeline

Model calls and tool calls are rows among the steps, ordered by their start time. Framework spans have no rows. A call seen by a proxy and through the agent's spans is one row once the two are linked; a pair left unlinked is two rows, each labelled with its one source.

### 5. The time lane

Every row ends in a narrow lane of the same width, drawn against the length of the whole turn. A call draws a bar from its start to its end; a step or a delivery draws a dot at its moment. A model call's bar is lighter until its first token and darker after, the change of tone marking the time to the first token; the first A2UI step's dot marks the time to the first component. Each row also shows its duration beside the lane. Bars are grey, teal on the selected row, and red only for problems.

### 6. What a call's row says

| Call | Label | Muted target |
| --- | --- | --- |
| Model call | The model id as requested, such as `gemini-3.6-flash` | The provider: Gemini, OpenAI or Anthropic |
| MCP | The tool's name for `tools/call`, the method otherwise | "MCP" and the server's host |
| HTTP tool | The method and the path | "HTTP" and the host |
| Recorded raw | The host | The method and the path |

Tokens, cost and cache use are not on the row. When the response names a model other than the request's, the detail shows both. An MCP request other than `tools/call`, `resources/read` and `prompts/get` is drawn as the smaller, muted 28px row a delivery has; those three are full 32px step rows.

### 7. A narrow timeline

As the timeline narrows, the muted target gives way first, then the name truncates. The problem mark, the duration and the lane keep their width at every size.

### 8. The live turn

While following, the timeline follows the newest row of any kind, calls included. An in-flight call's duration counts up and its bar grows, lighter until its first token and darker after; its detail fills as chunks arrive, the readable response and the chunk list both growing. Selecting a call shows the surfaces as they stood at its end, or the latest state while it is in flight.

### 9. Maximize

The step's detail has a Maximize button, for every step. Pressed, the detail takes the result pane's height, the result pane folded to its header line; pressed again, the split returns. Selecting another step keeps it maximized. `m` toggles it. It is not remembered in the browser: a reload brings the split back, the divider's position remembered as now.

### 10. A model call's detail

In order: the title line, with the model id, the provider and the API, such as "Anthropic Messages", the sources, such as "Model proxy · ADK spans", the duration and the time to the first token; the usage; the prefix break's sentence; the request; the response; the exchange; and "From the agent's spans" when a span is linked. The sections are separated by spacing and small labels, with no tabs.

### 11. The request

The request is read as sections from the GenAI names: the settings, the model id, temperature, maximum tokens and the rest, as a short list of keys and values; the system prompt as one text block; the tool definitions as a foldable list by name; the messages in order, each with its role, each part by its type, text as text and tool calls and tool results as JSON blocks. The body as sent is in the exchange.

### 12. The usage

Two groups of labelled figures. Tokens: Input, Output, Reasoning, Cache read and Cache write. Derived: Hit ratio, and Estimated cost with a quiet note, "LiteLLM prices · <date>", "Price from the config" when the config overrides it, or "No price for `<model>`" when the table does not know the model. A figure the API never reports is left out, such as cache write on OpenAI; a figure the API has shows even at 0, so a Gemini call with nothing from the cache reads "Cache read 0 · Hit ratio 0%". Figures are set in the sans with tabular digits; how cost is rounded is settled on the canvas.

### 13. The prefix break

One sentence in the usage area, in three forms: "Shares all of the earlier call's request" when the earlier call's whole request is a prefix of this one; "Prefix breaks in the system prompt · against the call at 14:02:31" when the prefix ends inside it, naming the part it ends in; "First gemini-3.6-flash call in this conversation" when there is none to compare with. The earlier call's time is a link that selects that call, in an earlier turn too. In the request below, a thin grey marker, "Shared prefix ends", sits at the exact point with its part unfolded, and under it the text that differs as two short lines, the earlier call's and this one's, the differing span tinted. A prefix break is drawn in grey and a neutral tint, never red.

### 14. The exchange

Request and Response as two labelled parts. The request: the method and the URL on one line, the headers as a list of keys and values, the body as a foldable JSON block. The response: the status, the headers, then the body, or for a stream the list of chunks, each with its time since the call started and its event name, its data folded. A credential Spectra removed shows as its header's name, or its URL parameter, with "Removed by Spectra" in grey. The section starts folded on a call read in full and open on a call recorded raw or an HTTP tool.

### 15. A call recorded raw

The title line holds the host, the method and the path, the status, the duration and the sources, and under it one grey sentence: "Recorded raw · Spectra reads Gemini, OpenAI and Anthropic on their own hosts only." It has no usage, no prefix break and no readable request or response.

### 16. A tool call's detail

The model call's order, with Arguments and Result in place of the usage, the request and the response: the title line, with the tool's name or the method, "MCP" or "HTTP" and the host, the duration and the sources; Arguments as a JSON block; Result, a text block as text and every other block as JSON, labelled "Error" when `isError` is set or the reply is a JSON-RPC error, the tool's own text first; the exchange; and "From the agent's spans" when a span is linked, the only content under the title for a tool seen through the agent's spans only. A housekeeping request shows its params and its result in the same places. An image block in a result is shown as JSON.

### 17. The agent's spans

A source from the receiver is named by the dialect it was translated from: "ADK spans", "OpenInference spans", or "GenAI spans" for the current conventions. The section "From the agent's spans" holds, in order: a first line with that name and the scope's name and version, such as "ADK spans · gcp.vertex.agent 2.8.0"; the chain of spans above the call, such as "invocation › agent_run restaurant_agent › call_llm", each with its duration and folding open to its own attributes; the translated names as a list of keys and values; the span's events, received logs included, each with its time and its body folded; and "As received", every attribute as sent, as one folded JSON block. In a linked pair, the proxy's reading fills the call's sections and the span's view follows in this section.

### 18. A call the model proxy did not read

A model call seen through the agent's spans only, or a linked pair whose proxy side was recorded raw, fills its sections from the span where the span carries the values: the usage from its token counts, with the hit ratio and the cost; the request and the response from its content, each section's label adding "· from <dialect> spans". When the span carries no content, one grey sentence takes the request's place: "No prompt or response in this span · its producer's content capture is off." It has no prefix break, and no exchange where there is no proxy exchange.

### 19. Failed calls as problems

A model call or tool call answered with an HTTP error status, a JSON-RPC error, or a received span whose status is an error, is a problem: it joins the one count, carries the red mark on its row, and opens its detail with a problem block in Phase 3's form, a plain sentence first, such as "The model API answered 429 Too Many Requests.", and the status or code on the second line. A tool's own `isError` is shown in its Result and not counted. A prefix break is never a problem.

### 20. The turn header's second line

A second quiet line under the header's first, shown only when the turn has a model or tool call: "First token 1.2 s · First component 2.8 s · 3 model calls · 2 tool calls · 41.2k in · 1.1k out · 92% from cache · Est. $0.031 · LiteLLM prices 2026-10-01". The first token is timed from the turn's start to the first token of its first model call. A call with no price adds "· 1 call unpriced"; a call recorded raw counts among the model calls, adds no tokens or cost, and adds "· 1 call recorded raw". The totals are the sum of the timeline's rows.

### 21. The first screen under `attach`

Under `a2ui-spectra attach`, the first screen gains a third block under the wire proxy's route: "To see model and tool calls, set these in the agent's shell", with the variables and values `attach` prints at start and one copy button for all of them. Under `a2ui-spectra run` it is not shown.

### 22. What other sub-tasks and documents take from this

- Sub-task 5.2: the model proxy keeps a removed credential's header name, or URL parameter, with a placeholder value; the API serves the variables and values `attach` prints, for the first screen.
- Sub-task 5.4: its linking rule settles a call around which two model call spans may nest, such as ADK's own call span and OpenInference's LiteLLM span on the custom-components example.
- Sub-task 5.5: done when the artifact's Flow 5 row works in the viewer.
- The Phase 5 spec: decision 18 gains the first screen under `attach`, amended in place.
