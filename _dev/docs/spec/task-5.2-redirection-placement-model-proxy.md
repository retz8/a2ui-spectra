# Sub-task 5.2 — Redirection, placement and the model proxy

Redirection under `run` and `attach`, trace context on A2A requests, placing calls in their turns, and the model proxy reading the four provider APIs, with the stand-in provider and its recordings. Sub-task 5.2 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, carrying out its decisions 1 to 7 and 17: the providers read in full, redirection, trace context on A2A requests, placing a call in its turn, what cannot be placed, the model proxy's test agents, the stand-in provider, and the turn record's provider rule.

## Scope

- `run`'s base-URL variables, the model proxy's listener and forwarding to the original value; what `attach` prints, the API serving it, and the first screen's block showing it.
- The `traceparent` on A2A turn requests, a host's own kept.
- Placing model calls in their turns, the unplaced logged, a turn waiting for its calls, and the `model_proxy` capture path.
- The model proxy: the four APIs read in full on the providers' own hosts, every other request recorded raw, streams passed on as they arrive, credentials removed, failed calls; calls on the live stream.
- The stand-in provider, the model capture suite, the Gemini and Anthropic recordings, OpenAI's responses from its API reference.
- The turn record prose's amendments: the provider rule, the placeholder for a removed credential, and a body that is neither JSON nor text.

Out of scope: the tool proxy, sub-task 5.3; the OTLP/HTTP receiver and `run`'s content capture switch, sub-task 5.4; the model call in the viewer, including a readable response growing from its chunks, sub-task 5.5; tool calls, spans and the timeline in the viewer, sub-task 5.6; the OpenAI APIs against the stand-in under a real agent, the Node restaurant finder and A2UIVerse's agents, the acceptance run, sub-task 5.7. Vertex AI is not supported.

## Locked decisions

### 1. Trace context: the wire proxy alone, on turn requests only

The wire proxy holds each request until its body has been read, then forwards it. A turn request, `message/send` or `message/stream`, or `SendMessage` or `SendStreamingMessage` in A2A 1.0, gains a `traceparent`; every other request passes as before. The message box adds none of its own: its requests pass through the wire proxy and get the wire proxy's.

### 2. The `traceparent`

Version `00`, the turn's trace id, the turn event's `spanId` as the parent id, and the flags `01`, sampled. No `tracestate` is added. A host's own `traceparent` is kept with its `tracestate`, and the turn adopts its trace id. One that does not parse under W3C's version-00 rules counts as absent and is replaced by Spectra's.

### 3. A host's trace id already taken

A host's trace id is adopted only when no turn, open or in the store, has it. When one has, the wire proxy replaces the host's `traceparent` on that request with Spectra's own, and the terminal says once per run that the host reuses trace ids.

### 4. A trace id that names no turn

A call carrying trace context whose trace id is no turn's is placed by the time window, as a call without trace context is.

### 5. A turn waits for its calls

A turn is checked and written once the calls placed in it have ended. Its end time stays the agent's last reply. A call carrying its trace id that starts during the wait is placed in it; one that arrives after the write is not recorded, and the terminal logs it as its turn already written. When Spectra stops, a call it cuts off ends at the stop, with an error status and `error.type` `aborted`.

### 6. The `model_proxy` capture path

Under `run`, every turn lists `model_proxy` in `a2ui.turn.capture_paths`. Under `attach`, only a turn with a call through the model proxy placed in it does.

### 7. The model proxy's address

The model proxy has its own listener on loopback, on `--model-proxy-port`, default 9822, under the rules `--port` and `--proxy-port` follow: command line only, and a port that is taken is an error at start. Each variable has its own path prefix, named after the variable, with no trailing slash, such as `http://127.0.0.1:9822/GOOGLE_GEMINI_BASE_URL`. A call under a prefix is forwarded to that prefix's target, followed by the rest of its path.

### 8. The variables `run` sets, and where each forwards

`run` sets five variables. Each forwards to what its client would have resolved from the original values in Spectra's own environment:

| Variable | Forwards to the original value of |
| --- | --- |
| `GOOGLE_GEMINI_BASE_URL` | itself, else `https://generativelanguage.googleapis.com` |
| `OPENAI_BASE_URL` | itself, else `OPENAI_API_BASE`, else `https://api.openai.com/v1` |
| `ANTHROPIC_BASE_URL` | itself, else `https://api.anthropic.com` |
| `ANTHROPIC_API_BASE`, LiteLLM's | itself, else `ANTHROPIC_BASE_URL`, else `https://api.anthropic.com`; an original ending in `/v1/messages` has that ending dropped |
| `GEMINI_API_BASE`, LiteLLM's | itself, else decision 9 |

`OPENAI_API_BASE` is not set. No Vertex AI variable is set, such as `GOOGLE_VERTEX_BASE_URL` or `ANTHROPIC_VERTEX_BASE_URL`. An original value that points at the model proxy itself counts as unset.

### 9. LiteLLM's Gemini calls without `GEMINI_API_BASE`

When `GEMINI_API_BASE` has no original value, the proxy forwards to `https://generativelanguage.googleapis.com/v1alpha` for a model whose name contains `gemini-3`, and to `…/v1beta` otherwise: LiteLLM 1.81.10's rule, its source pinned in the code.

### 10. What `attach` prints

At start, after the addresses Spectra prints: a line saying to set these in the agent's shell and restart it; one POSIX `export` line per variable, each ending in a comment naming where it forwards, with credentials removed from it; and a line saying that if the agent's shell already sets one of them to another address, Spectra is to be started with that value set as well.

### 11. The API and the first screen

Under `attach`, `GET /api/context` gains the variables and values `attach` prints, as a list of names and values; under `run` the list is absent. This sub-task builds the first screen's block that shows them, from the canvas board: "To see model and tool calls, set these in the agent's shell", with one copy button for all of them. The list holds the model proxy's variables; the tool proxy and the receiver add theirs.

### 12. What is read in full

The providers' own hosts are `generativelanguage.googleapis.com`, `api.openai.com` and `api.anthropic.com`. Five requests on them are read in full:

| API | Request |
| --- | --- |
| Gemini | `POST /{version}/models/{model}:generateContent`, and `:streamGenerateContent?alt=sse` |
| OpenAI Chat Completions | `POST /v1/chat/completions` |
| OpenAI Responses | `POST /v1/responses` |
| Anthropic Messages | `POST /v1/messages` |

Every other request, on these hosts or any other, is recorded raw as a `model_call` event and placed like any call, a Gemini stream without `alt=sse` included. Anthropic's `/v1/oauth/token` and WebSocket upgrades are passed on unrecorded, with one terminal line each.

### 13. The stand-in read as the provider's own host

A test-only environment variable names the stand-in provider's origin. A call forwarded there is read as the own host of the API its path names. It is documented in `conformance/README.md` only, not in the tool's usage or `--help`.

### 14. The GenAI mapping

| Point | Mapping |
| --- | --- |
| `gen_ai.operation.name` | `generate_content` for Gemini; `chat` for Chat Completions, Responses and Messages |
| `openai.api.type` | `chat_completions` or `responses`, on every OpenAI call |
| `gen_ai.provider.name` | `gcp.gemini`, `openai`, `anthropic` |
| `gen_ai.usage.input_tokens` | Includes cached tokens: Anthropic's `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens` summed; OpenAI's as reported |
| Gemini's tokens | As the pinned conventions' reference scenario has them: input `promptTokenCount` plus `toolUsePromptTokenCount`, cache read `cachedContentTokenCount`, output `candidatesTokenCount` plus `thoughtsTokenCount`, and `thoughtsTokenCount` also as `gen_ai.usage.reasoning.output_tokens` |
| Cache reads and writes | As each provider reports them: OpenAI and Gemini reads, Anthropic reads and writes |
| A count the provider does not report | Left out, never written as 0 |
| Finish reasons | Normalised to the copied output-messages schema's values, `stop`, `length`, `content_filter`, `tool_call`, `compaction` and `error`, in `gen_ai.output.messages` and in `gen_ai.response.finish_reasons` |
| Span name | `{gen_ai.operation.name} {gen_ai.request.model}`; a call recorded raw is named by its HTTP method |

### 15. Credentials

Removed: the request headers `authorization`, `proxy-authorization`, `x-api-key`, `x-goog-api-key`, `api-key` and `cookie`; the response header `set-cookie`; the URL parameters `key`, `api_key` and `access_token`; a URL's `user:pass@`; and any request header or URL parameter whose name contains `key`, `token`, `secret`, `auth`, `password` or `cookie`. The pattern does not apply to response headers. A removed value becomes `REMOVED`, the name kept, in headers and URLs alike. Credentials are removed at capture, before the live stream, the API or the store sees the event.

### 16. Failed calls

Each case is recorded with the span status `code` `2`:

| Case | What the agent gets | `error.type` | Also recorded |
| --- | --- | --- | --- |
| The provider answers 400 or above | The reply, unchanged | The status, such as `"429"` | On the four APIs read in full, the provider's error message from the body as the status message |
| A 2xx stream carrying an error: Anthropic's `event: error`, OpenAI Responses' `response.failed`, an error object in a Gemini stream | The stream, unchanged | The error's own type, such as `overloaded_error` | The chunks so far, and the error's message |
| The provider cannot be reached | A `502` from the proxy, with a plain-text line naming the host and the error, as the wire proxy answers when it cannot reach the agent | The error's code, such as `ECONNREFUSED` | No response attributes |
| The provider's stream breaks partway | The break, passed on | The error's code | The chunks so far |
| The agent closes the connection before the response ends, and the reply, read on, does not end within five seconds | — | `aborted` | The chunks before the close, the end time at the close. A reply that ends within the five seconds is complete, read in full: an agent may leave once it has the content, before the stream's last event, as the ADK samples do through LiteLLM |

### 17. A body neither JSON nor text

A request or response body whose `content-type` is not JSON, `application/json` or `*+json`, not `text/*` and not form-encoded is left out of the exchange. Its `content-type` and `content-length` headers stay.

### 18. Calls on the live stream

The live stream gains three events: `call_started`, `{traceId, event}`, the call's event so far, its start time, its request and the GenAI request names read from it; `call_chunk`, `{traceId, spanId, chunk}`, each response chunk as it arrives, in the record's `a2ui.http.response.chunk` shape; and `call_ended`, `{traceId, event}`, the complete event as the record holds it. A new subscriber catches up on each open turn's calls with their chunks so far, as it does on wire events.

### 19. The stand-in provider and the model capture suite

The stand-in provider is a standalone server in `conformance/` replaying recorded HAR traffic for the four APIs at one origin. It answers each request with the next recorded response, sends a stream in pieces, and answers a request it did not expect with an error naming what it expected. A model capture suite mirrors the A2A capture suite: each case is a HAR and its expected record, the recorded requests are sent through the model proxy to the stand-in, and the `model_call` events are compared with the expected record. The Gemini and Anthropic HARs are recorded by a recording tool under `_dev/tools/`, which removes credentials before it writes.

### 20. What the recordings cover

| Case | Source |
| --- | --- |
| Each client's request shape and auth: google-genai through the Python restaurant finder; LiteLLM's `gemini/` and `anthropic/` through the custom-components example | Real recordings of those agents, one short conversation each |
| Streamed and not streamed, Gemini and Anthropic | Real, from the agents where they stream, otherwise scripted calls |
| A tool call and the request carrying its result | Real: the restaurant finder's `get_restaurants`, and the custom-components example on Anthropic |
| Anthropic's cache write, then read | Scripted: two calls with `cache_control` on the same long system prompt |
| Gemini's cache read | Scripted: repeated calls on a long prefix, kept only if a hit is reported |
| An error status | Scripted, real: an unknown model's 404 on each provider; the Gemini 429 built from Gemini's documented error shape |
| An error inside a 2xx stream | Built: Anthropic's `overloaded_error` and OpenAI's `response.failed`, from their documentation |
| OpenAI, both APIs: not streamed, streamed, a tool call, `cached_tokens`, an error | Built from OpenAI's API reference |
| Another request on a provider's host, recorded raw | Scripted, real: Gemini's `countTokens` |
| A call recorded raw on another host | The stand-in at an origin the test-only variable does not name |

### 21. OpenAI's traffic for the acceptance run

The stand-in's OpenAI traffic for the custom-components example, on Chat Completions and on Responses, takes its requests, responses and stream events in the shapes of OpenAI's API reference, carrying the example's own replies from its Gemini recording of the same conversation.

### 22. The keys

The Gemini and the Anthropic keys come from `../a2uiverse-apps/linear/agent/.env`: each passed only to the process that needs it, never printed, and never written into a record, a fixture, a HAR or a commit.

### 23. Done line

Done when, with the real binary, under `run`, the Python restaurant finder on Gemini and the custom-components example on Gemini and on Anthropic each write a turn whose model calls are read in full in the record `GET /api/turns/<trace id>` serves, with the keys shown as `REMOVED`; and under `attach`, the first screen through the tunnel shows the variables block, and the restaurant finder restarted with those variables set gives the same.

### 24. Other documents

- The Phase 5 spec, amended in place:
  - Trace context on A2A requests: the wire proxy alone adds the `traceparent`, to turn requests only, in decision 2's shape, with decision 3's rule for a host's trace id already taken.
  - Redirection: the five variables of decision 8, each forwarding to what its client would have resolved; Vertex AI not redirected.
  - Placing a call or a span in its turn: a trace id that names no turn falls to the time window.
  - The stand-in provider: the acceptance run's OpenAI traffic carries the custom-components example's own replies.
  - Other documents: Capture's Redirection in SPEC.md gains LiteLLM's Anthropic variable, `ANTHROPIC_API_BASE`, in place of its OpenAI and Anthropic variables; the v1 coverage table gains that redirection does not reach Vertex AI in v1.
- The turn record prose, amended in place: the provider rule reads the four APIs of decision 12 in full; a removed credential's value is `REMOVED`, its name kept; a body neither JSON nor text is left out of the exchange, its `content-type` and `content-length` kept.
- SPEC.md, this sub-task's share of the Phase 5 spec's amendments: the v1 coverage table, with Vertex AI, Azure OpenAI and Amazon Bedrock after v1 and redirection not reaching Vertex AI in v1; Capture's Redirection, with LiteLLM's `ANTHROPIC_API_BASE` beside its `GEMINI_API_BASE`, forwarding to the original value, what `attach` prints, the trace context on A2A requests, and placing by trace context and then the time window.
- The tool's README: `run`'s variables, what `attach` prints, `--model-proxy-port`, the model proxy, the live stream's call events, the list in `GET /api/context`, and the terminal's new lines.
- `conformance/README.md`: the stand-in provider, its test-only variable, and the model capture suite.
- `CLAUDE.local.md`: the Gemini key, beside the Anthropic one.
- `_dev/TODO.md`: the 5.2 line names this spec and gains the first screen's block and the done line.
- `_dev/otel-findings.md`: the pinned GenAI conventions have no normative Gemini document; their registry describes `generate_content` as Gemini's operation, while their reference scenarios use `chat` for Gemini.

## Invariants

- The proxies forward requests and responses unchanged, and pass a streamed response on chunk by chunk as it arrives. The trace context on A2A turn requests is the one change Spectra makes to traffic.
- No credential is ever in a record, a HAR or the live stream.
