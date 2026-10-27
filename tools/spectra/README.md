# Spectra for A2UI

The `a2ui-spectra` command: it attaches to a running A2UI agent over A2A, puts a wire proxy in front of it, checks each turn it captures and writes it to a local store, sends messages to the agent from its message box, and serves Spectra's viewer and its API on a local port. The viewer is built in [`../spectra_viewer/`](../spectra_viewer).

## Prerequisites

1. [Node.js](https://nodejs.org/en) 22.
2. Yarn, through Corepack: `corepack enable`.

## Usage

```
a2ui-spectra attach [<agent-url>] [options]
a2ui-spectra run [--agent-url <url>] [options] -- <command> [args...]
a2ui-spectra <command> --help
a2ui-spectra --version
```

- `attach` attaches to an agent that is already running at `<agent-url>`.
- `run` starts the agent's command, then attaches to it. The command after `--` starts without a shell, with Spectra's environment and working directory, and writes to Spectra's terminal. Environment variables go before `a2ui-spectra`.

The agent's URL is its base address. It may come from [the config file](#the-config-file) instead, as `agent.url`; the command line takes precedence over the file, and with neither Spectra stops with a usage error naming both. Both commands wait, with no time limit, until the agent's card answers at `<agent-url>/.well-known/agent-card.json`, saying why they wait, the status the card answered with or that it did not answer, once and again whenever the reason changes; then they start the wire proxy and the viewer, print their addresses and open the browser.

| Option                | Meaning                                                                                                      | Default                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `--agent-url <url>`   | The agent's base address. `run` only; takes precedence over the config file's `agent.url`.                   |                                                                 |
| `--config <path>`     | The config file, relative to the working directory when relative.                                            | `a2ui-spectra.json` in the working directory, when there is one |
| `--port <n>`          | The viewer's port.                                                                                           | 9820                                                            |
| `--proxy-port <n>`    | The wire proxy's port.                                                                                       | 9821                                                            |
| `--no-open`           | Do not open the browser.                                                                                     |                                                                 |
| `--allow-host <name>` | Also answer requests addressed to `<name>`, a host name without a port, such as a tunnel's. Can be repeated. |                                                                 |

A port that is taken is an error at start. The viewer's server listens on loopback only and answers requests addressed to `localhost`, `127.0.0.1` and `[::1]`, plus the names given with `--allow-host`. Ports and allowed hosts are command-line only.

## The config file

`a2ui-spectra.json`, optional, in the directory Spectra is launched from and committed in the adopter's repo, or the file `--config` names. Its settings:

```json
{
  "$schema": "http://localhost:9820/api/config.schema.json",
  "agent": {
    "url": "http://localhost:10002",
    "headers": {"Authorization": "Bearer ${SPECTRA_AGENT_TOKEN}"}
  },
  "catalogs": ["./catalogs/catalog.json"],
  "preview": ["http://localhost:5174/spectra-preview"]
}
```

- `agent.url`: the agent's base address, starting with `http://` or `https://`. With it, `attach`'s argument and `run`'s `--agent-url` may be left out; given, they take precedence.
- `agent.headers`: headers the message box adds to every request it makes to the agent, the card fetch at start included, and the wire proxy forwards like any host's. A `${VAR}` in a value, the bare form only, is replaced from Spectra's environment when the box sends, so the file holds variable names, never values; `$VAR`, `${a-b}` and `${}` are left as written, and substitution runs on header values only. The box's own transport headers, such as `Content-Type` and `Accept`, win over a configured header of the same name. A variable that is not set is reported at start: the header naming it is not sent, the card fetch goes ahead with the headers that resolved, and the box refuses to send, naming the variable, until Spectra is started with it set. Headers are never recorded.
- `catalogs`: the paths of catalog definition files, each carrying its own `catalogId`, relative to the config file's directory when relative. See [the catalog registry](#the-catalog-registry). They are read once at start; a changed definition needs a restart.
- `preview`: the URLs of preview pages built with a Spectra preview adapter, starting with `http://` or `https://`. Read and validated now, used by the preview.
- `$schema`: the schema's address, for an editor's completion and checks; Spectra ignores it. The running tool serves the schema at `GET /api/config.schema.json`.

The file is read strictly. A `--config` file that does not exist, a file that is not valid JSON or does not hold an object, a setting of the wrong type, a key Spectra does not know, such as `header` for `headers`, and a catalog path that does not load each stop Spectra at start with a message naming the file, the setting and the problem. Only the default file being absent is quiet. Spectra prints the file it read settings from, and the ids of the catalogs configured.

## The catalog registry

The catalog definitions Spectra knows, which web core's message processor, the message box's offer, the turn listing's rejection count and the viewer's Structure use:

- The basic catalogs are built in: v0.9's, copied from upstream at the pin into [`src/check/schemas/`](src/check/schemas), which also answers to the v0.9.1 basic catalog URL, `https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json`, upstream's v0.9.1 doc's name for the same file; and v1.0's.
- The configured catalogs come from the config file's `catalogs`, in order. A definition naming `protocolVersion` 1.0 is validated against upstream's catalog definition meta-schema, copied at the pin; one naming no version, or 0.9, must parse, carry a string `catalogId` and be a JSON Schema document. Both are then built through web core's `Catalog.fromJson`. A component or function the definition's maps name that is not listed under `$defs.anyComponent` or `$defs.anyFunction`, which web core would drop, is an error at start, as are two files carrying the same id and a file claiming a basic catalog's id.
- The inline catalogs a host sends in its capabilities, under `inlineCatalogs` of each version's key, are built from the turn's host message when the turn is replayed, for the turn and the conversation's earlier turns, each id once. An inline item whose id is built in or configured, or that web core cannot load, is left out. Web core reads the legacy v0.9 shape, with `functions` as a list and a `theme` map and no `$defs`, as it does a file.
- A surface's catalog id resolves in that order: built in, configured, inline. An id that resolves nowhere gets a stand-in catalog with no component schemas, which web core's relaxed mode lets any component through, and the viewer shows its surface unnested.

## The wire proxy

Point a host at the address Spectra prints, `http://127.0.0.1:<proxy-port>` followed by the agent's base path, in place of the agent's URL. The proxy speaks A2A 0.3 and A2A 1.0 over JSON-RPC.

- It forwards every request to the agent's origin with its headers and body as received, except `Host`, which it sets to the agent's. Replies and server-sent event streams pass back as received.
- It rewrites the agent's card, at `/.well-known/agent-card.json`, at `/.well-known/agent.json` and as the extended card, so that each JSON-RPC endpoint in it points at the proxy. Endpoints of other transports are left as they are.
- It reads each `message/send` and `message/stream`, or `SendMessage` and `SendStreamingMessage` in A2A 1.0, as one turn, written as turn record v0.1 events.

At start, Spectra checks where the card puts JSON-RPC. When the card prefers another transport, Spectra warns that hosts following the card's preference bypass the proxy. When the card lists no JSON-RPC interface, or no interface at all, Spectra stops with an error. When the card lists JSON-RPC only at A2A versions other than 0.3 and 1.0, Spectra warns that the message box cannot send to the agent and keeps running.

Under `run`:

- When the agent's process exits, Spectra exits with its exit code.
- When Spectra stops, it sends the stop signal to the agent's process group and force-kills the group after 10 seconds. A second Ctrl-C forces it at once.

## The store

Each turn the wire proxy captures is checked when it closes and written to the store, `.a2ui-spectra/turns/` in the working directory Spectra was launched from. Spectra prints the turns directory at start.

- `.a2ui-spectra/` holds a `.gitignore` that ignores everything in it. Spectra writes it only when it creates the directory, so a changed or removed `.gitignore` stays as it is.
- One folder per conversation, the A2A `contextId`: `turns/<conversation>/<time>_<trace id>.json`. `<time>` is the turn's start in UTC to the millisecond, such as `2026-10-24T15-30-12.123Z`, so a conversation's files sort by time. `<trace id>` is the turn's trace id. A conversation id made only of letters, digits, `-`, `_` and `.`, not starting with a dot, names its folder as it is; any other is percent-encoded.
- A turn with no conversation id is a file directly in `turns/`, holding only that turn.
- Each file is one complete turn record v0.1, written once, atomically: the turns of the conversation's latest file, then the turn. A conversation carried on after a restart keeps its history.
- The store lists every turn in it, earlier runs included, newest first.

When the store's directory cannot be created at start, Spectra stops with an error. When one turn's file fails to write, Spectra prints an error naming the file and keeps the turn in memory until it stops. When Spectra stops, it waits for the turns still open to close, as failed when the stop cut them off, and to be written.

## The schema check

The schema check validates each A2UI message the agent sent in a turn against the protocol schema of the version the message declares: v0.9, v0.9.1 or v1.0. The host's A2UI messages are not checked. The schemas are upstream's, copied unchanged into [`src/check/schemas/`](src/check/schemas), with their catalog reference bound to a stand-in that accepts any component, any function and any theme; components are the catalog check's. Ajv runs with strict mode off, as upstream's schema tests run it.

The check writes one `check` event, named `schema`, into the turn.

- Its protocol version is the one the agent's first A2UI message declares, else the turn's protocol version. A turn with neither has no schema check event.
- A turn with no A2UI from the agent and a known version passes with no findings.
- Each finding's `path` is a JSON Pointer from the turn object, the record's `turns` entry, to the offending value: `/events/<n>/attributes/a2ui.wire.message/parts/<n>/content`, then the message's index in an array, then the path inside the message.
- Each finding carries `surfaceId` when its message names a surface.
- For a message that fails its schema, the findings are the errors of the message type it names, such as `createSurface`, one per error, in Ajv's words, with the property named for an additional or unevaluated one.

| Code                         | When                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`          | A message declaring v0.9, v0.9.1 or v1.0 fails its schema, including one that names no message type or several |
| `SCHEMA_VERSION_MISSING`     | An object with no `version` string                                                                             |
| `SCHEMA_VERSION_UNSUPPORTED` | A `version` other than v0.9, v0.9.1 and v1.0                                                                   |
| `SCHEMA_NOT_AN_OBJECT`       | Content, or an element of an array, that is not a JSON object                                                  |
| `SCHEMA_VERSIONS_MIXED`      | The agent's messages in one turn declare more than one version                                                 |

## The message box

The message box is Spectra's own host: an A2A client that sends through the wire proxy, so its turns are captured like any other host's. It sends one text part per message, and no data model.

- **The interface.** It follows the card fetched at start. With `supportedInterfaces`, it speaks to the first JSON-RPC entry whose `protocolVersion` is 0.3 or 1.0, compared on major.minor, and sets that entry's `tenant` in each A2A 1.0 request. A card without `supportedInterfaces` is spoken to as A2A 0.3 at its JSON-RPC interface.
- **The method.** `message/stream` in A2A 0.3 and `SendStreamingMessage` in A2A 1.0 when the card declares streaming, else `message/send` and `SendMessage`.
- **The offer.** Every A2UI version Spectra supports, for the agent to choose from: the v0.9, v0.9.1 and v1.0 extension URIs in `X-A2A-Extensions` in A2A 0.3 or `A2A-Extensions` in A2A 1.0, with `A2A-Version: 1.0`; and in the message's metadata, `a2uiClientCapabilities` for v0.9 and v0.9.1 and `a2uiRendererCapabilities` for v1.0, each naming its version's basic catalog, under v0.9.1 by both its URLs, and every configured catalog whose protocol version matches: one naming 1.0 under v1.0, one naming no version or 0.9 under v0.9 and v0.9.1. It advertises only, and sends no catalog inline.
- **The headers.** The config file's `agent.headers`, their variables replaced from Spectra's environment, on every request. While a variable is not set, the box refuses every send with `Can't send · <VAR> is not set in Spectra's environment`, which the composer shows in place of its line, with Send disabled.
- **The conversations.** It holds each one it starts: the `contextId` the agent's first reply names, or the conversation its turn was recorded in when that reply broke off, and the `taskId` to send back after a turn that ended waiting for input. A send continues one of them by its id, or else starts a new conversation. Each run of Spectra starts with none, and a conversation whose agent names no id is not continued.
- **One turn at a time in each conversation.** While a conversation's last turn is open, a send in it is refused; a send in another conversation, or in a new one, goes ahead.

## The API

The viewer's server answers under `/api/`. The routes that change anything take JSON only.

| Route                            | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/context`               | The session: `agentName`, the name on the agent's card, when it has one; `agentUrl`, the agent's URL Spectra was given; `mode`, `"run"` or `"attach"`; `proxyAddress`, the wire proxy's address for a host app to point at; and what the card states, read once at start: `a2aVersions`, the A2A versions of its JSON-RPC entries of `supportedInterfaces` in A2A 1.0, or its `protocolVersion` in A2A 0.3; `a2uiExtensions`, each A2UI extension in its `capabilities.extensions` with the `version` its URI names and its `catalogIds`, the extension's `supportedCatalogIds`; and `examples`, the first example of each of its skills; each in card order. |
| `GET /api/turns`                 | `{"turns": [...]}`, newest first: each turn's `traceId`, `conversationId` when it has one, `startTime`, and `input`, the host's input in brief, when it has one. A closed turn adds its `outcome`, its `agentName` when it has one, its `durationMs`, its `schemaCheck` when it has one, with whether it `passed` and its number of `findings`, and `rejections`, how many of its A2UI messages web core's message processor rejects. The store's turns, earlier runs and turns kept in memory after a failed write included, and the turns open now, with `"open": true`.                                                                                    |
| `GET /api/turns/<trace id>`      | The record of a closed turn: its file's turn record, the conversation's earlier turns included. `409` for a turn still open, `404` for an unknown one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/stream`                | The live stream, as server-sent events. A new subscriber first receives each open turn's `turn_opened` and its `wire_event`s so far, then every event as it comes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /api/message-box`           | `conversations`, the conversations the message box started in this run, oldest first: each one's `conversationId` once the agent has named one, `turns` with the trace ids of the turns the box sent in it, oldest first, and `openTurn` with the trace id of its open turn; `unavailable` with the reason when the box cannot send to the agent; and `unsetVariables`, the variables the configured headers name that are not set in Spectra's environment, when there are any.                                                                                                                                                                              |
| `POST /api/message-box/messages` | Sends `{"text": "…"}`, continuing the box's conversation named by `"conversationId"`, or else in a new conversation. Answers once the wire proxy opens the turn, with its `traceId` and the `conversationId` when known. `404` for a conversation the box did not start in this run, `409` while the conversation's turn is open, `422` when the box cannot send to the agent, `502` when the wire proxy cannot be reached.                                                                                                                                                                                                                                   |
| `GET /api/catalogs`              | `{"catalogs": [...]}`, the catalog definitions Spectra knows, the built-in ones then the configured ones in config order: each one's `id`, its `aliases`, the other ids it answers to, its `protocolVersion` as web core reads it, `0.9` or `1.0`, its `source`, `built-in` or `configured`, its `title` when its definition carries one, and the `definition` itself. The viewer reads it once at connect, and builds the catalogs its Structure nests with from it; inline catalogs it takes from the turn record.                                                                                                                                          |
| `GET /api/config.schema.json`    | The JSON schema the config file is validated against, for an editor's `$schema`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

A turn's `rejections` come from feeding the agent's A2UI messages of the conversation's earlier turns, then the turn's own, one by one into upstream web core's message processor in its relaxed validation mode, as the viewer's conversation replay does, with every catalog the registry knows registered, the catalogs the conversation's hosts sent inline built from their messages, and a stand-in under any other catalog id the messages name; each of the turn's own messages the processor throws on counts, so a bad property on a configured catalog's component counts as the basic catalog's does. The count is not recorded in the turn record.

A turn's `input` is `{"text": …}`, the host's first text part that is not blank, its white space collapsed; else `{"action": …}`, the name of the A2UI action it sent, in `action` or v0.8's `userAction`; else `{"partType": …}`, the type of its first part. An open turn has it once its input has arrived.

The live stream's events:

- `turn_opened`: `{"traceId", "conversationId", "startTime"}`, the conversation id when the host's request names one, or, for a subscriber catching up, once a reply has named it.
- `wire_event`: `{"traceId", "conversationId", "event"}`, each wire input and wire output event as it is captured, the conversation id once the host's request or a reply has named it.
- `turn_closed`: `{"traceId", "turn"}`, sent once the turn is checked and its write has finished, whether or not the write succeeded. `turn` is the turn's own events with its check event, as the record holds it.
- `heartbeat`: `{}`, every two seconds, so a reader can tell a stream that went silent, such as one a proxy holds open after Spectra stopped, from one that is quiet.

## The binary

`yarn build:binary` compiles the tool with Bun, pinned as a dev dependency, into `dist/a2ui-spectra` for the host platform. The viewer's build is embedded, and the binary does not load `.env` or `bunfig.toml` files from its working directory.

## Layout

- `src/`: the TypeScript source, with each unit test beside its source as `*.test.ts`.
- `src/cli.test.ts`: the command-line test, which starts Spectra as a process.
- `src/end_to_end.test.ts`: the end-to-end test, which starts Spectra against the conformance workspace's stub agent and holds a two-turn conversation through the message box's API, continued after a second conversation was started, on A2A 1.0 and on A2A 0.3; and starts it again from a working directory holding a config file with the agent's URL, a token header read from the shell and a configured catalog, against the stub requiring the token, once with the variable set and once without.
- `src/config.ts`: the config file, and `src/config.schema.json`, its schema.
- `src/catalog/`: the catalog registry.
- `src/a2a/`: the A2A adapter: the wire proxy, the card rewrite and the turns it captures.
- `src/check/`: the schema check, the rejection count, and the protocol schemas and catalog definitions copied from upstream in `src/check/schemas/`.
- `src/store/`: the store.
- `src/recorder.ts`: checks each closed turn and writes it to the store.
- `src/turn_hub.ts`: the turns of this run as they happen, for the live stream.
- `src/api.ts`: the API's routes.
- `src/listing.ts`: what the turn listing reads from each turn.
- `src/message_box.ts` and `src/a2a/client.ts`: the message box and its A2A client.
- `src/testing/fake_agent.ts`: a small A2A agent the command-line test runs.
- `src/testing/spectra_process.ts`: Spectra as a process, for the command-line test and the end-to-end test.
- `src/testing/turn_record_schema.ts`: validates the records tests produce against turn record v0.1's schema.
- `src/record/turn_record.ts`: the types for turn record v0.1.
- `dist/`: the compiled tool, with the viewer's build copied into `dist/viewer/`.

## Commands

From `tools/spectra/`:

- `yarn build`: compiles `src/` into `dist/` and copies the viewer's build into `dist/viewer/`, building the viewer first.
- `yarn build:binary`: compiles the binary into `dist/a2ui-spectra`.
- `yarn test`: builds the tool and the conformance workspace, whose stub agent the end-to-end test runs, then runs the unit tests, the command-line test and the end-to-end test under Node's test runner.
- `SPECTRA_BINARY=dist/a2ui-spectra yarn test`: runs the same tests with the command-line test and the end-to-end test against the binary.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.
- `node dist/cli.js <command>`: runs the built tool under Node.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
