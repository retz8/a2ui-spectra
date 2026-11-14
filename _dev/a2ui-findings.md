# A2UI upstream findings

Issues found in A2UI's specifications and their reference implementations while
building Spectra, recorded for upstream contribution (`a2ui-project/a2ui`). Each
finding is self-contained and reproducible against upstream artifacts only.

---

Each finding was found at `a2ui-project/a2ui`
`020a9d6f694761ad16b35bc38945e4ccd0ac14e8` (2026-10-23) unless it names its own
commit, and its text, paths and line numbers are as found there. Its
**Standing** line is as read at the pin [`upstream-pin.json`](upstream-pin.json)
names: it holds; it is fixed upstream, with the commit and the pull request; or
it is changed, with what differs now, line numbers at the pin. A **Held by**
line says what Spectra carries because of the finding, and where; the pin file
lists those findings with their upstream paths. Paths are relative to that repo
unless noted. "The extension specs" are the three A2A extension specifications:

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

**Standing:** changed: the issue holds, and new helpers do the same. Run in the
worktree, `a2ui-a2a`'s `extract_a2ui_json_to_parts` (PR #3790,
`parts.py:285-296`) and `create_a2ui_parts` (PR #3795, `parts.py:147-186`) give
one part per message; `parse_content_to_parts` (`parts.py:216-256`) goes through
`to_a2a_parts`, one part per message at `parts.py:210-212`. The ADK extension's
converter is at `part_converter.py:116`; the TypeScript sample and the three
clients are unchanged.

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

**Standing:** changed: the issue holds; with no version argument
`create_a2ui_part` now takes the message's own `version`, and run in the
worktree a v0.9 message still gets `application/json+a2ui`. The constants are at
`parts.py:45-47` and the choice at `parts.py:77-81`.

**Held by:** `tools/spectra/src/a2a/parts.ts:7-12` accepts
`application/json+a2ui` as the spelling upstream's Python A2A extension writes;
`parts.test.ts:64-69`, the ADK-shaped v0.9 parts in `turn.test.ts` and the fake
agent in `testing/fake_agent.ts` rely on it.

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

**Standing:** fixed by `fa8346d92` (PR #3299), merged 2026-10-27:
`A2uiPartConverter` takes no version and labels each part with its message's
version (`part_converter.py:60-61` and `:116`). Run in the worktree, v0.9.1 and
v1.0 parts get `application/a2ui+json`; a v0.9 part gets the deprecated type of
finding 2.

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

**Standing:** holds. Neither file has changed: the Lit client sets `mimeType` on
the part at `client.ts:71`, `:85` and `:93`, the React middleware at
`middleware/a2a.ts:104`. PR #3602 and issue #3601 are open.

**Held by:** `tools/spectra/src/a2a/parts.ts:18-23`, `:47` and `:109` read the
MIME type from the part itself under A2A 0.3, tested in `parts.test.ts:85-90`,
"as the Lit sample client sends it".

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

**Standing:** holds. `agent_executor.py` has not changed: lines 81-94 still read
the capabilities from inside the data part. PR #3272 is open.

**Held by:** `tools/spectra/src/check/checks.test.ts:143-144` expects the
custom-components recording's `action-modal` surface to have no catalog
definition, citing this finding.

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

**Standing:** fixed by `0e3ee8402` (PR #3603), merged 2026-11-03: the three
extension specs give `DataPart.metadata["mimeType"]` in prose and examples alike
(v0.9 and v0.9.1 lines 51, 56 and 176; v1.0 lines 51, 56 and 181).

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

**Standing:** changed: fixed for v1.0 by `a641e84f2` (PR #3799), whose spec now
says `message.metadata` (lines 110, 114 and 148); the v0.9 and v0.9.1 specs
still say `sendMessageRequest.message[…]` at lines 115 and 143.

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

**Standing:** fixed by `2d5b0bb07` (PR #3600), merged 2026-11-03: validated
against each version's `server_to_client_list.json` and basic catalog, the v0.9
and v0.9.1 examples pass, the component now `{"id": "root", "component": "Text",
"text": "Hello!"}` (lines 209-213).

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

**Standing:** holds. No spec names the chosen version in a reply, v1.0's new
"Capability scoping" section (line 144) included; `extension.py:162-179` and the
TypeScript sample's `pick-a2ui.ts` are unchanged.

**Held by:** `tools/spectra/src/a2a/turn.ts:150-161` and `:207-208` take a
turn's version from the reply's extensions header when it names exactly one A2UI
version, else from the one version the host offered.

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

**Standing:** holds. The three specs still name only `X-A2A-Extensions` (lines
64, 71, 89 and 96) and A2A 0.3's part shape (v0.9 lines 218-221; v1.0 lines
223-226 and 252-255). The A2A specification and the outside agents were not read
again, but for AG2: `ag2` 1.3.1 sets both `mediaType` and `metadata.mimeType`, as
the recording `ag2/stream_v1_0_function_call` of sub-task 9.6 holds.

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

**Standing:** changed: the issue holds, at v0.9 and v0.9.1 line 178 and v1.0
line 183; run again, `a2a-sdk` 0.3.25's `DataPart` rejects the array. The
concepts note quoted above is gone with `docs/public/`, removed by `58379ad4c`
(PR #4213).

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

**Standing:** changed: the issue holds; only the v0.9 spec's lines moved, to
line 227 and the example at 229-252. The clients, the agents and web core's v0.8
`userAction` are unchanged.

**Held by:** Spectra reads v0.8's `userAction` in v0.9 traffic:
`tools/spectra/src/listing.ts:123-134`,
`tools/spectra_viewer/src/model/input_brief.ts:32-43` and `steps.ts:525-539`,
tested in `listing.test.ts:117-125` and `input_brief.test.ts:47-55`.

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

**Standing:** fixed by `4e5c6b244` (PR #3763), before the previous pin:
`samples/agent/adk/custom-components-example/agent.py:264-268` wraps the prompt
in `A2uiInstruction`, so ADK leaves its `{name}` templates alone; run in the
worktree on a session holding only `base_url`, ADK's instruction processing
succeeds with `${expression}` kept. The restaurant finder's `"expression"`
seeding is gone too.

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

**Standing:** changed: the cause holds, `token_stream` passing every event's
text without checking `event.partial` (`agent.py:286-303`), but the second
`createSurface` no longer reaches the wire: since `ff188f8d8` (PR #3701) the
sample reads through the SDK's stream, which rejects the aggregated copy, and
the sample retries, which is finding 31. Run at the SDK level, a reply fed as
partial chunks and then whole gives "Surface default already exists." PR #3272
is open.

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

**Standing:** holds. Every v0.9.1 schema but `client_to_server.json` still
declares a `v0_9` `$id` (e.g.
`specification/v0_9_1/json/server_to_client.json:3`); run with Ajv 8.18, adding
both versions' `server_to_client.json` throws, and v0.9.1's list rejects a
`"version":"v0.9.1"` message. Issue #3974 and PR #3975 are open.

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

**Standing:** holds. `client_to_server.json` declares no `$id` in v0.9 or
v0.9.1, and both lists reference it relatively at line 8; run at the pin,
compiling either list fails with "can't resolve reference
client_to_server.json". Upstream's own workaround is at
`conformance/tests/test_conformance_yaml.py:53`.

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

**Standing:** holds. `samples/agent/node/restaurant_finder/src/model.ts` is
unchanged, reading the notice at line 117 and putting it before every example at
line 123; run at v1.0 without starting the agent, both turns of the built
`StubBackend` begin with `createSurface` of `stub-notice`, and web core rejects
the second.

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

**Standing:** holds. `emitReady` (`direct-json/response-stream.ts:357`) still
emits at line 399 an open `updateDataModel` without its `value`; the doc comment
is at lines 110-111 and the reader's heal points at `json-reader.ts:334` and
`:379`. Run at the pin, at v1.0 and v0.9, the first chunk emits
`updateDataModel` with only `path`. Issue #3929 and PR #3930 are open.

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

**Standing:** holds.
`typescript/core/web_core/src/v1_0/schema/agent-to-renderer.ts:105-109` keeps
`'value': z.any()` with no refinement, and the agent SDK's `renderer-state.ts`
call is at `src/utils/renderer-state.ts:1059`; run at the pin, the schema
accepts an `updateDataModel` with only `path`, and the processor leaves the data
model `{}`.

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

**Standing:** fixed by `ff188f8d8` (PR #3701): no sample imports
`parse_response_to_parts` or calls `create_parser`, the streaming samples
passing `processor.open_stream()` to `stream_response_to_parts`; upstream's
`samples/agent/adk/tests/test_agents_stream.py` passes in the worktree, and the
three Gemini Enterprise samples import cleanly. PRs #3272 and #3273 are open.

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

**Standing:** changed: #3269's entries still sit under `## 0.1.0 (2026-10-17)`
(`python/a2ui_a2a/CHANGELOG.md:34`, the breaking items at lines 46-62), but the
release that carries #3269 is now 0.2.0, tagged at `9e8a9bac5`, whose section
(lines 25-33) does not list them; `## Unreleased` holds #4013's entry. The fix
is now to move them under 0.2.0.

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

**Standing:** fixed in AG2 by `cdc37c184` (ag2ai/ag2 PR #3469), first released
in ag2 1.2.2 (2026-10-27); the latest, 1.3.1 (2026-11-10), prompts for
`callRendererFunction` with `@call`, reads the reply as
`rendererFunctionResponse`, and validates an agent's call only on a function
its catalog declares `agentOnly` or `rendererOrAgent`
(`ag2/a2ui/schema_manager.py`, `_callable_by`). Spectra's recording
`ag2/stream_v1_0_function_call` is on ag2 1.3.1 through
`_dev/tools/ag2_a2ui_server.py`, its call on the `agentOnly` function of
`_dev/tools/ag2_agent_function_catalog_v1_0.json`.

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

**Standing:** changed: the issue holds; the locations moved: the executor at
`samples/community/agent/adk/file_upload_summarizer/agent_executor.py:47-50`,
now with a processor, `tools.py:27-93`, the part converter's tool-response path
at `python/a2ui_adk/src/a2ui/adk/a2a/part_converter.py:92-115`, web core's
rejection at `message-processor.ts:1173`; the workspace still locks `google-adk`
2.3.0 and `a2a-sdk` 0.3.25. Judged by reading.

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

**Standing:** changed: `specification/v1_0/json/catalog_definition.json:31`
still requires both unions, now beside leaf definitions allowed in `$defs`
(lines 32-34, `4767c140e`, PR #2724). Run at the pin,
`composition_catalog_v1_0.json` still fails for want of `anyFunction`;
`agent_functions_catalog_v1_0.json` fails only for want of `anyComponent`, its
`allowedCallers` fixed by `a4c963a0a` (PR #3671); the four `peer_matching/`
catalogs are gone (`c824c5b89`, PR #3575); `derive_source_catalog_v1_0.json` (PR
#3688) is a new failing one; `catalogs/basic/v1/catalog.json` passes.

**Held by:** the copied
`conformance/test_data/catalogs/composition_catalog_v1_0.json` gains
`$defs.anyFunction` as `{"not": {}}`, the pin file's merge patch for this
finding.

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

**Standing:** holds: `a2ui_examples.py:142-146` still builds the v0.9 `WebFrame`
with `html` and no `url`, and `inline_catalog_0.9.json:838-875` still requires
`url` (line 873); run at the pin, web core and a JSON Schema validator both
reject it. The sentence above that `examples/0.9/floor_plan.json` holds the same
shape does not hold, at `409ded29` or at the pin: that file writes `url` and
passes both.

**Held by:** the fixture
`conformance/test_data/turn_record/v0_1/full_record_custom_components.json`
expects the catalog finding "must have required property 'url'" on
`location-surface` and `ROOT_MISSING`, written by
`_dev/tools/make_fixtures.py:1093-1104` from a floor plan copied there by hand
and asserted by `tools/spectra/src/check/checks.test.ts:53-80`.

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

**Standing:** changed: the issue holds, and the function named above is gone:
`validateComponent` is at `payload-validator.ts:212`, and below v1.0
`stripStructuralKeys` (line 745) drops `id` and `component` and
`validateLegacyAccessibility` (line 343) strips `accessibility`; since
`48f9c557e` (PR #4140) and `8c3bd4073` (PR #4037) `metadata` is checked as a
property. Run at the pin, the v0.9 schema rejects the note's `id` as unevaluated
and web core accepts it.

**Held by:** `tools/spectra/src/check/checks.test.ts:132-136` expects 16
`VALIDATION_FAILED` findings on
`a2uiverse_circleci/runs_then_confirm_rerun.json`, each component's `id`
unevaluated by the v0.9 schema;
`tools/spectra/src/check/catalog_check.ts:235-258` validates a v0.9 component
against its catalog branch alone.

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

**Standing:** holds. Nothing in `typescript/renderers/react/src/` catches a
component's failure, and `A2uiLitElement.update` (now
`a2ui-lit-element.ts:527-532`) has no catch; run under jsdom at the pin, a basic
catalog component that throws reaches `surface.onError` with nothing. Issue
#3993 and PR #4016 are open.

**Held by:** the React preview adapter's `ComponentBoundary` and `guardCatalog`
(`typescript/preview/react/src/boundaries.tsx:29-86`, applied in
`SpectraPreview.tsx`); the preview core's `performUpdate` guard
(`typescript/preview/core/src/guard.ts:27-50`, applied by
`guardUniversalElements` in `web_core.ts:107-116`) and its window listeners
(`window.ts:50-63`).

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

**Standing:** holds; the lines moved: `dispatchOnce` is at
`node-resolver.ts:150-166`, dispatching `{code, message}` at line 165, React's
`UNRESOLVED_CHILD_REFERENCE` at `node-view.tsx:132`, `A2uiErrorPayload`
unchanged at `surface-model.ts:77-91`. Run at the pin for v0.9 and v1.0, an
unknown type and a cycle are reported with the component only in the message. PR
#4019 and issue #4018 are open.

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

**Standing:** holds. The three clients are unchanged and send capabilities only
(`samples/client/react/shell/middleware/a2a.ts:127`,
`samples/client/lit/shell/client.ts:102`,
`samples/client/angular/projects/restaurant/src/server.ts:125`);
`getRendererDataModel` is at `message-processor.ts:500`. Judged by reading.

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

**Standing:** holds. Lit's try/catch in `a2ui-surface.ts:147-152` wraps only
`renderA2uiNode(root)`; run under jsdom at the pin, a basic catalog component
that throws reaches `onError` with nothing and keeps its old content. Angular's
`component-host.component.ts` still mounts through `*ngComponentOutlet` (line
154) with no catch, judged by reading.

**Held by:** the Lit preview adapter's `guardUniversalElements`
(`typescript/preview/lit/src/spectra_preview.ts:97`); the Angular preview
adapter's `wrapErrorHandler`
(`typescript/preview/angular/src/spectra_preview.component.ts:59-78`, installed
at `:110`) and its `guardUniversalElements` (`:129`); the preview core's guard
and window listeners, as in finding 27.

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

**Standing:** holds. `samples/agent/adk/restaurant_finder/` is unchanged; the
core's message is now at `message_processor.py:778-780`. Run at the SDK level,
`stream_response_to_parts` fed a v0.9 reply in chunks and then whole raises
`A2uiIntegrityError` "Surface default already exists.", a `ValueError`, which
takes the sample's retry; the whole sample is judged by reading.

**Held by:** the viewer test "ties a stream fed its call's reply twice to that
call" (`tools/spectra_viewer/src/model/a2ui_step.test.ts:239-240`) and the
wrapper capture case `surface_already_exists`
(`conformance/wrapper_capture/capture_v0_1.yaml`), both recorded from this
retry.

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

**Standing:** holds. The sample is unchanged: `_build_generator` holds only
`BasicCatalog` (`agent.py:174-180`) while its examples and
`a2ui_examples.py:134` and `:194` name `inline_catalog`; the core's message is
now at `message_processor.py:768-771`. Run at the SDK level,
`multi_surface.json` fails with "Catalog not found: inline_catalog". The
sentence above that a host sending no capabilities sees none of this does not
hold at the pin: the sample maps no capabilities to the basic catalog alone
(`agent.py:82-83`), and the reply fails the same way.

**Held by:** the wrapper capture case `tool_call_catalog_not_found`
(`conformance/wrapper_capture/capture_v0_1.yaml`),
`python/a2ui_spectra_instrumentation/tests/test_events.py`'s toolset cases and
`tools/spectra_viewer/src/model/problems.test.ts:274-280` expect the
`inline_catalog` rejection, recorded from this sample.

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

**Standing:** changed: the Express prompt difference is fixed by `f7b795e45` (PR
#3567), both SDKs' Express prompts on the basic catalog at v1.0 byte-identical;
the other differences hold, run at the pin: the malformed block's class, the
dangling child's and the unknown component's wording, Express's unknown function
as a different error class, and the mixed-version catalogs refused at different
points.

**Held by:** the wrapper capture suite keeps a record per language for
`direct_json_malformed_block`, `dangling_child`,
`direct_json_unknown_component`, `express_unknown_component`, `express_generate`
and `express_generate_two_catalogs`, and runs `generate_failed` in TypeScript
only; the Python records of `express_generate` and
`express_generate_two_catalogs` hold the Express header the pin no longer
writes.

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

**Standing:** fixed by `9e8a9bac5` (PR #3810), the previous pin: its agent SDK
required `a2ui-core>=0.5.0,<0.6.0` with `python/a2ui-core/v0.5.0` tagged there,
and at the pin `python/a2ui_agent/pyproject.toml:25` requires `>=0.6.0,<0.7.0`
with v0.6.0 tagged; in the worktree, `uv pip check` reports no a2ui conflict.

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

**Standing:** holds. `run_async` (`send_a2ui_to_client_toolset.py:443-478`)
returns and logs without the call id, and PR #3795's `_resolve_processor` (line
454) does not read it; run at the pin with `function_call_id` set, no result or
log record holds it.

**Held by:** the Python wrapper reads `tool_context.function_call_id` itself in
its `run_async` hook (`hooks.py:537-539`) and writes it as `gen_ai.tool.call.id`
(`events.py:559-560`).

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

**Standing:** holds. `InferenceFormat`
(`python/a2ui_agent/src/a2ui/inference_format.py:32`) has `prompt_generator`,
`create_parser()` and `supports_streaming` and no name; run in the worktree, a
processor's `ExpressFormat`, its parser and its generator carry none.
TypeScript's `InferenceFormat`
(`typescript/agents/a2ui_agent/src/inference-format.ts:24-31`) has none either.

**Held by:** both wrappers name the formats themselves: the Python wrapper's
hook table tags each parser hook (`hooks.py:61-92`), its table of the four
formats' prompt generator classes names each (`hooks.py:94-113`), and it maps
instances by class (`state.py:23-34`, used by the `generate` hook at
`hooks.py:416-449` and by `_adopt_processor` at `hooks.py:602-608`). The format
packages no longer export the generator classes (PR #3568), so the wrapper reads
each from the module that defines it, such as
`a2ui.inference_formats.direct_json.prompt_generator`. The TypeScript wrapper's
`FORMAT_CLASSES` (`table.ts:40-46`) and `formatOf` (`instrumentation.ts:50-55`).

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

**Standing:** holds. `agent.py` is unchanged: it streams through
`stream_response_to_parts(processor.open_stream(), …)` at lines 307-309 and
parses the joined reply again with `processor.parse_response` at line 345.
Judged by reading.

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

**Standing:** holds. `RowComponent.justify`
(`python/a2ui_core/src/a2ui/core/basic_catalog/v1_0/components.py:227`) is in
sorted order and `ColumnComponent.justify` (`:271`) in the specification's; run
at the pin's `a2ui-core`, Column's prompt gives Row's order on Python 3.12 and
its own on Python 3.14.

**Held by:** the Python expected records of the six prompt generation cases
under `conformance/test_data/wrapper_capture/v0_1/`, `atom_generate`,
`elemental_generate`, `direct_json_generate`, `express_generate`,
`express_generate_two_catalogs` and `generate_outside_turn`, hold Column's
`justify` in Row's order, as Python 3.12 writes it; `conformance/README.md`
names 3.12.

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

**Standing:** holds, with a new pair of versions:
`typescript/agents/a2ui_agent/package.json` states 0.1.0, npm's latest of
2026-11-02, after eleven commits to its `src/` since the release commit
`4fdc4c632`, among them the `@` envelope keys (PR #4044); npm's 0.1.0 has no
`@catalogId` and no `isAgentFunction`, a build at the pin has both.

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

**Standing:** holds. `exports`
(`typescript/agents/a2ui_agent/package.json:24-29`) names only `"."` and
`src/index.ts` exports no version; run in the worktree,
`require.resolve('@a2ui/agent/package.json')` and the JSON import both fail with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

**Held by:** `typescript/instrumentation/src/check.ts:33-46`, `sdkVersion`,
walks up from the resolved entry file to the `package.json` named `@a2ui/agent`,
called at `check.ts:82`.

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

**Standing:** holds. `ErrorPart` is `{type: 'error'; error: A2uiError}`
(`typescript/agents/a2ui_agent/src/parser/response-part.ts:60-64`), Python's the
same (`python/a2ui_agent/src/a2ui/parser/response_part.py:57-63`); run in the
worktree, a Direct JSON error part carries only `type` and `error`, and
Express's `rawContent` is the statements read so far. Since `b1bf1ac3c` (PR
#3880) a block is rejected while it arrives whenever components are buffered, at
v1.0 or with `bufferIncompleteComponents`.

**Held by:** both wrappers find the block by counting:
`typescript/instrumentation/src/events.ts:307-427` and
`python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/events.py:354-469`;
the record-writer's facts tools feed the text one character at a time,
`_dev/tools/wrapper_capture_facts.py:200` and
`_dev/tools/wrapper_capture_facts.mjs:209`.

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

**Standing:** changed: the issue holds; the lines moved, web core's throw to
`typescript/core/web_core/src/processing/message-processor.ts:1690-1695`, the
SDK stream's to
`typescript/agents/a2ui_agent/src/inference-formats/direct-json/response-stream.ts:536`,
Python's detail to
`python/a2ui_core/src/a2ui/core/state/surface_components_model.py:226-235`. Run
in the worktree, TypeScript gives `details: ['title']`, Python a `duplicate_id`
detail.

**Held by:** `typescript/instrumentation/src/events.ts:80-91`, `errorDetails`,
drops a `details` array whose items are not all objects, naming this error;
`direct_json_open_stream_rejected_while_arriving`'s TypeScript record holds the
error with no details and its Python record the structured detail;
`_dev/tools/wrapper_capture_facts.mjs:105-109` filters the same way.

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

**Standing:** holds, run in the worktree in Python and TypeScript at v1.0; Dart
was not run. The v1.0 protocol sentence is now at
`specification/v1_0/docs/a2ui_protocol.md:1044`. PR #4191, opened 2026-11-12 and
not merged, fixes it in Python, TypeScript and Dart; issue #4132 and PR #3930
are open.

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

**Standing:** holds on npm: `@a2ui/markdown-it` 0.2.2 is still the latest, with
the peer `@a2ui/web_core` `^0.14.0`, beside web core 0.15.0; run in a Yarn
4.13.0 project, `yarn install` gives the `YN0060` warning. At the pin the peer
is still `"workspace:*"`
(`typescript/renderers/markdown-it/package.json:65-67`), which a build at the
pin writes as `^0.15.0`.

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

**Standing:** holds. `typescript/renderers/lit/src/surface/a2ui-surface.ts` is
unchanged (`willUpdate` 79-83, `connectedCallback` 88-93, `new NodeResolver`
123); run under the renderer's jsdom setup, a surface set before it attaches
reports each error twice, one attached first reports it once.

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

**Standing:** holds. `agent.py` is unchanged, `token_stream` iterating
`runner.run_async(…)` at lines 286-302 with no `aclosing`, and
`stream_response_to_parts` (`python/a2ui_a2a/src/a2ui/a2a/parts.py:312-337`)
never closes it; the workspace still locks `google-adk` 2.3.0. Judged by
reading.

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

At the Phase 8 acceptance run the traceback was logged after retried turns of the Python
restaurant finder launched as `uv run .`, eight times across two starts, and after neither of the
two retried turns of the same finder launched under `opentelemetry-instrument`, traces
`16d55d7962a168154874d95f5b10814a` and `6d91ed68bb0fe87bfd59ab25b06e1db4`. Its absence there was
Spectra's own: the A2UI wrapper's stream event kept the `ValueError` it recorded, the error's
traceback kept the frame of `stream_response_to_parts`, and so `token_stream` and ADK's generator
were never closed, neither `Root node restaurant_agent was cancelled.` nor the traceback being
logged. With the wrapper keeping no error past its call, a replay of the recorded retried turn
`52c785da538f422e2c56e4e2e18f472d` logs both lines once under `opentelemetry-instrument`, as it
does under `uv run .`.

### Fix

Close the generator where it is abandoned, in the task that opened it: iterate `token_stream()`
under `contextlib.aclosing` in `agent.py`, so the `ValueError` path closes ADK's generator in
place. Not tried.

## 47. The v0.9.1 basic catalog's List lacks the `listStyle` the v0.9 one regained

**Component:** `specification/v0_9_1/catalogs/basic/catalog.json`;
`specification/v0_9/catalogs/basic/catalog.json`;
`typescript/core/web_core/src/v0_9/basic_catalog/components/basic_components.ts`.

**Severity:** two catalog files of one basic catalog disagree; a v0.9.1 List
with `listStyle` passes web core's v0.9 basic catalog and fails the v0.9.1
catalog file. Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Judged by reading the two files at the pin.

**Held by:** Spectra's catalog registry serves its copy of the v0.9 basic
catalog under the v0.9.1 URL, `tools/spectra/src/catalog/registry.ts`, and so
does the TypeScript wrapper driver's `basic_v0_9.json`; a v0.9.1 List with
`listStyle` passes the catalog check, the case in
`tools/spectra/src/check/catalog_check.test.ts`, "knows the v0.9 basic catalog
under its v0.9.1 URL".

### Issue

`2e8a58a69` (PR #3956) restored List's `listStyle` (`"ordered"`,
`"unordered"`, `"none"`) to `specification/v0_9/catalogs/basic/catalog.json`
(List at line 329, `listStyle` at lines 360-364) and to web core's v0.9 basic
catalog, `basic_components.ts`. `specification/v0_9_1/catalogs/basic/catalog.json`
was left as it was: its List, also at line 329, declares `children`,
`direction` and `align` only, closed by `unevaluatedProperties: false`. The
v0.9.1 protocol doc names the v0.9.1 file's URL for the basic catalog, and
web core has no v0.9.1 basic catalog of its own, so a v0.9.1 renderer on web
core judges List by the v0.9 schema while a validator reading the v0.9.1 file
rejects the same component.

### Reproduction

Validate `{"id": "list", "component": "List", "children": [], "listStyle":
"ordered"}` against `#/components/List` of each file at the pin, under JSON
Schema 2020-12 with Ajv, `strict` off, the v0.9 common types loaded and the
file also bound under `https://a2ui.org/specification/v0_9/catalog.json`, the
URL the common types reference for `anyFunction`: the v0.9 file passes it, the
v0.9.1 file fails it with the unevaluated property `listStyle`.

### Fix

Add `listStyle` to List in `specification/v0_9_1/catalogs/basic/catalog.json`
as PR #3956 added it to the v0.9 file.

## 48. The Python core's `allow_unknown_elements` lets unknown properties through, web core's does not

**Component:** `python/a2ui_core/src/a2ui/core/validation/payload_validator.py`;
`typescript/core/web_core/src/validation/integrity-checker.ts`;
`typescript/core/web_core/src/validation/payload-validator.ts`.

**Severity:** the two cores' relaxed validation disagree on a component with a
property its schema does not declare: an agent checking its output with the
Python core in relaxed mode passes components a web renderer in relaxed mode
refuses. Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run in Spectra's workspace, `a2ui-core` as the uv git
source at the pin.

### Issue

Both cores define `RELAXED_VALIDATION` with the same four flags
(`payload_validator.py:72-77`; `integrity-checker.ts:223-228`), among them
`allow_unknown_elements` / `allowUnknownElements`. Web core documents that flag
as allowing "components and functions that the resolved catalog does not
define" (`integrity-checker.ts:200-209`): with it set, a component's own
properties are still parsed against its schema (`payload-validator.ts:314`),
and a property the schema does not declare is rejected. The Python core also
tolerates unknown properties under it: `_is_unknown_property_error`
(`payload_validator.py:105-117`) says "Those are the errors that
`allow_unknown_elements` tolerates", an `additionalProperties` or
`unevaluatedProperties` error, and the component and function checks drop
those errors when the flag is set (lines 951 and 1517).

### Reproduction

Feed `{"version": "1.0", "createSurface": {"surfaceId": "s", "catalogId":
"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}}`, then an
`updateComponents` of `{"id": "root", "component": "Text", "text": "Hi",
"colour": 1}`, to each core's message processor on its v1.0 basic catalog, in
relaxed mode. Web core rejects it with "Validation failed for component 'Text'
(root): root: Unrecognized key(s) in object: 'colour'"; the Python core
accepts it and stores `colour` as a property. A bare `checks` or an `@checks`
on the Text goes the same way: web core rejects both, the second with
"Component 'Text' (root) is not checkable and does not accept '@checks'.". In
strict mode the Python core rejects all three as additional properties.

### Fix

Give the flag one meaning in both cores: either web core's, unknown components
and functions only, with the Python core's property errors kept under it; or
the Python core's, stated in both cores' documentation of the flag and done in
web core too.

## 49. Web core's v1.0 validation accepts v0.9's `path` and `call`, which its v1.0 resolution reads as literal values

**Component:** `typescript/core/web_core/src/v1_0/schema/common-types.ts`;
`typescript/core/web_core/src/resolution/data-context.ts`.

**Severity:** a v1.0 payload written with v0.9's binding or call keys passes
web core's validation, in strict mode too, and then draws the wrong value: the
literal object in place of the bound one. Found at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against web core built at the pin, Spectra's
`vendor/a2ui/a2ui-web_core-0.15.0.tgz`.

### Issue

Web core's v1.0 `DataBindingSchema` (`common-types.ts:38-46`) takes either
`@path` or `path`, "Either '@path' or 'path' must be provided.", and its
`FunctionCommonSchema` (from line 49) either `@call` or `call`. Its v1.0
resolution takes only the `@` keys: `isDataBindingObject`
(`data-context.ts:541-551`, "In v1.0, data bindings must use `@path`") and
`isFunctionCallObject` (`data-context.ts:556-565`, "In v1.0, function calls
must use `@call`"). The specification agrees with the resolution: the v1.0
common types' `DataBinding` (`specification/v1_0/json/common_types.json`, from
line 104) requires `@path` and allows nothing else, and the v1.0 evolution
guide says plain objects with `"path"` or `"call"` keys "are treated as
literal dictionary values and are no longer intercepted as dynamic directives"
(`specification/v1_0/docs/evolution_guide.md:21`).

### Reproduction

Feed web core's message processor, on its v1.0 basic catalog, in relaxed or
strict mode: `createSurface` for `s`, an `updateComponents` of `{"id": "root",
"component": "TextField", "label": "Name", "value": {"path": "/name"}}` and an
`updateDataModel` of `{"name": "Ada"}`, all `"version": "1.0"`. The processor
accepts them. A `DataContext` on the surface at `/` resolves the TextField's
`value` to `{"path": "/name"}`; with `{"@path": "/name"}` it resolves to
`"Ada"`. Validated against the v1.0 common types and basic catalog, the
`{"path": "/name"}` value fails `DynamicString`.

### Fix

Drop `path` from the v1.0 `DataBindingSchema` and `call` from the v1.0
`FunctionCommonSchema`, so that web core's validation takes the keys its
resolution and the specification take; or, if the unprefixed keys are kept on
purpose for a transition, read them in resolution too and say so in the
evolution guide.

## 50. Web core's `required` refuses an unresolved value instead of failing the check

**Component:** `typescript/core/web_core/src/catalogs/basic/v1/functions/basic_functions_api.ts`;
`typescript/core/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts`;
`typescript/core/web_core/src/resolution/data-context.ts`.

**Severity:** a `required` check on a field whose bound path the data model does
not hold, as on a form drawn before its `updateDataModel` or sent with no initial
value, dispatches an `EXPRESSION_ERROR` on the surface and resolves to no check
result, where it should fail the check. A web renderer reports a render error and
the field shows no check message from it. The Python core fails the check. Found
at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against web core built at the pin, Spectra's
`vendor/a2ui/a2ui-web_core-0.15.0.tgz`, and against the Python core at the pin,
`a2ui-core` as the uv git source.

### Issue

The v1.0 basic catalog's `required` "Checks that the value is not null,
undefined, or empty." (`catalogs/basic/v1/catalog.json:684-704`), and web core's
implementation does so: `validateRequired`
(`typescript/core/web_core/src/common/basic_functions.ts:107-116`) returns
`{valid: false, message: "This field is required."}` for `undefined`. But web
core's argument schema refuses `undefined` before the implementation runs:
`RequiredApi`'s `value` is `z.any().refine(v => v !== undefined, 'Required')`
(`catalogs/basic/v1/functions/basic_functions_api.ts:34-47`, the refine at line
42; the v0.9 `RequiredApi` the same, `v0_9/basic_catalog/functions/basic_functions_api.ts:32-45`).
A binding to a path the data model does not hold resolves to `undefined`, so the
call fails its schema and `dispatchExpressionError`
(`resolution/data-context.ts:1682-1700`) sends "Validation failed for function
'required'" to the surface as an `EXPRESSION_ERROR`, the call resolving to
`undefined`. The Python core resolves the same binding to `None`, with a
`MissingDataBindingWarning`
(`python/a2ui_core/src/a2ui/core/resolution/data_context.py:570-581`), and its
`_required_execute`
(`python/a2ui_core/src/a2ui/core/basic_catalog/v1_0/function_impls.py:82-92`)
returns `{"valid": false}`.

### Reproduction

Feed each core's message processor, on its v1.0 basic catalog: `createSurface`
for `s` on `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`,
then an `updateComponents` of `{"id": "root", "component": "TextField",
"label": "Name", "value": {"@path": "/name"}}`, both `"version": "1.0"`, and no
`updateDataModel`. Resolve `{"@call": "required", "args": {"value": {"@path":
"/name"}}}` in a data context on the surface at `/`. Web core resolves it to
`undefined`, and the surface's `onError` gets `EXPRESSION_ERROR` "Validation
failed for function 'required': [ { "code": "custom", "message": "Required",
"path": [ "value" ] } ]"; with `/name` set to `""` it resolves to `{"valid":
false, "message": "This field is required."}`. The Python core resolves it to
`{"valid": false}` in both cases. In Spectra, the stub agent's v1.0 booking form
drawn on the built-in preview page at its `updateComponents` step, before its
`updateDataModel`, shows the error as a counted problem, in the `@` form and the
bare form alike.

### Fix

Drop the `refine` from `RequiredApi`'s `value` in v0.9 and v1.0, so that an
unresolved value reaches `validateRequired`, which already fails it. The
catalog's `"required": ["value"]` on the call's written arguments stays the
schema's concern.

## 51. Python's and TypeScript's Express compilers number `_inline_N` differently

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/compiler.ts`.

**Severity:** the same Express text compiles to different component ids in the
two agent SDKs, so a renderer, a test or a tool that names a component by id
sees another component under each SDK. Found at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

**Held by:** the viewer's Express reader counts `_inline_N` as the parse's SDK
counts, `tools/spectra_viewer/src/model/readers/express.ts:474` and `:482`, held
by the wrapper capture case `express_inline_numbering`'s two expected records.

### Issue

An inline component written where no property names it, such as a template's
component, takes the id `_inline_N`. Python increments the counter only for
such a component (`compiler.py:2552-2555`, inside the branch with no parent
property); TypeScript increments it for every inline component, those named for
their parent's property included (`compiler.ts:3111-3116`, before the branch).
The compile case suite does not pin the numbering: none of the expected messages
in `conformance/agent/express/compiler.yaml` holds an `_inline_` id after an
inline component named for its slot.

### Reproduction

Compile `root = Card(List(_template($/items, Text($/name))))` on the v1.0 basic
catalog. Python gives `root`, `root_child` and `_inline_1`; TypeScript gives
`root`, `root_child` and `_inline_2`.

### Fix

Count as one SDK counts in both, and pin it with a compile case holding an
`_inline_` id after a slot-named inline component.

## 52. Python's and TypeScript's schema helpers walk a component's sub-schemas in different orders

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/_shared/schema_helper.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/schema-helper.ts`.

**Severity:** a component's positional property order, which names an Express
inline component `<parent>_<property>`, differs between the SDKs for two schema
shapes, so the same text compiles to different ids. No catalog upstream ships has
either shape. Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

**Held by:** the viewer's positional order walks the sub-schemas as the parse's
SDK walks them, `tools/spectra_viewer/src/model/readers/schema.ts:146-165`
(Python's) and `:167-206` (TypeScript's), held by the wrapper capture cases
`express_positional_root_beside_all_of` and
`express_positional_nested_all_of`, each with two expected records, on
`conformance/test_data/catalogs/reader_catalog_v1_0.json`.

### Issue

Python's `_ordered_component_sub_schemas` (`schema_helper.py:166-201`) visits
the schema and every nested `allOf` entry in pre-order and puts every node whose
`properties` declare `component` before the others, the root included among the
others when it has properties. TypeScript's `orderedComponentSubSchemas`
(`schema-helper.ts:423-477`) puts the schema itself first, then the top-level
`allOf` entries that declare `component`, then the other top-level entries, each
expanded depth first with its own nested `allOf`. The two orders differ:

- for a schema with properties of its own beside an `allOf` entry declaring
  `component`: Python reads the entry's properties first, TypeScript the
  schema's;
- for an `allOf` mixin whose own nested `allOf` declares `component`: Python
  reads the nested entry's properties first, TypeScript the mixin's.

### Reproduction

On a catalog with `Shelf: {properties: {head: ComponentId}, allOf: [{properties:
{component: {const: "Shelf"}, body: ComponentId}}]}` and a `Leaf`, compile
`root = Shelf(Leaf("a"))`: Python gives `root_body`, TypeScript `root_head`. With
`Tier: {allOf: [{properties: {lead: ComponentId}, allOf: [{properties:
{component: {const: "Tier"}, main: ComponentId}}]}]}`, `root = Tier(Leaf("a"))`
gives `root_main` in Python and `root_lead` in TypeScript.

### Fix

One order in both helpers, and a compile case on each shape.

## 53. Python's and TypeScript's schema helpers judge a bare envelope key's standard schema differently

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/_shared/schema_helper.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/schema-helper.ts`.

**Severity:** a component property named `metadata`, `accessibility` or `checks`
is taken for the envelope key, and given no positional slot, by one SDK and for a
property of the component's own, with a slot, by the other, so the same Express
text compiles to different ids. Found at the pin `0888f88b2` (2026-11-13); the
`accessibility` and `checks` forms in the read of upstream's commits since
`9e8a9bac5`.

**Standing:** holds. Run against both SDKs at the pin.

**Held by:** the viewer's positional order judges each key as the parse's SDK
judges it, `tools/spectra_viewer/src/model/readers/schema.ts:223-277` (Python's)
and `:232-237` and `:313-332` (TypeScript's), held by the wrapper capture cases
`express_positional_metadata_inline`, `express_positional_accessibility_inline`
and `express_positional_checks_without_type`, each with two expected records, on
`conformance/test_data/catalogs/reader_catalog_v1_0.json`.

### Issue

Each helper drops a bare envelope key from the positional properties when its
schema is the standard one, and the two read "standard" differently:

- `metadata`: Python's is an object schema whose `properties` are exactly
  `extensions` and whose `additionalProperties` is `false`
  (`schema_helper.py:315-322`); TypeScript's has the standard description or an
  `extensions` referring to the common `Extensions` (`schema-helper.ts:72-92`).
- `accessibility`: Python's refers to `AccessibilityAttributes`, or has `label`
  and `description` with `additionalProperties: false` (`schema_helper.py:323-332`);
  TypeScript's refers to the common `AccessibilityAttributes`
  (`schema-helper.ts:94-100`).
- `checks`: Python's refers to `Checkable` or has items referring to a
  `CheckRule` (`_is_standard_checks_schema`, `schema_helper.py:44-56`);
  TypeScript's is an array whose items refer to the common `CheckRule`
  (`isCheckRuleArraySchema`, `schema-helper.ts:497-511`).

### Reproduction

On `reader_catalog_v1_0.json`, each component declaring the key before a
`ComponentId` slot: `root = Frame(Leaf("a"), Leaf("b"))`, Frame's `metadata`
written `{properties: {extensions: {type: object}}, additionalProperties:
false}`, gives `root_child` and `root_footer` in Python, `root_child` and
`root_metadata` in TypeScript; `root = Plate(Leaf("a"))`, Plate's
`accessibility` written `{properties: {label, description},
additionalProperties: false}`, gives `root_child` in Python and
`root_accessibility` in TypeScript; `root = Tally(Leaf("a"))`, Tally's `checks`
written `{items: {$ref: "common_types.json#/$defs/CheckRule"}}`, gives
`root_child` in Python and `root_checks` in TypeScript.

### Fix

One test of each key's standard schema, shared by both helpers.

## 54. TypeScript's Express compiler takes a check-rule property of another name out of the positional arguments, and Python's does not

**Component:** `typescript/agents/a2ui_agent/src/inference-formats/express/schema-helper.ts`;
`typescript/agents/a2ui_agent/src/inference-formats/express/compiler.ts`;
`python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py`.

**Severity:** on a component declaring an array of check rules under a name of
its own, the positional arguments after that property fill other slots in each
SDK, so the same text compiles to different ids. Found at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

**Held by:** the viewer's positional order leaves the property out as the parse's
SDK does, `tools/spectra_viewer/src/model/readers/schema.ts:297-305` and
`:348-351`, held by the wrapper capture case
`express_positional_check_rule_property`'s two expected records, on
`conformance/test_data/catalogs/reader_catalog_v1_0.json`.

### Issue

TypeScript's schema helper takes the first property of a component's own schema
whose schema is an array of the common `CheckRule`, whatever its name, as the
component's check-rule property (`schema-helper.ts:558-583`, set at `:624`), and
the compiler leaves that property out of the positional arguments
(`compiler.ts:2146-2151`). Python's leaves out `checks` alone
(`compiler.py:1993-1996`), so a check-rule property of another name keeps its
slot.

### Reproduction

On a catalog with `Gate: {child: ComponentId, rules: {type: array, items: {$ref:
"common_types.json#/$defs/CheckRule"}}, extra: {}, footer: ComponentId}`, compile
`root = Gate(Leaf("a"), [], Leaf("b"))`. Python fills `child`, `rules` and
`extra`, giving `root_child` and `root_extra`; TypeScript fills `child`, `extra`
and `footer`, giving `root_child` and `root_footer`.

### Fix

One rule in both compilers for which property a component's checks are, and
whether it takes a slot.

## 55. Python refuses an Express block holding an out-of-range number, and TypeScript drops only its statement

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/express/visitor.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/visitor.ts`.

**Severity:** a block with one statement holding a number literal out of range as
a double fails to compile in Python and compiles, without that statement, in
TypeScript. Found in the read of upstream's commits since `9e8a9bac5`: #3880
(`b1bf1ac3c`) made Python re-raise. Reproduced at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

**Held by:** the viewer's Express reader stops at the number for a Python parse
and drops the statement for a TypeScript one,
`tools/spectra_viewer/src/model/readers/express.ts:221-240` and `:287`, held by
the wrapper capture case `express_number_out_of_range`'s two expected records.

### Issue

Both visitors refuse a number literal that is not finite as a double, `1e999`,
with an `ExpressParseError` (Python `visitor.py:46-48`, TypeScript
`parseNumberLiteral`, `visitor.ts:218-222`). Python's `visitProgram` re-raises
that error, "the statement is wrong, not unfinished, so it is reported rather
than dropped" (`visitor.py:104-108`). TypeScript's catches every error from a
statement and drops the statement (`visitor.ts:297-300`), its comment citing
Python's earlier behaviour. The compile case suite's one out-of-range case,
`test_compile_express_number_out_of_range_is_a_parse_error`
(`conformance/agent/express/compiler.yaml:1701-1709`), holds the number in the
block's only statement, so it does not show the difference.

### Reproduction

Compile `root = Text("hi")` followed by `x = Text(1e999)` on the v1.0 basic
catalog. Python raises `A2uiCompilationParseError` "Number literal 1e999 is out
of range."; TypeScript gives `root` alone.

### Fix

Re-raise the visitor's own `ExpressParseError` in TypeScript as Python does.

## 56. `@a2ui/agent`'s `KNOWN_GAPS.md` describes Python behaviour Python no longer has

**Component:** `typescript/agents/a2ui_agent/KNOWN_GAPS.md`.

**Severity:** ten of the file's entries state behaviour of the Python SDK, or of
both SDKs, that the code at the pin no longer has, eight wholly and two in part;
a reader porting or comparing the SDKs is sent after gaps that are closed. Found
at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Each entry run against the Python SDK at the pin, the first
against both.

### Issue

Wholly stale, paths under `python/a2ui_agent/src/a2ui/` unless noted:

- Lines 37-42, the Express decompiler leaving out a component its catalog does
  not declare, "Python does the same": Python's decompiler raises
  (`inference_formats/express/decompiler.py:451-453`, `:685`), and so does
  TypeScript's.
- Lines 85-90, `A2uiGenerator` and `A2uiRequestProcessor` not landed in Python:
  both exist (`processor/generator.py:35`, `processor/processor.py:35`, exported
  at `processor/__init__.py:25-26`).
- Lines 108-114, Python's Express emitting checks on a component that takes none:
  it raises (`inference_formats/express/compiler.py:2134-2142`), writes the
  envelope key (`:2153`), and reads an inline `@checks` or a bare array of check
  rules as checkable (`inference_formats/_shared/schema_helper.py:297-300`).
- Lines 124-133, the Express conformance cases Python fails: Python's harness's
  `KNOWN_GAPS` is empty (`python/a2ui_agent/tests/conformance/test_conformance.py:318`),
  and the cases named pass, 47 passed and 7 skipped, each skip a v0.9 lowering
  with its reason.
- Lines 150-155, a v0.9 catalog's common properties ignored: local references are
  inlined (`schema_helper.py:242-243`) and walked (`:166-196`); `Text("hi",
  weight=1)` compiles on the v0.9 basic catalog.
- Lines 165-171, v0.9 JSON examples left untranslated:
  `inference_formats/express/prompt_generator.py:42-49` lists `updateComponents`
  and `callRendererFunction`.
- Lines 181-187, event names not escaped by the decompiler: `decompiler.py:984`
  escapes them, and a name with quotes and a backslash goes round.
- Lines 189-195, falsy data model values dropped: `decompiler.py:633-636` writes
  `""`, `0`, `false` and `[]`.

In part:

- Lines 135-140, Python's Express defaulting to v1.0: the default is the
  catalogs' version (`compiler.py:1298`, `inference_formats/express/format.py:61-63`);
  an explicit version of another release line is still not checked.
- Lines 157-163, the restaurant finder's v0.9 examples not decompiled: they go
  round, equal by value (`decompiler.py:518`, `:633`), but `createSurface.theme`
  is still dropped.

### Reproduction

On the v1.0 basic catalog: decompiling a component named `Nope` raises
`ExpressValidationError: Unknown component 'Nope' not defined in catalog
'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'.` in Python and
`ExpressUnknownComponentError: Component 'Nope' is not defined in the catalog.` in
TypeScript; `Text("hi", _, _, [?required])` raises `ExpressValidationError:
Component 'Text' does not declare a 'checks' property, so it cannot take checks.`
On the v0.9 basic catalog, `ExpressCompiler` built on it has the version `v0.9`.

### Fix

Delete the eight stale entries and cut lines 137 and 159 to the clauses that
hold.

## 57. The Express prompt advertises `checks?` as `TextField`'s sixth positional argument, and the compilers count five

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py`;
`python/a2ui_agent/src/a2ui/inference_formats/_shared/schema_helper.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/compiler.ts`;
`typescript/agents/a2ui_agent/src/inference-formats/express/schema-helper.ts`.

**Severity:** the prompt tells the model a checkable component's checks are its
last positional argument; the compilers take a check out wherever it is written
and count the positions without it, so anything else in that slot, a variable
holding checks or an empty list, is refused with a message naming one argument
fewer than the prompt, and a variable holding checks compiles into a property.
Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

### Issue

Both helpers put `checks` last in a checkable component's properties
(`schema_helper.py:342-357`; `schema-helper.ts:691-704`), and both prompt
generators write it so: `• TextField(label, value, placeholder?, variant?
(static), weight? (static), checks? (static))`. Both compilers drop `checks` from
the positional properties (`compiler.py:1993-1997`; `compiler.ts:2146-2151`), take
out each argument that is a check or a non-empty list of checks
(`compiler.py:2003-2010`; `compiler.ts:2157-2168`), and refuse more positional
arguments than are left (`compiler.py:2014-2020`; `compiler.ts:2171-2177`). A
variable is not a check expression, so a variable holding checks fills an
ordinary slot, positionally or as `checks=`.

### Reproduction

On the v1.0 basic catalog, `root = TextField("Name", $/name, "hint",
"shortText", 1, [])` raises, in both SDKs, "TextField takes at most 5 positional
arguments (label, value, placeholder, variant, weight), but component 'root'
passes 6."; so does `c = [?required]` with `root = TextField("Name", $/name,
"hint", "shortText", 1, c)`. With `[?required]` in the sixth place it compiles,
and with it first or third the other arguments keep their properties. `root =
TextField("Name", $/name, c)` compiles to `"placeholder": [{"@call": "required",
"args": {}}]`, which validation refuses.

### Fix

Either read the advertised slot as checks, a variable holding checks resolved
there, or stop listing `checks?` among the positional parameters and say that a
check may be written among the arguments anywhere.

## 58. Python and TypeScript bind a component's value into a check by different rules

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/compiler.ts`.

**Severity:** on a catalog whose check function's first parameter is not named
`value`, the same Express check compiles to a valid condition in TypeScript and to
one missing an argument in Python, which validation refuses; the default message
is capitalised differently too. The basic catalogs show neither: their check
functions' first parameter is `value` and their names are lower-case. Found at
the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

### Issue

Python records the bound path of the property named `value` alone
(`compiler.py:2129-2132`) and binds it into a check only when the function's
first parameter is `value` (`:2227-2234`). TypeScript records every property bound
to a path (`compiler.ts:2310-2315`) and binds the one named as the function's
first parameter (`:2420-2433`). Python's default message is
`check_name.capitalize()` (`compiler.py:2224`), TypeScript's the name with its
first character upper-cased (`compiler.ts:2415`).

### Reproduction

On a v1.0 catalog with a checkable `Meter` whose property is `amount`, a
`DynamicNumber`, and a check function `atLeast(amount, min)`, both required,
compile `root = Meter($/amount, ?atLeast(5))`. Python gives `"@checks":
[{"condition": {"@call": "atLeast", "args": {"amount": 5}}, "message": "Atleast
check failed"}]`, which `parse_response` refuses: `components.root.@checks.0.condition:
'min' is a required property`. TypeScript gives `"@checks": [{"condition":
{"@call": "atLeast", "args": {"amount": {"@path": "/amount"}, "min": 5}},
"message": "AtLeast check failed"}]`, which it accepts.

### Fix

One rule in both compilers, held by a compile case whose check function's first
parameter is not `value`, and one capitalisation of the default message.

## 59. TypeScript refuses a v1.0 catalog whose component declares an `@` envelope key, which Python accepts

**Component:** `typescript/core/web_core/src/catalog/schema_loader.ts`;
`python/a2ui_core/src/a2ui/core/catalog/catalog.py`.

**Severity:** a catalog declaring `@catalogId`, `@metadata`, `@accessibility` or
`@checks` as a component's property loads in Python and fails to load in
TypeScript, so an agent cannot use it on `@a2ui/agent`. The v1.0 catalog
definition meta-schema accepts such a property. Found at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

### Issue

Web core's catalog loader checks every v1.0 component property's name as a UAX
#31 identifier, with no exemption (`schema_loader.ts:1457-1466`, through
`assertUax31Identifier`, `common/uax31.ts:65-69`), though it reads `@catalogId` as
an envelope field further on (`:589-594`). Python's skips the four envelope keys
(`catalog.py:3277-3286`, the set at `:951-953`), added by #4037 (`8c3bd4073`),
which edited the TypeScript loader without the same exemption; any other `@` name
it refuses. The meta-schema's `ComponentDefinition`
(`specification/v1_0/json/catalog_definition.json:229-271`) puts no rule on a
component's property names; the protocol document requires property names to be
UAX #31 identifiers (`specification/v1_0/docs/a2ui_protocol.md:550`) and says the
envelope keys take the `@` "so they never collide with UAX #31 catalog property
names" (`:509`), without saying whether a catalog may declare them.

### Reproduction

Load a v1.0 catalog whose component `Badge` declares `@catalogId`, `@metadata`,
`@accessibility` and `@checks` before `child`, as Spectra's
`conformance/test_data/catalogs/reader_at_keys_catalog_v1_0.json` does.
TypeScript's `Catalog.fromJson` raises `A2uiCatalogError: Invalid UAX #31 property
identifier: '@catalogId' in component 'Badge'`. Python's `CatalogConfig.from_path`
loads it; with `@foo` added it raises `A2uiCatalogError: Invalid UAX #31 property
identifier: '@foo' in component 'Badge'`.

### Fix

Skip the four envelope keys in TypeScript's check as Python does, and state the
rule in the meta-schema or the protocol document.

## 60. An Express `checks=` argument that is not purely check expressions is written under the bare `checks` at v1.0

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/express/compiler.py`;
`typescript/agents/a2ui_agent/src/inference-formats/express/compiler.ts`.

**Severity:** a v1.0 component compiled from `checks=[...]` whose list is not made
only of checks carries the bare `checks`, the legacy form, where the agent SDKs
otherwise emit `@checks` alone; the value is passed on uncompiled as data, a check
in it uncompiled too. Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

### Issue

A keyword argument's value is taken out as checks only when it is a check or a
non-empty list made only of checks (`_is_check_expression`, `compiler.py:569-575`;
`isCheckExpression`, `compiler.ts:228-236`). Any other `checks=` value joins the
ordinary properties (`compiler.py:2068-2075`; `compiler.ts:2229-2239`) and is
written under the property's own name, `checks` (`compiler.py:2127`;
`compiler.ts:2308`), while compiled checks take the version's envelope key
(`compiler.py:2153`, `envelope_key("checks", ctx.at_least_v10)`; `compiler.ts:2355-2357`).
The validators read the bare key as `@checks` during the transition, so its
contents are judged and the key itself is not refused.

### Reproduction

On the v1.0 basic catalog, compile `root = TextField("Name", $/name,
checks=[{condition: $/ok, message: "m"}])`: both SDKs give `"checks":
[{"condition": {"@path": "/ok"}, "message": "m"}]`, and the validated parse
(`parse_response`) accepts it with the bare key. `checks=[?required, "x"]` gives
`"checks": [{"@call": "required", "args": {}}, "x"]`, the check uncompiled and its
value not bound, which both validators refuse at `@checks`. `checks=[?required]`
gives `"@checks": [{"condition": {"@call": "required", "args": {"value": {"@path":
"/name"}}}, "message": "Required check failed"}]`.

### Fix

Refuse a `checks=` value that is not a check expression, or write it under
`envelope_key("checks", at_least_v10)`.

## 61. Atom takes a bare string equal to an id the compiler generated for a reference

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py`.

**Severity:** a bare string child that happens to equal a generated id, `root`
or `node_N`, which the author never wrote, becomes a reference to that component
instead of a text: the text is lost and the component is listed as a child twice.
Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against the Python SDK at the pin.

### Issue

`_auto_wrap_text_child` returns a bare string as a reference when a component
already compiled into the block has that id (`compiler.py:1254-1255`). The
block's components include the ids the compiler generated, `node_N` from
`_next_id` (`:1176-1181`) and `root` from `_assign_id` (`:1183-1200`). The ids the
author wrote are already collected, as `_reserved_ids` by `_collect_reserved_ids`
(`:522-534`).

### Reproduction

Compile `(Column (Text :text "a") "node_0")` on the v1.0 basic catalog, through
`parser.compile` or `parse_response`: `[{"id": "root", "component": "Column",
"children": ["node_0", "node_0"]}, {"id": "node_0", "component": "Text", "text":
"a"}]`, which validation accepts. `(Column (Text :text "a") "node_9")` gives
`"children": ["node_0", "node_1"]` and `{"id": "node_1", "component": "Text",
"text": "node_9"}`.

### Fix

Take the string for a reference only when it is an id the text states:
`text_str in self._reserved_ids and any(...)`.

## 62. Atom writes an unknown keyword property into the component unchecked

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py`.

**Severity:** `compile` passes a property the component's catalog does not
declare into the compiled component; the validated parse refuses the message
afterwards, where Express refuses the text with the property's name and the ones
the component takes. Found at the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against the Python SDK at the pin.

### Issue

The keyword branch of `_compile_component` writes any key it does not handle
otherwise (`compiler.py:1446-1450`, `comp[wire_key(key)] = self._coerce_object_list(...)`),
and `_finalize_component` (`:1548-1576`) coerces values and checks required
properties alone; nothing checks the key against the component's properties.
Express raises `ExpressUnknownPropertyError` for it
(`express/compiler.py:2079-2080`). `parser.compile` does not validate
(`parser/parser.py:98-101`).

### Reproduction

On the v1.0 basic catalog, `parser.compile` of `(Text :text "a" :foo "x")` gives
`[{"id": "root", "component": "Text", "text": "a", "foo": "x"}]`; `parse_response`
raises `A2uiValidationError: Validation failed for component 'Text':
components.root.foo: Additional properties are not allowed: unrecognized key(s)
in object: 'foo' (extra inputs are not permitted)`. Express's `root = Text("a",
foo="x")` raises `A2uiCompilationValidationError: Property 'foo' is not a valid
property of component 'Text'.` on both paths.

### Fix

Raise for a key that is not among the component's properties, nor an envelope or
template key, as Express does.

## 63. Atom drops a positional argument past a component's last property

**Component:** `python/a2ui_agent/src/a2ui/inference_formats/experimental/atom/compiler.py`.

**Severity:** a value written in a component's positional arguments beyond the
last property it takes is lost with no error, on both the compile and the
validated path, where Express refuses the text. Found at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against the Python SDK at the pin.

### Issue

On a component with no child property, a positional value fills the next
property while one is left (`compiler.py:1510-1515`), and the branch has no `else`:
a value past the last is skipped. Express raises "takes at most N positional
arguments" (`express/compiler.py:2015-2020`; `compiler.ts:2173-2176`).

### Reproduction

On the v1.0 basic catalog, `(Text "a" "caption" 2 "more")` compiles, and
validates, to `{"id": "root", "component": "Text", "text": "a", "variant":
"caption", "weight": 2}`, "more" gone. Express's `root = Text("a", "caption", 2,
"more")` raises `A2uiCompilationValidationError: Text takes at most 3 positional
arguments (text, variant, weight), but component 'root' passes 4.`

### Fix

Raise in the missing `else`, with Express's message.

## 64. `extract_a2ui_json_to_parts` finds Direct JSON blocks otherwise than the Direct JSON parser

**Component:** `python/a2ui_a2a/src/a2ui/a2a/parts.py`;
`python/a2ui_agent/src/a2ui/parser/lexer.py`;
`python/a2ui_agent/src/a2ui/inference_formats/direct_json/blocks.py`.

**Severity:** the same reply gives different A2UI parts through the A2A
extension's helper and through the agent SDK's Direct JSON parser: a fence's
language, a stray `"""` and backticks beside the tags are read differently, and
in the `"""` case the helper loses a valid message. Found in the read of upstream's
commits since `9e8a9bac5`: #3790 (`1e9ed04b5`) added the helper. Reproduced at
the pin `0888f88b2` (2026-11-13).

**Standing:** holds. Run against the Python SDK at the pin.

### Issue

`extract_a2ui_json_to_parts` (`parts.py:259-309`) finds blocks with the shared
`BlockLexer` (`parts.py:49-59`, `parser/lexer.py`), while `DirectJsonParser.unwrap`
(`direct_json/parser.py:109-160`) uses `direct_json/blocks.py`'s `scan_block` and
`clean`. They differ in three places:

- a fence's language: the shared lexer strips `` ```[a-zA-Z0-9_-]* ``
  (`lexer.py:34-35`), Direct JSON `` ```[a-zA-Z-]* `` (`blocks.py:31-32`), though
  its own recovery pattern is the wider one (`direct_json/parser.py:33`);
- `"""`: the shared lexer opens a triple-quoted string and waits for the next
  `"""` (`lexer.py:164-173`, `:204-208`); Direct JSON toggles on every `"`
  (`blocks.py:89-104`);
- backticks beside the tags: Direct JSON trims them from the text around a block
  (`direct_json/parser.py:128-129`, `:153-154`); the shared lexer strips only a
  three-backtick fence or text of nothing but backticks (`lexer.py:122-134`,
  `:144-147`).

### Reproduction

With `MSG` = `{"version":"1.0","deleteSurface":{"surfaceId":"s"}}`:

- `<a2ui-json>` + "\n```json5\n" + `MSG` + "\n```\n" + `</a2ui-json>`: `unwrap`
  gives the block `5\n{…}`, which fails to compile with "The direct JSON block
  is not JSON"; the helper gives the message as a data part.
- `<a2ui-json>""""</a2ui-json> hi <a2ui-json>` + `MSG` + `</a2ui-json>`: `unwrap`
  gives a block that is not JSON, the text "hi" and a block that compiles; the
  helper gives `[]` and logs "Skipping unclosed A2UI JSON block.".
- "Here: \`" + `<a2ui-json>` + `MSG` + `</a2ui-json>` + "\` done.": `unwrap` gives
  the texts "Here:" and "done."; the helper gives "Here: \`" and "\` done.".

### Fix

Find the blocks in the helper with Direct JSON's own block finding, and widen
`blocks.py:31-32` to `[a-zA-Z0-9_-]`.

## 65. Web core checks a v1.0 catalog's check rules against the v0.9 and v1.0 superset, accepting a boolean condition and extra keys

**Component:** `typescript/core/web_core/src/catalog/schema_loader.ts`;
`typescript/core/web_core/src/types/common-types.ts`;
`typescript/core/web_core/scripts/generate-superset-common-types.mjs`.

**Severity:** a v1.0 component whose check rule has a literal boolean
`condition`, or a key the rule does not define, passes web core's validation, and
so `@a2ui/agent`'s `validatePayload`, while the v1.0 common types and the Python
core refuse it. Found while reproducing finding 60, at the pin `0888f88b2`
(2026-11-13).

**Standing:** holds. Run against both SDKs at the pin.

### Issue

The v1.0 common types' `CheckRule.condition` is one of `DataBinding` or
`FunctionCall`, and the rule allows no other key
(`specification/v1_0/json/common_types.json:273-288`); v0.9's and v0.9.1's is a
`DynamicBoolean`, which a literal boolean is
(`specification/v0_9/json/common_types.json:237-239`). Web core's catalog loader
resolves a catalog's `common_types.json#/$defs/…` reference, as the v1.0 basic
catalog's `Checkable` (`catalogs/basic/v1/catalog.json:390`, and at `:423`,
`:461`, `:490`, `:554`, `:596`), through `resolveProtocolRef`
(`schema_loader.ts:92-97`, used at `:214` and `:862-872`), which looks the name up
in `types/common-types.ts`'s `CommonSchemas` whatever the catalog's version
(`schema_loader.ts:23`). That file is "the runtime superset of the modern protocol
lineage (v0.9 and above)" (`types/common-types.ts:28-30`), generated by
`generate-superset-common-types.mjs`, whose `mergeObjectSchemas` (`:118-131`)
unions each property's schemas across versions and writes no
`additionalProperties`. Its `CheckRuleSchema`'s `condition` is
`z.union([DynamicBooleanSchema, DataBindingSchema, FunctionCallSchema])`, with no
`.strict()` (`types/common-types.ts:222-233`). The version's own, strict schema,
`v1_0/schema/common-types.ts:211-220`, is not used by the loader. The Python core's
v1.0 `CheckRule` takes `DataBinding | FunctionCall`
(`python/a2ui_core/src/a2ui/core/schema/v1_0/common_types.py:304-317`).

### Reproduction

On the v1.0 basic catalog, validate `[{"version": "1.0", "createSurface":
{"surfaceId": "main", "catalogId":
"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", "components":
[{"id": "root", "component": "TextField", "label": "Name", "value": "v",
"@checks": [{"condition": true}]}]}}]`. `@a2ui/agent`'s `validatePayload` accepts
it; the Python core's `validate_payload` raises `A2uiValidationError: Validation
failed for component 'TextField': components.root.@checks.0.condition…: Expected
dictionary or instance of DataBinding, received boolean`. With the rule
`{"condition": {"@path": "/ok"}, "foo": 1}`, TypeScript accepts and Python raises
`components.root.@checks.0.foo: Additional properties are not allowed`. With
`{"condition": {"@path": "/ok"}}` both accept.

### Fix

Resolve a catalog's common type references in the common types of the catalog's
own protocol version, `v1_0/schema/common-types.ts`'s `CommonSchemas` for a v1.0
catalog.
