# OpenTelemetry upstream findings

Issues found in OpenTelemetry's GenAI semantic conventions and their reference
implementations, recorded for upstream contribution
(`open-telemetry/semantic-conventions-genai`). Each finding is self-contained and
reproducible against upstream artifacts only.

---

All findings below were checked against `open-telemetry/semantic-conventions-genai` at
`8538971bd11dba723fdd33c804b5a32121827ff7` (2026-10-21, schema version `1.42.0-dev`,
core dependency `v1.44.0`). Paths are relative to that repo unless noted.

---

## 1. The generic part makes every typed part's required fields unenforceable (content schemas)

**Component:** `model/gen-ai/gen-ai-input-messages.json` and
`gen-ai-output-messages.json` (`$defs/ChatMessage` / `OutputMessage`, `parts`),
generated from `docs/gen-ai/non-normative/models.py`.

**Severity:** schema bug: malformed parts of the defined types validate.

### Issue

`parts.items` is an `anyOf` over the eleven part types, ending with `GenericPart`.
`GenericPart` requires only `type`, typed as any string, with
`additionalProperties: true`. Any object with a string `type` therefore matches
`GenericPart`, including a `text` part with no `content` or a `blob` part with no
`modality` or `content`. The required fields of `TextPart`, `BlobPart`,
`ToolCallRequestPart` and the rest are never enforced.

The repo's own snapshot test shows it:
`docs/gen-ai/non-normative/tests/cases/input-messages-parts-missing-required.yaml`
is described as "A text part without `content`, and a blob part without `modality`
or `content`", and its snapshotted result is `errors: []`.

### Reproduction

Validate this document against `gen-ai-input-messages.json` with a draft 2020-12
validator, as `docs/gen-ai/non-normative/tests/test_schemas.py` does:

```json
[{"role": "user", "parts": [{"type": "text"}, {"type": "blob", "mime_type": "image/png"}]}]
```

No error is reported.

### Fix

Exclude the defined type names from `GenericPart.type`, for example with
`"not": {"enum": ["text", "tool_call", "tool_call_response", "server_tool_call",
"server_tool_call_response", "blob", "file", "uri", "reasoning", "compaction"]}`,
generated from the same list as the typed parts. The snapshot for the
missing-required case then reports the two errors its description names.

## 2. `gen_ai.tool.call.result` has no valid form for a plain-text tool result

**Component:** `model/gen-ai/gen-ai-tool-call-result.json`;
`model/gen-ai/registry.yaml` (`gen_ai.tool.call.result`, `gen_ai.input.messages`
examples).

**Severity:** schema gap: a common tool result cannot be recorded validly.

### Issue

`gen-ai-tool-call-result.json` is `"type": "object"`. The registry note says the
value "is expected to be an object" and that a serialized string should be
deserialized "to an object" as a best effort. Many tools return plain text, which
does not deserialize to an object. The registry's own `gen_ai.input.messages`
example records the result of the `get_weather` call as the string
`"rainy, 57°F"` in a `tool_call_response` part, whose `response` is untyped. The
same result has no valid value under `gen_ai.tool.call.result`.

### Reproduction

Validate the JSON string `"rainy, 57°F"` against `gen-ai-tool-call-result.json`:
it fails on `type`. Compare the `gen_ai.input.messages` example in
`docs/registry/attributes/gen-ai.md`, which uses that string as the tool response.

### Fix

Allow any JSON value, as `ToolCallResponsePart.response` already does, or define
how a non-object result is wrapped. The same applies to
`gen-ai-tool-call-arguments.json`.

## 3. A remote agent invocation requires a provider that agent protocols do not have

**Component:** `model/gen-ai/spans.yaml` (`gen_ai.invoke_agent.client`);
`model/gen-ai/registry.yaml` (`gen_ai.provider.name`).

**Severity:** design gap: required attribute with no applicable value.

### Issue

`gen_ai.invoke_agent.client` "describes GenAI agent invocation over a remote
service" and requires `gen_ai.provider.name`. The registry note says that
attribute "identifies the GenAI telemetry format flavor specific to that
provider", and every listed value is a model or platform provider (`openai`,
`gcp.gemini`, `aws.bedrock`, …). The span's examples, OpenAI Assistants API and
AWS Bedrock Agents, are provider-hosted.

An agent reached over an agent protocol, such as a self-hosted A2A or AG-UI
agent, has no provider in that sense: the caller does not know, and should not
need to know, which model provider the agent uses. A client instrumenting that
call cannot satisfy the requirement without inventing a value.

### Reproduction

Read `gen_ai.invoke_agent.client` in `model/gen-ai/spans.yaml` (around line 505)
and the `gen_ai.provider.name` note in `model/gen-ai/registry.yaml` (around line
84). No value or rule covers an agent invoked over an agent protocol.

### Fix

Make `gen_ai.provider.name` conditionally required on `gen_ai.invoke_agent.client`
("when the agent is hosted by a known provider"), or add a way to name the agent
protocol in use, for example a well-known value per protocol.

## 4. The content schemas declare no draft and no id

**Component:** the eight `model/gen-ai/gen-ai-*.json` schemas.

**Severity:** interoperability gap.

### Issue

None of the eight schemas has `$schema` or `$id`. Which JSON Schema draft they
follow is stated only in the repo's test code, which validates them with
`Draft202012Validator` (`docs/gen-ai/non-normative/tests/test_schemas.py`).
Consumers that reference these schemas from their own cannot resolve them by id,
and a validator that defaults to another draft may read them differently.

### Reproduction

Open any `model/gen-ai/gen-ai-*.json`: the top-level keys are `$defs`,
`description`, `title`, `type` and `items` or `properties`, with no `$schema` or
`$id`.

### Fix

Emit `"$schema": "https://json-schema.org/draft/2020-12/schema"` and a stable
`$id` per file from `models.py` when generating them.

## 5. The finish-reason values have no home after the deprecation

**Component:** `model/gen-ai/gen-ai-output-messages.json` (`$defs/FinishReason`,
`OutputMessage.finish_reason`); `model/gen-ai/registry.yaml`
(`gen_ai.response.finish_reasons`); `changelog.d/363.deprecation.md`.

**Severity:** documentation and schema gap.

### Issue

`changelog.d/363.deprecation.md` deprecates `gen_ai.output.messages[].finish_reason`
in favour of `gen_ai.response.finish_reasons`. The well-known values (`stop`,
`length`, `content_filter`, `tool_call`, `compaction`, `error`) survive only in
`$defs/FinishReason`, referenced by the deprecated field.
`gen_ai.response.finish_reasons` is a free `string[]` whose note defines only
`error`, with examples `stop` and `length`. Three test cases still use the
deprecated field: `output-messages-assistant-text.yaml`,
`output-messages-reasoning-and-generic-parts.yaml` and
`output-messages-wrong-field-types.yaml` under
`docs/gen-ai/non-normative/tests/cases/`.

### Fix

Move the well-known values to `gen_ai.response.finish_reasons` as an open enum,
and update the test cases to the non-deprecated attribute.

## 6. `tool_call_response` claims built-in tool outcomes that the examples assign to another part

**Component:** `docs/gen-ai/non-normative/models.py` (`ToolCallResponsePart`,
around line 77) and the generated descriptions in `gen-ai-input-messages.json` and
`gen-ai-output-messages.json`; `docs/gen-ai/non-normative/examples-llm-calls.md`
("Tool calls (built-in)").

**Severity:** contradictory guidance.

### Issue

`ToolCallResponsePart` is documented as "a tool call result sent to the model or a
built-in tool call outcome and details". The built-in tools example says
"Built-in tools use `server_tool_call` and `server_tool_call_response` part types
… to separate them from client-side function tool calls". An instrumentation
author cannot tell which part a built-in tool's outcome belongs in.

### Fix

Drop "or a built-in tool call outcome and details" from `ToolCallResponsePart`.

## 7. The MCP transport table leaves out protocol version `2025-03-26`

**Component:** `docs/gen-ai/mcp.md` ("Recording MCP transport").

**Severity:** documentation bug: consumers misclassify a transport.

### Issue

The table tells consumers to tell Streamable HTTP from HTTP with SSE by
`mcp.protocol.version`: Streamable HTTP is "`2025-06-18` or newer" and HTTP with
SSE is "`2024-11-05` or older". MCP `2025-03-26` falls in neither range, yet it is
the version that introduced Streamable HTTP. MCP's own changelog for that version
says it "Replaced the previous HTTP+SSE transport with a more flexible Streamable
HTTP transport" (`docs/specification/2025-03-26/changelog.mdx` in
`modelcontextprotocol/modelcontextprotocol` at `80041ab0`).

### Fix

Change the Streamable HTTP row to "`2025-03-26` or newer".

## 8. The MCP context-propagation examples are not valid JSON

**Component:** `docs/gen-ai/mcp.md`, the two `params._meta` examples (around lines
79 and 98).

**Severity:** documentation bug.

### Issue

Both examples end with `"id": 1,` followed by `}`. JSON does not allow a trailing
comma, so the examples fail to parse when copied.

### Fix

Remove the trailing comma after `"id": 1` in both examples.

## 9. The modality description names a `mimeType` field that does not exist

**Component:** `docs/gen-ai/non-normative/models.py` (lines 205, 222 and 241) and
the generated `modality` descriptions in `gen-ai-input-messages.json` and
`gen-ai-output-messages.json`.

**Severity:** documentation bug.

### Issue

The `modality` description on blob, file and URI parts says "Instrumentations
SHOULD also set the mimeType field if the specific type is known". The field is
`mime_type`.

### Fix

Change `mimeType` to `mime_type` in the three descriptions and regenerate.

## 10. The blob part alone drops unknown fields

**Component:** `docs/gen-ai/non-normative/models.py` (`BlobPart`, line 195).

**Severity:** inconsistency.

### Issue

Every part model sets `model_config = ConfigDict(extra="allow")` except
`BlobPart`. With pydantic's default, a blob part parsed through the models drops
unknown fields, where every other part keeps them. The generated JSON schema
shows the difference only as a missing `additionalProperties: true` on
`BlobPart`.

### Fix

Add `model_config = ConfigDict(extra="allow")` to `BlobPart`.

## 11. The conformance scenarios waive `process.exit.code`, which core defines

**Component:** `reference/scenarios/google-adk/conformance.yaml`,
`reference/scenarios/langchain/conformance.yaml` and
`reference/scenarios/openai-agents/conformance.yaml`.

**Severity:** reference-implementation gap: a waiver hides a resolvable failure.

### Issue

The command-tool refinement in `model/gen-ai/spans.yaml` (around line 1017)
references `process.exit.code`. Three scenarios waive a `missing_attribute` error
for it, with the reason "Registry validation does not recognize this process
attribute referenced by the command-tool refinement". Core `v1.44.0`, the version
`model/manifest.yaml` pins, defines `process.exit.code` at `release_candidate` in
`model/process/registry.yaml`. Why the runner's registry lacks it was not
determined.

### Fix

Make the conformance runner resolve `process.exit.code` from the pinned core
registry, then remove the three waivers.

## 12. A workaround comment for `metric_attributes.openai` is stale

**Component:** `model/gen-ai/metrics.yaml` (line 258); `model/gen-ai/token-metrics.yaml`.

**Severity:** maintenance.

### Issue

The `openai.client.operation.duration` refinement lists its two attributes by hand
under the comment "`ref_group: metric_attributes.openai` - does not work,
https://github.com/open-telemetry/weaver/issues/1411". The seven OpenAI
refinements in `token-metrics.yaml` use that same `ref_group`, and the generated
`docs/gen-ai/openai.md` shows their `openai.response.service_tier` rows.

### Fix

Use the `ref_group` in `metrics.yaml` too and drop the comment.

## 13. One OpenAI metric refinement breaks the naming pattern

**Component:** `model/gen-ai/metrics.yaml` (`metric_refinements`).

**Severity:** naming inconsistency.

### Issue

The refinement of `gen_ai.client.operation.duration` has the id
`openai.client.operation.duration`. Every other OpenAI refinement prefixes the
refined metric's full name, as in `openai.gen_ai.client.inference.duration` and
`openai.gen_ai.client.inference.usage.input_tokens`.

### Fix

Rename it `openai.gen_ai.client.operation.duration`.

## 14. Prose names span types that do not exist

**Component:** `changelog.d/469.breaking.md`; `model/gen-ai/metrics.yaml`
(`gen_ai.execute_tool.duration` note).

**Severity:** documentation bug.

### Issue

`changelog.d/469.breaking.md` tells consumers to aggregate cache usage "from
`gen_ai.inference.client` spans"; the span type is `gen_ai.client.inference`. The
`gen_ai.execute_tool.duration` note refers to "a `gen_ai.execute_tool` span"; the
span type is `gen_ai.execute_tool.internal`.

### Fix

Use the span type ids as defined in `model/gen-ai/spans.yaml`.

## 15. The MCP model links to two MCP spec versions

**Component:** `model/mcp/registry.yaml` (line 136), `model/mcp/spans.yaml` (lines
74 and 134), `model/mcp/common.yaml` (line 85).

**Severity:** documentation consistency.

### Issue

`mcp.session.id` links to the `2025-06-18` transports page, while the prompt and
resource error-handling links point to `2025-11-25`. A reader cannot tell which
MCP version the conventions are written against.

### Fix

Link every MCP reference to one spec version, the newest the conventions support.

## 16. Open TODOs where consumers need guidance

**Component:** `docs/gen-ai/gen-ai-spans.md` (lines 1012 and 1018); `README.md`
(line 15).

**Severity:** documentation gap.

### Issue

Three sections are placeholders:

- "Streaming chunks" in `gen-ai-spans.md` contains only "TODO", although
  `gen_ai.response.time_to_first_chunk` and the chunk metrics depend on how chunks
  are counted.
- "TODO: document a common approach to record references to externally stored
  content" follows the content-uploading guidance in the same file.
- "Schema URL" in `README.md` contains only "TODO".

### Fix

Document each, starting with streaming chunks.

## 17. The blob part's content uses a format JSON Schema does not define

**Component:** `model/gen-ai/gen-ai-input-messages.json` and
`gen-ai-output-messages.json` (`$defs/BlobPart.content`), generated from
`docs/gen-ai/non-normative/models.py` (`BlobPart.content: bytes`, line 207).

**Severity:** schema bug: the encoding the description requires is never checked.

### Issue

`BlobPart.content` is `{"type": "string", "format": "binary"}`, with the
description "This field SHOULD be encoded as a base64 string when serialized to
JSON". `binary` is pydantic's output for `bytes` and an OpenAPI format; JSON
Schema 2020-12 defines no `binary` format. Validators ignore it, so a blob whose
content is not base64 passes. JSON Schema's own keyword for this is
`contentEncoding`.

### Reproduction

Compile `gen-ai-input-messages.json` with Ajv 8.17.1 in draft 2020-12 mode: it
reports `unknown format "binary" ignored in schema at path
"#/properties/content"`.

### Fix

Generate `"contentEncoding": "base64"` for `BlobPart.content` in place of
`"format": "binary"`.

## 18. Gemini has no normative document, and the registry and the reference scenario name its operation differently

**Component:** `model/gen-ai/registry.yaml` (`gen_ai.operation.name`, around line
653); `reference/scenarios/google-genai/scenario.py` and `README.md`.

**Severity:** documentation gap and inconsistency: an instrumentation cannot tell
which operation name a Gemini call takes.

### Issue

The registry defines the operation name `generate_content` as a "Multimodal
content generation operation such as [Gemini Generate Content]", beside `chat`
for "Chat completion operation such as [OpenAI Chat API]". No normative page
under `docs/gen-ai/` covers Gemini, where `docs/gen-ai/openai.md`,
`docs/gen-ai/anthropic.md` and others cover their providers. The repository's own
reference instrumentation of Google's `google-genai` client,
`reference/scenarios/google-genai/scenario.py`, writes
`"gen_ai.operation.name": "chat"` on every `generate_content` and
`generate_content_stream` call (lines 175, 225, 258, 344, 402, 485, 543 and 596),
and its `README.md` lists the client's inference operation as `chat`. The
registry's own example for Gemini is thus not what the reference scenario
produces.

### Reproduction

Compare `model/gen-ai/registry.yaml` at `id: generate_content` with the value of
`gen_ai.operation.name` set in `reference/scenarios/google-genai/scenario.py`
around line 175.

### Fix

Add a Gemini page under `docs/gen-ai/` that fixes the operation name, and make the
reference scenario write it; or drop `generate_content` from the registry if
`chat` is meant to cover Gemini.
