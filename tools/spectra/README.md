# Spectra for A2UI

The `a2ui-spectra` command: it attaches to a running A2UI agent over A2A, puts a wire proxy in front of it, checks each turn it captures and writes it to a local store, and serves Spectra's viewer on a local port. The viewer is built in [`../spectra_viewer/`](../spectra_viewer).

## Prerequisites

1. [Node.js](https://nodejs.org/en) 22.
2. Yarn, through Corepack: `corepack enable`.

## Usage

```
a2ui-spectra attach <agent-url> [options]
a2ui-spectra run --agent-url <url> [options] -- <command> [args...]
a2ui-spectra <command> --help
a2ui-spectra --version
```

- `attach` attaches to an agent that is already running at `<agent-url>`.
- `run` starts the agent's command, then attaches to it. The command after `--` starts without a shell, with Spectra's environment and working directory, and writes to Spectra's terminal. Environment variables go before `a2ui-spectra`.

The agent's URL is its base address. Both commands wait, with no time limit, until the agent's card answers at `<agent-url>/.well-known/agent-card.json`, then start the wire proxy and the viewer, print their addresses and open the browser.

| Option                | Meaning                                                                                                      | Default |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| `--agent-url <url>`   | The agent's base address. `run` only, and required there.                                                    |         |
| `--port <n>`          | The viewer's port.                                                                                           | 9820    |
| `--proxy-port <n>`    | The wire proxy's port.                                                                                       | 9821    |
| `--no-open`           | Do not open the browser.                                                                                     |         |
| `--allow-host <name>` | Also answer requests addressed to `<name>`, a host name without a port, such as a tunnel's. Can be repeated. |         |

A port that is taken is an error at start. The viewer's server listens on loopback only and answers requests addressed to `localhost`, `127.0.0.1` and `[::1]`, plus the names given with `--allow-host`.

## The wire proxy

Point a host at the address Spectra prints, `http://127.0.0.1:<proxy-port>` followed by the agent's base path, in place of the agent's URL. The proxy speaks A2A 0.3 and A2A 1.0 over JSON-RPC.

- It forwards every request to the agent's origin with its headers and body as received, except `Host`, which it sets to the agent's. Replies and server-sent event streams pass back as received.
- It rewrites the agent's card, at `/.well-known/agent-card.json`, at `/.well-known/agent.json` and as the extended card, so that each JSON-RPC endpoint in it points at the proxy. Endpoints of other transports are left as they are.
- It reads each `message/send` and `message/stream`, or `SendMessage` and `SendStreamingMessage` in A2A 1.0, as one turn, written as turn record v0.1 events.

At start, Spectra checks where the card puts JSON-RPC. When the card prefers another transport, Spectra warns that hosts following the card's preference bypass the proxy. When the card lists no JSON-RPC interface, or no interface at all, Spectra stops with an error.

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

## The binary

`yarn build:binary` compiles the tool with Bun, pinned as a dev dependency, into `dist/a2ui-spectra` for the host platform. The viewer's build is embedded, and the binary does not load `.env` or `bunfig.toml` files from its working directory.

## Layout

- `src/`: the TypeScript source, with each unit test beside its source as `*.test.ts`.
- `src/cli.test.ts`: the command-line test, which starts Spectra as a process.
- `src/a2a/`: the A2A adapter: the wire proxy, the card rewrite and the turns it captures.
- `src/check/`: the schema check, and the protocol schemas it copies in `src/check/schemas/`.
- `src/store/`: the store.
- `src/recorder.ts`: checks each closed turn and writes it to the store.
- `src/testing/fake_agent.ts`: a small A2A agent the command-line test runs.
- `src/testing/turn_record_schema.ts`: validates the records tests produce against turn record v0.1's schema.
- `src/record/turn_record.ts`: the types for turn record v0.1.
- `dist/`: the compiled tool, with the viewer's build copied into `dist/viewer/`.

## Commands

From `tools/spectra/`:

- `yarn build`: compiles `src/` into `dist/` and copies the viewer's build into `dist/viewer/`, building the viewer first.
- `yarn build:binary`: compiles the binary into `dist/a2ui-spectra`.
- `yarn test`: builds, then runs the unit tests and the command-line test under Node's test runner.
- `SPECTRA_BINARY=dist/a2ui-spectra yarn test`: runs the same tests with the command-line test against the binary.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.
- `node dist/cli.js <command>`: runs the built tool under Node.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
