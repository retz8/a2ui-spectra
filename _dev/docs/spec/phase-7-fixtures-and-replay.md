# Phase 7 — Fixtures and replay

Save as fixture; replay with everything recorded and with tools recorded and the model live, each labelled with its cost; `a2ui-spectra replay`; `a2ui-spectra test` for CI. Phase 7 of SPEC.md's roadmap, between Phase 6, the A2UI step, and Phase 8, the dev loop. The design authority is SPEC.md, in particular its "Features" ("Not paying for every run"), "Replay and storage" and "Adopter path" sections, and the turn record spec's rule that replay sends the earlier turns of the conversation first, then the turn. The record is turn record v0.1, amended as decisions 8 and 15 say.

## Scope

In scope:

- The model proxy and the tool proxy in replay mode: the key, the order, the pool, MCP's server side, the miss.
- The replay driver: Spectra as the host re-sending a record's wire inputs through the wire proxy, with the ids rewritten; the replayed turn's provenance; the verdict.
- Fixtures: the folder, save as fixture, the name.
- `a2ui-spectra replay` and `a2ui-spectra test`.
- The viewer: the Fixtures rail, the fixture view, the header controls, the replayed turn's line, a served call and a miss shown, the live status.
- The structural check amended to judge this turn's components only, the backlog item parked for this grill.
- The stub agent's model-calling mode, the conformance replay suite, the end-to-end test and the acceptance run.
- The turn record's amendments, and the design canvas's Phase 7 boards.

Out of scope:

- Pinned assertions on a fixture and fixture editing. After v1, as SPEC.md has them.
- A JUnit or other report format for `test`. Backlog.
- The tool proxy keeping session housekeeping it saw outside any turn. Backlog, taken up in this phase only if the acceptance run hits it (decision 6).
- A third mode re-sending the wire input with nothing recorded. That is Phase 8's re-run of the last turn.
- Deleting or renaming a fixture from the viewer.

## Locked decisions

### 1. The replay driver, and where the agent comes from

Replay is Spectra acting as the host, as the message box does: the server re-sends the record's wire inputs through the wire proxy, the earlier turns first and then the turn, while the model proxy and the tool proxy are armed with the record's exchanges. Each replayed send produces a turn in the store and the viewer through the one capture path every turn takes. The agent runs with redirection in place. In the viewer, Replay works on the agent attached, launched or not. `a2ui-spectra replay` and `a2ui-spectra test` take the agent either way `run` and `attach` do: `-- <command>` launches it with the variables set, `--agent-url` names one already running whose shell the adopter set them in.

### 2. The two modes differ in what a miss does

In both modes, a model request identical to a recorded one is served from the record; a tool request likewise. In everything-recorded mode a miss is an error. In the live mode a model miss goes to the provider, so replaying an unchanged agent costs nothing and a replay after a prompt edit pays only from the point where the request changed. A tool miss has no live fallback in either mode. The labels stay SPEC.md's: free, and model tokens only.

### 3. A miss

A request with nowhere to go is answered to the agent with a `502`, the status both proxies answer with when they cannot reach the target, carrying one plain-text line: the proxy, that it is replaying, that the request matched nothing in the record, and the method and target path with credentials removed. The agent fails the call as it fails any provider error, and the turn goes on to whatever outcome that gives. The call is recorded as a failed `model_call` or `tool_call` with `error.type` `replay_miss`, carrying the request as received and no response attributes, the line as its status message. The terminal gets one line per miss.

### 4. The key for a model call

The method, the URL as the proxy would forward it, the resolved target with credential parameters removed, and the body, compared by value when it is JSON and as text otherwise. Headers are not part of the key: a header is either a credential, already removed, or a client detail that changes without the request changing. An HTTP tool keys the same way. A per-request id an SDK writes into a body, found in none of the four APIs' SDKs at the pin, would be a per-provider exclusion added when met, not a rule now.

### 5. Order, the pool, the reply as recorded

Exchanges with the same key are served in recorded order, each once; a request beyond the recorded count is a miss. One pool holds every recorded turn's calls together, the earlier turns' included. A served reply is the recorded one, each shape of recorded failure reproduced: a status as recorded, body and all, a 503 as a 503; an error carried inside a 2xx stream as its chunks; a stream that broke as its chunks and then the connection destroyed; an aborted call as its chunks and then a clean end; a call with no response recorded, unreached or a miss, as the proxy's `502` line, the recorded status message as its reason. Its headers are the recorded response headers less a header recorded as `REMOVED`, `content-encoding`, and `content-length`, which is recomputed for the body as serialised. A JSON body is serialised from the recorded value and a text body written as its text; a streamed reply is one server-sent event per recorded chunk, `event:` and `id:` as recorded, the headers flushed first, written as fast as the agent reads them, with no reproduction of the recorded timing.

### 6. The tool proxy as the server

An MCP request keys by its method and params, with `id` and the whole of `params._meta` left out. Inside a served reply two identifiers are rewritten to the live request's own: the response's `id`, and the `progressToken` of each `notifications/progress` on the served event, rewritten to the live request's `_meta.progressToken` when it asked for progress and written as recorded when it did not; nothing else in a served body is touched. `tools/call`, `resources/read`, `prompts/get` and every other request outside housekeeping are consumed in recorded order. Housekeeping, `initialize`, `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` and `logging/setLevel`, is matched by method alone and not consumed, served from the record's latest exchange of that method as often as asked. An answer the protocol fixes never misses: a notification gets `202 Accepted` with no body, a `ping` gets the empty result, and a JSON-RPC response the client posts gets `202 Accepted`, each whether or not the record holds the method; every other method with no recorded exchange misses. An event the server initiated, `kind` `4`, is never re-sent: a `tools/call` that asked the client something is served its recorded result directly, and the model call the agent would have made for the sampling stays unconsumed in the pool. The session is replayed as recorded: `Mcp-Session-Id` as the recorded `initialize` answered it, a `DELETE` answered as recorded or with 204 when the record has none; a live session id that differs does not miss, headers being out of the key. Under streamable HTTP a POST gets the recorded reply in its recorded form, a server request inside its stream included, and the client's answering POST gets the protocol's `202`.

An armed tool proxy reads a `GET` in this order: one whose key matches a recorded HTTP tool call is served as one; one carrying `Mcp-Session-Id` is a streamable HTTP carrier, `200` `text/event-stream`, held open, nothing written, closed when the client closes it or the proxy is disarmed; one whose path is the path of the `a2ui.mcp.stream.url` on a recorded `initialize` whose first chunk is an `endpoint` event is an HTTP+SSE carrier, that `endpoint` event written as recorded, relative, resolving against the listener as today, and the session registered under that endpoint; anything else is a miss. Under HTTP+SSE a posted request gets its 202 with its recorded response written on the carrier, and a miss gets the `502` on the POST with nothing written on the carrier.

Known limit: an agent that opens its MCP session before the first turn has an `initialize` that Phase 5's placement rule did not record, so its replay misses on `initialize` and loses its tools. The Phase 5 targets connect inside the turn. The fix, the tool proxy keeping the session-level housekeeping it saw outside any turn, is taken up only if the acceptance run meets the case.

### 7. The ids across a replayed conversation

Each recorded wire input is sent as recorded, its parts, its metadata with the capabilities and the data model, the extensions header, the A2A version and the method, the wire proxy adding the new turn's `traceparent` as for any host. The first turn's request is sent with no `contextId`, so the agent opens a new conversation, and each later turn's request carries the `contextId` the live agent's reply named. A recorded request that carried a `taskId`, the turn after one that ended waiting for input, carries the live previous turn's task id. `messageId` is fresh for each send. Every recorded turn is sent in order, whatever the outcome of the one before.

### 8. What a replayed turn records

The replayed turn is captured through the one path and states what happened, its timing its own. Turn record v0.1 is amended in place with provenance: on the turn event, `a2ui.replay.source`, the path of the record file replayed, relative to the working directory when under it, `a2ui.replay.turn`, the trace id of the recorded turn this one stands for, and `a2ui.replay.mode`, `recorded` or `model_live`; on a model call or tool call served from the record, `a2ui.replay.served_from`, the span id of the recorded event it was served from, absent on a live call; and `replay_miss` among the error types. A served call carries its recorded token usage, and the viewer prices only the calls with no `served_from`, so a replayed turn's cost is what the replay paid. A replayed conversation lands in the store under the new `contextId` the agent gave it.

### 9. The verdict

Per recorded turn, a replayed turn passes when every call was served from the record, no miss and in everything-recorded mode no live call, housekeeping standing outside that rule: served or answered as the protocol fixes, it never gates the verdict, and a miss on it still does; its outcome is the recorded one; and the agent's A2UI messages equal the recorded ones by JSON value, in order, text parts and other data parts not compared. A record passes when every one of its turns passes. The four checks run on the replayed turn as on any turn and are reported beside the verdict without gating it, so a fixture saved from a turn whose checks failed keeps passing until the agent changes. An agent that makes up a surface or component id at random, which no SDK at the pin does, would be a finding and a comparison that learns to ignore that id, not a weaker verdict.

### 10. The two commands

Both headless, no viewer and no browser, under the config file as `run` is, with the agent taken either way of decision 1. `a2ui-spectra replay <file>` waits for the card, replays the one record in everything-recorded mode or with the model live under a flag, prints one line per recorded turn with its verdict and the reasons it failed and where its records landed, and exits 0 when the record passes, else 1. `a2ui-spectra test <folder>` replays every `.json` file under the folder, recursively, in path order, each in everything-recorded mode in its own conversation against the one agent process; a file that is not a valid turn record counts as failed and says why; one line per fixture with its failing turns' reasons under it, a summary line, exit 0 when every fixture passes, else 1; no live flag. Output is plain terminal lines.

### 11. The fixtures folder, the file, the name

A `fixtures` setting in the config file names the folder, relative to the config file's directory when relative; the default is `a2ui-spectra-fixtures/` in that directory, or in the working directory when there is no config file, a visible folder outside `.a2ui-spectra/`. Save as fixture writes the turn's record as the store holds it, whole, the earlier turns embedded, nothing stripped, creating the folder when it is missing; any turn in the store can be saved, earlier runs included. The file name is the fixture's name, `<name>.json`, letters, digits, `-`, `_` and `.`; the record carries no title. The viewer asks for the name at save, prefilled with a slug of the turn's input in brief, a clash taking a numeric suffix.

### 12. The viewer's fixture side

The rail's second section, Fixtures, switches the panels: it shows the fixtures list and the fixture view in the places of the turn list and the turn view, the context bar staying and the composer not shown. The list holds the folder's files by name, watched, so a file dropped in or removed shows at once, grouped like the turn list: one group per fixture, titled by its name, with its turn count and its recorded cost, its turns as rows in order, the fixture's own turn last. Selecting a row opens that turn in the fixture view, the turn view's shape, under a fixture line naming the file, the turn count, the recorded estimated cost and when it was saved. One Replay button sits in the fixture view's header and in a store turn's header alike, a store turn replaying directly from its file, and opens a popover with the two modes as rows, each with its cost label: "Everything recorded" over "Free · the model and the tools answer from the record", and "Tools recorded, model live" over "Up to <the recorded cost> · a request that changed goes to the model", the ceiling the whole conversation's recorded cost. Pressing a row starts the replay; the viewer switches to Turns and follows the new turns as they land, as it follows the box's send, and they list under their new conversation. Save as fixture, in a store turn's header, asks the name and then names the file written; nothing tracks whether a turn was already saved. Replay is refused while a turn is open, as the box's send is, and the box refuses a send while a replay runs; the context bar's live status names the replay and its turn meanwhile.

### 13. The replayed turn's view, and a miss shown

A third quiet line under a replayed turn's header names what it was replayed from, the turn's number, the mode and the verdict, passed or failed, linking to the source record, whose turn opens in its own view. Each reason of a failed verdict joins the one problem count and the `n` key: a miss is the failed call's problem on its row; a different outcome and different A2UI are problems of the whole turn, on the outcome step, each a plain sentence over its code. A served model call's or tool call's row carries a grey "Record" tag and its detail says it was served from the record, linking to the recorded call, with its estimated cost reading "Free · served from the record"; the header's second line counts the live calls alone, adding how many calls came from the record. A miss's detail says it matched nothing in the record: a model miss shows under it Phase 5's prefix break against the recorded request of the same model that shares the longest prefix with it, in the prefix break's own form; a tool miss lists the recorded requests of the same method and, for `tools/call`, the same tool name. The timeline and the checks are the replayed turn's own.

### 14. A record with nothing to serve

A record whose turns hold no model call and no tool call keeps its controls: everything-recorded is disabled, saying no model or tool calls were recorded, and the live mode's label reads cost unknown in place of the ceiling; the live replay runs as any other. In `test` such a fixture fails with that reason before anything is sent.

### 15. The structural check judges this turn's components

`COMPONENT_UNREACHABLE` is reported for a component this turn's messages carried, added or updated, that the walk from `root` does not reach at the close. A component an earlier turn left behind is not reported again, so a surface repainted in place with a new `root` gets no finding, which the protocol at the pin permits: it states no rule that every component be reachable, and `deleteSurface` is its only message that removes components. This amends Phase 4's structural check; the backlog item is removed.

### 16. The design artifact comes first

Phase 7's boards are drawn first on the design canvas "Spectra viewer UI", in light and dark, and the build follows them: the rail with its Fixtures section and the fixture view with its header line and the two Replay controls, the disabled state of decision 14 included; a store turn's header with Save as fixture and the Replay controls, the name prompt and the line naming the file written; the replayed turn, its line passed and failed, a served call's detail, a model miss's detail with the prefix break and a tool miss's list; the context bar's live status during a replay; Flow 7, saving a turn as a fixture and replaying it for free, then seeing where a prompt edit broke the request; a Screens pair, the fixture view in light and dark; and one small-window board drawing the fixture view. The commands' terminal output is not a board.

### 17. The tests and the acceptance run

Unit tests on the matcher, the verdict, the fixtures folder's naming and the driver's id rewriting. Two conformance replay suites, `conformance/model_replay/` and `conformance/tool_replay/`, reusing the model and tool capture suites' data: each case arms the proxies in replay mode with the expected record, sends the recording's requests through them, and asserts each reply comes back as recorded and a changed request gets the miss; no new recordings. The stub agent gains a mode that calls the stand-in provider's Gemini API through `GOOGLE_GEMINI_BASE_URL` and the conformance MCP server through a variable, builds its A2UI from the reply, and takes an option that changes its prompt; the end-to-end test records a conversation against the stand-in, saves it as a fixture through the API, replays it with the stand-in stopped and sees it pass, changes the prompt and sees the miss with the prefix break, and runs both commands in both agent forms, under Node and the binary. The acceptance run, the last sub-task, through the tunnel, on the three samples at the pin, the Python restaurant finder, the Node restaurant finder and the custom-components example with its MCP server over HTTP+SSE: each saved as a fixture and replayed in both modes from the viewer, one with its prompt edited to see the miss, both commands from the terminal, every board in light and dark; what it finds is fixed within the sub-task.

### 18. The pin and the other documents

The upstream pin stays at `9e8a9bac5`, upstream's releases of 2026-11-02, unless the acceptance run needs a move.

- SPEC.md, amended in place: "Not paying for every run" gains the two modes' one difference, what a miss does; "Replay and storage" gains the key, the order, the verdict and the fixtures folder; the adopter path's step 4 and the browser-terminal table name the commands as they are.
- Turn record v0.1, prose and schema, carry decisions 8 and 15; Phase 1's fixtures follow where a shape changed.
- The READMEs: the tool's, for the commands, the `fixtures` setting, the replay rules and decision 6's known limit; the viewer's; `conformance/README.md`, for the replay suite and the stub agent's mode.
- `_dev/TODO.md`: the Phase 7 line names this spec; the backlog loses the structural check item and gains a JUnit report for `test` and the tool proxy keeping session housekeeping seen outside a turn.
- `_dev/a2ui-findings.md` and `_dev/otel-findings.md` gain what the phase finds.

## Invariants

- No credential is ever in a record or a fixture, and none is part of a replay key.
- A replayed turn is a turn: captured through the one path, in the one record format, stating what happened, with cost derived when shown.
- Everything-recorded means free: no call leaves the machine in that mode; a miss is an error, never a live call.
- The replay sends the wire input as recorded; the ids the agent assigns, and `messageId`, are the only rewrites.
- The checks report; the verdict gates.
