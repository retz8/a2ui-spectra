# Replay and fixtures: how Spectra runs a turn again without paying for it

This doc explains how Spectra keeps the turns it captures, how a turn becomes a fixture, and how a replay sends a recorded conversation to the agent again while the model and the tools answer from the record. It is written for the developer of an A2UI agent who uses Spectra and wants to know what a replay serves, what makes it miss, what decides whether it passes, and what `a2ui-spectra replay` and `a2ui-spectra test` print and return. It starts with the problem, follows one conversation from its recording to a failed replay and back, then opens up the store, the fixtures folder, the request key and the verdict, and ends with the design decisions and where the code is.

The running example is a two-turn restaurant conversation: "Top 2 Chinese restaurants in New York", then "Book a table for 2 at the first one tomorrow at 7pm". Upstream's Python restaurant finder, `samples/agent/adk/restaurant_finder`, answered it in the Gemini recording [`conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.har`](../../conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.har). The terminal lines below come from runs of the built binary on the repository's stub agent in its model-calling mode, described in [`conformance/README.md`](../../conformance/README.md#the-stub-agent): it sends its own Gemini requests, gets the restaurant finder's recorded replies from a stand-in provider playing that recording, and answers the model's function call with a tool on the repository's MCP tool server, so no model is paid for at any step.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/replay-and-fixtures-dark.png">
  <img alt="A fixture, a turn record in the fixtures folder, gives its wire inputs to Spectra's message box. The box sends each turn again over A2A through the wire proxy to your agent, and judges the turn once it closes. The agent runs its own code. Its model calls and tool calls go to the model proxy and the tool proxy. The pool, filled with the record's calls, arms both proxies, and they answer from it, each call once, in order; the tool proxy answers from the pool alone. Only with the model live does a model call the record misses go on to Gemini." src="diagrams/replay-and-fixtures.png">
</picture>

## Problem it solves

Every run of an A2UI agent calls its model, and often its tools. While you work on a prompt, a catalog or the agent's code, that means:

- paying for the model each time you look at the same turn again;
- a different reply each time, so a change in the UI cannot be told from the model's variance;
- tool servers that must be running, and tools that act on the world, for every run;
- no way to check in CI that a turn still produces the same A2UI, since CI should not call a model.

Spectra answers this with the record-and-replay pattern of Ruby's VCR and Netflix's Polly.js, applied to the model and tool calls of an agent. Every turn Spectra captures is written as a turn record. Saved as a fixture, the record can be replayed: Spectra sends the recorded conversation to the real agent again, and its model proxy and tool proxy answer the agent's calls from the record. An agent that has not changed replays for free and gives the same A2UI; an agent whose prompt changed is caught at the request that changed.

## Five ideas to hold on to

### 1. A fixture is a turn record

The store writes one turn record per captured turn, the turns before it in its conversation embedded. Save as fixture copies that file, whole, into a folder you choose and commit. Nothing is converted: a fixture, a store turn's file and the file `replay` takes are the same format, the [turn record](../../specification/turn_record/v0_1/docs/turn_record.md).

### 2. A replay drives the real agent and answers its calls from the record

Spectra's message box re-sends each recorded turn's wire input through the wire proxy, the earlier turns first, so the agent rebuilds its session and runs its own code as on any turn. Meanwhile the model proxy and the tool proxy are armed with every call of the record, and answer the agent's requests from it instead of forwarding them.

### 3. A recorded call answers the exact same request, once

A model call or an HTTP tool call is matched by its method, its URL and its body, compared by JSON value, and an MCP request by its method and its params; headers and credentials play no part. Requests with the same key are served in recorded order, each once, MCP's housekeeping requests, such as `initialize`, aside. Anything else is a miss.

### 4. The modes differ in what a miss does

With everything recorded, a miss is an error and no call leaves the machine. With tools recorded and the model live, a model request the record misses goes to the provider, so a replay after a prompt edit pays only from the request that changed. A tool request that matches nothing is a miss in both. A third mode, live, serves nothing from the record and sends the conversation again with every call live.

### 5. A replayed turn is judged against the recorded one

When a replayed turn closes, it passes when no call missed, its outcome is the recorded one and the agent sent the recorded A2UI messages, equal by JSON value and in order. The four checks run on it as on any turn and report beside the verdict without changing it. A record passes when every turn passes.

## One conversation, end to end

The excerpts in this section are cut from one session of runs, in one working directory whose config file, shown under [The fixtures folder](#the-fixtures-folder), named the stub agent's URL, `"fixtures": "./fixtures"`, and the tool server under the variable `SPECTRA_STUB_TOOL_SERVER_URL`. The stand-in provider was named in `GOOGLE_GEMINI_BASE_URL`.

1. **The conversation is recorded.** Under `a2ui-spectra run -- node conformance/dist/stub_agent/stub_agent.js --model-calling --port 19962`, two messages are sent from the message box. The first turn makes a model call, opens an MCP session to call the tool, and makes a second model call with the tool's result; the second turn makes one model call. The store writes a file per turn, `.a2ui-spectra/turns/637ce7e0-…/2026-11-21T04-20-59.116Z_b10b3f4a….json` for the first and `…/2026-11-21T04-21-05.335Z_9df324b5….json` for the second, which also holds the first.
2. **The second turn is saved as a fixture.** Save as fixture, here through the viewer's route `POST /api/fixtures`, writes `fixtures/restaurants.json`, both turns in it. The same name again is refused with the first free name:

   ```
   {"name":"restaurants","path":"fixtures/restaurants.json"}
   {"error":"fixtures/restaurants.json exists already.","suggested":"restaurants-2"}
   ```

3. **It replays for free.** With the stand-in provider stopped, so that no model could answer, `a2ui-spectra replay fixtures/restaurants.json -- node conformance/dist/stub_agent/stub_agent.js --model-calling --port 19962` starts the agent, re-sends both turns and serves every model and tool call from the record. Its stdout:

   ```
   turn 1 of 2: passed
   turn 2 of 2: passed
   fixtures/restaurants.json: passed; the replayed turns are in .a2ui-spectra/turns/cfa2c9c4-52e1-4272-8ab7-c5676574f156
   ```

4. **The prompt changes, and the replay misses.** The same command with the stub's `--prompt 'Answer in French.'` changes the system instruction of every model request. The first model request matches nothing in the record: the model proxy answers it with a `502`, prints its line on stderr, and the agent's task fails.

   ```
   a2ui-spectra: a2ui-spectra's model proxy is replaying, and POST /v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse matched nothing in the record.
   ```

   On stdout, each turn's reasons, and the exit code 1:

   ```
   turn 1 of 2: failed (A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent. The turn ended failed; the record ended completed. The A2UI differs from the record: this turn sent 0 messages, the record sent 3.); 4 of the recorded calls were not asked for
   turn 2 of 2: failed (A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent. The turn ended failed; the record ended completed. The A2UI differs from the record: this turn sent 0 messages, the record sent 4.); 1 of the recorded calls was not asked for
   fixtures/restaurants.json: failed; the replayed turns are in .a2ui-spectra/turns/71af1d24-746f-4084-9a7f-504a8117c4b0
   ```

5. **With the model live, it pays for the model alone.** With the stand-in provider running again, the same changed agent under `--model-live` sends each model request the record misses to the provider, while the MCP session and the tool call are still served from the record. Both turns pass; the two model calls of the first turn and the one of the second went live:

   ```
   turn 1 of 2: passed; 2 of the recorded calls were not asked for
   turn 2 of 2: passed; 1 of the recorded calls was not asked for
   fixtures/restaurants.json: passed; the replayed turns are in .a2ui-spectra/turns/8ee2c46f-11ed-4579-9447-59bd420b6504
   ```

6. **CI runs the folder.** `a2ui-spectra test -- node conformance/dist/stub_agent/stub_agent.js --model-calling --port 19962`, with the unchanged agent, replays every fixture under `fixtures/` with everything recorded, and exits 0:

   ```
   restaurants: passed
   1 fixture: 1 passed
   ```

   [The commands `replay` and `test`](#the-commands-replay-and-test) shows it on a fuller folder.

Each replayed turn is a turn like any other, captured, checked and written to the store, and says what it stands for on its turn event. The first replayed turn of step 4, cut from its file in the store, `.a2ui-spectra/turns/71af1d24-…/2026-11-21T04-22-07.644Z_960ed27b….json`, with the miss its model call records:

```jsonc
// The turn event's attributes, in part
{
  "a2ui.turn.outcome": "failed",
  "a2ui.replay.source": "fixtures/restaurants.json",
  "a2ui.replay.turn": "b10b3f4a8a87b78ee8a669241b52f032",
  "a2ui.replay.mode": "recorded",
  "a2ui.replay.verdict": "failed",
  "a2ui.replay.reasons": [
    {"code": "REPLAY_MISS", "message": "A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent."},
    {"code": "OUTCOME_DIFFERS", "message": "The turn ended failed; the record ended completed."},
    {"code": "A2UI_DIFFERS", "message": "The A2UI differs from the record: this turn sent 0 messages, the record sent 3."}
  ]
}
// Its model call, in part
{
  "error.type": "replay_miss",
  "http.request.method": "POST",
  "url.full": "http://127.0.0.1:19960/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse"
}
// with status {"code": 2, "message": "a2ui-spectra's model proxy is replaying, and POST /v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse matched nothing in the record."}
```

`a2ui.replay.turn` is the trace id of the recorded turn this one re-sent. In the passing replay of step 3, each served call carries instead `a2ui.replay.served_from`, the span id of the recorded call it was served from.

## Inside the machinery

### The local store

Each turn the wire proxy captures is checked when it closes, once the calls placed in it have ended, and written to the store: `.a2ui-spectra/turns/` in the working directory Spectra was launched from. Spectra prints the turns directory at start, `Turns are saved in <absolute path>`.

- **Kept out of git.** When Spectra creates `.a2ui-spectra/`, it writes a `.gitignore` into it that ignores everything there. It writes the file only when it creates the directory, so a `.gitignore` you changed or removed stays as it is. The one Spectra writes:

  ```
  # Created by a2ui-spectra. Everything in this directory is ignored.
  *
  ```

- **One folder per conversation**, named by the conversation's id, A2A's `contextId`: `turns/<conversation>/<time>_<trace id>.json`. `<time>` is the turn's start in UTC to the millisecond, its colons written as `-`, such as `2026-11-21T04-20-59.116Z`, so a conversation's files sort by time; `<trace id>` is the turn's trace id. A turn with no conversation id is a file directly in `turns/`, holding only that turn.
- **The folder's name.** A conversation id made only of ASCII letters, digits, `-`, `_` and `.`, not starting with a dot, names its folder as it is. Any other id is percent-encoded byte by byte, everything but letters, digits, `-` and `_` encoded, and so is an id Windows cannot hold as a folder name: a device name Windows reserves, alone or before a dot, or a name ending in a dot. When the encoded name would still be a reserved device name, its first character is encoded too. The store's tests give `a/b:c` as `a%2Fb%3Ac`, `.hidden` as `%2Ehidden`, `ctx.` as `ctx%2E` and `con` as `%63on`.
- **Each file is one complete turn record v0.1**, written atomically, through a temporary file renamed into place: the turns of the conversation's latest file that reads as a record of a version this Spectra reads, then the turn. A conversation carried on after Spectra restarts keeps its history, since the earlier turns are read from disk.
- **A file is amended in place.** A span the OpenTelemetry receiver places in a turn after it was written, and a replayed turn's verdict, rewrite the turn's file and each later file of its conversation that embeds the turn. The live stream says `turn_amended`, as [the API doc](api.md) describes.
- **The listing** holds every turn in the store, earlier runs included, newest first by start time. A file not named `<time>_<trace id>.json`, and a folder no conversation id encodes to, are passed over.

When the store's directory cannot be created at start, Spectra stops with `Spectra cannot create its store at <directory>: <reason>`. When one turn's file fails to write, Spectra prints `Spectra could not write <file>: <reason>. The turn is kept in memory until Spectra stops.`; the turn lists and opens as any other until then. When Spectra stops, it waits for the turns still open to close, as failed when the stop cut them off, and to be written.

What the checks add to a turn before it is written is in [the checks doc](checks.md).

### Save as fixture

A fixture is a turn record saved where you decide, to replay from the viewer, with `replay` or with `test`.

- **What is written.** The turn's record as the store holds it, whole: the conversation's earlier turns embedded and nothing stripped, as `<name>.json` at the top of the fixtures folder, atomically. The folder is created on the first save.
- **Which turns.** Any turn in the store, from earlier runs too, and a turn kept in memory after its file failed to write. An open turn has no record yet and is refused: `The turn is still open, so it has no record yet.` A store turn whose file is of a newer turn record version is refused with the line [Reading a record file](#reading-a-record-file) gives.
- **What is in it.** No credential is ever in a record: the proxies remove them before anything is written, as [the model and tool calls doc](model-and-tool-calls.md) describes. Everything else is kept, prompts, tool results and the user's messages included. What content is safe to commit is your call.

**The name** follows one rule, on every platform:

| Rule                                                                                                                     | Refused with                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASCII letters, digits, `-`, `_` and `.`, not starting with a dot                                                         | `A fixture's name uses letters, digits, '-', '_' and '.', and does not start with a dot.`                                                                      |
| Not a device name Windows reserves, CON, PRN, AUX, NUL, COM1 to COM9 or LPT1 to LPT9, alone or before a dot, in any case | `A fixture's name is not CON, PRN, AUX, NUL, COM1 to COM9 or LPT1 to LPT9, alone or before a dot: Windows reserves them for devices and cannot hold the file.` |
| Not a name the folder holds                                                                                              | `<folder>/<name>.json exists already.`, with the first free of `<name>-2`, `<name>-3`, … offered                                                               |

The three refusals are cut from the session's answers to `.hidden`, `con.backup` and a second `restaurants`.

**The prefilled name.** The viewer fills the name field with a slug of the turn's input in brief, by the server's rule: the text lowercased, every run of characters outside ASCII letters and digits one `-`, a `-` at either end dropped, and a slug longer than forty characters cut at its last `-` that keeps it to forty, or at forty characters when no `-` does. An action's name is slugged the same way, and `turn` stands for an input where nothing survives. The fixtures module's tests give `Book a table for 2!` as `book-a-table-for-2`, `Find   the top-10 Chinese restaurants in the US, please.`, padded with spaces, as `find-the-top-10-chinese-restaurants-in`, the action `submit_booking` as `submit-booking`, and a Korean sentence as `turn`.

### The fixtures folder

The config file's `fixtures` setting names the folder: a string, a path relative to the config file's directory when relative. Left out, the folder is `a2ui-spectra-fixtures/` beside the config file, or in the working directory when there is no config file. It is a visible folder outside `.a2ui-spectra/`, meant to be committed. Spectra prints it at start, `Fixtures are saved in <absolute path>`, whether or not it exists yet. Where the config file is found, and that it is read strictly, are in [the command's README](../../tools/spectra/README.md).

The running example's config file:

```json
{
  "$schema": "https://raw.githubusercontent.com/retz8/a2ui-spectra/main/tools/spectra/src/config.schema.json",
  "agent": {"url": "http://127.0.0.1:19962"},
  "fixtures": "./fixtures",
  "tools": [{"variable": "SPECTRA_STUB_TOOL_SERVER_URL", "url": "http://127.0.0.1:19961/mcp"}]
}
```

- **The listing** takes every `.json` file under the folder, recursively, in path order. A fixture is named by its path relative to the folder, without `.json`, with `/` between folders: `nested/no-calls` for `nested/no-calls.json`. A file dropped in by hand lists and replays under any name; only Save as fixture holds a name to the rule. A folder that does not exist lists as empty.
- **A file that is not a turn record v0.1** lists with its reason, as [Reading a record file](#reading-a-record-file) gives it.
- **The saved time** shown for a fixture is the file's modification time. A record carries no saved time and no title.
- **The folder is watched**, so a file dropped in, changed or removed shows at once, after a quiet spell of a tenth of a second; the live stream says `fixtures_changed`. While the folder does not exist, its parent is watched for it to appear. Under `run`, while restart on save watches the folder that holds the fixtures folder, that watch tells its changes. The store and the fixtures folder are passed over by restart on save, so saving a fixture never restarts the agent; [the agent's process doc](agent-process.md) has the watch's rules.
- **`test`** replays this folder when it is given no folder of its own.

### Reading a record file

One reader reads every record file Spectra is handed: a fixture, a store turn's file, the file `replay` takes and each file `test` lists. It checks the shape a replay depends on, not the whole schema:

| The file                                                            | What Spectra says                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Not JSON                                                            | `The file is not JSON: <the parser's message>.`                                                                      |
| Not an object                                                       | `The file is not a turn record v0.1: it is not an object.`                                                           |
| `version` missing, or not of the form `v<major>.<minor>[.<patch>]`  | `The file is not a turn record v0.1: its version is missing.`, or `…: its version is 0.1.` naming a string it holds  |
| A version of that form newer than every one this Spectra reads      | `The file is a turn record v0.2, newer than this Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it.`     |
| Any other version this Spectra does not read, such as `v0.1.0`      | `The file is not a turn record v0.1: its version is v0.1.0.`, not called newer                                       |
| No turns, a turn with no `events`, or a turn without its turn event | `The file is not a turn record v0.1: it has no turns.`, `…: turn 2 has no events.` or `…: turn 2 has no turn event.` |
| An event that is not an object, or holds no `attributes` object     | `The file is not a turn record v0.1: event 3 of turn 2 is not an event.`                                             |

A release reads the versions it knows and refuses every other, one that differs in its third part alone included; the newer line rests on the top-level `version` alone. The rule is the turn record's [Versions](../../specification/turn_record/v0_1/docs/turn_record.md#versions). Where it applies:

- **`replay`** exits 2 with `<file> does not read as a turn record: <the line>`.
- **`test`** reports the fixture as failed with the line, and goes on with the next.
- **The fixtures folder** lists the file with the line in place of its turns.
- **The store** lists a turn whose file is of a newer version with that version in place of its details, and refuses to open it, save it as a fixture or replay it, answering with the newer line. When it writes a conversation's next turn, it reads the earlier turns from the latest file that reads, passing over a newer one.

### What a replay re-sends

A replay sends the record's conversation as one new conversation of the message box, a turn at a time: each turn's wire input is sent once the turn before it has closed.

- **The input.** Each recorded turn's wire input, its parts written back from the record's GenAI shape, the A2UI MIME type as `application/a2ui+json`, its capabilities under their keys and its data model under its version's key, the other metadata unchanged. A turn with no wire input cannot be re-sent: `Turn 2 of the record has no wire input, so there is nothing to send for it.`
- **The envelope.** The record keeps no transport envelope. The A2A version, and send or stream, come from the live agent's card, as the message box chooses them for any message. The A2UI extensions header carries the URIs of the versions the recorded capabilities are keyed by, else the recorded turn's protocol version, else nothing. How the box writes a message is in [the wire doc](wire.md).
- **The ids.** The first turn is sent with no `contextId`, so the agent opens a new conversation, and each later turn carries the `contextId` the agent named. A turn whose recorded previous turn ended waiting for input is sent with the live previous turn's task id when that turn also ended waiting for input, and with none when it did not; any other turn goes without one. `messageId` is fresh for each send, and the wire proxy adds the new turn's `traceparent` as for any host.
- **A fixture is input.** Its inputs reach the agent as written, and with the model live or every call live the agent acts on them with the developer's provider key and tools. A fixture someone else recorded is read before it is replayed live.
- **Where it lands.** The replayed conversation is in the store under the new `contextId` the agent gave it, and is a box conversation like any other: once the replay ends, the composer can carry it on live.

### The pool and the request key

While a replay runs with everything recorded or with the model live, the model proxy and the tool proxy are armed with one pool: every model call and tool call of the record, in turn order and then start order. They are disarmed when the replay ends. The pool is the one place that holds what has been consumed, so a call recorded in one turn can be served in another. An armed proxy asks the pool for every request it gets, placed in a turn or not; placement decides only whether the call is recorded.

Not every recorded call is in the pool. A call read from the agent's own spans has no exchange to serve; an operation the MCP server started is never re-sent; and a notification, a client's response to the server and a session's end are answered as the protocol fixes, below.

**A model call and an HTTP tool call** are keyed by three attributes of the exchange, as the proxy records it: `http.request.method`, `url.full` and `a2ui.http.request.body`, compared by JSON value, so whitespace and the order of an object's keys do not count, nor the sign of a zero, which the record's JSON text does not keep. Headers are no part of the key, and no credential is: a credential in the URL is recorded as `REMOVED` on both sides, so any API key, a placeholder included, matches. A body the exchange leaves out, one that is not JSON, text or form-encoded, keys on the method and the URL alone. The exchange's attributes are in the turn record's [The exchange](../../specification/turn_record/v0_1/docs/turn_record.md#the-exchange). The first call of the restaurant finder's record, cut from [`conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.json`](../../conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.json) and shortened:

```jsonc
// What the key reads
{
  "http.request.method": "POST",
  "url.full": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
  "a2ui.http.request.body": {
    "contents": [{"parts": [{"text": "Top 2 Chinese restaurants in New York"}], "role": "user"}, …],
    "systemInstruction": {"parts": [{"text": "You are a helpful restaurant finding assistant. Your final output MUST be an A2UI UI definition.\n\n…"}]},
    "tools": […],
    "generationConfig": {…}
  }
}
// What it leaves out: every header, such as
//   "http.request.header.x-goog-api-key": ["REMOVED"]
```

`url.full` is the target the proxy resolved, not the address the agent called. A record captured while a base-URL variable pointed the provider at another address misses when replayed without that variable, as the stub's record, whose `url.full` is the stand-in's, would.

**The order.** Exchanges with the same key are served in recorded order, each once, and one more is a miss.

**An MCP request**, one of the Model Context Protocol's JSON-RPC requests to a tool server, is keyed by its method and its params, its JSON-RPC `id` and the whole of `params._meta` left out, params left empty once `_meta` is out counting as none.

| What the client sends                                                                                                      | What the armed tool proxy does                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/call`, `resources/read`, `prompts/get` or any other request                                                         | Serves the first unserved recorded request with its key, in recorded order, each once                                                                                                              |
| Housekeeping: `initialize`, `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`, `logging/setLevel` | Serves the record's latest exchange of the method with the same params, so a paged list gets the page its cursor names, or the latest exchange of the method when none has them, as often as asked |
| A notification, or a response the client posts                                                                             | `202 Accepted` with no body, whether or not the record holds it                                                                                                                                    |
| `ping`                                                                                                                     | The empty result, whether or not the record holds it                                                                                                                                               |
| A `DELETE` carrying `Mcp-Session-Id`, the session's end                                                                    | Serves the record's latest session end, or `204` when the record holds none                                                                                                                        |

When the config file names more than one tool server, each listener is served only the recorded requests, HTTP+SSE openings and session ends made to its own server, by the origin of their `url.full`, so one server's client never gets another's answers; a server whose port moved since the recording then misses. With one tool server, every recorded tool call is its own.

In a served reply, the response's `id` becomes the live request's, and each `notifications/progress` takes the live request's progress token when it asked for progress; nothing else is touched. `Mcp-Session-Id` is served as the recorded `initialize` answered it. An operation the server started is never re-sent: under MCP's older HTTP+SSE transport, a `tools/call` that asked the client something gets its recorded result directly, and under streamable HTTP a POST's stream is served as recorded, a server request inside it included.

**A `GET` to a tool server** is read in four steps, the first that applies:

1. One that matches a recorded HTTP tool call by its key is served as one.
2. One carrying `Mcp-Session-Id` is a streamable HTTP carrier, a stream the server would write on unasked: it is held open with nothing written.
3. One at the path of a recorded HTTP+SSE `initialize`'s stream URL is that session's carrier: it gets the recorded `endpoint` event, and each reply served to a POST on the session is written on it after the POST's `202`.
4. Anything else is a miss.

Disarming closes the carriers the proxy holds.

**The reply as recorded.**

- Its status, and its body.
- Its recorded response headers, less a header recorded as `REMOVED`, `content-encoding`, and `content-length`, which is computed again for a body served whole.
- A JSON body serialised from the recorded value, a text body as its text.
- A stream as one server-sent event per recorded chunk, with its `event` and `id`, written as fast as the agent reads.
- A reply that broke off once it had begun is served as recorded, its chunks or its body, and then the connection destroyed; a call the agent aborted, as recorded and a clean end.
- A call recorded with no response, one whose provider could not be reached, as the proxy's `502` line with the recorded failure.

**A miss** is answered `502` with one plain-text line, which the terminal prints at each miss: `a2ui-spectra's model proxy is replaying, and POST /v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse matched nothing in the record.`, with `tool proxy` for the tool proxy and the path and query with any credential removed. The call is recorded as failed, `error.type` `replay_miss`, the line as its status message, and the request's exchange with no response attributes. Under HTTP+SSE the POST gets the `502`, and the request's JSON-RPC error, code `-32603` with the same line as its message, is written on the session's carrier, where the client waits for its reply; that error is not recorded. A token request and a WebSocket upgrade get the same answer and are not recorded, except from the model proxy with the model live, which passes them on.

**A recorded redirect** is not served, in any mode: a matched call whose recorded status is in the 300s would send the agent's client, its credentials with it, where the record says. It is answered as a miss, `502` and `replay_miss`, carrying no `a2ui.replay.served_from`, with a line of its own naming the status and the host the location named: `a2ui-spectra's model proxy is replaying, and the record answers POST /v1/messages with a redirect, 302 to attacker.example, which a replay does not serve.`

**`a2ui.replay.served_from`**, on a call served from the record, is the span id of the recorded event it was served from. An answer the protocol fixes and a live call carry none. The attribute is in the turn record's [`model_call`](../../specification/turn_record/v0_1/docs/turn_record.md#model_call) and [`tool_call`](../../specification/turn_record/v0_1/docs/turn_record.md#tool_call).

### The modes

| Mode, `a2ui.replay.mode`                 | Model calls                                                        | Tool calls                                          | Verdict | Cost                                                 | Asked for                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- | ------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Everything recorded, `recorded`          | From the record; a miss is a `502`, and nothing leaves the machine | From the record; a miss is a `502`                  | Yes     | Free                                                 | The viewer's "Everything recorded"; `replay <file>`; `test`               |
| Tools recorded, model live, `model_live` | From the record; a miss goes to the provider, recorded as any call | From the record; a miss is a `502`                  | Yes     | The model's tokens, from the request that changed on | The viewer's "Tools recorded, model live"; `replay <file> --model-live`   |
| Live, `live`                             | Every call to the provider, recorded as any call                   | Every call to the tool server, recorded as any call | No      | Every call                                           | The viewer's Re-run live; `replay <file> --live`; `test` does not take it |

- **Nothing to serve.** A record with no call the proxies could serve cannot be replayed with everything recorded; a call known only from the agent's spans, an operation the server initiated, a notification, a client's response and a session end do not count: `The record holds no model call or tool call the proxies can answer with, so there is nothing to serve with everything recorded.` The API's refusal adds `Replay it with the model live.`, and `replay`'s line `Replay it with --model-live.` It replays with the model live, and live.
- **Live** arms no proxy. The record's wire inputs are re-sent as in any replay and every model and tool call goes out, recorded as on any turn. A turn replayed live carries `a2ui.replay.source`, `a2ui.replay.turn` and `a2ui.replay.mode` `live`, and no verdict and no reasons. The terminal prints one line as each turn closes, with its outcome: `Re-run of fixtures/restaurants.json, turn 1 of 2: completed.` A host app's turn that arrives meanwhile is an ordinary turn, and nothing is printed for it.
- Every mode is asked for through [the API](api.md), `POST /api/replays`, under `run` and `attach` alike, and runs by the rules of [One replay at a time](#one-replay-at-a-time).

### The verdict

A turn replayed with everything recorded or with the model live is judged when it closes, against the recorded turn it re-sent. It passes when:

1. **No call missed.** Every call that matched nothing is a reason, `REPLAY_MISS`, naming its kind, its method and its path without the query: `A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent.` A call served from the record, an answer the protocol fixed and a live call all count the same.
2. **Its outcome is the recorded one**, `completed`, `failed`, `cancelled` or `waiting_for_input`; otherwise `OUTCOME_DIFFERS`: `The turn ended failed; the record ended completed.`
3. **Its A2UI messages equal the recorded ones** by JSON value, in order, compared as the flattened sequence of the A2UI parts of the turn's wire outputs, an array part giving its elements. The wire form does not count: one data part holding an array equals one part per message. Otherwise `A2UI_DIFFERS`, naming the first message that differs, `The A2UI differs from the record: message 2 of 3 is not the recorded one.`, with its `path`, a JSON Pointer to that message in the replayed turn; or naming the two counts when one is a prefix of the other, as in the running example, with the `path` of the first message beyond the record when the replayed turn sent more.

The reasons are written on the turn event as `a2ui.replay.reasons`, each a `code`, a `message` and, for one message, its `path`. A recorded call the turn never asked for is not a reason: the terminal says how many there were. The four checks run on a replayed turn as on any turn and report without changing the verdict. A record passes when every turn passes; a turn not sent fails it.

The verdict is taken once, when the turn closes, and is amended onto the turn's file in the store; it does not change when the source record changes later. The provenance, `a2ui.replay.source`, `a2ui.replay.turn` and `a2ui.replay.mode`, is attached as the turn opens, so a turn still open carries no verdict. `a2ui.replay.source` is the record file's path, relative to the working directory when under it, with forward slashes on every platform. The attributes are defined in the turn record's [`turn`](../../specification/turn_record/v0_1/docs/turn_record.md#turn).

### One replay at a time

A replay starts only when no turn is open anywhere, the box's conversations and other hosts' turns included, and only one runs at a time. The box refuses a send while it runs.

| The state                               | The refusal                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A replay is running                     | `A replay is running. Wait for it to end.`; a send from the box, `A replay is running. The message box sends again once it ends.`    |
| A turn is open                          | `A turn is open. Wait for it to close before replaying.`                                                                             |
| The message box cannot send             | The box's reason, such as the agent's card not having answered, or a configured header's variable unset; see [the wire doc](wire.md) |
| A store turn whose file was not written | `The turn's record was not written to the store, so there is no file to replay. Save it as a fixture first.`                         |

What stops a replay once it runs:

- **A turn that cannot be sent**, the wire proxy unreachable or Spectra stopping: the remaining turns are reported as not sent, with the reason, and the record fails.
- **Under `run`, a restart or an exit the agent takes on its own:** the open turn is cut and fails, and the remaining turns are reported as not sent, with `The agent was restarted.` or the terminal's exit sentence, such as `The agent's process exited with code 1.` The proxies stay armed until that process has stopped, not only until the cut, so a call the agent makes on its way out does not reach the provider.

### The commands `replay` and `test`

Both run headless, with no viewer and no browser. How each takes the agent, a command after `--` or an agent already running, its options and their defaults are in [the command's README](../../tools/spectra/README.md). Both wait for the agent's card with no time limit, then run.

**Where the lines go.** The status lines go to stderr with the `a2ui-spectra:` prefix: the start-up lines, the card wait, the proxies' lines, such as a miss, under `--model-live` or `--live` one line before the first turn saying what goes out live, `fixtures/restaurants.json's inputs are sent to the agent as the record holds them, and each model call the record does not answer goes to your provider, at your cost.`, the box's line per replayed turn, `Replay of fixtures/restaurants.json, turn 1 of 2: passed.`, and a host's turn that opened during the replay. The launched agent's own output goes to stderr as the agent wrote it, without the prefix. Stdout carries the result lines alone, so `a2ui-spectra test > results.txt` keeps the verdicts.

**`a2ui-spectra replay <file>`** replays one record, a fixture or a store turn's file, its path relative to the working directory: with everything recorded, with the model live under `--model-live`, or live under `--live`. `--live` beside `--model-live` is a usage error. It prints:

- one line per recorded turn: `turn 2 of 2: passed`; or `failed`, with its reasons' messages in parentheses; or `not sent`, with the reason the replay stopped before it; and `; 2 of the recorded calls were not asked for` when any of that recorded turn's calls was never asked for by the time its replayed turn closed;
- a closing line for the record, `fixtures/restaurants.json: passed; the replayed turns are in .a2ui-spectra/turns/<conversation>`, the folder named once a turn has landed in it;
- under `--live`, the turn's outcome where its verdict sits, `turn 1 of 2: completed`, and the closing line with how many turns were sent: `fixtures/restaurants.json: 2 of 2 turns sent; the replayed turns are in .a2ui-spectra/turns/f88fe42b-f9be-409a-a8b8-6ac8dabf81b0`, cut from the session's `--live` run;
- when the replay is refused before its first turn, one line, `<file>: failed (<the refusal>)`;
- on a record with nothing to serve, replayed with everything recorded, before the agent is reached: `nested/no-calls.json: failed (The record holds no model call or tool call the proxies can answer with, so there is nothing to serve with everything recorded. Replay it with --model-live.)`.

**`a2ui-spectra test [<folder>]`** replays every `.json` file under the folder, recursively, in path order, as [the fixtures folder](#the-fixtures-folder) lists them, each with everything recorded, in its own conversation, against the one agent. The folder is relative to the working directory, and the config file's fixtures folder when left out. A folder of four files, one of them the unchanged restaurant fixture, gave on stdout, with the exit code 1:

```
later: failed (The file is a turn record v0.2, newer than this Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it.)
nested/no-calls: failed (The record holds no model call or tool call the proxies can answer with, so there is nothing to serve with everything recorded.)
notes: failed (The file is not JSON: JSON Parse error: Unexpected identifier "not".)
restaurants: passed
4 fixtures: 1 passed, 3 failed
```

The parser's message after `The file is not JSON:` is the JavaScript engine's own, and differs between the binary and Node. With the changed prompt, the failed fixture's turns that failed or were not sent are listed under it, indented, with the conversation folder its turns landed in:

```
restaurants: failed
  turn 1 of 2: failed (A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent. The turn ended failed; the record ended completed. The A2UI differs from the record: this turn sent 0 messages, the record sent 3.); 4 of the recorded calls were not asked for
  turn 2 of 2: failed (A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent. The turn ended failed; the record ended completed. The A2UI differs from the record: this turn sent 0 messages, the record sent 4.); 1 of the recorded calls was not asked for
  the replayed turns are in .a2ui-spectra/turns/07d063c0-74c0-45cc-8878-a1965f1cd547
1 fixture: 0 passed, 1 failed
```

- A passing fixture is one line, `restaurants: passed`, with the unasked calls of all its turns when there are any.
- A file that is not a turn record, and a record with nothing to serve, fail before anything is sent.
- A fixture whose replay is refused fails on one line, `<name>: failed (<the refusal>)`; one whose first turn cannot be sent fails with its turns listed as not sent, with the reason. Either way the next fixture is tried.
- Once the agent's process has ended, or Spectra is stopping, each remaining fixture is not run: `<name>: not run (<the reason>)`, the reason the terminal's exit sentence, such as `The agent's process exited with code 1.`, or `Spectra is stopping.`
- The summary counts the fixtures and those that passed, then, when any failed or was not run, those that failed, and those not run when there are any, as `4 fixtures: 1 passed, 3 failed` above.

**Exit codes.**

| Code | `replay`                                                                                                                                                  | `test`                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0    | The record passes; under `--live`, every turn was sent, whatever its outcome                                                                              | Every fixture passes                                          |
| 1    | The record fails; under `--live`, a turn was not sent; the replay is refused; nothing to serve with everything recorded, said before the agent is reached | A fixture fails or is not run                                 |
| 2    | The file is missing or does not read as a turn record; a usage error                                                                                      | The folder is missing or holds no `.json` file; a usage error |

Both commands also exit 1 when the config file does not read; when the message box cannot send, said before anything is sent; and when the agent's process ends mid-run, the remaining turns reported as not sent and the remaining fixtures as not run, the agent's exit said on stderr and not returned. What gives 2 is said before the agent is launched or its card waited for. A usage error, such as an agent's URL given neither on the command line nor in the config file, wins over the nothing-to-serve line: that line is printed first, and the command exits 2. Stopped by a signal, such as Ctrl-C, either command prints the result lines known so far, the turns not yet judged as not sent and the fixtures not yet run as not run, with `Spectra is stopping.`, and exits 128 plus the signal's number, as `run` does in [the agent's process doc](agent-process.md).

**One warning.** When a record replays with everything recorded or with the model live, none of its replayed turns holds a model call or a tool call, and some of its recorded calls are not asked for, stderr says so, naming the two usual causes:

```
No model call and no tool call reached the proxies while fixtures/restaurants.json replayed, and none of its recorded calls was asked for. An agent already running needs the variables Spectra prints set in its shell, and an agent that hardcodes its model or tool endpoints is not redirected.
```

The line is the one `replay_report.ts` writes, as the commands' end-to-end test meets it on the restaurant fixture with the agent already running without the variables. It does not change the verdict: such a turn passes when its outcome and its A2UI match the record, and the live calls it made were paid for. How an agent's calls are redirected to the proxies is in [the model and tool calls doc](model-and-tool-calls.md).

### In the viewer

The viewer puts Save as fixture, Replay and Re-run live in a turn's header, and lists the fixtures folder in its Fixtures section. How each is drawn, and how a replayed turn, its verdict, a miss and a live call are shown, is in [the viewer doc](viewer.md). The rules behind them:

- **Save as fixture** is on a store turn, and off on an open turn. It uses the [name rule](#save-as-fixture) and the prefilled slug above, through `POST /api/fixtures`.
- **What each control sends.** A store turn's Replay replays its file: the conversation up to and including that turn. A fixture's Replay replays the whole fixture, whichever of its turns is in view. Re-run live sends the conversation again up to and including the turn in view, live: a store turn by its trace id, a fixture's turn by the fixture's name and its recorded trace id.
- **Replay's two rows** are the two modes, each labelled with its cost. "Everything recorded" is free. "Tools recorded, model live" costs up to the record's estimated cost: every ended model call of the record priced as the turn header prices it, from [the price table](model-and-tool-calls.md), calls a replay served included, since a request that changed could cost them again. On a record with nothing to serve, the first row is off and the second's cost is unknown.
- **When they are off.** Re-run live and both rows of Replay are off for the first reason that applies: not connected to Spectra; a store turn whose file was not written, "Save it as a fixture first"; the message box's reason it cannot send; a replay running; a turn open. The server is the authority on a refusal, and its answer is shown as it is.
- **A replayed turn's source** is named by the first that applies: a fixture the folder lists at the recorded path; else a store turn carrying the recorded trace id; else the path's base name, the source being gone. A recorded call of a store turn's source is named by the turn that holds it, since a replay sends the conversation and the call may sit in another of its turns than the one the replayed turn stands for.
- **While a replay runs**, the box does not send, and the context bar names the source and the turn of the total.

## When things go wrong

| What happens                                                                                  | What you see, and what to do                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A request changed since the recording: the prompt, a tool's argument, a model                 | `… is replaying, and <method> <path> matched nothing in the record.` on stderr, `REPLAY_MISS` in the turn's reasons. Replay with `--model-live` to pay from the changed request on, or record the turn again                                                                                                                                  |
| Something in each request changes every run, such as a date or a random id                    | Every replay with everything recorded misses at that request. Keep the value out of the request, or replay with the model live                                                                                                                                                                                                                |
| The provider's address was set through a base-URL variable when recorded                      | Misses on every model call when replayed without it, as `url.full` is the target the proxy resolved. Replay with the same variables set                                                                                                                                                                                                       |
| The agent is already running without Spectra's variables, or hardcodes its endpoints          | `No model call and no tool call reached the proxies while … replayed …` on stderr. The calls went live and were paid for                                                                                                                                                                                                                      |
| The agent opens its MCP session at its start, before any turn                                 | Its `initialize` is not in the record, as housekeeping before any turn is forwarded and not recorded. The proxies are armed only while a replay runs, so a session opened at the agent's start reaches the tool server, which must be running then. An `initialize` the agent sends while a replay runs misses, and the agent loses its tools |
| The record holds no call to serve                                                             | `The record holds no model call or tool call the proxies can answer with, so there is nothing to serve with everything recorded.` Replay with the model live                                                                                                                                                                                  |
| The file is of a newer turn record version                                                    | `The file is a turn record v0.2, newer than this Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it.`                                                                                                                                                                                                                              |
| A host app sends a turn while a replay with everything recorded, or with the model live, runs | It is captured as any turn, and its calls meet the armed proxies; the terminal names it: `A turn from another host opened while <source> replays: <its input in brief>, trace <id>. Its model and tool calls meet the record the proxies are replaying.`                                                                                      |
| A turn is open, or a replay is running                                                        | The replay is refused, as [One replay at a time](#one-replay-at-a-time) lists                                                                                                                                                                                                                                                                 |
| The agent restarts, or exits, during a replay                                                 | The open turn fails, and the rest are not sent: `The agent was restarted.` or `The agent's process exited with code 1.`                                                                                                                                                                                                                       |
| A store turn's file failed to write                                                           | It can be saved as a fixture, but not replayed or re-run from the store: "Save it as a fixture first"                                                                                                                                                                                                                                         |
| A fixture name is refused                                                                     | The rule's line, or the first free numbered name                                                                                                                                                                                                                                                                                              |
| The store's directory cannot be created                                                       | `Spectra cannot create its store at <directory>: <reason>`, and Spectra stops                                                                                                                                                                                                                                                                 |

## Design decisions

| Decision                                                                                                | What it buys                                                                                                                                                                                                    | What it costs                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A fixture is a turn record, the store's own file copied whole                                           | One format for the store, the fixtures, `replay` and `test`; a fixture replays the whole conversation on its own                                                                                                | Each file repeats the conversation's earlier turns, so files grow with the conversation                                           |
| Replay drives the real agent over the wire, through the message box                                     | The agent runs its own code, unchanged; a replayed turn is captured, checked and stored as any turn; the box can carry the conversation on afterwards                                                           | One replay at a time, with no other turn open, and the box must be able to send                                                   |
| Key on the method, the URL and the body by JSON value, headers and credentials left out                 | An unchanged agent is matched exactly; a changed prompt shows as a miss at the request that changed; no credential is needed or kept                                                                            | A value that changes every run misses; the key depends on the resolved target, so the base-URL variables must match the recording |
| Same-key calls served in recorded order, each once, from one pool for the whole record                  | Repeated calls and retries replay as they happened; a call recorded in one turn can be served in another                                                                                                        | A call the agent makes more often than recorded misses                                                                            |
| MCP housekeeping matched by its method, its params first, and served as often as asked                  | A client that lists tools or initialises more or less often than recorded still replays                                                                                                                         | Only the record's latest answer of each method and params is served                                                               |
| Modes differ only in what a miss does, and tools have no live fallback                                  | Everything recorded is free and needs no provider, for CI; with the model live, a prompt edit pays only from the changed request on, while the tools keep their recorded results and their servers need not run | A changed tool call misses in both modes; a replay with tools live is the live mode, which takes no verdict                       |
| The verdict compares the outcome and the A2UI by JSON value, as a flat sequence                         | The wire form the agent picks does not count; the checks stay informative without gating the verdict                                                                                                            | Text parts and other content beside the A2UI are not compared                                                                     |
| The proxies, armed, answer every request, placed in a turn or not                                       | Nothing the agent calls during a replay reaches a provider unasked, background calls included                                                                                                                   | Another host's turn during a replay meets the armed proxies                                                                       |
| The wire input is re-sent from the record's transport-neutral shape, the A2A version from the live card | A record replays against an agent whose A2A version or streaming choice has moved                                                                                                                               | The original request's envelope is not reproduced                                                                                 |
| Fixtures in a visible folder the adopter names; the store git-ignored                                   | Fixtures are committed beside the agent and run in CI; the store fills freely during development                                                                                                                | What a fixture holds, prompts and tool results included, is the adopter's to review before committing                             |
| A record of any version this Spectra does not read is refused, a newer one by name                      | A record is never misread; the line says which side to upgrade                                                                                                                                                  | A record from a newer Spectra needs an upgrade to replay                                                                          |
| The verdict is taken once, at the turn's close, and stored with the turn                                | A stored replayed turn states what happened against the record as it was                                                                                                                                        | A verdict does not follow later edits to the fixture                                                                              |

## Known limits

- An agent that opens its MCP session at its start, before any turn, has no `initialize` in its records. That session reaches the tool server, so the server must be running when the agent starts, under `replay` and `test` too; an `initialize` the agent sends while a replay runs misses.
- A request carrying a value that changes every run, such as the current date or a random id, cannot replay with everything recorded.
- `test` replays with everything recorded only; it takes neither `--model-live` nor `--live`.
- The verdict judges the A2UI and the outcome; a changed text answer beside unchanged A2UI passes.
- Drive no other host during a replay: its turn's calls meet the armed proxies.
- A fixture cannot be edited from Spectra, such as a recorded tool result changed before a replay; edit the file by hand.

## Trying it

On your own agent, record once and replay as often as you like:

```bash
a2ui-spectra run --agent-url <url> -- <your agent's command>    # send a turn from the message box, then Save as fixture
a2ui-spectra test --agent-url <url> -- <your agent's command>   # replay every fixture, with everything recorded, for CI
```

With everything recorded, no model call leaves the machine, so the provider's key can be a placeholder if the agent's SDK needs one to start: no credential is part of the key.

The repository's own suites replay recorded traffic without a model:

- The model replay suite, [`conformance/model_replay/replay_v0_1.yaml`](../../conformance/model_replay/replay_v0_1.yaml), arms the model proxy with each model capture case's expected record and checks that every recorded reply is served as recorded, and that a changed request misses.
- The tool replay suite, [`conformance/tool_replay/replay_v0_1.yaml`](../../conformance/tool_replay/replay_v0_1.yaml), does the same for the tool proxy over each MCP transport and the plain HTTP routes.
- The commands' end-to-end test, [`tools/spectra/src/commands_end_to_end.test.ts`](../../tools/spectra/src/commands_end_to_end.test.ts), records the stub's conversation under `run` and replays it with `replay` and `test`, as the running example does.

## Where the code is

| What                                                                                                      | Where                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The contract: a replayed turn's attributes, a served call, a miss, the versions                           | [`specification/turn_record/v0_1/docs/turn_record.md`](../../specification/turn_record/v0_1/docs/turn_record.md#turn)                                                                                                                                                                                                                                                                                                                |
| Reading a record file, and the versions this Spectra reads                                                | [`tools/spectra/src/record/read_record.ts`](../../tools/spectra/src/record/read_record.ts), [`tools/spectra/src/record/versions.ts`](../../tools/spectra/src/record/versions.ts)                                                                                                                                                                                                                                                     |
| The store, and writing a closed turn to it                                                                | [`tools/spectra/src/store/store.ts`](../../tools/spectra/src/store/store.ts), [`tools/spectra/src/recorder.ts`](../../tools/spectra/src/recorder.ts)                                                                                                                                                                                                                                                                                 |
| The fixtures folder: Save, the name rule, the slug, the listing, the watch                                | [`tools/spectra/src/fixtures/fixtures.ts`](../../tools/spectra/src/fixtures/fixtures.ts), [`tools/spectra/src/windows/names.ts`](../../tools/spectra/src/windows/names.ts)                                                                                                                                                                                                                                                           |
| What a replay re-sends, and the replay's driver                                                           | [`tools/spectra/src/replay/inputs.ts`](../../tools/spectra/src/replay/inputs.ts), [`tools/spectra/src/message_box.ts`](../../tools/spectra/src/message_box.ts)                                                                                                                                                                                                                                                                       |
| The pool and the request key                                                                              | [`tools/spectra/src/replay/pool.ts`](../../tools/spectra/src/replay/pool.ts)                                                                                                                                                                                                                                                                                                                                                         |
| A recorded call served as a reply, and the miss line                                                      | [`tools/spectra/src/replay/served.ts`](../../tools/spectra/src/replay/served.ts)                                                                                                                                                                                                                                                                                                                                                     |
| The armed proxies                                                                                         | [`tools/spectra/src/model_proxy/proxy.ts`](../../tools/spectra/src/model_proxy/proxy.ts), [`tools/spectra/src/tool_proxy/serving.ts`](../../tools/spectra/src/tool_proxy/serving.ts)                                                                                                                                                                                                                                                 |
| The verdict                                                                                               | [`tools/spectra/src/replay/verdict.ts`](../../tools/spectra/src/replay/verdict.ts)                                                                                                                                                                                                                                                                                                                                                   |
| The commands `replay` and `test`, and their result lines                                                  | [`tools/spectra/src/replay_command.ts`](../../tools/spectra/src/replay_command.ts), [`tools/spectra/src/replay_report.ts`](../../tools/spectra/src/replay_report.ts)                                                                                                                                                                                                                                                                 |
| The routes that save a fixture and start a replay                                                         | [`tools/spectra/src/api.ts`](../../tools/spectra/src/api.ts)                                                                                                                                                                                                                                                                                                                                                                         |
| The viewer: the fixtures list, the Replay rows and their cost, why they are off, a replayed turn's source | [`tools/spectra_viewer/src/model/fixtures.ts`](../../tools/spectra_viewer/src/model/fixtures.ts), [`tools/spectra_viewer/src/model/dev_loop.ts`](../../tools/spectra_viewer/src/model/dev_loop.ts), [`tools/spectra_viewer/src/model/provenance.ts`](../../tools/spectra_viewer/src/model/provenance.ts), [`tools/spectra_viewer/src/components/FixtureControls.tsx`](../../tools/spectra_viewer/src/components/FixtureControls.tsx) |
| The replay suites and their harnesses                                                                     | [`conformance/model_replay/`](../../conformance/model_replay), [`conformance/tool_replay/`](../../conformance/tool_replay), [`tools/spectra/src/model_proxy/replay.conformance.test.ts`](../../tools/spectra/src/model_proxy/replay.conformance.test.ts), [`tools/spectra/src/tool_proxy/replay.conformance.test.ts`](../../tools/spectra/src/tool_proxy/replay.conformance.test.ts)                                                 |
| The end-to-end tests of the commands and the fixtures                                                     | [`tools/spectra/src/commands_end_to_end.test.ts`](../../tools/spectra/src/commands_end_to_end.test.ts), [`tools/spectra/src/fixtures_end_to_end.test.ts`](../../tools/spectra/src/fixtures_end_to_end.test.ts)                                                                                                                                                                                                                       |
| This doc's diagram, its source and its two exports                                                        | [`docs/design/diagrams/`](diagrams)                                                                                                                                                                                                                                                                                                                                                                                                  |

## Words used in this doc

| Word         | Meaning                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Turn record  | The file format of a turn, the conversation's earlier turns embedded; the contract every capture path writes and every fixture is          |
| Store        | `.a2ui-spectra/turns/`, where Spectra writes a turn record per captured turn                                                               |
| Fixture      | A turn record in the fixtures folder, saved to be replayed                                                                                 |
| Replay       | Sending a record's conversation to the agent again while the proxies answer its calls from the record                                      |
| Re-run live  | The viewer's replay in the live mode: the conversation sent again up to a turn, every call live                                            |
| Mode         | What a replay serves from the record: everything recorded, tools recorded with the model live, or nothing, live                            |
| Wire input   | What the host sent the agent for a turn, as the record holds it                                                                            |
| Pool         | Every recorded model and tool call of the record a replay serves from, and what has been consumed                                          |
| Request key  | What a request is matched by: the method, the URL and the body for a model or HTTP tool call; the method and the params for an MCP request |
| Miss         | A request the record matches nothing for                                                                                                   |
| Housekeeping | MCP's requests matched by their method, their params first, and served as often as asked: `initialize` and the list requests among them    |
| Carrier      | A tool server's `GET` stream the server writes on unasked; held open, or given the recorded `endpoint` event, during a replay              |
| Verdict      | Whether a replayed turn passed against the recorded turn it re-sent                                                                        |
| Provenance   | What a replayed turn stands for: the record file, the recorded turn and the mode                                                           |
| Message box  | Spectra's own host for the agent, which sends a turn's message and drives a replay                                                         |
| MCP          | The Model Context Protocol, over which an agent calls its tool servers                                                                     |
| A2A          | The agent-to-agent protocol Spectra talks to the agent over                                                                                |
