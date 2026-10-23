# Spectra for A2UI

The `a2ui-spectra` command: it attaches to a running A2UI agent over A2A and serves Spectra's viewer on a local port. The viewer is built in [`../spectra_viewer/`](../spectra_viewer).

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

The agent's URL is its base address. Both commands wait, with no time limit, until the agent's card answers at `<agent-url>/.well-known/agent-card.json`, then start the viewer, print its URL and open the browser.

| Option                | Meaning                                                                                                      | Default |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| `--agent-url <url>`   | The agent's base address. `run` only, and required there.                                                    |         |
| `--port <n>`          | The viewer's port.                                                                                           | 9820    |
| `--proxy-port <n>`    | The wire proxy's port.                                                                                       | 9821    |
| `--no-open`           | Do not open the browser.                                                                                     |         |
| `--allow-host <name>` | Also answer requests addressed to `<name>`, a host name without a port, such as a tunnel's. Can be repeated. |         |

A port that is taken is an error at start. The viewer's server listens on loopback only and answers requests addressed to `localhost`, `127.0.0.1` and `[::1]`, plus the names given with `--allow-host`.

Under `run`:

- When the agent's process exits, Spectra exits with its exit code.
- When Spectra stops, it sends the stop signal to the agent's process group and force-kills the group after 10 seconds. A second Ctrl-C forces it at once.

## The binary

`yarn build:binary` compiles the tool with Bun, pinned as a dev dependency, into `dist/a2ui-spectra` for the host platform. The viewer's build is embedded, and the binary does not load `.env` or `bunfig.toml` files from its working directory.

## Layout

- `src/`: the TypeScript source, with each unit test beside its source as `*.test.ts`.
- `src/cli.test.ts`: the command-line test, which starts Spectra as a process.
- `src/testing/card_server.ts`: a card-only agent the command-line test runs.
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
