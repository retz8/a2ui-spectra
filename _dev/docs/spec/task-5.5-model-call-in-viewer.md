# Sub-task 5.5 — The model call in the viewer

The model call in the viewer: the exact request and the response, the tokens, cache use and hit ratio, the estimated cost from LiteLLM's pinned price table, overridable in the config, and the prefix break; the Gemini reader taking both spellings of a request's fields. Sub-task 5.5 of the Phase 5 spec, `_dev/docs/spec/phase-5-inside-the-turn.md`, carrying out its decisions 13 to 16, prompt cache use, estimated cost, the prefix break and derived values computed when shown, and building the model call boards of the 5.1 design spec, `_dev/docs/spec/task-5.1-design-artifact.md`.

## Scope

- Model call rows on the step timeline, the turn header's second line, the step's detail's Maximize, and the model call's detail: the title line, the usage, the prefix break's sentence, the readable request and response, and the exchange; a call recorded raw; an in-flight call's detail filling as chunks arrive.
- The price table copied at its pin, the script that moves the pin, `GET /api/prices`, and the config file's `prices`.
- The hit ratio, the estimated cost and the prefix break, computed in the viewer.
- `call_progress` on the live stream.
- Failed model calls as problems, in the viewer and in the server's listing.
- The Gemini reader taking both spellings of every request field, and the model capture suite's Gemini expected records written again.

Out of scope: the time lane and the duration beside it, the in-flight bar, tool call rows, the "From the agent's spans" section, a call read from spans only, and the tool call count in the header's second line, sub-task 5.6; the acceptance run, sub-task 5.7.

## Locked decisions

### 1. The line with sub-task 5.6

A model call is a row among the steps in the 5.1 spec's row form: the model id as requested as its label, the provider as its muted target, the problem mark when it failed, with no time lane and no duration beside it. This sub-task also takes Maximize, the header's second line without its tool call count, and the in-flight call's detail. The lane, the durations, the in-flight bar, tool rows, the spans section and a call read from spans only are sub-task 5.6's.

### 2. Derived values are computed in the viewer

The viewer computes the hit ratio, the estimated cost and the prefix break from the records it loads, as it computes problems and the check state. One new route, `GET /api/prices`, serves the copied table's entries, the table's release and date, and the config's overrides, fetched once. For the prefix break, the viewer fetches the conversation's earlier turns through `GET /api/turns/<trace id>` and keeps them, as it keeps every record it has read. The server records; it computes none of the three.

### 3. The price table

The table is LiteLLM's `model_prices_and_context_window.json` at release v1.106.6, published 2026-10-28, trimmed to the entries whose `litellm_provider` is `gemini`, `anthropic` or `openai`, each entry whole as the release has it. A script under `_dev/tools/` reads the release's file and writes the copy; moving the pin is running it again. A NOTICE beside the copy carries LiteLLM's MIT licence text, the release tag and its date. The usage's note reads "LiteLLM prices · 2026-10-28".

### 4. Matching a call to a price

The config's override is tried first, keyed by the model id as requested. Then the table: among the entries whose `litellm_provider` is the call's provider, the one whose key, as written or less the `gemini/` prefix, equals `gen_ai.request.model`, so that a LiteLLM span's `gemini/gemini-3.6-flash` meets its own key; failing that, `gen_ai.response.model`; failing both, the call has no price and the usage reads "No price for `<model>`". Nothing is stripped from or added to a model id.

### 5. The cost formula

Uncached input, the input tokens less the cache read and cache write tokens, at the input price; cache read and cache write tokens at theirs; the output at the output price, the reasoning tokens at the reasoning price when the entry has one and the rest of the output at the output price. When the input tokens exceed an entry's threshold, such as the one at 200k, every token of a kind the entry prices above that threshold is priced at the above-threshold rate, as LiteLLM's own calculation does. Service tiers and Anthropic's one-hour cache write rate are not applied: the record carries neither the tier nor the write's lifetime.

### 6. The config's price override

The config file gains `prices`, an object keyed by model id as requested. Each entry gives USD per million tokens: `input` and `output` required, `cacheRead` and `cacheWrite` optional, a missing cache price pricing those tokens at the input price. An entry carries no tiers and no reasoning price. It replaces the table's entry whole, never merging with it, and a model the table lacks can be priced this way. The usage's note reads "Price from the config".

### 7. The figures and the hit ratio

Every API has Input, Output, Reasoning and Cache read; Cache write is Anthropic's alone. A figure the API has that the record lacks shows as 0. The usage group appears only when the record has `gen_ai.usage.input_tokens`, so a failed call with no usage shows none. A call's hit ratio is its cache read tokens over its input tokens as recorded, cached tokens included; the turn's is the sum of cache reads over the sum of inputs across its model calls that have input tokens; with no input tokens there is no ratio. The header's "N% from cache" appears only when the turn read something from the cache; the detail reads "Cache read 0 · Hit ratio 0%".

### 8. The prefix break's comparison

Each call read in full becomes a sequence of segments from its GenAI names, in cache order: one per tool definition, one for the system prompt, then one per input message. A segment's text is what the readable request shows for it: a prompt or text part as text, a tool definition, tool call or tool result as its JSON block. The prefix is matched segment by segment, and inside the first differing segment character by character; that segment is the part the sentence names, "in the tool definitions", "in the system prompt" or "in message 4", and the marker sits at that character with the two differing lines under it.

The candidates are the model calls read in full with the same `gen_ai.request.model` in the same conversation that started before this one, this turn's earlier calls and the conversation's earlier turns included; the longest shared prefix wins, the latest call on a tie. A call recorded raw is neither compared nor a candidate.

The sentence takes the three forms of the 5.1 spec's decision 13 and a fourth: when every segment of this call is in the earlier one, "Shares all of its request with the call at 14:02:31". The request is known from `call_started`, so the sentence shows on a call in flight.

### 9. The readable response in flight

The live stream gains `call_progress`, `{traceId, spanId, attributes}`: the reader's response names from the chunks so far, the output messages, finish reasons and usage as far as the stream has given them. It is sent at most ten times a second while chunks arrive, and once more at the last chunk before `call_ended`. The viewer draws what it is sent.

### 10. The Gemini reader's spellings

The reader takes both the camel-case and the snake-case spelling of every request field it reads, as the Gemini API does: the system instruction, the generation settings and each of their keys, the tools and their function declarations, `parameters` and `parameters_json_schema`, the function call and function response parts, and the thought signature. The response side stays camel case. Both Gemini cases of the model capture suite have their expected records written again, the LiteLLM one gaining its system prompt, its tool definition and its tool call and result parts.

### 11. Failed model calls as problems

Every model call with span status 2 is a problem: on its row with the red mark, in the one count, and opening its detail with a problem block in Phase 3's form. The first line by the error's kind: "The model API answered 429 Too Many Requests." for a status; "The stream carried an error: overloaded_error." for an error inside a stream; "The provider could not be reached: ECONNREFUSED." for a connection error; "The connection closed before the response ended." for `aborted`. The second line as the canvas draws it, the code, the provider's own status when the body gave one, and the API: "HTTP 429 · RESOURCE_EXHAUSTED · Gemini API". The status message the proxy recorded is the quiet third line. The server's listing fields gain the count of failed model calls, so the turn list's count agrees with the header's. A prefix break is never a problem.

### 12. The header's second line

Shown when the turn has a model call, growing on a live turn as calls end. "First token" runs from the turn's start to the first chunk of the first model call when it streamed, and to that call's end when it did not. "First component" runs from the turn's start to the first A2UI step. "N model calls" counts every model call, raw ones included. The token totals sum the calls with usage, "9.1k" above a thousand and "640" below; the detail keeps "24,562". "Est." sums the priced calls, rounded to two significant figures and at most four decimals, as the canvas has "$0.024", "$0.20" and "$0.0009"; its note names the table's date, or reads "Prices from the config" when every priced call used an override. "· 1 call unpriced" and "· 2 calls recorded raw" follow as the 5.1 spec has them. With no priced call there is no "Est." and no note. "N% from cache" appears only above zero.

### 13. What is built as the 5.1 spec draws it

The row's label and muted target, the detail's section order, the request's sections, the usage's labels and notes, the three sentence forms and the marker, the exchange's form and folding, the raw call's sentence, the in-flight detail, Maximize with `m` in the list of keys, and selecting a call showing the surfaces as they stood at its end are built as the 5.1 spec's decisions 6, 8 to 15 and 20 have them. A model call step is addressed in the page address by its span id.

### 14. Done line

Done when, through the tunnel with the real binary, on the custom-components example on Gemini through LiteLLM: under `run`, two turns in one conversation from the message box; the header's second line shows its tokens, cache share, cost and the table's date; selecting the second turn's first model call shows its hit ratio and "Shares all of the earlier call's request", and the link selects the first turn's last call. Then under `attach`, with a line of the example's prompt changed and the agent restarted, the same conversation continued: the new turn's call reads "Prefix breaks in the system prompt · against the call at …", the marker sits at the changed line with the two differing lines under it, and the cache share has fallen. Beside it, the model capture suite green on the rewritten Gemini records, and the viewer's tests covering the sentence's four forms on hand-written records.

### 15. Other documents

- The Phase 5 spec, amended in place: decision 14 gains the pin, the trimmed copy with its script, the matching rule, the formula's reach and the override's unit; decision 15 the segment comparison and the fourth sentence form; decision 16 that the viewer computes the three values, with `GET /api/prices`.
- The 5.1 design spec: decision 13 gains the fourth sentence form, and the canvas's components page gains that sentence beside the three.
- SPEC.md, this sub-task's share of the Phase 5 spec's decision 20: the v1 features' token usage line gains cache reads and writes, the hit ratio and the estimated cost with its table's date; the prefix break is added as a line; the after-v1 tokens split by where they went drops cache hits.
- The tool's README: the config file's `prices`, `GET /api/prices`, `call_progress` on the live stream, the failed-call count in the listing, the price table's pin and NOTICE with the script that moves it, and the Gemini reader's two spellings.
- `conformance/README.md`: a line on the Gemini reader's spellings beside the model capture suite, where it says what the reader takes.
- The config schema gains `prices`; the script joins `_dev/tools/`.
- `_dev/TODO.md`: the 5.5 line names this spec and gains LiteLLM's snake-case Gemini requests and the done line.
- The turn record prose and schema are unchanged. The findings files gain nothing unless the run finds something.

## Invariants

- The record states what happened. The hit ratio, the estimated cost and the prefix break are computed in the viewer when shown and are never stored.
- A prefix break is drawn in grey and a neutral tint, and is never a problem.
