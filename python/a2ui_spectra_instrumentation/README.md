# a2ui-spectra-instrumentation

The A2UI step for [Spectra for A2UI](../../README.md), from a Python agent on upstream's agent SDK, `a2ui-agent-sdk`. Installed beside your agent, it reports each prompt the SDK writes and each parse of the model's raw text to Spectra, and changes nothing the SDK does.

In Spectra's turn view, each parse becomes a step of its own: the raw text with each component's characters linked to the tree, the error that stopped a block, the model reply it read and the call that retried it.

## Install

A dev dependency of your agent, in the agent's own environment:

```sh
uv add --dev a2ui-spectra-instrumentation
```

or, without uv:

```sh
pip install a2ui-spectra-instrumentation
```

`opentelemetry-bootstrap` does not suggest it: install it by name.

## Switch it on

Launch your agent under `opentelemetry-instrument`, which the package installs, through `a2ui-spectra run`:

```sh
a2ui-spectra run -- opentelemetry-instrument python agent.py
```

Or add one line to your agent, before it parses or generates a prompt, and launch it as you do today:

```python
import a2ui_spectra_instrumentation

a2ui_spectra_instrumentation.instrument()
```

`a2ui-spectra run` points the wrapper at Spectra for you. Under `a2ui-spectra attach`, set the variables Spectra prints at start in your agent's shell, then start the agent either way.

The wrapper uses your agent's tracer provider when it has one, and starts one exporting to Spectra when it has none. `instrument(tracer_provider=...)` sends the spans to a provider of your own.

## What it supports

| Package                                                                            | Range            | Tested at                                  |
| ---------------------------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| `a2ui-agent-sdk`                                                                   | `>=0.11.0`       | upstream's main at `0888f88b2`, and 0.12.0 |
| `a2ui-adk`, for `SendA2uiToClientToolset`                                          | its API at 0.3.0 | 0.3.0                                      |
| `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http` | `>=1.39.0,<2`    | 1.39.0 and 1.45.2                          |
| `opentelemetry-instrumentation`                                                    | `>=0.60b0`       | 0.60b0 and 0.66b2                          |
| `wrapt`                                                                            | `>=1.16.0,<3`    | 1.16.0 and 2.5.2                           |

Every inference format the SDK implements is reported: Direct JSON, Express, Elemental and Atom. So is A2UI sent as a tool call through `a2ui-adk`'s `SendA2uiToClientToolset`. The root README's [What Spectra supports](../../README.md#what-spectra-supports) has the rest.

## When nothing shows up

**The turn has no A2UI step.** The wrapper is not installed in the environment the agent runs in, or is not switched on. The turn view's hint, "How to switch it on", has both forms.

**The agent's output has a warning from the wrapper.** The SDK is below the floor, or its API has moved, and nothing was hooked. The line names what was found:

```
a2ui-spectra-instrumentation left a2ui-agent-sdk 0.10.0 unpatched: it is below the version floor; it was written against a2ui-agent-sdk 0.11.0, upstream's release of 2026-11-10 (a2ui-agent-sdk >= 0.11.0)
```

Upgrade `a2ui-agent-sdk` to 0.11.0 or later.

**The agent's output says the wrapper started no tracer provider.** The agent's environment names no OTLP endpoint, or names a protocol other than `http/protobuf`. Under `a2ui-spectra attach`, set the variables Spectra prints at start; under `a2ui-spectra run` they are set for you.

**The step is there, but says it was reported under a newer turn record.** The wrapper is newer than the running Spectra. Upgrade `a2ui-spectra`.

## How it works

[The A2UI step](../../docs/design/a2ui-step.md) explains what the wrapper hooks, what its spans carry, the pinned API it checks, and what Spectra works out from the spans.

## Development

From the repository root, with [uv](https://docs.astral.sh/uv/) and Python 3.10 or later:

```sh
uv sync --all-packages
uv run pytest python/a2ui_spectra_instrumentation   # the wrapper's tests
uv run mypy                                         # strict type checks
uv run pyink --check .                              # the format check
```

The wrapper capture suite runs the wrapper on the real SDK through the Python driver, in the tool's test target: `yarn workspace a2ui-spectra test`.
