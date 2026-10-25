# A2UI upstream findings

Issues found in A2UI's specifications and their reference implementations while
building Spectra, recorded for upstream contribution (`a2ui-project/a2ui`). Each
finding is self-contained and reproducible against upstream artifacts only.

---

All findings below were checked against `a2ui-project/a2ui` at
`020a9d6f694761ad16b35bc38945e4ccd0ac14e8` (2026-10-23). Paths are relative to
that repo unless noted. "The extension specs" are the three A2A extension
specifications:

- `specification/v0_9/docs/a2ui_extension_specification.md` (v0.9);
- `specification/v0_9_1/docs/a2ui_extension_specification.md` (v0.9.1);
- `specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md` (v1.0).

---

## 1. Every sample sends one A2UI message per part where the specs require an array

**Component:** `python/a2ui_a2a/src/a2ui/a2a/parts.py`;
`python/a2ui_adk/src/a2ui/adk/a2a/part_converter.py`;
`samples/agent/node/restaurant_finder/src/a2a.ts`; the Lit, React and Angular
sample clients.

**Severity:** deviation from the extension specs: every agent and client in the
repo.

### Issue

The extension specs say a data part's `data` "contains a list of A2UI JSON
messages … It MUST be an array of messages" (v0.9 and v0.9.1 line 178, v1.0
line 180). Every implementation in the repo puts one message object in each part
instead:

- `parse_content_to_parts` creates one part per message
  (`python/a2ui_a2a/src/a2ui/a2a/parts.py:126-128`);
- the ADK extension's `A2uiPartConverter` does the same
  (`python/a2ui_adk/src/a2ui/adk/a2a/part_converter.py:115-118`);
- the TypeScript sample maps each message to its own data part
  (`samples/agent/node/restaurant_finder/src/a2a.ts:26-37`);
- the Lit, React and Angular clients send a user action as a single object
  (`samples/client/lit/shell/client.ts:67-87`,
  `samples/client/react/shell/middleware/a2a.ts:100-106`,
  `samples/client/angular/projects/restaurant/src/server.ts:73-79`).

A receiver written to the specs, which reads `data` as an array, rejects all of
this traffic.

### Reproduction

Read the cited lines: each builds a `DataPart` whose `data` is one message
object.

### Fix

Either send arrays, as the specs require, or change the specs to allow one
message or an array, which is what receivers have to accept today.

## 2. The Python A2A extension tags v0.9 parts with the deprecated MIME type

**Component:** `python/a2ui_a2a/src/a2ui/a2a/parts.py` (`create_a2ui_part`).

**Severity:** deviation from the v0.9 extension spec.

### Issue

The v0.9 extension spec identifies an A2UI data part by
`"mimeType": "application/a2ui+json"` (line 176). `create_a2ui_part` writes
`application/json+a2ui`, named `DEPRECATED_A2UI_MIME_TYPE` in the same file, for
v0.8, for v0.9 and when no version is given
(`python/a2ui_a2a/src/a2ui/a2a/parts.py:37-39,56-58`). Every v0.9 part from the
Python samples carries the deprecated type.

### Reproduction

Call `create_a2ui_part({"version": "v0.9", "createSurface": {...}}, version="v0.9")`:
the part's metadata is `{"mimeType": "application/json+a2ui"}`.

### Fix

Write `application/a2ui+json` for v0.9 and later, keeping the deprecated type
for v0.8 only.

## 3. The ADK extension's event converter tags every part as v0.8

**Component:** `python/a2ui_adk/src/a2ui/adk/a2a/event_converter.py`
(`A2uiEventConverter`); `python/a2ui_adk/src/a2ui/adk/a2a/part_converter.py`
(`A2uiPartConverter`).

**Severity:** deviation from the extension specs, whatever version is in use.

### Issue

`A2uiEventConverter` builds its `A2uiPartConverter` without a version
(`event_converter.py:95-99`). The part converter's version defaults to v0.8
(`part_converter.py:65-66,76`) and is passed to `create_a2ui_part` and
`parse_content_to_parts` (`part_converter.py:116,131,147`), so every A2UI part
the event converter produces carries the deprecated MIME type of finding 2,
including parts holding v0.9.1 or v1.0 messages.

### Reproduction

Read `event_converter.py:95-99`: the `A2uiPartConverter(...)` call names
`catalogs`, `bypass_tool_check` and `fallback_text`, and no `version`.

### Fix

Give `A2uiEventConverter` the version negotiated for the request and pass it on
to the part converter.

## 4. The Lit and React sample clients put the MIME type on the part

**Component:** `samples/client/lit/shell/client.ts`;
`samples/client/react/shell/middleware/a2a.ts`.

**Severity:** deviation from the extension specs.

**Upstream:** issue #3601, PR #3602.

### Issue

Every example in the extension specs puts the MIME type in the part's metadata,
`"metadata": {"mimeType": "application/a2ui+json"}` (v0.9 lines 219-222). The
Lit client sets `mimeType` on the part itself, beside `kind` and `data`
(`client.ts:71,85`), and so does the React client's middleware (`a2a.ts:104`).
An A2A 0.3 `DataPart` has no `mimeType` field; both cast the object to `Part` to
add it. The Angular client puts it in the metadata
(`samples/client/angular/projects/restaurant/src/server.ts:77`).

### Reproduction

Read the cited lines.

### Fix

Put the MIME type in `metadata.mimeType`, as the Angular client does.

## 5. The custom-components sample reads capabilities from inside a data part

**Component:** `samples/agent/adk/custom-components-example/agent_executor.py`.

**Severity:** deviation from the extension specs.

**Upstream:** PR #3272.

### Issue

The extension specs carry client capabilities in the message's metadata,
`message.metadata["a2uiClientCapabilities"]` (v0.9 line 7 and the example at
lines 127-136). The custom-components sample looks for them in a data part's
`data`, at `part.root.data["metadata"]["a2uiClientCapabilities"]`
(`agent_executor.py:81-94`), and ignores the message's metadata. A client that
follows the specs cannot send it inline catalogs.

### Reproduction

Read `agent_executor.py:81-94`.

### Fix

Read `a2uiClientCapabilities` from the message's metadata.

## 6. The specs' prose and examples disagree on where the MIME type goes

**Component:** the extension specs' "A2A Extension activation" and "Data
encoding" sections.

**Severity:** specification contradiction.

**Upstream:** PR #3603.

### Issue

The prose places the MIME type inside the data:
`DataPart.data.metadata["mimeType"] = "application/a2ui+json"` (v0.9 and v0.9.1
lines 51, 56 and 176; v1.0 lines 51, 56 and 178). Every example in the same
specs places it in the part's own metadata, a sibling of `data`
(v0.9 and v0.9.1 lines 219-222; v1.0 lines 221-223). No implementation in the
repo uses the prose's location: the A2A helpers and the other samples follow
the examples, and the Lit and React sample clients put it on the part itself
(finding 4).

### Reproduction

Compare v0.9 line 176 with the example DataPart at lines 194-223.

### Fix

Change the prose to `DataPart.metadata["mimeType"]`.

## 7. The specs' prose and examples disagree on where client metadata goes

**Component:** the extension specs' "A2A Client to Server Metadata" sections.

**Severity:** specification contradiction.

### Issue

The overview and activation sections put client capabilities in the message's
metadata, `message.metadata["a2uiClientCapabilities"]` (v0.9 lines 7, 51 and
55), and so do the examples (lines 127-136 and 155-165). The section that
defines them says the client sends `sendMessageRequest.message["a2uiClientCapabilities"]`
and `sendMessageRequest.message["a2uiClientDataModel"]`, on the message itself
(v0.9 and v0.9.1 lines 115 and 143). The v1.0 spec repeats this with
`a2uiRendererCapabilities` and `a2uiRendererDataModel` (lines 115 and 145).

### Reproduction

Compare v0.9 line 115 with the example below it at lines 119-139.

### Fix

Change the defining sentences to `message.metadata[...]`.

## 8. The v0.9 and v0.9.1 examples write a component in no version's shape

**Component:** the v0.9 and v0.9.1 extension specs' "Server-to-client
messages" example.

**Severity:** specification example that fails its own schema.

**Upstream:** PR #3600.

### Issue

The example `updateComponents` message holds
`{"Text": {"id": "root", "text": "Hello!"}}` (v0.9 and v0.9.1 lines 209-214),
which matches neither v0.8 nor v0.9. In v0.8 `id` sits beside a `component`
object keyed by the type name, `{"id": "root", "component": {"Text": {...}}}`
(`specification/v0_8/json/server_to_client.json:45-62`). In v0.9 a component
carries `id` and a `component` property naming its type: `ComponentCommon`
requires `id`
(`specification/v0_9/json/common_types.json:25-35`) and the basic catalog's
`Text` sets `"component": {"const": "Text"}`
(`specification/v0_9/catalogs/basic/catalog.json:20-21`). The v1.0 spec's
example uses the current shape, `"component": "Text"` (line 213).

### Reproduction

Validate each spec's example `updateComponents` message against that version's
`server_to_client.json` (`specification/v0_9/json/` and
`specification/v0_9_1/json/`) with its basic catalog: the component has no `id`
and no `component`.

### Fix

Write the component as `{"id": "root", "component": "Text", "text": "Hello!"}`.

## 9. Nothing in a reply names the A2UI version the agent chose

**Component:** the extension specs.

**Severity:** specification gap.

### Issue

Activation is optional (v0.9 lines 7 and 49-58): a client may offer versions
through capabilities alone. When it activates the extension through the
`X-A2A-Extensions` header, the agent's A2A server echoes the activated URI in
the response header (`a2a-sdk` 0.3.25,
`a2a/server/apps/jsonrpc/jsonrpc_app.py:548-550`), and the Python A2A extension
activates the newest version both sides name
(`python/a2ui_a2a/src/a2ui/a2a/extension.py:162-179`). When the client offers
versions through capabilities only, as the TypeScript sample expects
(`samples/agent/node/restaurant_finder/src/pick-a2ui.ts`), nothing in the reply
names the version chosen. The only signal is the `version` field of each A2UI
message, so a reply with no A2UI message, such as a text answer or an error,
leaves the version unknown.

### Reproduction

Search the three extension specs for a response header, metadata key or field
that carries the chosen version: there is none.

### Fix

Have the agent name the version it uses in every reply, for example by always
echoing the activated extension URI, or with a key in the reply's metadata.

## 10. The extension specs cover A2A 0.3 only

**Component:** the extension specs' activation and data encoding sections.

**Severity:** specification gap.

### Issue

The extension specs name A2A 0.3's extensions header, `X-A2A-Extensions`
(v0.9 lines 64, 71, 89 and 96), and its part shape, with `kind` and the MIME
type in `metadata` (v0.9 lines 219-222). A2A 1.0, released 2026-03-12, renames
the header `A2A-Extensions` and adds `A2A-Version` (A2A specification v1.0.1,
sections 3.2.6 and 14.2.2), drops `kind` from parts, and gives a part its own
`media_type` field (`specification/a2a.proto`, `Part`, at A2A's `v1.0.1`). The
specs do not say which header an A2A 1.0 client activates with, or whether the
A2UI MIME type goes in `mediaType` or `metadata.mimeType`. A2A 1.0 agents
already differ: `filipw/strathweb-a2ui` at `c92222f` sets only
`metadata.mimeType` (`src/Strathweb.A2UI.A2A/A2UIParts.cs:22-26`), and
`muncus/a2term` at `79426d3` sets both (`cmd/examplesvc/cards.go:618-631`), and
AG2's `A2UIAgentExecutor` in `ag2` 1.2.1 sets only `mediaType`
(`ag2/a2ui/a2a/parts.py:23-46` in the PyPI wheel).

### Reproduction

Read the cited sections of the extension specs against A2A v1.0.1's
`docs/specification.md` and `specification/a2a.proto`.

### Fix

Add an A2A 1.0 section to each extension spec: the header to activate with, and
where a part's A2UI MIME type goes.

## 11. The specs require an array where an A2A 0.3 data part holds an object

**Component:** the extension specs' data encoding section; A2A 0.3's `DataPart`.

**Severity:** specification contradiction.

### Issue

The extension specs say a data part's `data` "MUST be an array of messages"
(v0.9 and v0.9.1 line 178, v1.0 line 180), and they bind A2UI to A2A 0.3 (see
finding 10). A2A 0.3 types `DataPart.data` as an object: `"type": "object"` in
A2A's `specification/json/a2a.json` at tag `v0.3.0` (`DataPart.properties.data`).
The A2A SDKs follow it: Python's `a2a-sdk` 0.3.25 declares `data: dict[str, Any]`
(`a2a/types.py:277`) and `@a2a-js/sdk` 0.3.14 declares an object. So an A2A 0.3
part that follows the extension specs does not validate as an A2A 0.3 part, and
Python's SDK rejects it. Under A2A 1.0, whose `Part.data` is a `google.protobuf.Value`,
"object, array, string, number, boolean, or null" (`specification/a2a.proto` at
A2A's `v1.0.1`), the array is carried: `filipw/strathweb-a2ui`, `muncus/a2term` and AG2 send one.

### Reproduction

Read `DataPart` in A2A's `specification/json/a2a.json` at `v0.3.0`, and validate
`{"kind": "data", "data": [{"version": "v0.9", "deleteSurface": {"surfaceId":
"s"}}]}` against it.

### Fix

Allow one message or an array under A2A 0.3, or say that A2A 0.3 carries one
message per part and only A2A 1.0 carries an array.

## 12. The sample clients and agents send and read actions in v0.8's shape

**Component:** `samples/client/angular/projects/restaurant/src/app/client.ts`;
`samples/client/lit/shell/app.ts`;
`samples/agent/adk/custom-components-example/agent_executor.py`.

**Severity:** deviation from the extension specs.

### Issue

The v0.9 extension spec's "Client-to-server events" section says an action's
data part "must validate against the Client-to-Server Message List Schema"
(v0.9 line 228), and its example holds `{"version": "v0.9", "action": {…}}`
(lines 230-251); `client_to_server.json` requires `version` with `action` or
`error` (lines 90-97). The Angular client sends `{"userAction": {…}}`
(`client.ts:31`, wrapped as the part's data at `server.ts:66-82`), and so does
the Lit client (`app.ts:527-535`). `userAction` is v0.8's client event key
(`typescript/core/web_core/src/v0_8/types/client-event.ts:44`). The
custom-components sample reads an action only from `userAction`
(`agent_executor.py:96-98`), so a client that follows the v0.9 spec cannot press
its controls; the restaurant finders read both (`samples/agent/adk/restaurant_finder/agent_executor.py:84-94`,
`samples/agent/node/restaurant_finder/src/a2a.ts:77-83`). The React client sends
the v0.9 shape (`samples/client/react/shell/src/App.tsx:68`).

### Reproduction

Read the cited lines. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/angular_client/python_restaurant_finder_booking.har`
in `a2ui-spectra` holds the Angular client's `userAction` parts as sent.

### Fix

Send `{"version": "v0.9", "action": {…}}` from the Angular and Lit clients, as
the React client does, and read `action` in the custom-components sample.

## 13. The custom-components sample fails every v0.9 turn that reaches the model

**Component:** `samples/agent/adk/custom-components-example/agent.py`.

**Severity:** sample defect.

### Issue

The v0.9 basic catalog describes `formatString` with the text "`${expression}`"
(`specification/v0_9/catalogs/basic/catalog.json:965`), and the catalog goes
into the agent's instruction. ADK replaces every `{name}` in an instruction with
the session state's value and raises `KeyError: Context variable not found` when
there is none (`google/adk/utils/instructions_utils.py:122-124` in `google-adk`
2.3.0, the version upstream's `uv.lock` pins). The restaurant finder seeds
`"expression": "{expression}"` into its session state for this
(`samples/agent/adk/restaurant_finder/agent.py:210`); the custom-components
sample seeds only `base_url` (`agent.py:379`). Every v0.9 turn that reaches the
model fails with ``KeyError: 'Context variable not found: `expression`.'``, and
over `message/stream` the connection closes after the `submitted` task, with no
final status. Turns the sample answers without the model, such as its
`send_message` action, work.

### Reproduction

Run the sample with a Gemini key and send it a text message over
`message/stream` with the v0.9 extension requested. The A2A capture suite's
recording `conformance/test_data/a2a_capture/v0_1/custom_components/action_then_model_turn.har`
in `a2ui-spectra` holds such a turn.

### Fix

Seed `expression` in the session state, as the restaurant finder does, or escape
the catalog's braces before it goes into an ADK instruction.

## 14. The Python restaurant finder creates the same surface twice in a streamed turn

**Component:** `samples/agent/adk/restaurant_finder/agent.py`.

**Severity:** deviation from the v0.9 protocol.

**Upstream:** PR #3272.

### Issue

The v0.9 protocol says "It is an error to try to create a surface with a
`surfaceId` that already exists without first deleting it"
(`specification/v0_9/docs/a2ui_protocol.md:180`). Over `message/stream`, every
turn of the sample sends `createSurface` for its surface twice, with no
`deleteSurface` between. ADK's streaming mode delivers the model's reply as
partial chunks and then once more as one aggregated response with
`partial=False` (`StreamingResponseAggregator.close()`,
`google/adk/utils/streaming_utils.py:348-412`, in `google-adk` 2.3.0). The
sample's `token_stream` passes on the text of every event without looking at
`event.partial` (`agent.py:281-298`), so its streaming parser reads the whole
reply a second time and emits its messages again.

### Reproduction

Run the sample with a Gemini key and stream any request with the v0.9 extension
requested. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/angular_client/python_restaurant_finder_booking.har`
in `a2ui-spectra` holds three such turns.

### Fix

Skip partial events or the final aggregated one in `token_stream`, so each piece
of text reaches the parser once.

## 15. The v0.9.1 schemas declare v0.9's `$id`s

**Component:** every schema in `specification/v0_9_1/json/` that declares an
`$id`, and `specification/v0_9_1/catalogs/basic/catalog.json`.

**Severity:** specification defect.

### Issue

Each v0.9.1 schema declares the `$id` of its v0.9 counterpart: for example,
`specification/v0_9_1/json/server_to_client.json:3` declares
`https://a2ui.org/specification/v0_9/server_to_client.json`, the `$id` of
`specification/v0_9/json/server_to_client.json`. The same holds for
`client_capabilities.json`, `client_data_model.json`,
`client_to_server_list.json`, `client_to_server_list_wrapper.json`,
`common_types.json`, `sample.json`, `server_capabilities.json`,
`server_to_client_list.json`, `server_to_client_list_wrapper.json` and the basic
catalog, `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`.

JSON Schema tools register schemas and resolve `$ref`s by `$id`. A validator
that holds v0.9 and v0.9.1 together either refuses the second version or
resolves one version's references to the other's documents. A tool that checks
both versions has to keep each in its own validator.

### Reproduction

With Ajv 8's draft 2020-12 build, `addSchema` the v0.9 and then the v0.9.1
`server_to_client.json`. The second call throws
`schema with key or id "https://a2ui.org/specification/v0_9/server_to_client.json" already exists`.

### Fix

Give each v0.9.1 file the `$id` of its own path, under
`https://a2ui.org/specification/v0_9_1/`.

## 16. `client_to_server.json` declares no `$id` in v0.9 and v0.9.1

**Component:** `specification/v0_9/json/client_to_server.json` and
`specification/v0_9_1/json/client_to_server.json`.

**Severity:** specification defect.

### Issue

Every other schema of v0.9 and v0.9.1 declares an `$id`, and v1.0's counterpart,
`specification/v1_0/json/renderer_to_agent.json`, declares
`https://a2ui.org/specification/v1_0/renderer_to_agent.json`.
`client_to_server.json` declares none. `client_to_server_list.json` references
it as `client_to_server.json` (line 8 in both versions), resolved against its
own `$id` to `https://a2ui.org/specification/v0_9/client_to_server.json`, which
no schema declares. A validator that loads the schemas by their `$id`s cannot
resolve that reference unless it registers `client_to_server.json` under that
address by hand.

### Reproduction

With Ajv 8's draft 2020-12 build, `addSchema` every v0.9 schema that declares an
`$id`, and compile `client_to_server_list.json`. It fails with
`can't resolve reference client_to_server.json from id https://a2ui.org/specification/v0_9/client_to_server_list.json`.

### Fix

Declare `https://a2ui.org/specification/v0_9/client_to_server.json` in v0.9's
file, and the v0.9.1 address in v0.9.1's, with finding 15.

## 17. The TypeScript restaurant finder's stub creates `stub-notice` again in every turn

**Component:** `samples/agent/node/restaurant_finder/src/model.ts`.

**Severity:** deviation from the v0.9 and v1.0 protocols.

### Issue

The v0.9 protocol says "It is an error to try to create a surface with a
`surfaceId` that already exists without first deleting it; `surfaceId` must be
globally unique for the renderer's lifetime"
(`specification/v0_9/docs/a2ui_protocol.md:180`), and v1.0 calls it "a state
integrity error (`code: "INTEGRITY_ERROR"`)"
(`specification/v1_0/docs/a2ui_protocol.md:178`). Run with `STUB_LLM=true`, the
sample answers without a model, and "each stub response starts with an extra
surface, `stub-notice`" (`samples/agent/node/restaurant_finder/README.md:31`):
`StubBackend` puts the notice's messages, `createSurface` included, before the
example of every turn (`src/model.ts:123`), with no `deleteSurface`. So the
second turn of a conversation creates `stub-notice` while the host still holds
it from the first, and a host on upstream's web core rejects it with
`Surface stub-notice already exists.`

### Reproduction

Run the sample with `STUB_LLM=true`, send a message, then press a button of the
surface it draws, in the same conversation. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/node_restaurant_finder/stream_v1_0_booking.har`
in `a2ui-spectra` holds such a conversation on v1.0.

### Fix

Send the notice in the first turn of a conversation only, or send
`deleteSurface` for `stub-notice` before creating it again.

## 18. The TypeScript agent SDK streams an `updateDataModel` before its `value`

**Component:**
`typescript/agents/a2ui_agent/src/inference-formats/direct-json/response-stream.ts`
and `json-reader.ts` beside it.

**Severity:** deviation from the v1.0 protocol; at v0.9 and v0.9.1, a deletion
the reply does not make.

### Issue

The Direct JSON response stream emits `updateComponents` and `updateDataModel`
while they arrive: "A message is emitted, and applied to the state, as soon as
it reads and the state accepts it, and again each time it grows"
(`response-stream.ts:98-100`). To read a message still arriving, the partial
reader heals the object the text ends in with the keys read so far
(`json-reader.ts:332` and `:377`). When a chunk of the model's text ends after an
`updateDataModel`'s `path` and before its `value`, the stream emits the message
with no `value`, then again once the value arrives:

```
{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/items"}}
{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/items","value":["a","b"]}}
```

At v1.0 the first message is invalid: `value` is "(any, required)"
(`specification/v1_0/docs/a2ui_protocol.md:264`), and the schema requires it
(`specification/v1_0/json/agent_to_renderer.json:141`). At v0.9 and v0.9.1 it
is valid and means "If omitted, the key at `path` is removed"
(`specification/v0_9/docs/a2ui_protocol.md:252`,
`specification/v0_9_1/docs/a2ui_protocol.md:249`): on it, web_core's v0.9
`MessageProcessor` takes a data model of `{"items":["a","b"]}` to `{}`. A turn
that sends a path already holding data removes that data until the full message
arrives. The stream's own check accepts the message at v1.0 (finding 19).

### Reproduction

From `samples/agent/node/restaurant_finder`, create a processor for the v1.0
basic catalog (`catalogs/basic/v1/catalog.json`) with
`new A2uiGenerator([new CatalogConfig(catalog)], {}).createProcessor({supportedCatalogIds: [catalogId]}, new DirectJsonFormatFactory())`,
open a stream with `openStream()`, and feed it a reply whose `<a2ui-json>` block
holds `createSurface`, `updateComponents` and
`{"version":"v1.0","updateDataModel":{"surfaceId":"s","path":"/items","value":["a","b"]}}`,
in two chunks cut right after `"path":"/items",`. The first chunk's parts hold
the message with no `value`. The same holds at v0.9. The sample itself, run on
Gemini and asked for v1.0, sent such a message in a turn.

### Fix

Emit a growing `updateDataModel` only once its `value` has begun to arrive.

## 19. web_core's v1.0 model accepts an `updateDataModel` with no `value`

**Component:** `typescript/core/web_core/src/v1_0/schema/agent-to-renderer.ts`,
generated by `typescript/core/web_core/src/v1_0/scripts/generate-schemas.mjs`.

**Severity:** deviation from the v1.0 schema.

### Issue

The v1.0 schema requires `value` in `updateDataModel`:
`"required": ["surfaceId", "value"]`
(`specification/v1_0/json/agent_to_renderer.json:141`). The generated Zod model
declares it as `'value': z.any()` (`agent-to-renderer.ts:105-109`), and Zod lets
an object key whose schema accepts `undefined` be missing, so
`UpdateDataModelMessageSchema` accepts a message without one. The TypeScript
agent SDK checks each message it streams against these models
(`typescript/agents/a2ui_agent/src/utils/envelope-validation.ts:63`,
`renderer-state.ts:794`), so it lets finding 18's message through.

### Reproduction

`UpdateDataModelMessageSchema.safeParse({version: 'v1.0', updateDataModel: {surfaceId: 's', path: '/items'}})`
from `@a2ui/web_core/v1_0` returns `success: true`.

### Fix

Have the generator require a required property whose schema accepts any value,
for example with a refinement that rejects `undefined`.

## 20. The Python samples still call the `a2ui-a2a` functions #3269 removed or changed

**Component:** `samples/agent/adk/restaurant_finder/agent.py`;
`samples/agent/adk/custom-components-example/agent.py`;
`samples/community/agent/adk/gemini_enterprise/v0_8/agent_engine/agent.py`;
`samples/community/agent/adk/gemini_enterprise/v0_8/cloud_run/agent.py`;
`samples/community/agent/adk/gemini_enterprise/v0_9/agent.py`.

**Severity:** sample defect: the two core Python samples do not start.

**Upstream:** PR #3272, PR #3273.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24), not at the
commit above; at `020a9d6f` the samples run.

### Issue

#3269 (`803874bb3`, "make the Parser stateless; always validate; add
ResponseStream") removed `parse_response_to_parts` from `a2ui.a2a`, whose
`__all__` no longer lists it (`python/a2ui_a2a/src/a2ui/a2a/__init__.py:37-53`),
and changed `stream_response_to_parts` to take a `ResponseStream` instead of a
`Parser` (`python/a2ui_a2a/src/a2ui/a2a/parts.py:167-171`). The samples were not
updated:

- all five import `parse_response_to_parts` from `a2ui.a2a` (restaurant finder
  `agent.py:42`, custom-components `agent.py:42`, the v0.8 Gemini Enterprise
  samples `agent_engine/agent.py:29` and `cloud_run/agent.py:30`, the v0.9 one
  `agent.py:30`), so each fails at import with
  `ImportError: cannot import name 'parse_response_to_parts' from 'a2ui.a2a'`;
- the restaurant finder, the custom-components sample and the v0.9 Gemini
  Enterprise sample pass a `Parser` from `create_parser()` to
  `stream_response_to_parts` (restaurant finder `agent.py:304-312`,
  custom-components `agent.py:526-532`, v0.9 `agent.py:343-349`), so their
  streaming path breaks once the import is fixed.

### Reproduction

At `409ded29c`, in `samples/agent/adk/restaurant_finder`, run `uv run .`: it
exits with the `ImportError` above before serving its card. The same holds for
`samples/agent/adk/custom-components-example`.

### Fix

Parse with `A2uiRequestProcessor.parse_response()` and convert with
`to_a2a_parts`, as `a2ui-a2a`'s CHANGELOG directs, and stream through the
`ResponseStream` from `open_stream()`. Running the samples in CI, at least to
import, would catch the next such break.

## 21. `a2ui-a2a`'s CHANGELOG lists #3269's breaking changes under the released 0.1.0

**Component:** `python/a2ui_a2a/CHANGELOG.md`.

**Severity:** release-notes defect.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

### Issue

The CHANGELOG's `## Unreleased` section is empty (`CHANGELOG.md:1`), and #3269's
entries — `stream_response_to_parts` taking a `ResponseStream`, and
`parse_stream_chunk_to_parts` and `parse_response_to_parts` removed, all marked
**BREAKING** — sit under `## 0.1.0 (2026-10-17)` (`CHANGELOG.md:3`, `:15-25`),
with `to_a2a_parts` and `parse_content_to_parts`'s `state` after them
(`:26-31`). The 0.1.0 release, tagged `python/a2ui-a2a/v0.1.0` at `c68db100a`,
predates #3269: it still exports `parse_response_to_parts` and
`parse_stream_chunk_to_parts` (`__init__.py:33`, `:51`), and its
`stream_response_to_parts` takes a `Parser` (`parts.py:215-218`). A reader
of the CHANGELOG is told 0.1.0 removed functions that 0.1.0 has.

### Reproduction

Compare `git show python/a2ui-a2a/v0.1.0:python/a2ui_a2a/src/a2ui/a2a/__init__.py`
with the `## 0.1.0` section of `python/a2ui_a2a/CHANGELOG.md` at `409ded29c`.

### Fix

Move #3269's entries under `## Unreleased`.
