# Task 2.1 — The workspaces and the binary

Spec for sub-task 2.1 of Phase 2 — First turn on screen (`_dev/docs/spec/phase-2-first-turn-on-screen.md`): the tool and viewer workspaces, the CLI with `run` and `attach` and their options, the server skeleton, the Bun build, and CI building and running the binary. The Phase 2 spec's decisions on what `run` does, the agent's URL, the server, the workspaces, the binary and the tests apply. Upstream is read from `upstream/main` at 020a9d6f, the Phase 2 pin.

## Scope

- The tool workspace and the viewer workspace, picked up by the root manifest.
- The TypeScript types for turn record v0.1.
- The CLI: `run` and `attach`, their options, help and version.
- The agent's process under `run`.
- The server skeleton, serving the viewer, and the viewer's placeholder page.
- Bun as a pinned dependency, and the binary's build target.
- The command-line test, under Node and against the binary, and CI running it.
- A README for each new workspace.
- Not in scope: the proxy's listener, which is sub-task 2.2; the API and the live stream, which are sub-task 2.4; the viewer's development loop and its tests, which are sub-task 2.5.

## Locked decisions

### 1. The workspaces

The tool is in `tools/spectra/`, named `a2ui-spectra`. The viewer is in `tools/spectra_viewer/`, private, named `a2ui-spectra-viewer`. The root manifest's workspaces add `tools/*`.

### 2. The turn record's TypeScript types

Written by hand in the tool workspace: the file shape, the span fields every event shares, and the union of the nine kinds, with attribute types for the four kinds Phase 2 writes: the turn, the wire input, the wire output and the check. Later phases add their kinds' attribute types when they write them. The viewer imports the types from the tool's source as type-only imports.

### 3. The CLI

`attach` takes the agent's URL as its argument. `run` takes it as `--agent-url`, and the agent's command after `--`. Both take `--port` for the viewer, `--proxy-port` for the proxy, `--no-open` and `--allow-host`. `--help` works on the tool and on each command, and `--version` prints the tool's version. There are no short flags. Arguments are parsed with `parseArgs` from `node:util`, as upstream's scripts do, and the help text is written by hand.

### 4. The agent's URL

The agent's base address. The card is fetched at the URL followed by `/.well-known/agent-card.json`, and a path in the base address is kept.

### 5. The agent's command under `run`

Everything after `--` is the command and its arguments, started directly without a shell, inheriting Spectra's environment and working directory. The child writes to Spectra's stdout and stderr directly, and its input is closed.

### 6. Waiting for the card

`run` and `attach` both wait for the card with no time limit, saying so with the card's address and the option that changes it. Under `run`, the wait ends when the card answers or the child exits.

### 7. When the agent's process exits

Whenever the child exits, before or after its card answers, Spectra says so, shuts down and exits with the child's exit code.

### 8. Ending the agent's process

The child is started as the leader of its own process group. Spectra ends it by sending the stop signal to the group, and force-kills the group if it has not exited after 10 seconds, the time `docker stop` waits by default. A second Ctrl-C forces it at once. Ending the process tree on Windows comes with Phase 8's platform work.

### 9. The browser

Spectra opens the browser unless `--no-open` is given, on either command. It does not inspect the environment to decide.

### 10. Ports

The viewer's port defaults to 9820 and the proxy's to 9821, both unassigned in IANA's port registry. A taken port is an error at start, naming the port and the option that changes it.

### 11. Who can reach Spectra

Both listeners bind to loopback only. The server answers only requests whose `Host` is localhost, 127.0.0.1 or [::1], or a name given with `--allow-host`, which can be repeated. Its routes that change anything accept only JSON. The proxy makes no checks of its own.

### 12. The server skeleton

The server serves the viewer's built files from a copy inside the tool's build output, read from the same path under Node and in the binary. A path that is not a file gets the viewer's `index.html`. There are no API routes. The viewer is a placeholder React page. `--proxy-port` is parsed and validated, and the proxy's listener arrives with sub-task 2.2. `attach` and `run` wait for the card, start the server, print its URL and open the browser.

### 13. Bun

Bun is an exact dev dependency of the tool at 1.4.4, with its install step allowed in the root manifest.

### 14. The binary's build

A separate `build:binary` target in the tool, not part of `build`. Bun compiles the tool's TypeScript source with the copied viewer build embedded. The output is `a2ui-spectra` in the tool's build output directory.

### 15. The command-line test and CI

A test in the tool workspace, run by its `test` target under Node's test runner, starts Spectra as a separate process. It checks `--version` and `--help`; `attach` against a card-only server inside the test, the viewer's index page, and a request with a foreign `Host`; and `run` with that card server as its child, covering the wait, the stop that ends the child's group, and the exit code when the child exits. The same test runs against the binary when an environment variable names it, and sub-task 2.4's end-to-end test uses the same switch. CI stays one job: build, build the binary, lint, format check, test under Node, and test against the binary.

### 16. The package

The tool is at version 0.0.1 until Phase 8 sets the release scheme, and is private until Phase 8.

### 17. READMEs

Each new workspace has a README in upstream's shape. The tool's covers what it is, the two commands and their options, and the build, binary, lint and test steps. The viewer's covers its build and test steps. The root README is unchanged.

### 18. The viewer's toolchain

The viewer mirrors upstream's React sample shell: its React, Vite and React plugin version ranges, its build under wireit, and the root ESLint preset, with React's hooks lint rules switched on. Its test target uses the no-tests fallback until sub-task 2.5 adds tests on Node's test runner.
