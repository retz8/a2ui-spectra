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

### Issue

The prose places the MIME type inside the data:
`DataPart.data.metadata["mimeType"] = "application/a2ui+json"` (v0.9 and v0.9.1
lines 51, 56 and 176; v1.0 lines 51, 56 and 178). Every example in the same
specs places it in the part's own metadata, a sibling of `data`
(v0.9 and v0.9.1 lines 219-222; v1.0 lines 221-223). Every implementation in
the repo follows the examples.

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

## 8. The v0.9.1 capabilities example does not validate against the v0.9.1 schema

**Component:** `specification/v0_9_1/docs/a2ui_extension_specification.md`;
`specification/v0_9_1/json/client_capabilities.json`.

**Severity:** specification contradiction.

### Issue

The v0.9.1 spec's capabilities example keys the capabilities by `"v0.9.1"`
(line 129). The v0.9.1 schema it links defines only a `"v0.9"` property and
requires it (`client_capabilities.json:7-26`); its `$id` is still v0.9's,
`https://a2ui.org/specification/v0_9/client_capabilities.json` (line 3). The
v0.9.1 data model schema, by contrast, accepts both versions
(`client_data_model.json:8-10`). A host cannot tell which key a v0.9.1 agent
reads, and agents differ: the TypeScript sample reads only `"v0.9"` and
`"v1.0"` (`samples/agent/node/restaurant_finder/src/versions.ts`).

### Reproduction

Validate the example at lines 120-138 (its `metadata.a2uiClientCapabilities`
value) against `specification/v0_9_1/json/client_capabilities.json`: it fails on
the required `v0.9` property.

### Fix

Decide the key for v0.9.1 and make the example and the schema agree, for
example by accepting both `"v0.9"` and `"v0.9.1"` as the data model schema does.

## 9. The v0.9 and v0.9.1 examples write a component in v0.8's shape

**Component:** the v0.9 and v0.9.1 extension specs' "Server-to-client
messages" example.

**Severity:** specification example that fails its own schema.

### Issue

The example `updateComponents` message holds
`{"Text": {"id": "root", "text": "Hello!"}}` (v0.9 and v0.9.1 lines 209-214),
the component shape of v0.8. In v0.9 a component carries `id` and a `component`
property naming its type: `ComponentCommon` requires `id`
(`specification/v0_9/json/common_types.json:25-35`) and the basic catalog's
`Text` sets `"component": {"const": "Text"}`
(`specification/v0_9/catalogs/basic/catalog.json:20-21`). The v1.0 spec's
example uses the current shape, `"component": "Text"` (line 213).

### Reproduction

Validate the example's `updateComponents` message against
`specification/v0_9/json/server_to_client.json` with the basic catalog: the
component has no `id` and no `component`.

### Fix

Write the component as `{"id": "root", "component": "Text", "text": "Hello!"}`.

## 10. Nothing in a reply names the A2UI version the agent chose

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

## 11. The extension specs cover A2A 0.3 only

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

## 12. The specs require an array where an A2A 0.3 data part holds an object

**Component:** the extension specs' data encoding section; A2A 0.3's `DataPart`.

**Severity:** specification contradiction.

### Issue

The extension specs say a data part's `data` "MUST be an array of messages"
(v0.9 and v0.9.1 line 178, v1.0 line 180), and they bind A2UI to A2A 0.3 (see
finding 11). A2A 0.3 types `DataPart.data` as an object: `"type": "object"` in
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

## 13. The sample clients and agents send and read actions in v0.8's shape

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

## 14. The custom-components sample fails every v0.9 turn that reaches the model

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

## 15. The Python restaurant finder creates the same surface twice in a streamed turn

**Component:** `samples/agent/adk/restaurant_finder/agent.py`.

**Severity:** deviation from the v0.9 protocol.

### Issue

The v0.9 protocol says "It is an error to try to create a surface with a
`surfaceId` that already exists without first deleting it"
(`specification/v0_9/docs/a2ui_protocol.md:180`). Over `message/stream`, every
turn of the sample sends `createSurface` for its surface twice, with no
`deleteSurface` between. ADK's streaming mode delivers the model's reply as
partial chunks and then once more as one aggregated response
(`google/adk/utils/streaming_utils.py:28-33`, `StreamingResponseAggregator`, in
`google-adk` 2.3.0). The sample's `token_stream` passes on the text of every
event without looking at `event.partial` (`agent.py:281-298`), so its streaming
parser reads the whole reply a second time and emits its messages again.

### Reproduction

Run the sample with a Gemini key and stream any request with the v0.9 extension
requested. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/angular_client/python_restaurant_finder_booking.har`
in `a2ui-spectra` holds three such turns.

### Fix

Skip partial events or the final aggregated one in `token_stream`, so each piece
of text reaches the parser once.
