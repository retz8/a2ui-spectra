# a2ui-spectra-instrumentation

The A2UI step for [Spectra for A2UI](../../README.md), from a TypeScript agent on upstream's agent SDK, `@a2ui/agent`. Installed beside your agent, it reports each prompt the SDK writes and each parse of the model's raw text to Spectra, and changes nothing the SDK does.

In Spectra's turn view, each parse becomes a step of its own: the raw text with each component's characters linked to the tree, the error that stopped a block, the model reply it read and the call that retried it.

## Install

A dev dependency of your agent, in the agent's own `node_modules`, beside its `@a2ui/agent`:

```sh
npm install --save-dev a2ui-spectra-instrumentation
```

It needs Node 22.12 or later. `@a2ui/agent` and `@opentelemetry/api` are peer dependencies: your agent's own copies are the ones used.

## Switch it on

Launch your agent through Node's `--import`, through `a2ui-spectra run`, with the URL your agent serves A2A on:

```sh
a2ui-spectra run --agent-url http://localhost:10002 -- node --import a2ui-spectra-instrumentation/register agent.js
```

For a command that starts Node itself, such as `npm run dev`, set `NODE_OPTIONS="--import a2ui-spectra-instrumentation/register"` for it instead.

Or add one line to your agent, anywhere before it parses or generates a prompt, and launch it as you do today:

```ts
import {instrument} from 'a2ui-spectra-instrumentation';

instrument();
```

An agent that already sets up OpenTelemetry's NodeSDK can list the wrapper among its instrumentations instead:

```ts
import {A2uiInstrumentation} from 'a2ui-spectra-instrumentation';

const sdk = new NodeSDK({instrumentations: [new A2uiInstrumentation()]});
```

`a2ui-spectra run` points the wrapper at Spectra for you. Under `a2ui-spectra attach`, set the variables Spectra prints at start in your agent's shell, then start the agent any of the three ways.

The wrapper uses your agent's tracer provider when it has one, and starts one exporting to Spectra when it has none. `instrument({tracerProvider})` sends the spans to a provider of your own.

## What it supports

| Package                                   | Range             | Tested at                                 |
| ----------------------------------------- | ----------------- | ----------------------------------------- |
| `@a2ui/agent`                             | `>=0.1.0`         | upstream's main at `0888f88b2`, and 0.1.0 |
| `@opentelemetry/api`, the peer            | `>=1.3.0 <1.10.0` | 1.3.0 and 1.9.1                           |
| `@opentelemetry/instrumentation`          | `^0.223.0`        | 0.223.0 and 0.223.2                       |
| `@opentelemetry/exporter-trace-otlp-http` | `^0.223.0`        | 0.223.0 and 0.223.2                       |
| `@opentelemetry/sdk-trace-node`           | `^2.12.0`         | 2.12.0 and 2.12.1                         |

Both inference formats the SDK implements are reported: Direct JSON and Express. The wrapper is on OpenTelemetry JavaScript's 2.x line: an agent whose own OpenTelemetry setup is on 3.x, `@opentelemetry/api` 1.10 with `@opentelemetry/sdk-trace` 3.x, is not supported yet, and npm refuses the install with `ERESOLVE`. The root README's [What Spectra supports](../../README.md#what-spectra-supports) has the rest.

## When nothing shows up

**The turn has no A2UI step.** The wrapper is not installed beside the agent's own `@a2ui/agent`, or is not switched on. The turn view's hint, "How to switch it on", has the forms. A second copy of `@a2ui/agent` elsewhere in the process is left unpatched: the wrapper patches the one it resolves from its own place.

**The agent's output has a warning from the wrapper.** The SDK is below the floor, not installed, or its API has moved, and nothing was hooked. The line names what was found:

```
(node:62685) Warning: a2ui-spectra-instrumentation left @a2ui/agent 0.1.0 unpatched: RendererState.markChecked is missing; it was written against @a2ui/agent 0.1.0, upstream's release of 2026-11-02 (@a2ui/agent >= 0.1.0)
```

**The wrapper started no tracer provider.** The agent's environment names no OTLP endpoint, or names a protocol other than `http/protobuf`. Under `a2ui-spectra attach`, set the variables Spectra prints at start; under `a2ui-spectra run` they are set for you.

**The last parses are missing after Ctrl-C.** The wrapper flushes its spans when the agent's process ends on its own. An agent stopped by a signal keeps only what was exported already, up to five seconds behind.

**The step is there, but says it was reported under a newer turn record.** The wrapper is newer than the running Spectra. Upgrade `a2ui-spectra`.

## How it works

[The A2UI step](../../docs/design/a2ui-step.md) explains what the wrapper hooks, what its spans carry, the pinned API it checks, and what Spectra works out from the spans.

## Development

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-instrumentation build
yarn workspace a2ui-spectra-instrumentation test
yarn workspace a2ui-spectra-instrumentation lint
yarn workspace a2ui-spectra-instrumentation format:check
```

The wrapper capture suite runs the wrapper on the real SDK through the TypeScript driver, in the tool's test target: `yarn workspace a2ui-spectra test`.
