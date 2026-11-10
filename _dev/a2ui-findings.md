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

**Upstream:** PR #3603, merged 2026-11-03.

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

**Upstream:** PR #3600, merged 2026-11-03.

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
Upstream's own concepts page already draws the line the extension specs lack:
"The use of a **list** in the `data` field was introduced in **A2A v1.0**.
Earlier versions of the A2A protocol expect the `data` field to contain a single
JSON object." (`docs/public/concepts/actions.md:265`, the same at
`409ded29ccac3eebc541979ae5320771703248e8`).

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

**Component:** every schema in `specification/v0_9_1/json/` except
`common_types.json`.

**Severity:** specification defect; the v0.9.1 list schemas that a2ui.org
publishes reject v0.9.1 messages.

**Upstream:** issue #3974, PR #3975.

Checked at `43696ef43` (2026-11-03), not at the commit above.

### Issue

Each v0.9.1 schema declares the `$id` of its v0.9 counterpart: for example,
`specification/v0_9_1/json/server_to_client.json:3` declares
`https://a2ui.org/specification/v0_9/server_to_client.json`, the `$id` of
`specification/v0_9/json/server_to_client.json`. When #1493 created v0.9.1 as a
copy of v0.9, the two `json/` folders were identical. #1561 then changed the
`version` of v0.9.1's `server_to_client.json`, `client_to_server.json` and
`client_data_model.json` from `"const": "v0.9"` to
`"enum": ["v0.9", "v0.9.1"]` and kept the `$id`s, so the `$id`s of
`server_to_client.json` and `client_data_model.json` each name two different
documents. The list, wrapper and sample files refer to these schemas
relatively, so v0.9.1's resolve to v0.9's.

`.github/workflows/docs.yml` publishes each `json/` file at its version root. A
validator that fetches
`https://a2ui.org/specification/v0_9_1/server_to_client_list.json` and
retrieves its references by URL follows its `$id` to
`https://a2ui.org/specification/v0_9/server_to_client.json`, v0.9's schema, and
rejects every `"v0.9.1"` message in the list; v0.9.1's
`client_to_server_list.json` does the same (finding 16). A validator that
registers the schemas by `$id` cannot hold v0.9 and v0.9.1 together: it refuses
v0.9.1's `server_to_client.json` and `client_data_model.json`, and a lookup by
the `$id` of v0.9.1's list returns v0.9's list.

`common_types.json` and the basic catalog are byte-identical to v0.9's and
share v0.9's `$id`s by design. The catalog's `$id` is its `catalogId`, which the
v0.9.1 extension specification gives as
`https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`, and the
catalog refers to `common_types.json` by its absolute v0.9 address, 78 times.

### Reproduction

Fetch `https://a2ui.org/specification/v0_9_1/server_to_client_list.json`,
compile it with Ajv 8's draft 2020-12 `compileAsync` and a `loadSchema` that
fetches each reference by URL, supplying the basic catalog for the
`catalog.json` placeholder, which a2ui.org does not serve (HTTP 404). Validating
`[{"version":"v0.9.1","deleteSurface":{"surfaceId":"s"}}]` fetches
`https://a2ui.org/specification/v0_9/server_to_client.json` and fails with
`/0/version must be equal to constant {"allowedValue":"v0.9"}`. Python's
`jsonschema` 4.26.0 with a retrieving `referencing.Registry` rejects it with
`'v0.9' was expected`. With v0.9.1's `server_to_client.json` as the root, the
message is valid.

With Ajv 8's draft 2020-12 build, `addSchema` the v0.9 and then the v0.9.1
`server_to_client.json`. The second call throws
`schema with key or id "https://a2ui.org/specification/v0_9/server_to_client.json" already exists`.

### Fix

Give each v0.9.1 schema in `json/` except `common_types.json` the address
a2ui.org publishes it at, `https://a2ui.org/specification/v0_9_1/<name>.json`,
and keep `common_types.json` and the basic catalog under v0.9's `$id`s. PR #3975
does this. It also gives a2ui-core's generated v0.9.1 `server_to_client` schema
the new `$id`, which a conformance case compares with the file exactly, and has
the v0.9.1 test runner alias the catalog at both addresses that `catalog.json`
then resolves to: under `v0_9_1/` from `server_to_client.json`, and under
`v0_9/` from `common_types.json`.

## 16. `client_to_server.json` declares no `$id` in v0.9 and v0.9.1

**Component:** `specification/v0_9/json/client_to_server.json` and
`specification/v0_9_1/json/client_to_server.json`.

**Severity:** specification defect.

**Upstream:** issue #3974, PR #3975.

Checked at `43696ef43` (2026-11-03), not at the commit above.

### Issue

Every other schema of v0.9 and v0.9.1 declares an `$id`, and v1.0's counterpart,
`specification/v1_0/json/renderer_to_agent.json`, declares
`https://a2ui.org/specification/v1_0/renderer_to_agent.json`.
`client_to_server.json` declares none. `client_to_server_list.json` references
it as `client_to_server.json` (line 8 in both versions), resolved against its
own `$id` to `https://a2ui.org/specification/v0_9/client_to_server.json`, which
no schema declares. A validator that loads the schemas by their `$id`s cannot
resolve that reference unless it registers `client_to_server.json` under that
address by hand, and `client_to_server_list_wrapper.json` fails with it. Nothing
in the repo compiles either list. `conformance/tests/test_conformance_yaml.py`
adds the `$id` to v0.9's file by hand before registering it
(`V09_CLIENT_TO_SERVER`, from #3583), and the Swift schema generator falls back
to the same address when the file has none.

A validator that retrieves references by URL does get a file at that address,
since a2ui.org serves v0.9's `client_to_server.json` there: v0.9's list works,
and v0.9.1's list rejects v0.9.1 messages (finding 15).

### Reproduction

With Ajv 8's draft 2020-12 build, `addSchema` every v0.9 schema that declares an
`$id`, and compile `client_to_server_list.json`. It fails with
`can't resolve reference client_to_server.json from id https://a2ui.org/specification/v0_9/client_to_server_list.json`.
v0.9.1 fails the same way.

### Fix

Declare `https://a2ui.org/specification/v0_9/client_to_server.json` in v0.9's
file, and the v0.9.1 address in v0.9.1's, with finding 15. PR #3975 does this.

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

**Severity:** a deletion the reply does not make, at v0.9, v0.9.1 and v1.0, of
the data at the message's `path` or of the whole data model; at v1.0 also a
deviation from the protocol.

**Upstream:** issue #3929, PR #3930.

Checked at `d378d2008` (2026-11-03), not at the commit above.

### Issue

The Direct JSON response stream emits `updateComponents` and `updateDataModel`
while they arrive: "A message is emitted, and applied to the state, as soon as
it reads and the state accepts it, and again each time it grows"
(`response-stream.ts:109-111`). To read a message still arriving, the partial
reader heals the object the text ends in with the keys read so far
(`json-reader.ts:332` and `:377`). When a chunk of the model's text ends after an
`updateDataModel`'s `path` and before its `value`, the stream emits the message
with no `value`, then again once the value arrives:

```
{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/items"}}
{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/items","value":["a","b"]}}
```

When the chunk ends before the `path` too, it emits
`{"version":"1.0","updateDataModel":{"surfaceId":"s"}}`.

At v1.0 these messages are invalid: `value` is "(any, required)"
(`specification/v1_0/docs/a2ui_protocol.md:266`), and the schema requires it
(`specification/v1_0/json/agent_to_renderer.json:141`). At v0.9 and v0.9.1 they
are valid: `value` "If omitted, the key at `path` is removed"
(`specification/v0_9/docs/a2ui_protocol.md:252`,
`specification/v0_9_1/docs/a2ui_protocol.md:249`), and "If `path` is omitted
(or is `/`), the entire data model for the surface is replaced"
(`specification/v0_9/docs/a2ui_protocol.md:245`). web_core's `MessageProcessor`
applies them as removals at every version, since its v1.0 model accepts them
(finding 19): a data model of `{"items":["a","b"],"other":1}` goes to
`{"other":1}`, or to `{}` when the message has no `path`. The full message that
follows writes only its own `path`, so after a message with no `path` the rest
of the data model stays removed when the turn ends: streamed in three chunks,
`{"surfaceId":"s","path":"/items","value":["c","d"]}` leaves
`{"items":["c","d"]}`, where one chunk leaves `{"items":["c","d"],"other":1}`.

### Reproduction

From `samples/agent/node/restaurant_finder`, create a processor for the v1.0
basic catalog (`catalogs/basic/v1/catalog.json`) with
`new A2uiGenerator([new CatalogConfig(catalog)], {}).createProcessor({supportedCatalogIds: [catalogId]}, new DirectJsonFormatFactory())`,
open a stream with `openStream()`, and feed it a reply whose `<a2ui-json>` block
holds `createSurface`, `updateComponents` and
`{"version":"1.0","updateDataModel":{"surfaceId":"s","path":"/items","value":["a","b"]}}`,
in two chunks cut right after `"path":"/items",`. The first chunk's parts hold
the message with no `value`. The same holds at v0.9. The sample itself, run on
Gemini and asked for v1.0, sent such a message in a turn. Issue #3929 holds a
script that streams the message into a `RendererState` and prints the data model
after each chunk.

### Fix

Emit a growing `updateDataModel` only once its `value` has begun to arrive.

PR #3930 does this in `emitReady` through `mayGrow`: an open message is emitted
if it is an `updateComponents`, or an `updateDataModel` that holds `value`. An
`updateDataModel` that closes without `value` is still emitted, as v0.9's way to
remove a key.

### Prior art

The Python and Dart streams already hold such a message: Python's `_may_grow`
(`python/a2ui_agent/src/a2ui/inference_formats/direct_json/response_stream.py:603`)
and Dart's `_mayGrow`
(`dart/a2ui_agent/lib/src/inference_formats/direct_json/response_stream.dart:653`)
let an open `updateDataModel` be emitted only once it holds `value`. Issue #2936
(closed) was the same class of bug in Python's earlier stream parser, partial
`updateDataModel` messages sent without their `path`, closed as fixed by #3074.

## 19. web_core's v1.0 model accepts an `updateDataModel` with no `value`

**Component:** `typescript/core/web_core/src/v1_0/schema/agent-to-renderer.ts`,
generated by `typescript/core/web_core/src/v1_0/scripts/generate-schemas.mjs`
through `compileDefToZod` in `typescript/core/web_core/scripts/zod-generator-core.mjs`.

**Severity:** deviation from the v1.0 schema; a v1.0 web renderer applies such a
message from any agent as a removal of the data at its `path`.

**Upstream:** issue #3929, PR #3930.

Checked at `d378d2008` (2026-11-03), not at the commit above.

### Issue

The v1.0 schema requires `value` in `updateDataModel`:
`"required": ["surfaceId", "value"]`
(`specification/v1_0/json/agent_to_renderer.json:141`), and gives `value` a
description and no type. json-schema-to-zod compiles it to `'value': z.any()`
(`agent-to-renderer.ts:105-109`), and Zod lets an object key whose schema
accepts `undefined` be missing, so `UpdateDataModelMessageSchema` accepts a
message without one. web_core's `MessageProcessor` validates v1.0 messages with
`AgentToRendererMessageSchema`
(`typescript/core/web_core/src/processing/adapters/v1_0.ts:71`), so it applies
such a message as a removal. The TypeScript agent SDK checks each message it
streams against the same models
(`typescript/agents/a2ui_agent/src/utils/envelope-validation.ts:125`,
`renderer-state.ts:984`), so it lets finding 18's message through. In the v0.9
and v1.0 schemas, `updateDataModel.value` is the only required property with no
type. Ajv rejects the message against `agent_to_renderer.json` ("must have
required property 'value'"), and so does the Python agent SDK's v1.0 model
(`updateDataModel.value: Field required`).

### Reproduction

`UpdateDataModelMessageSchema.safeParse({version: '1.0', updateDataModel: {surfaceId: 's', path: '/items'}})`
from `@a2ui/web_core/v1_0` returns `success: true`. Given that message after one
that set `/items` to `["a","b"]`, a v1.0 `MessageProcessor` leaves a data model
of `{}`.

### Fix

Have the generator require a required property whose schema accepts any value,
for example with a refinement that rejects `undefined`.

PR #3930 does this in `compileDefToZod`: a required property whose schema holds
only `description`, `title`, `examples`, `$comment` or `deprecated` compiles to
`z.any().refine(value => value !== undefined, 'Required')`. The regenerated
`agent-to-renderer.ts` gains that one line; no v0.9 output changes.

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

## 22. AG2's v1.0 function call is not in v1.0's shape

**Component:** `ag2` 1.2.1 (`ag2ai/ag2`): `ag2/a2ui/v1_0/`, `ag2/a2ui/_types.py`,
`ag2/a2ui/parser.py`, `ag2/a2ui/a2a/executor.py`.

**Severity:** deviation from the v1.0 protocol.

**Upstream:** `ag2ai/ag2` PR #3469, merged 2026-10-23, after the 1.2.1 release of
2026-10-21; no release carries it yet.

Checked in the `ag2` 1.2.1 wheel from PyPI; AG2 paths are inside it.

### Issue

v1.0 wraps an agent's call to a renderer function in `callRendererFunction`,
holding `functionCallId` and a `callFunction` that names the function with
`@call` and must carry its `catalogId`
(`specification/v1_0/json/agent_to_renderer.json:170-205`,
`specification/v1_0/json/common_types.json:215-228`,
`specification/v1_0/docs/a2ui_protocol.md:298-310`). It has no `wantResponse`:
"the renderer MUST always send a corresponding `rendererFunctionResponse`"
(`a2ui_protocol.md:300`). AG2 1.2.1 vendors v1.0 from upstream's `d8af0c56`
(2026-06-13), "an upstream **candidate**" (`ag2/a2ui/v1_0/spec/README.md:8-9`),
whose `CallFunctionMessage` put `functionCallId`, `wantResponse` and a
`callFunction` named by `call` at the top level
(`ag2/a2ui/v1_0/spec/server_to_client.json:177-210`). Upstream replaced it with
`callRendererFunction` in #2210 (`e4882a5af`, 2026-08-12;
`specification/v1_0/docs/evolution_guide.md:71`) and renamed `call` to `@call`
in #2891 (`ae0a5253b`, 2026-10-02). AG2 still:

- asks the model for the draft's shape
  (`ag2/a2ui/v1_0/prompt_message_types.md:6`, `:22-24`);
- knows a message's type only by the draft's payload keys
  (`ag2/a2ui/_types.py:93-104`, `:139-157`), so a reply holding v1.0's
  `callRendererFunction` is "not an A2UI message" (`ag2/a2ui/parser.py:105-122`)
  and, once the retries run out, the whole block is dropped from the reply,
  surface messages included (`ag2/a2ui/middleware.py:208-219`, `:245-251`);
- ends the task input-required only on a top-level `callFunction` with
  `wantResponse` (`ag2/a2ui/a2a/executor.py:294-321`), and reads the renderer's
  answer as `functionResponse` (`executor.py:379-401`,
  `ag2/a2ui/incoming.py:181-188`), where v1.0 sends `rendererFunctionResponse`
  (`specification/v1_0/json/renderer_to_agent.json:75`).

So a v1.0 renderer receives
`{"version":"v1.0","functionCallId":…,"wantResponse":true,"callFunction":{"call":…,"args":…}}`,
which `agent_to_renderer.json` rejects.

### Reproduction

`_dev/tools/ag2_a2ui_server.py` in `a2ui-spectra` serves
`A2UIAgentExecutor(agent, protocol_version="v1.0")` on AG2's scripted model.
With `--reply function_call`, the scripted reply holds a card and a call in the
shape AG2's prompt asks for (`ag2_a2ui_server.py:46-54`): the message's text is
the script's, and AG2 validates it, sends it, and ends the task input-required on
it. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/ag2/stream_v1_0_function_call.har` in
`a2ui-spectra` holds the turn.

### Fix

Vendor upstream's current v1.0 and move the prompt, the message types, the
input-required check and the reply parsing to `callRendererFunction` and
`rendererFunctionResponse`, as #3469 does on `main`; release it.

## 23. The file-upload summarizer creates the same surface twice in a turn

**Component:** `samples/community/agent/adk/file_upload_summarizer/agent_executor.py`,
on ADK's `A2aAgentExecutor` (`google-adk` 2.3.0, as `uv.lock:1674-1675` pins).

**Severity:** deviation from the v0.9 protocol.

### Issue

The v0.9 protocol says "It is an error to try to create a surface with a
`surfaceId` that already exists without first deleting it"
(`specification/v0_9/docs/a2ui_protocol.md:180`). Asked for the uploader, the
sample's `show_file_uploader_tool` returns `createSurface` and
`updateComponents` for a new `file_upload_surface_<id>` and sets
`skip_summarization`, so the turn ends on the tool's response
(`samples/community/agent/adk/file_upload_summarizer/tools.py:33-94`).
`A2uiEventConverter(bypass_tool_check=True)` (`agent_executor.py:47-50`) turns
that response into a `working` status update holding the two messages
(`python/a2ui_adk/src/a2ui/adk/a2a/part_converter.py:99-118`). ADK's
`A2aAgentExecutor` keeps the last `working` status message
(`google/adk/a2a/executor/task_result_aggregator.py:61-62`) and, when the run
ends still working, publishes that message's parts again as the task's artifact,
"as the final result according to a2a protocol"
(`google/adk/a2a/executor/a2a_agent_executor.py:291-310`, in `google-adk`
2.3.0). So every turn carries its surface's `createSurface` twice, with no
`deleteSurface` between:

- over `message/stream`, in a `status-update` and then in an `artifact-update`;
- over `message/send`, in the returned task's `history`, where `a2a-sdk` 0.3.25
  moves each earlier status message (`a2a/server/tasks/task_manager.py:139-147`),
  and again in its `artifacts`.

A host that applies every update, as upstream's Angular restaurant client
forwards both kinds (`samples/client/angular/projects/restaurant/src/server.ts:162-166`),
creates the surface a second time, and upstream's web core rejects it with
`Surface file_upload_surface_… already exists.`
(`typescript/core/web_core/src/processing/message-processor.ts:761`). The
sample's own host sends with `message/send` and reads only the task's status
message and artifacts
(`samples/community/client/angular/projects/a2a-chat-canvas/src/lib/utils/a2a.ts:39-52`),
so it sees one copy.

### Reproduction

Run the sample with a Gemini key, stream "Show me the file uploader" with the
v0.9 extension requested, then send "Show me the file uploader again" in the
same context. The A2A capture suite's recording
`conformance/test_data/a2a_capture/v0_1/file_upload_summarizer/artifact_stream_and_send.har`
in `a2ui-spectra` holds both turns.

The community rizzcharts sample, on the same executor, does the same at
upstream `9e8a9bac5` with `google-adk` 2.3.0: asked "show my sales breakdown by
product category for q3" over `message/stream`, its turn carries the three
messages `SendA2uiToClientToolset`'s tool returned twice, in a status update
and again in the artifact, and the second `createSurface` is rejected,
`Surface q3-sales-breakdown already exists.` Seen in the Phase 6 acceptance
run, trace `cbc0a67c10e4c37223447661094369c6`.

### Fix

Send each turn's A2UI messages once: keep them out of either the `working`
status update or the final artifact ADK's executor builds from it.

## 24. Upstream's own v1.0 catalogs fail the v1.0 catalog definition meta-schema

**Component:** `specification/v1_0/json/catalog_definition.json`;
`conformance/test_data/catalogs/`.

**Severity:** the meta-schema and the test data disagree; a validator that
follows the meta-schema refuses upstream's own catalogs.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

### Issue

`catalog_definition.json` requires both unions under `$defs`
(`"required": ["anyComponent", "anyFunction"]`, with
`additionalProperties: false`), and `specification/v1_0/docs/a2ui_protocol.md`
says a catalog's `$defs` holds only those two. Six of upstream's conformance
catalogs declare `"protocolVersion": "1.0"` and have no `anyFunction`:
`composition_catalog_v1_0.json`, `agent_functions_catalog_v1_0.json` (which
also sets `allowedCallers` to a value outside the meta-schema's enum), and the
four under `peer_matching/`. Web core's `Catalog.fromJson` loads them, since it
reads the unions only to filter entries, and `Catalog.toJson` writes an empty
union as `{"not": {}}` (`typescript/core/web_core/src/catalog/schema_serializer.ts`,
`EMPTY_UNION`), so the form the meta-schema wants for "no functions" exists
but the test data does not use it.

### Reproduction

Validate each `conformance/test_data/catalogs/*_v1_0.json` and
`peer_matching/**/*.json` against `specification/v1_0/json/catalog_definition.json`
with `common_types.json` loaded, under JSON Schema 2020-12. Spectra's catalog
registry does this for a configured definition naming protocol version 1.0,
and refuses the six.

### Fix

Add `"anyFunction": {"not": {}}` to each catalog's `$defs`, as `toJson`
writes it, and fix `agent_functions_catalog_v1_0.json`'s `allowedCallers`; or
relax the meta-schema to make `anyFunction` optional, and say so in the
protocol doc.

## 25. The custom-components sample's floor plan fails its own inline catalog

**Component:** `samples/agent/adk/custom-components-example/a2ui_examples.py`;
`samples/agent/adk/custom-components-example/inline_catalog_0.9.json`.

**Severity:** the sample's own catalog rejects the sample's output; a renderer
that validates against the catalog, web core included, refuses the floor plan.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

### Issue

The sample's inline catalog defines `WebFrame` with
`"required": ["component", "url"]` and `unevaluatedProperties: false`
(`inline_catalog_0.9.json`, the `WebFrame` entry). The floor plan the sample
sends for its `view_location` action writes the frame's content as `html`
and no `url`: `a2ui_examples.py` builds the v0.9 component as
`{"component": "WebFrame", ..., "html": html_content}` (lines 143-146), and
`examples/0.9/floor_plan.json` holds the same shape. Web core's
`PayloadValidator` rejects the `updateComponents` for the missing `url`, so
the `location-surface` is created and stays empty.

### Reproduction

Validate the `WebFrame` component of `examples/0.9/floor_plan.json` against
`inline_catalog_0.9.json`'s `components/WebFrame`: `url` is missing. Or feed
the floor plan's messages to web core 0.14.0's `MessageProcessor` with the
inline catalog registered: `Validation failed for component 'WebFrame'`.

### Fix

Either send the floor plan as `url` (a data URL, or a served page), or make
`url` optional in the catalog with `html` as the alternative, and say which
in the definition.

## 26. Web core accepts a component whose v0.9 catalog definition rejects its own `id`

**Component:** `typescript/core/web_core/src/validation/payload-validator.ts`
(`PayloadValidator.validateComponent`); `specification/v0_9/json/server_to_client.json`.

**Severity:** the reference processor and the protocol schema disagree on
what a v0.9 catalog's component definition has to say about a component's
envelope, so a catalog can pass one and fail the other.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24) and
`@a2ui/web_core` 0.14.0 on npm.

### Issue

The v0.9 protocol schema validates each component of `updateComponents`
whole, `id` included, against the catalog: `components.items` is
`catalog.json#/$defs/anyComponent` (`server_to_client.json`,
`UpdateComponentsMessage`). Upstream's basic catalog therefore includes
`common_types.json#/$defs/ComponentCommon` in every component's `allOf`,
beside `"unevaluatedProperties": false`. Web core validates differently:
`validateComponent` reads `id` and `component` off the payload, strips the
`accessibility` and `metadata` envelope fields a component schema does not
declare (`validateCommonEnvelopeFields`), and parses the remaining properties
with the component's Zod schema. A catalog whose component definitions set
`unevaluatedProperties: false` and leave out `ComponentCommon`, as
A2UIVerse's CircleCI catalog does, passes web core and fails the protocol
schema on every component, with `id` as an unevaluated property. Nothing in
`specification/v0_9/docs/` says a component definition has to include the
envelope.

### Reproduction

Define a v0.9 catalog with one component,
`{"type": "object", "properties": {"component": {"const": "Note"}, "text": {"type": "string"}}, "unevaluatedProperties": false}`,
listed under `$defs.anyComponent`. Validate
`{"version": "v0.9", "updateComponents": {"surfaceId": "s", "components": [{"id": "root", "component": "Note", "text": "Hi"}]}}`
against `server_to_client.json` with the catalog bound as `catalog.json`:
`must NOT have unevaluated properties: id`. Feed the same message to web core
0.14.0 with the catalog registered: accepted.

### Fix

Say in the v0.9 protocol doc that a component definition includes
`ComponentCommon`, as the basic catalog does, and have web core validate the
envelope too; or wrap the catalog's component in the protocol schema as v1.0
does, with `ComponentCommon` outside the catalog's branch, so a definition
need not repeat it.

## 27. The React renderer catches no component's failure, and a basic catalog component that throws names nothing

**Component:** `typescript/renderers/react/src/node-view.tsx`;
`typescript/renderers/react/src/web_component_node.tsx`;
`typescript/core/web_core/src/universal/a2ui-lit-element.ts`.

**Severity:** a host cannot tell which component failed. A universal element
that throws stops updating and keeps its stale content; a React implementation
that throws takes down the host's whole React root, or the whole surface when a
host error boundary catches it.

Checked at `15c5ca9aa` (2026-11-05), `@a2ui/react` 0.15.0 and `@a2ui/web_core`
0.15.0 on npm, with Lit 3.3.3 and React 19.2.7. First checked at
`409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

**Upstream:** issue #3993.

### Issue

The React renderer has no error boundary: nothing under
`typescript/renderers/react/src/` implements `componentDidCatch` or
`getDerivedStateFromError`. Both basic catalogs, v0.9's included, are drawn
through web core's universal elements: the v0.9 basic catalog's entries are
universal Lit elements (`typescript/core/web_core/src/v0_9/basic_catalog/catalog.ts`),
which React mounts through `WebComponentNode`. A throw inside such an element's
update is caught by Lit's `ReactiveElement.performUpdate`, which marks the
element updated and rethrows from its asynchronous update loop, so it reaches
the page only as an unhandled promise rejection carrying the error, with
nothing that names the element or its component; the element's next update
re-raises the same error once more, then recovers. `A2uiLitElement.update`
(`a2ui-lit-element.ts`, line 516) wraps `super.update` with no catch, and web
core's error channel is not told. A React implementation that throws while
rendering meets no boundary of the renderer's: without a host boundary, React
unmounts the host's whole root and reports the error through `reportError`
(the window's `error` event); with one above `A2uiSurface`, that boundary
catches it (upstream's `boundary-through-lit` test in
`typescript/renderers/react/tests/v0_9/universal-components.test.tsx`) and
replaces the whole surface.

### Reproduction

Render a v0.9 surface of the basic catalog with a `Column` holding a `Text` and
a React `Badge` through `@a2ui/react` 0.15.0's `A2uiSurface`, then replace the
`a2ui-basic-text` prototype's `render` with a function that throws a
`RangeError` and call `requestUpdate()` on the element. The process receives an
`unhandledRejection` whose reason is the `RangeError`; `surface.onError`
receives nothing; the `Text` keeps its old content and the `Badge` stays
mounted; no report names `Text` or the component's id. Render the same surface
with a React implementation that throws in place of the `Text`, with no error
boundary above `A2uiSurface`: the window receives an `error` event carrying the
`RangeError`, the container is left empty, and `surface.onError` receives
nothing.

### Fix

Catch per component in the renderer: an error boundary around each React
implementation's view, and a catch around `A2uiLitElement`'s update that
dispatches the error through the surface's error channel with the component's
id and type and leaves the element as a placeholder, so the rest of the
surface stays drawn.

### Prior art

Issue #2013 (open) covers placeholders for components that have not arrived or
have no implementation; its plan lists "exception during render" as out of
scope and boundaries as later work, and #3756 (merged) writes that into the
framework adapter blueprint's "Not in this version". PR #2088 (open, stale)
defined an `error` fallback state but wired it only to the Lit surface's
context-creation failure. PR #3616 (open) proposes the rule "No adapter-level
problem reports", which a catch that dispatches from the element would
contradict. Upstream's `boundary-through-lit` test asserts that a host
boundary above `A2uiSurface` catches a throw under a Lit parent; a boundary
inside the renderer would catch it first.

## 28. Web core's resolver reports name the component only inside their sentence

**Component:** `typescript/core/web_core/src/resolution/node-resolver.ts`
(`NodeResolver.dispatchOnce`); `typescript/core/web_core/src/state/surface-model.ts`
(`A2uiErrorPayload`); `typescript/renderers/react/src/node-view.tsx`
(`UnresolvedChildReference`).

**Severity:** a host or a tool that receives a surface's errors cannot tie one
to its component without parsing the English sentence.

**Upstream:** issue #4018, PR #4019.

Checked at `7791823d0` (2026-11-06), with `@a2ui/web_core` and `@a2ui/react`
0.15.0 built from it, and for Lit and Angular at `551bd0f48` (2026-11-05), which
differs from it by a docs page. First checked at
`409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24) and `@a2ui/web_core`
0.14.0 on npm.

### Issue

`NodeResolver.dispatchOnce(code, componentId, dataPath, message)` receives the
component's id and data path, uses them to dispatch each error once, and
dispatches `{code, message}` only (`node-resolver.ts`, lines 146-162). Its two
callers, `UNKNOWN_COMPONENT_TYPE` and `CYCLIC_REFERENCE`, put the component's
id only into the message text. The `UNKNOWN_COMPONENT_TYPE` sentence holds no
data path, so the instances of one template send identical reports.
`A2uiErrorPayload` carries `code`, `message`, `surfaceId`, `functionCallId`,
`expression`, `details` and an index signature, and declares no field for a
component (`surface-model.ts`, lines 77-91). The React renderer reports an
unresolved child reference the same way, as
`{code: 'UNRESOLVED_CHILD_REFERENCE', message}` (`node-view.tsx`, line 140).
That code exists only in React. The resolver's two reach Lit and Angular too,
since #3705 and #3706 moved them onto `NodeResolver`.

Other reports name no component at all. `EXPRESSION_ERROR`, for a function
missing from the catalog, gives the function in `expression`; `DataContext`
dispatches it and does not know its component.

### Reproduction

Feed web core's `MessageProcessor` a v0.9 or v1.0 surface whose root has a type
its catalog does not define, resolve it with `NodeResolver`, and subscribe to
`surface.onError`: the payload is
`{code: 'UNKNOWN_COMPONENT_TYPE', message: "Component '<id>' has type '<type>', which is not in catalog '<catalog id>'.", surfaceId}`,
with the component's id in the sentence alone, while the root node carries
`componentId` and `type` as fields. A cycle gives the same shape as
`CYCLIC_REFERENCE`. React's `A2uiSurface`, Lit's `<a2ui-surface>` and Angular's
`ComponentHostComponent` deliver the same shape at v0.9.

### Fix

Add `componentId` and `componentType` to `A2uiErrorPayload`, and pass them from
`dispatchOnce` and from the renderer's unresolved-reference report.

PR #4019 does this and leaves the data path out: the instance does not change
what to fix, and the framework adapter blueprint's `A2uiErrorInfo` has no data
path either. PR #4016, open, adds the same two fields for its
`COMPONENT_RENDER_ERROR`.

## 29. No sample client sends the data model a surface asks for

**Component:** `samples/client/react/shell/middleware/a2a.ts`;
`samples/client/lit/shell/client.ts`;
`samples/client/angular/projects/restaurant/src/server.ts`.

**Severity:** deviation from the protocol: an agent that creates a surface with
`sendDataModel` gets no data model from any of upstream's hosts.

Checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

### Issue

`createSurface`'s `sendDataModel` says "If true, the client will send the full
data model of this surface in the metadata of every message sent to the server"
(`specification/v0_9/docs/a2ui_protocol.md:189`), as `a2uiClientDataModel` in
v0.9 and v0.9.1 and `a2uiRendererDataModel` in v1.0, each a map of surface ids
to data models (`client_data_model.json`, `renderer_data_model.json`). Web core
builds that map, `MessageProcessor.getRendererDataModel`
(`typescript/core/web_core/src/processing/message-processor.ts:399`), and no
sample client calls it: each sets the message's metadata to its capabilities
alone (`samples/client/react/shell/middleware/a2a.ts:127`,
`samples/client/lit/shell/client.ts:102`,
`samples/client/angular/projects/restaurant/src/server.ts:125`). No sample agent sets
`sendDataModel`, so nothing in the repo sends or reads the data model. The
clients' actions themselves differ from the extension specs and from each other
in shape, as findings 1, 4 and 12 record.

### Reproduction

Read the cited lines: each client's message metadata is its capabilities and
nothing else, whatever surfaces it holds; `git grep sendDataModel -- samples/agent`
finds nothing.

### Fix

Have the sample clients send `getRendererDataModel(version)` under the
version's key with every message, an action or a text, as the protocol has it.

## 30. Neither the Lit nor the Angular renderer catches a component's failure

**Component:** `typescript/renderers/lit/src/surface/a2ui-surface.ts`;
`typescript/renderers/angular/src/core/component-host.component.ts`;
`typescript/core/web_core/src/universal/a2ui-lit-element.ts`.

**Severity:** a host cannot tell which component failed. A component that
throws stops updating and keeps its stale content, and the error leaves the
surface as an unhandled rejection (Lit) or reaches the application's
`ErrorHandler` alone (Angular).

Checked at `15c5ca9aa` (2026-11-05), `@a2ui/lit` 0.15.0, `@a2ui/angular`
0.14.0 and `@a2ui/web_core` 0.15.0 on npm, with Lit 3.3.3 and Angular 21.2.17.
First checked at `409ded29ccac3eebc541979ae5320771703248e8` (2026-10-24).

**Upstream:** issue #3993.

### Issue

Lit: every component the Lit renderer draws, the basic catalog's and a host's
own, is one of web core's universal elements, an `A2uiLitElement`, whose update
has no catch (finding 27). `<a2ui-surface>`'s `render()` has a try/catch, but
it wraps only the `renderA2uiNode(root)` call, which returns a directive; since
ff86e043b (#3705) the surface resolves the root through `NodeResolver` and
creates no context of its own. Each element below renders in its own Lit
update cycle, outside the try.

Angular: the renderer's native components are Angular components hosted by
`ComponentHostComponent` through `*ngComponentOutlet`, with no error handling
around them. A component type missing from the catalog is reported: the host
logs a `console.error`, and the `NodeResolver` dispatches
`UNKNOWN_COMPONENT_TYPE` on `surface.onError`. A component whose template
throws while drawing is not: the error reaches the application's
`ErrorHandler` through Angular's change detection, which hands over the error
alone, with nothing that names the component or its surface, and Angular has
no per-component catch to put one in. Web core's error channel is not told.

### Reproduction

Lit: render a v0.9 surface of the basic catalog plus a custom component, an
`A2uiLitElement` subclass, through `@a2ui/lit` 0.15.0's `<a2ui-surface>`, then
make the custom element's `render` throw a `RangeError` and change a value it
binds. The process receives an `unhandledRejection` whose reason is the
`RangeError`; `surface.onError` receives nothing; the element keeps its old
content. The next change to the bound value raises the same `RangeError` once
more as a second unhandled rejection, then the element renders the new value.

Angular: render the same surface through `@a2ui/angular` 0.14.0's
`ComponentHostComponent` (what `<a2ui-v09-surface>` wraps), with a native
component made with `createComponentImplementation` whose template calls a
function that throws for one bound value, then set that value. The
application's `ErrorHandler.handleError` receives the `RangeError` alone;
`surface.onError` receives nothing; the component keeps its old content.

### Fix

Catch per component in each renderer and dispatch the error through the
surface's error channel with the component's id and type, leaving a
placeholder so the rest of the surface stays drawn: in web core's
`A2uiLitElement` update, as finding 27 gives it, which covers the Lit renderer
and the Angular renderer's universal components; and in the Angular renderer's
`ComponentHostComponent`, around the native component it hosts.

### Prior art

As finding 27: issue #2013 and #3756 leave "exception during render" and
boundaries for later; PR #3616 proposes "No adapter-level problem reports".

## 31. The Python restaurant finder retries its model call on `Surface default already exists`

**Component:** `samples/agent/adk/restaurant_finder/agent.py`, with the agent
SDK's `ResponseStream`.

**Severity:** an extra model call in every streamed turn, and a surface built
three times. Seen at upstream `825beac28` with `google-adk` 2.3.0.

### Issue

Finding 14's cause stands: `token_stream` passes on the text of every ADK event
without looking at `event.partial` (`agent.py:286-302`), so the aggregated
response ADK's streaming mode appends reaches the parser after the partial
chunks that already made the whole reply. At `825beac28` the sample reads the
reply through the agent SDK's stream, `processor.open_stream()` fed by
`stream_response_to_parts` (`agent.py:307-308`), and the stream applies each
block to a renderer state as it comes. The aggregated copy's `createSurface`
for `default` then meets the surface the partial chunks created, and the
message processor rejects it:
`Surface default already exists.`
(`python/a2ui_core/src/a2ui/core/processing/message_processor.py:678`). The
sample takes the `ValueError` as a bad response, marks the stream failed
(`agent.py:326`) and retries the model with "Your previous response was
invalid" (`agent.py:398`). The retry is read whole, not streamed, and passes.

So a turn that needed two model calls, the tool round and the answer, makes
three; and the surface is created once by the first attempt's stream, then
deleted and created twice more as the retry's reply arrives, its streamed and
its aggregated copy. The retry's request repeats the whole prompt, so the
extra call costs as much as the one it repeats.

### Reproduction

Run the sample with a Gemini key and send "Top 3 Chinese restaurants in New
York" over `message/stream`. The sample logs
`A2UI stream failed: Surface default already exists. (Attempt 1)` and
`Retrying... (1/2)`. Under `a2ui-spectra run`, the turn's record holds three
`model_call` events, the third's request carrying the retry prompt, and on the
wire one `createSurface default`, then `deleteSurface` and `createSurface`
twice. Seen in two conversations in the Phase 5 acceptance run, traces
`9e94333e102bd3b80aa935a6360e45f2` and `a81c164e3082ef3c3bcddf3187490c55`.
Seen again at upstream `9e8a9bac5` on `a2ui-agent-sdk` 0.10.0 with Spectra's
wrapper on, trace `a41943c41ad31f0c03e64c3934088ac7`: each stream's input, the
first attempt's and the retry's, is its call's reply exactly twice over. Seen
in the Phase 6 acceptance run, trace `e6cc470d890bdbfbaddff4a9a6687ac3`.

### Fix

Finding 14's: skip partial events, or the final aggregated one, in
`token_stream`, so each piece of text reaches the stream once.

## 32. The custom-components example prompts with examples in a catalog the host did not negotiate

**Component:** `samples/agent/adk/custom-components-example/agent.py` and
`a2ui_examples.py`.

**Severity:** an extra model call in every turn with a host that names its
catalogs, and the turn's second surface lost. Seen at upstream `825beac28`.

### Issue

The example builds the processor of each request from the host's
capabilities: `create_processor` takes the client's `supportedCatalogIds`
(`agent.py:159-167`, from `agent_executor.py:167`), so a host that offers the
basic catalog alone gets a processor whose only active catalog is the basic
one. The prompt's examples do not follow: `floor_plan`, `org_chart` and
`multi_surface` under `examples/0.9/` create their surfaces with
`"catalogId": "inline_catalog"`, and `a2ui_examples.py:134` and `:194` build
the same by hand. Asked about a contact, the model answers as the examples
show, with an org chart in `inline_catalog`, and the processor rejects the
reply: `Catalog not found: inline_catalog`
(`python/a2ui_core/src/a2ui/core/processing/message_processor.py:668-671`).
The example retries once with "Validation failed: Catalog not found:
inline_catalog" (`agent.py:540-564`), the model answers the same way, and the
example gives up with "I'm sorry, I'm having trouble generating the interface
for that request right now." So every turn makes three model calls where two
would do, and the org chart never arrives. A host that sends no capabilities
gets every catalog of the agent and sees none of this.

### Reproduction

Send "Who is Alex Jordan?" from a host whose capabilities name the basic
catalog only, such as Spectra's message box. The example logs
`A2UI stream failed: Catalog not found: inline_catalog (Attempt 2)` and
`Max retries exhausted. Sending text-only error.` Under `a2ui-spectra run`, the
turn's record holds three `model_call` events, the third's request carrying
the retry prompt. Seen in every message-box turn of the Phase 5 acceptance run
on Gemini, Anthropic and both OpenAI APIs, among them traces
`54d0bbb3b13b9831…`, `7c7ad7a3617a52c…` and `5d62d220c67d7d3…`.

Seen again at upstream `9e8a9bac5`, on `a2ui-agent-sdk` 0.10.0 with Spectra's
wrapper on, trace `c7d120f29b28029ec96c08b5709c590a`. The first attempt's
stream stops on the reply's first block, the whole `<a2ui-json>` payload, with
`Catalog not found: inline_catalog`, an `A2uiValidationError`, after the
block's `createSurface` was sent. The retry's stream fails too, but not the
same way: the model moved the org chart into the basic catalog, and the stream
stops on `Validation failed for component 'OrgChart':
components.org-chart.component: Unrecognized component type 'OrgChart'`,
another `A2uiValidationError`, after the messages before it were sent, so the
host draws the contact card without its org chart. The example then gives up
with "I'm sorry, I'm having trouble generating the interface for that request
right now. Please try again in a moment."

### Fix

Give the model only the examples of the catalogs the request's processor
holds, or negotiate the inline catalog with hosts that accept inline catalogs
before prompting with it.

## 33. The Python and TypeScript agent SDKs word the same errors differently and expose different error classes

**Component:** `python/a2ui_agent` and `python/a2ui_core`;
`typescript/agents/a2ui_agent` and `typescript/core/web_core`.

**Severity:** a caller, a test or a tool that reads an error from both SDKs
cannot match it by class or by message, and an agent ported from one SDK to
the other changes the text it sends back to the model on a retry. Seen at
upstream `825beac28`.

### Issue

Given the same text, catalogs and format, the two agent SDKs raise errors of
the same kind with different classes and different messages, and generate
different prompts:

- **A Direct JSON block that is not JSON** raises `A2uiParseError` in Python
  and `ParseError` in TypeScript (`typescript/agents/a2ui_agent/src/errors.ts:34`),
  with the same message.
- **A dangling child** is reported as "Dangling reference: Component 'root'
  references non-existent component 'bookButton' in field 'children[1]'" in
  Python (`python/a2ui_core/src/a2ui/core/state/validation_helpers.py:79`) and
  "Component 'root' references non-existent component 'bookButton' in field
  'children[1]' (Dangling reference 'bookButton' in component 'root')" in
  TypeScript (`typescript/core/web_core/src/state/surface-components-model.ts:318`).
- **A Direct JSON component the catalog does not define** is reported as
  "Validation failed for component 'Heading': components.name.component:
  Unrecognized component type 'Heading'" in Python
  (`python/a2ui_core/src/a2ui/core/validation/payload_validator.py:336`) and
  "Unknown component type 'Heading' not found in catalog '<catalog id>'." in
  TypeScript (`typescript/core/web_core/src/validation/payload-validator.ts:226`).
- **An Express name the catalog does not define**, such as `Heading(...)`,
  raises `A2uiCompilationValidationError` in both, but its cause is a plain
  `ExpressValidationError` in Python, with "Unknown function 'Heading' not
  defined in catalog '<catalog id>'."
  (`python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py:1394`),
  and an `ExpressUnknownFunctionError` in TypeScript, with "Function 'Heading'
  is not defined in the catalog."
  (`typescript/agents/a2ui_agent/src/inference-formats/express/errors.ts:132`).
- **The compilation errors' classes.** Python's `A2uiCompilationParseError` is
  also an `A2uiParseError`, and `A2uiCompilationValidationError` an
  `A2uiValidationError` (`python/a2ui_agent/src/a2ui/parser/errors.py`).
  TypeScript's derive from `A2uiCompilationError` alone
  (`typescript/agents/a2ui_agent/src/errors.ts:98` and `:123`), so code that
  catches `A2uiValidationError` catches a block the catalog refuses in Python
  and misses it in TypeScript.
- **Express's prompt.** Python's prompt generator heads its rules with
  "## Workflow Description:"
  (`python/a2ui_agent/src/a2ui/inference_formats/express/prompt_generator.py:700`);
  TypeScript's writes the rules without it
  (`typescript/agents/a2ui_agent/src/prompt/generator.ts:80`).
- **Catalogs of mixed protocol versions,** v0.9 and v0.9.1, are rejected by
  Python when the format is built, before the prompt generator runs
  (`python/a2ui_agent/src/a2ui/inference_formats/_shared/catalogs.py`, "The
  catalogs target incompatible protocol versions"), and by TypeScript's Direct
  JSON format only inside the generator
  (`typescript/agents/a2ui_agent/src/inference-formats/direct-json/prompt-generator.ts:81`,
  "The schema prompt's catalogs target different protocol versions").

### Reproduction

Run the same text through both SDKs' `parse_response` / `parseResponse` on the
basic catalog at v1.0: the texts of Spectra's wrapper capture suite,
`conformance/test_data/wrapper_capture/v0_1/`, `direct_json_malformed_block`,
`dangling_child`, `direct_json_unknown_component` and
`express_unknown_component`, give the pairs above; their expected records,
`expected_python.json` and `expected_typescript.json`, hold each SDK's class and
message. `express_generate` gives the two prompts, and `generate_failed` the
mixed catalogs.

### Fix

Share the error classes' hierarchy and the messages between the SDKs, as the
conformance suite shares their behaviour: one class for each kind of error,
with the same parents, and one message text for each.

## 34. The agent SDK requires an `a2ui-core` release its own workspace does not build

**Component:** `python/a2ui_agent/pyproject.toml` and `python/a2ui_core`.

**Severity:** an install of the agent SDK from upstream's repository is
inconsistent by its own metadata: `uv pip check` and `pip check` report it,
though uv's resolver accepts it. Seen at upstream `825beac28`.

### Issue

The agent SDK requires `a2ui-core>=0.4.1,<0.5.0`
(`python/a2ui_agent/pyproject.toml:25`) and takes core from the workspace. The
workspace builds core with `hatch-vcs` from the `python/a2ui-core/v*` tags, as
`0.4.1.dev171` at this commit, which PEP 440 orders below `0.4.1`: the version
the requirement names is not out yet, and the one built does not satisfy it.

### Reproduction

In a uv project that takes `a2ui-agent-sdk` from
`git+https://github.com/a2ui-project/a2ui@825beac28` by its subdirectory,
`python/a2ui_agent`, `uv sync` installs `a2ui-core` 0.4.1.dev171 from the same
repository, and `uv pip check` reports "The package `a2ui-agent-sdk` requires
`a2ui-core>=0.4.1,<0.5.0`, but `0.4.1.dev171` is installed".

### Fix

Require the floor the workspace builds, `a2ui-core>=0.4.1.dev0,<0.5.0`, while
core's release is pending, or require the released `0.4.0` until it is out.

## 35. `SendA2uiToClientToolset` drops the call id of the tool call it serves

**Component:** `python/a2ui_adk/src/a2ui/adk/send_a2ui_to_client_toolset.py`.

**Severity:** an observer of the toolset cannot name the model's tool call a
payload came from: what it parses is tied to the call only by the span that is
current when the tool runs. Seen at upstream `825beac28`.

### Issue

ADK hands each tool call's id to the tool in its context, as
`ToolContext.function_call_id`. The toolset's tool, `send_a2ui_json_to_client`,
reads only `actions.skip_summarization` from the context
(`send_a2ui_to_client_toolset.py:438`) and returns `{"validated_a2ui_json": …}`
or `{"error": …}` without the id, and logs neither. A turn whose model asks for
the tool twice gives two parses that nothing in the toolset tells apart by
call.

### Reproduction

Run the community rizzcharts sample, or any agent on `SendA2uiToClientToolset`,
on a request that makes the model call `send_a2ui_json_to_client` twice in one
turn, and read the tool's results and logs: neither names
`tool_context.function_call_id`.

### Fix

Carry the call id in what the tool returns and logs, or let the processor's
parse take it, so a hook or a log can name the call it parsed for.

## 36. No inference format names itself

**Component:** `python/a2ui_agent/src/a2ui/inference_format.py` and the four
formats under `python/a2ui_agent/src/a2ui/inference_formats/`.

**Severity:** a tool, a log line or a trace that reports which format a turn
used has to map the format's classes to names of its own. Seen at upstream
`825beac28`.

### Issue

`InferenceFormat` (`inference_format.py:32`), its factories, parsers and prompt
generators expose no name or id: Direct JSON, Express, Elemental and Atom are
known only by their classes, `DirectJsonParser`, `ExpressParser` and so on. A
caller holding a processor cannot ask it which format it uses, and each
observer invents its own spelling.

### Reproduction

`A2uiRequestProcessor([BasicCatalog("1.0")]).format` is an `ExpressFormat`
whose attributes hold no name; neither do its `create_parser()` and
`prompt_generator`.

### Fix

Give `InferenceFormat` a `name` property, `direct_json`, `express`, `elemental`
and `atom`, the spelling the formats' docs use, and pass it to the parser and
the prompt generator the format makes.

## 37. The restaurant finder parses each reply twice

**Component:** `samples/agent/adk/restaurant_finder/agent.py`.

**Severity:** a trace or a log of the sample's A2UI step shows two parses for
each model call, the streamed one and the whole one, and the same error twice
when a reply fails. Seen at upstream `825beac28`.

### Issue

`RestaurantAgent.stream` reads each reply as a stream while it arrives,
`processor.open_stream()` fed through `stream_response_to_parts`
(`agent.py:308`), and then, unless the stream failed, parses the joined reply
again with `processor.parse_response(final_response_content)` (`agent.py:345`)
to validate it. Both read the same text, against new renderer states.

### Reproduction

Run the sample with a wrapper or a hook that records each `open_stream` and
`parse_response` call, and send one message: a turn holds two parses of the
same text for each model call.

### Fix

Keep the parts the stream returned as the turn's validated UI, and drop the
second parse, or say in the sample why it parses twice.

## 38. The basic catalog's prompt depends on the Python version

**Component:** `python/a2ui_core/src/a2ui/core/basic_catalog/v1_0/components.py`.

**Severity:** the prompt an agent sends, and any record or cache keyed by its
text, differs between Python 3.12 or 3.13 and Python 3.14 for the same SDK and
catalogs. Seen at upstream `825beac28`.

### Issue

`RowComponent.justify` (`components.py:227`) and `ColumnComponent.justify`
(`components.py:271`) are `Literal[…] | None` over the same seven values,
Row's sorted and Column's in the specification's order. `typing` treats two
`Literal`s with the same values as equal, whatever their order, and on Python
3.12 and 3.13 its union cache hands Column the union built for Row, so
Column's values are written in Row's order. Python 3.14 builds Column its own,
in the order it declares. The basic catalog's document, its schema and every
prompt generated from it follow: Column's `justify` enum reads `center`,
`end`, `spaceAround`… on 3.12 and 3.13, and `start`, `center`, `end`… on 3.14.

### Reproduction

```
python -c "from a2ui.core.basic_catalog import BasicCatalog; print(BasicCatalog('1.0').to_json()['components']['Column']['properties']['justify']['enum'])"
```

prints `['center', 'end', 'spaceAround', 'spaceBetween', 'spaceEvenly',
'start', 'stretch']` on Python 3.12 and `['start', 'center', 'end',
'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch']` on Python 3.14. Any
`prompt_snippet` on the basic catalog at v1.0 differs the same way.

### Fix

Declare the values once, as one alias both components use, or in one order in
both, so the cache has nothing to swap.

## 39. A build of main between releases carries the last release's version

**Component:** `typescript/agents/a2ui_agent/package.json`.

**Severity:** two different APIs shared one version number: anything that checks the version
to decide what the SDK offers, such as an instrumentation's version floor, cannot tell them
apart. Seen between npm's `@a2ui/agent` 0.0.2 (2026-10-24) and upstream main `825beac28`
(2026-10-30); settled by the 0.1.0 release of 2026-11-02, `4fdc4c632`.

### Issue

The package's `version` is bumped only in the release commit, so main between two releases
states the last release's number while it carries the code after it. At `825beac28`,
`package.json` said `0.0.2`, as npm's 0.0.2 does, but npm's 0.0.2 exports no
`ExpressResponseStream`, `StreamedAnswer` or `DEFAULT_EXPRESS_PROGRESSIVE_KEYS`, its
`RendererState` has no `markChecked`, and its `DirectJsonParser.openStream` takes no
`afterRejectedBlock`, all of which main at `825beac28` has. The Python packages avoid this
with `hatch-vcs`, which gives a build of main a `.dev` version above the last release.

### Reproduction

```
npm pack @a2ui/agent@0.0.2 && tar xzf a2ui-agent-0.0.2.tgz
grep -c markChecked package/src/utils/renderer-state.js     # 0
git show 825beac28:typescript/agents/a2ui_agent/package.json | grep '"version"'   # 0.0.2
git grep -c markChecked 825beac28 -- typescript/agents/a2ui_agent/src/utils/renderer-state.ts
```

### Fix

Bump main to the next prerelease right after a release, such as `0.2.0-dev.0`, so a build of
main never states a released number.

## 40. `@a2ui/agent`'s exports map hides its `package.json`

**Component:** `typescript/agents/a2ui_agent/package.json`, `exports`.

**Severity:** a tool that reports or checks the installed SDK's version, such as an
instrumentation or a bug report template, cannot read it the usual way. Seen at upstream's
release of 2026-11-02, `9e8a9bac5`.

### Issue

`exports` names only `.`, so `require.resolve('@a2ui/agent/package.json')` and
`import('@a2ui/agent/package.json', {with: {type: 'json'}})` fail with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and the SDK exports no version of its own. A tool has to
resolve the entry file and walk up the directories to the `package.json` that names the
package.

### Reproduction

```
npm install @a2ui/agent@0.1.0
node -e "require.resolve('@a2ui/agent/package.json')"   # ERR_PACKAGE_PATH_NOT_EXPORTED
```

### Fix

Add `"./package.json": "./package.json"` to `exports`, as many packages with an exports map
do, or export the version as a constant.

## 41. A stream's `ErrorPart` does not say which block it rejected

**Component:** `typescript/agents/a2ui_agent/src/parser/response-part.ts` (`ErrorPart`);
`src/inference-formats/direct-json/response-stream.ts` (`emitReady`, `raisesWhileArriving`,
`applyAddedComponents`); `src/inference-formats/express/response-stream.ts` (`finishBlock`,
`compileStep`).

**Severity:** a tool that shows where a streamed response went wrong, such as a dev tool
marking the rejected block in the model's text, has to work out the block from what it can
count. Seen at upstream's release of 2026-11-02, `9e8a9bac5`.

### Issue

A whole response goes through public names a caller can watch: `Parser.parseResponse` hands
each block to `compile`, applies its messages with `RendererState.apply`, and checks the trees
with `RendererState.checkTopology`. A stream rejects blocks outside them:

- The Direct JSON stream checks each message as it arrives, applying it to the state and
  checking what a growing `updateComponents` or `updateDataModel` gained with its own checks
  (`applyAddedComponents`, `checkGained`). A v1.0 `updateComponents` it rejects is reported at
  once (`raisesWhileArriving`), before the block closes.
- The Express stream compiles the first block of a response through `ExpressParser.compile`,
  and every later block through its scope session (`ExpressScopeSession.compileStep`).

The `ErrorPart` a stream returns, and the error it throws, name no block. Direct JSON's errors
carry no `rawContent`; an Express error carries as `rawContent` the text it compiled, which for
a block rejected while it arrives is only the statements read so far. A tool can place the
error only by counting the blocks the stream finished and rejected before it, and finds a
block rejected while it arrives cut where the input then ended.

### Reproduction

Open a Direct JSON stream with `afterRejectedBlock: 'continue'` on the basic catalog at v1.0,
and feed a chunk that ends inside a block whose `updateComponents` repeats a component id:
`feed` returns `{type: 'error', error}` with an `A2uiIntegrityError` and no position. For
Express, feed a chunk that ends after a statement naming an unknown component and before the
block's close tag: the error's `rawContent` ends at that statement.

### Fix

Give the `ErrorPart`, and the error a stream throws, the rejected block's index among the
response's blocks and its range in the text fed, as the stream knows them when it rejects the
block.

## 42. The duplicate-id error carries the id as a plain string in `details`

**Component:** `typescript/core/web_core/src/processing/message-processor.ts:1423`;
`typescript/agents/a2ui_agent/src/inference-formats/direct-json/response-stream.ts:533`.

**Severity:** a tool that reads an error's structured details, as Spectra records them, gets a
different shape for this one error than for every other validation error, and than Python's
SDK gives for the same error. Seen at upstream's release of 2026-11-02, `9e8a9bac5`.

### Issue

`A2uiValidationError` and its subclasses carry `details`, which elsewhere are objects with
`path`, `code` and `message`, as Zod's issues and the SDK's own checks give them. The
duplicate-id `A2uiIntegrityError` passes `[comp.id]`, the repeated id as a string, with the
path in its context instead. Python's core raises the same error with a structured detail,
`{path, code: 'duplicate_id', message, surfaceId}`
(`python/a2ui_core/src/a2ui/core/state/surface_components_model.py:224`).

### Reproduction

Apply an `updateComponents` whose components repeat an id to a `RendererState` from
`@a2ui/agent` 0.1.0: the error's `details` is `['title']`. The same message through
`a2ui-agent-sdk` 0.10.0 gives
`[{'path': 'components.title', 'code': 'duplicate_id', ...}]`.

### Fix

Pass a structured detail, `{path: '/components/<i>/id', code: 'duplicate_id', message,
surfaceId}`, in both places.

## 43. A streamed `updateDataModel` whose `value` comes before its `path` replaces the whole data model

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/direct_json/response_stream.py`
(`_may_grow`); `dart/a2ui_agent/lib/src/inference_formats/direct_json/response_stream.dart`
(`_mayGrow`); `typescript/agents/a2ui_agent/src/inference-formats/direct-json/response-stream.ts`
(`emitReady` on main, `mayGrow` with PR #3930).

**Severity:** a reply that writes `value` before `path` replaces the surface's whole data model
while it streams. With a list `value` its block is then rejected; with an object `value` nothing
raises, and the turn ends with the value's keys at the root, the value again at `path`, and the
data model's other keys gone. Reproduced without a model; no model is recorded writing `value`
first, and the message schema in the Direct JSON prompt lists `path` before `value`.

**Upstream:** issue #4132.

Checked at `862af8214` (2026-11-10), not at the commit above: run in the Python SDK and in the
TypeScript SDK, on main and on PR #3930's head `776d7d24c`, at v0.9 and v1.0. Dart's `_mayGrow`
reads the same, not run. v0.8 and v0.9.1 not run.

### Issue

A stream emits a growing `updateDataModel` once its `value` has begun to arrive; on main the
TypeScript stream emits every open `updateDataModel`, and PR #3930 narrows that to one holding
`value`. None waits for `path`. An `updateDataModel` with no `path` refers to the whole data
model: "If `path` is omitted (or is `/`), the entire data model for the surface is replaced"
(`specification/v0_9/docs/a2ui_protocol.md:539`, `specification/v1_0/docs/a2ui_protocol.md:1043`).
JSON gives key order no meaning, so when a model writes `value` before `path`, the stream cannot
tell a message whose `path` is still to come from one with no `path`. It emits
`{"surfaceId":"s","value":["c","d"]}`, which replaces the whole data model with the list. When
the `path` arrives, the stream applies the full message
`{"surfaceId":"s","value":["c","d"],"path":"/items"}` on top of that, and it fails on the list:
`Cannot use non-numeric segment 'items' on an array in path '/items'.` With an object value the
full message is accepted: `{"surfaceId":"s","value":{"n":1},"path":"/items"}` leaves
`{"n":1,"items":{"n":1}}`.

Streaming a root update with no `path` is intended. Five cases in
`conformance/agent/direct_json/response_streaming.yaml` expect one to be emitted while it
arrives: `test_chunk_progressive_key_heals_a_partial_string`,
`test_chunk_data_model_grows_across_chunks`, `test_stream_data_model_grows_v09`,
`test_stream_data_model_cut_key_and_value_v09` and
`test_stream_data_model_keeps_earlier_entries_v09`. Holding every `updateDataModel` with no
`path` until it closes fails those five in the Python SDK, and three unit tests under
`python/a2ui_agent/tests/parser/`; not tried in TypeScript or Dart.

### Reproduction

Into a surface holding `{"items":["a","b"],"other":1}`, stream
`{"version":"1.0","updateDataModel":{"surfaceId":"s","value":["c","d"],"path":"/items"}}`
cut after `"value":["c","d"],`. The first chunk emits `{"surfaceId":"s","value":["c","d"]}`
and leaves a data model of `["c","d"]`; the second raises `A2uiValidationError` with the
message above. With `"value":{"n":1}` the first chunk emits `{"surfaceId":"s","value":{"n":1}}`,
the second emits the full message, and the data model ends as `{"n":1,"items":{"n":1}}`, where
one chunk leaves `{"items":{"n":1},"other":1}`. With `path` written first, two chunks leave
what one chunk leaves. The same holds at v0.9. Issue #4132 holds the script.

### Fix

Needs a decision upstream. One way: have the Direct JSON prompt ask for `path` on every
`updateDataModel`, `"/"` for the root, written before `value`, and hold a message with no
`path` until it closes; a root update written with `"path": "/"` still streams, and the five
conformance cases above gain a `path`.

Issue #4132 proposes this and asks whether a root update may stream only when it writes
`"path": "/"` first. No PR is open. The stream's half, one more condition in Python's
`_may_grow`, left the one-chunk data model in every case of the reproduction.

### Prior art

Issue #2936 (closed 2026-11-02) was the same symptom in Python's earlier stream parser: partial
`updateDataModel` messages sent without their `path`, which replaced the whole data model. It
was closed as fixed by #3074, which keeps the `path` on partial updates; the stream keeps it
only when `path` comes before `value`. Findings 18 and 19 (issue #3929, PR #3930) are the
opposite order in the TypeScript stream.

## 44. `@a2ui/markdown-it` 0.2.2 asks for web core 0.14 beside the renderers that bring 0.15

**Component:** `typescript/renderers/markdown-it/package.json`, `peerDependencies`; the npm
releases of 2026-11-02.

**Severity:** every install of the React, Lit or Angular renderer of that release meets a peer
range it cannot satisfy. Seen at upstream's release of 2026-11-02, `9e8a9bac5`.

### Issue

`@a2ui/markdown-it` 0.2.2, published on 2026-10-17, declares the peer `@a2ui/web_core`
`^0.14.0`. The releases of 2026-11-02 publish `@a2ui/web_core` 0.15.0, `@a2ui/react` 0.15.0
and `@a2ui/angular` 0.14.0, which depend on `@a2ui/web_core` `^0.15.0` and on
`@a2ui/markdown-it` `^0.2.2` (Angular as a peer), and `@a2ui/lit` 0.15.0, which depends on
web core `^0.15.0` and takes `@a2ui/markdown-it` `^0.2.2` as a peer. No `@a2ui/markdown-it`
release came with them, and a caret range on a 0.x version excludes the next minor, so
`^0.14.0` does not admit 0.15.0. At `9e8a9bac5` the package's `peerDependencies` names
`"workspace:*"`, which the publish writes as the web core version of the day.

### Reproduction

In a Yarn 4 workspace that depends on `@a2ui/react` 0.15.0 and `@a2ui/web_core` 0.15.0,
`yarn install` warns:

```
YN0060: @a2ui/web_core is listed by your project with version 0.15.0, which doesn't satisfy what @a2ui/markdown-it and other dependencies request (but they have non-overlapping ranges!).
```

### Fix

Publish `@a2ui/markdown-it` with each web core release, or declare a range that spans the
web core versions it works with.

## 45. Lit's `<a2ui-surface>` builds two `NodeResolver`s on first mount when `surface` is set before it attaches

**Component:** `typescript/renderers/lit/src/surface/a2ui-surface.ts` (`connectedCallback`,
`willUpdate`, `subscribeToRoot`).

**Severity:** a Lit host that mounts a surface the usual way gets every resolver report twice
and evaluates the surface's bindings twice. The conformance suite does not see it, because its
harness mounts in the other order.

Checked at `7791823d0` (2026-11-06), with `@a2ui/web_core` and `@a2ui/lit` 0.15.0 built from
it. Not reported upstream: no issue or open PR found for this, and none touching the file.

### Issue

`connectedCallback` calls `subscribeToRoot()` when `surface` is set and nothing is subscribed
yet (lines 88-93). `willUpdate` calls it again when `surface` is among the changed properties
(lines 79-83). A `surface` set before the element attaches meets both on first mount: the
property is set, the element attaches and `connectedCallback` subscribes, then the first update
reports `surface` as changed and `willUpdate` subscribes again. Each `subscribeToRoot()` disposes
the previous resolver and builds a new `NodeResolver` (line 123).

`NodeResolver` keeps its record of dispatched errors per instance
(`typescript/core/web_core/src/resolution/node-resolver.ts`, `dispatchedErrors`), so the second
resolver reports everything again, and it binds every component again.

Lit's template binding is that order: it sets `.surface=${surface}` before it inserts the
element. `samples/client/lit/shell/app.ts` (line 807) and
`samples/community/mcp/a2ui-kanban/client/src/app.ts` (line 705) mount it this way. The Lit
adapter harness (`typescript/renderers/lit/src/tests/adapter_harness.ts`) and
`src/tests/a2ui-surface.test.ts` attach first and set `surface` afterwards, so the adapter
conformance suite, which expects these reports on `surface.onError`, never mounts in the order
that doubles them.

A host cannot tell these duplicates from separate failures, because their payloads are identical
(finding 28).

### Reproduction

A v0.9 surface with a `Text` bound to a counting local function and a `Column` template over 3
items whose component has a type the catalog does not define, mounted three ways, counting
`surface.onError` reports and calls of the function:

```
template .surface=${surface}: reports=6 (3 template instances), function calls=4
surface set, then attached: reports=6 (3 template instances), function calls=4
attached, then surface set (the harness order): reports=3 (3 template instances), function calls=2
```

The React and Angular surfaces gave one report per failure in finding 28's reproduction. The
function's 2 calls under one resolver are a separate matter, not chased here. A function that
calls the agent was not tried.

### Fix

Skip `subscribeToRoot()` when already subscribed to the same surface. A temporary guard at the
top of it, comparing `this.surface` to the surface last subscribed while `this.unsubscribe` is
set, gave 3 reports and 2 calls in all three orders, and `@a2ui/lit`'s `node --test` stayed at
126 passed and 3 skipped. A regression test needs to mount with `surface` set before attaching.

## 46. The Python restaurant finder abandons ADK's run generator when its stream fails, and ADK's span fails to detach

**Component:** `samples/agent/adk/restaurant_finder/agent.py`, with `google-adk` 2.3.0's
`Runner.run_async`.

**Severity:** an error traceback logged on every retried turn, and ADK's `invocation` span left
attached past its turn. No turn failed for it. Seen at upstream `9e8a9bac5`.

### Issue

`token_stream` iterates `runner.run_async(...)` (`agent.py:286-302`), and the sample feeds it to
`stream_response_to_parts` (`agent.py:307-308`). When the stream rejects a block, as on finding
31's `Surface default already exists.`, the `ValueError` leaves `stream_response_to_parts`, and
`token_stream` and ADK's generator under it are left suspended at a `yield`, neither closed. ADK
holds its `invocation` span current across that `yield`: `_run_with_trace` runs inside
`with tracer.start_as_current_span('invocation')` (`google/adk/runners.py:1045`), and
`_run_node_async` yields each event from inside it (`runners.py:572`). The abandoned generator is
closed later, outside the task that opened it: ADK logs `Root node restaurant_agent was
cancelled.`, the `GeneratorExit` arrives at `runners.py:572`, and OpenTelemetry's context detach
raises `ValueError: <Token var=<ContextVar name='current_context' …>> was created in a different
Context`, logged by `opentelemetry.context` as `Failed to detach context`.

### Reproduction

Run the sample with a Gemini key, with or without `opentelemetry-instrument`, and send "Top 3
Chinese restaurants in New York" over `message/stream`. After `A2UI stream failed: Surface default
already exists. (Attempt 1)` and `Retrying... (1/2)`, the log holds `Root node restaurant_agent
was cancelled.` and the traceback above. Seen on every retried turn of the Phase 7 acceptance run,
under `attach` with nothing set in the agent's shell, trace `dada348a9de3c3e051938a1b8c98bf18`,
and under `run`; the custom-components example logs the same traceback after its own retries,
with `Root node contact_agent was cancelled.`

### Fix

Close the generator where it is abandoned, in the task that opened it: iterate `token_stream()`
under `contextlib.aclosing` in `agent.py`, so the `ValueError` path closes ADK's generator in
place. Not tried.
