# Phase 5 — Inside the turn

The model proxy and the tool proxy, reached by redirection, with credentials stripped; the OTLP/HTTP receiver translating each producer's dialect; the exact model request, tokens, prompt cache use, estimated cost and the timeline. Phase 5 of SPEC.md's roadmap, between Phase 4, checks and preview, and Phase 6, the A2UI step. The design authority is SPEC.md, in particular its "Features", "Capture", "Turn record" and "v1 coverage" sections. The record is turn record v0.1, amended as decision 17 says.

## Scope

In scope:

- Redirection under `a2ui-spectra run`, and what `a2ui-spectra attach` tells the adopter to set.
- Trace context on the A2A requests Spectra sends or passes on, and placing each call and span in its turn.
- The model proxy: four provider APIs read in full, every other host recorded raw.
- The tool proxy: MCP over streamable HTTP and over HTTP+SSE, and HTTP tools.
- The OTLP/HTTP receiver: its signals, the three dialects, content capture, and links to the proxies' events.
- The viewer: the model call, tool calls, received spans and the timeline; prompt cache use, estimated cost and the prefix break.
- The stand-in provider, Spectra's own MCP server and HTTP endpoint, the recordings, the tests and the acceptance run.
- The turn record's amendments.
- The design canvas's Phase 5 boards.

Out of scope:

- Reading other hosts of the four APIs, such as Vertex AI, Azure OpenAI and Amazon Bedrock. After v1.
- A recording of real OpenAI traffic. Backlog, until there is an OpenAI key.

## Locked decisions

### 1. The providers read in full

The model proxy reads four APIs in full: Google's Gemini API, OpenAI's Chat Completions and Responses, and Anthropic's Messages, each on the provider's own host only. A call to any other host that redirection reaches is recorded raw.

### 2. Redirection

`a2ui-spectra run` sets the base-URL variables the provider SDKs and LiteLLM read for the three providers. The model proxy forwards each call to the value the variable has in Spectra's own environment, and to the provider's own API when it has none. Under `a2ui-spectra attach`, Spectra prints at start the variables and the values to set in the agent's shell.

### 3. Trace context on A2A requests

The message box and the wire proxy add a W3C `traceparent` to each A2A request, carrying the turn's trace id. When a host's request through the wire proxy already carries one, the wire proxy keeps it and the turn adopts its trace id.

### 4. Placing a call or a span in its turn

A model call, a tool call or a received span carrying a turn's trace id belongs to that turn. Without trace context, one that starts while exactly one turn is open belongs to that turn.

### 5. What cannot be placed

A call or span that cannot be placed, because two turns are open or none is, is not recorded. The terminal logs one line for it: what it was, when, and why it was not placed.

### 6. The model proxy's test agents

Upstream's custom-components example, unchanged, its `LITELLM_MODEL` switched per API, covers the four APIs. A2UIVerse's agents on Claude, through ADK's Anthropic class, are a second route to Anthropic. The recordings are made with an Anthropic key; there is no OpenAI key.

### 7. The stand-in provider

The model proxy's tests run against a stand-in provider for the four APIs, read as if it were the provider's own host. Its Gemini and Anthropic responses are real recordings. Its OpenAI responses, for Chat Completions and Responses, are built from the request, response and stream event examples of OpenAI's published API reference, and the acceptance run drives the custom-components example against it for both OpenAI APIs.

### 8. The tool proxy

The tool proxy covers MCP over streamable HTTP and over HTTP+SSE. Traffic to a configured tool server that is not MCP is an HTTP tool, recorded raw as one tool call event per HTTP request. The targets:

- MCP over HTTP+SSE: the custom-components example's floor plan server.
- MCP over streamable HTTP: an MCP server of Spectra's own in `conformance/`, for the tests; A2UIVerse's CircleCI agent in its live mode, by hand in the acceptance run, its MCP URL read from a variable, a change made in `a2uiverse-apps` from this phase.
- HTTP tools: an HTTP endpoint of Spectra's own in `conformance/`.

### 9. The receiver's signals

The receiver takes traces and logs. A log record is attached to its span as one of the span's events and translated with it. Metrics are accepted and dropped.

### 10. The dialects

The receiver translates the three dialects SPEC.md names: ADK's own names, OpenInference's, and the current GenAI conventions, which OpenLLMetry writes and ADK writes when opted in. ADK is tested against upstream's ADK samples, unchanged. OpenInference and OpenLLMetry are tested against the custom-components example launched under `opentelemetry-instrument`, with their instrumentations installed beside it and its code unchanged.

### 11. Content capture

`a2ui-spectra run` switches the GenAI conventions' content capture on, unless the adopter has set it. ADK's, OpenInference's and OpenLLMetry's own switches keep their defaults. Under `attach`, the variable is printed with the others.

### 12. One call seen by two capture paths

A proxy event and a received span are linked as the same call through trace context. Without it, a proxied exchange that falls inside exactly one received model call span of the same turn is linked to it, and a tool proxy exchange to exactly one tool call span. When none or several contain it, they stay unlinked.

### 13. Prompt cache use

Each model call shows its cache read and cache write tokens where its provider reports them. Each model call and each turn shows its hit ratio, the share of input tokens read from the cache.

### 14. Estimated cost

Cost comes from LiteLLM's price table, copied at a pinned release with its notice and labelled with that release's date, and overridable per model in the config. Each model call and each turn shows its estimated cost with the table's date. A model the table does not know shows none.

### 15. The prefix break

Each model call read in full is compared with the earlier call of the same model in the same conversation that shares the longest prefix with it. It shows where the shared prefix ends, which part that is, the tool definitions, the system prompt or the nth message, and what differs there. A call recorded raw has none.

### 16. Derived values are computed when shown

The hit ratio, the estimated cost and the prefix break are computed when shown, from what the record holds. The record does not carry them.

### 17. The turn record

Turn record v0.1 is amended in place: its provider rule reads the four APIs of decision 1 in full, and a received log record is kept as an event of its span.

### 18. The design artifact comes first

Phase 5's boards are drawn first on the design canvas "Spectra viewer UI", in light and dark, alongside the server work: a model call read in full, with its exact request, its response, its tokens, cache use and hit ratio, its estimated cost and its prefix break; a call recorded raw; tool calls, MCP and HTTP; received spans and their links to the proxies' events; the timeline, with the time to the first token, the time to the first component and each tool call's duration; and the first screen under `a2ui-spectra attach`, with the variables to set in the agent's shell.

### 19. The acceptance run

The last sub-task, through the tunnel, under `run` and `attach`, across every board Phase 5 adds, in light and dark; what it finds is fixed within the sub-task. Each earlier sub-task keeps its own by-hand done line. The targets:

- the Python restaurant finder, on Gemini through ADK's Gemini class, with ADK's spans;
- the Node restaurant finder, on Gemini through `@google/genai`;
- the custom-components example across the four APIs, the OpenAI ones against the stand-in provider, with its MCP server over HTTP+SSE, and under OpenInference and OpenLLMetry;
- A2UIVerse's CircleCI agent in its live mode, with CircleCI's MCP server over streamable HTTP; on Claude once A2UIVerse's Claude support is on its main, on Gemini until then.

### 20. Other documents

- SPEC.md, amended in place:
  - The v1 coverage table: the four APIs of decision 1 read in full on the providers' own hosts, every other host recorded raw; other hosts, such as Vertex AI, Azure OpenAI and Amazon Bedrock, after v1.
  - The v1 features: token usage gains cache reads and writes, the hit ratio and the estimated cost with its table's date; the prefix break is added; the after-v1 tokens split by where they went drops cache hits.
  - Capture's Redirection: LiteLLM's OpenAI and Anthropic variables, forwarding to the original value, what `attach` prints, the trace context on A2A requests, placing by trace context and then the time window, and the content capture switch.
  - Capture's OpenTelemetry: the receiver takes traces and logs.
  - The roadmap's Phase 5 line.
- The turn record prose and schema carry decision 17.
- `_dev/TODO.md`: the Phase 5 line names this spec; the backlog's three items for the Phase 5 grill are removed; the backlog gains a recording of real OpenAI traffic once there is an OpenAI key.
- `_dev/otel-findings.md` gains what this phase finds in the GenAI conventions and their producers, each checked against the pinned conventions first; ADK 2.8.0 writing `gen_ai.usage.cache_creation.input_tokens` where turn record v0.1 has `gen_ai.usage.cache_write.input_tokens` is the first to check.
- `_dev/a2ui-findings.md` gains what this phase finds in A2UI.
- The READMEs: the tool's, for `run`'s variables, what `attach` prints and the receiver; `conformance/README.md`, for the stand-in provider, the MCP server and the HTTP endpoint.
- A2UIVerse: only the CircleCI agent's MCP URL read from a variable.

## Invariants

- No credential is ever in the record: model API keys and MCP's `Authorization` tokens, in headers and in URLs alike.
- The proxies forward requests and responses unchanged, and pass a streamed response on chunk by chunk as it arrives. The trace context on A2A requests is the one change Spectra makes to traffic.
- A record states what happened. Cost, the hit ratio and the prefix break are computed when shown.
- Nothing committed in A2UIVerse depends on this repo.
