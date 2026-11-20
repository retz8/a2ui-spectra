# Sub-task 10.13 — The wrappers' OpenTelemetry versions

Which OpenTelemetry releases the TypeScript and Python wrappers support, the ranges their manifests state, the runs that establish them, and the check that keeps them current. Sub-task 10.13 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, added by the 10.4 spec's decision 13, under SPEC.md's "Supported versions". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-20, read `upstream/main` at `496df0e76` (2026-11-19), 38 commits after the pin `0888f88b2`, the reading the 10.6 spec opens with, and found no event.

As read on 2026-11-20:

- **The manifests.**
  - The TypeScript wrapper, `typescript/instrumentation/package.json`: `@opentelemetry/instrumentation` `0.223.0`, `@opentelemetry/exporter-trace-otlp-http` `0.223.0` and `@opentelemetry/sdk-trace-node` `2.12.0` as dependencies, each exact; `@opentelemetry/api` as a peer at `>=1.3.0 <1.10.0`, and as a dev dependency at `1.9.1`; `engines.node` `>=22.12`.
  - The Python wrapper, `python/a2ui_spectra_instrumentation/pyproject.toml`: `opentelemetry-api>=1.39.0`, `opentelemetry-sdk>=1.39.0`, `opentelemetry-exporter-otlp-proto-http>=1.39.0`, `opentelemetry-instrumentation>=0.60b0` and `wrapt>=1.14.0`, none with an upper bound.
- **What is shared with the agent.** In TypeScript, `@opentelemetry/api` alone, the peer; the three dependencies are the wrapper's own copies, which npm shares with the agent's where both ranges admit one version. In Python, every distribution, the environment being one.
- **What the suites run on.** `yarn.lock` resolves `@opentelemetry/api` 1.9.1, `@opentelemetry/instrumentation` and the exporter 0.223.0 and `@opentelemetry/sdk-trace-node` 2.12.0. `uv.lock`, under Python 3.11 and later, resolves `google-adk` 2.13.0, OpenTelemetry 1.44.0, `opentelemetry-instrumentation` 0.65b0 and `wrapt` 2.5.2; under Python 3.10, `google-adk` 2.7.0, OpenTelemetry 1.43.0 and `opentelemetry-instrumentation` 0.64b0. CI runs Python 3.12, from `.python-version`.
- **CI.** `.github/workflows/checks.yml`, the definition CI and the release workflow both run. Its one job on Linux x64 syncs the Python workspace from the lockfile and runs the Python wrapper's `pytest` suite, 57 cases, and `yarn test:all`, which holds the TypeScript wrapper's own tests and the wrapper capture suite through both drivers. The sub-task 6.3 spec has the `pytest` suite not covering "the span attributes case by case, which is the capture suite's". Nothing runs either wrapper at a floor its manifest states, or at OpenTelemetry's published latest.
- **OpenTelemetry Python on PyPI.** The latest is 1.45.2, with `opentelemetry-instrumentation` 0.66b2, of 2026-10-29; 1.39.0 and 0.60b0 are of 2025-12-03.
  - `opentelemetry-python`'s `rationale.md`: "users can take a dependency on 1.0.0 version of any package, with the assurance that all future releases until 2.0.0 will be backward compatible."
  - `opentelemetry-instrumentation` 0.66b2 requires `opentelemetry-api~=1.4` and `wrapt<3.0.0,>=1.0.0`; 0.60b0 requires `opentelemetry-api~=1.4` and `wrapt<2.0.0,>=1.0.0`. `opentelemetry-exporter-otlp-proto-http` 1.45.2 requires `opentelemetry-api~=1.15`. `opentelemetry-sdk` 1.45.2 requires `opentelemetry-api==1.45.2`.
  - Its changelog from 1.39.0 to 1.45.2 marks no entry as breaking for what the wrapper imports. 1.45.0 moved the OTLP/HTTP exporter's default transport to urllib3 (#5389), and 1.45.1 restored `requests` (#5714). 1.45.0 widened the `AttributeValue` type (#5266).
- **ADK's OpenTelemetry ranges on PyPI**, `opentelemetry-api` and `opentelemetry-sdk` alike:

  | `google-adk` | First released | Range |
  | --- | --- | --- |
  | 1.28.1 to 1.31.1 | 2026-04-02 | `>=1.36.0,<1.39.0` |
  | 1.32.0 to 1.39.1, and 2.0.0 to 2.2.0 | 2026-05-01 | `>=1.36,<=1.41.1` |
  | 2.3.0 to 2.12.0 | 2026-06-18 | `>=1.39,<=1.42.1`; 2.7.0 alone `<=1.43` |
  | 2.13.0 | 2026-10-23 | `>=1.39,<=1.44` |
  | 2.14.0 to 2.15.0, the latest | 2026-11-07 | `>=1.39,<=1.45.2` |

  `a2ui-adk` 0.3.0 requires `google-adk>=1.28.1`. `a2ui-agent-sdk` 0.11.0 and 0.12.0 require no OpenTelemetry distribution. `google-adk` 2.12.0 and later require Python 3.11.
- **`wrapt` on PyPI.** 1.14.0 (2022-03-10) ships a wheel for Python 3.10 and none for 3.11 or 3.12; 1.16.0 (2023-11-09) is the first with a Python 3.12 wheel; the latest is 2.5.2 (2026-10-29). The wrapper takes `wrapt.BaseObjectProxy` where it exists and `wrapt.ObjectProxy` otherwise.
- **OpenTelemetry JavaScript's two lines on npm.**
  - The 2.x line, under the `latest-2` tag: `@opentelemetry/instrumentation` and `@opentelemetry/exporter-trace-otlp-http` 0.223.2 (2026-11-12), peering on `@opentelemetry/api` `^1.3.0`; `@opentelemetry/sdk-trace-node` 2.12.1 (2026-11-09), peering on the API at `>=1.0.0 <1.10.0`, and the packages under it at `>=1.3.0 <1.10.0`. `@opentelemetry/sdk-trace-node` 2.12.0 carries npm's deprecation notice, "Use @opentelemetry/sdk-trace package"; 2.12.1 carries none.
  - The 3.x line, under `latest`: `@opentelemetry/instrumentation` and the exporter 0.301.2, and `@opentelemetry/sdk-trace` 3.1.1, peering on the API at `>=1.10.0 <1.11.0` and `^1.10.0`, on Node `>=22.15.0`. `@opentelemetry/api` 1.10.0 and the 3.0.0 releases, `@opentelemetry/sdk-trace` 3.0.0 among them, are of 2026-10-20.
  - `opentelemetry-js`'s `doc/3.x/migration-guide.md`: "The SDK 2.x packages declare a peer dependency on `@opentelemetry/api` below 1.10.0, so they cannot be installed together with `@opentelemetry/api@1.10.0`. To use API v1.10.0, upgrade to SDK 3.x. A project that stays on SDK 2.x keeps `@opentelemetry/api` at 1.9.x." Its changelog, at 3.1.0, of the 3.x packages: "Combining these packages with `@opentelemetry/api` 1.9.x never worked: they failed at runtime."
  - `doc/3.x/announcement.md`: "2.x will continue to receive high-severity bugfix and security releases until September 30, 2027".
  - The migration guide on the move to 3.x: `@opentelemetry/sdk-trace-node` and `@opentelemetry/sdk-trace-base` are removed, `@opentelemetry/sdk-trace` in their place, with no `NodeTracerProvider`, the provider, the context manager and the propagators registered by hand; `BatchSpanProcessor` takes `{ exporter, ...options }`; the `OTEL_BSP_*` variables are no longer read.
- **Who is on which line, on npm.** `@google/adk` 2.5.0 (2026-11-12) depends on `@opentelemetry/api` `^1.9.1`, `@opentelemetry/sdk-trace-node` `^2.12.0` and `@opentelemetry/exporter-trace-otlp-http` `^0.223.0`. `@strands-agents/sdk` 1.26.0 peers on the API at `^1.9.0` and `@opentelemetry/sdk-trace-node` `^2.6.1`. `@genkit-ai/core` 1.44.0 depends on the API at `^1.9.0` and the trace SDK at `~1.25.0`. `@arizeai/openinference-instrumentation-openai` 4.6.0 and `@traceloop/instrumentation-openai` 0.27.0 depend on the API at `^1.9.0`. OpenTelemetry's contrib instrumentations at their latest, `@opentelemetry/instrumentation-express` 0.73.0 for one, peer on the API at `^1.10.0` with `@opentelemetry/instrumentation` `^0.301.0`. Upstream's Node restaurant finder at the pin names no OpenTelemetry package.
- **npm's resolutions**, npm 10.9.2, lockfile only, of a stand-in for the wrapper on its 2.x dependencies:

  | The agent | The stand-in's API peer | Result |
  | --- | --- | --- |
  | No OpenTelemetry of its own | `>=1.3.0 <1.10.0` | Resolves, the API at 1.9.1 |
  | On `@google/adk` 2.5.0 | `>=1.3.0 <1.10.0` | Resolves, the API at 1.9.1, one copy of each 2.x package |
  | Its own setup on 3.x, the API at 1.10.0 and `@opentelemetry/sdk-node` 0.301.2 | `>=1.3.0 <1.10.0` | Refused, `ERESOLVE` |
  | Its own setup on 3.x | `>=1.3.0 <1.11.0` | Resolves with "overriding peer dependency" warnings, the stand-in's own 2.12.1 trace SDK beside the API at 1.10.0 |

- **OpenTelemetry's guidance for an instrumentation.**
  - `opentelemetry-js-contrib`'s `GUIDELINES.md`: an instrumentation "SHOULD add an entry in `"peerDependencies"` in `package.json` with the **minimum** API version it requires, as caret range (for example: `^1.0.0`)", and "Instrumentations SHOULD specify these dependencies as caret range (`^1.0.0`), with minimum supported version (and not latest version)."
  - opentelemetry.io, "Libraries should only use the OpenTelemetry API": "Use the earliest stable OpenTelemetry API (1.0.\*) and avoid updating it unless you have to use new features."
- **Finding 30** of `_dev/otel-findings.md`, dated 2026-11-03, "The 3.0 instrumentation and the current trace SDK need different API versions", has the trace SDK's 3.0 "published only as a `development` prerelease", reading `@opentelemetry/sdk-trace-node` and `@opentelemetry/sdk-trace-base`.

## Scope

- What supporting an OpenTelemetry release means.
- The ranges both wrappers' manifests state, and the OpenTelemetry JavaScript line the TypeScript wrapper is on.
- The runs at each range's two ends.
- The check that reads a new OpenTelemetry release.
- The documents' statements of the supported OpenTelemetry releases, finding 30, and the backlog.

Out of scope: publishing anything; the TypeScript wrapper on OpenTelemetry JavaScript 3.x; a Python floor below OpenTelemetry 1.39.0; the Python versions the wrapper runs under; a scheduled run on OpenTelemetry's newest releases; the packages' READMEs as a DX product, sub-task 10.9.

## Locked decisions

### 1. Tested ends

A wrapper supports an OpenTelemetry release when the release lies in a range whose two ends the wrapper's own suites have passed on, in CI: the floor, and the published latest as of the release. The releases in between are taken on OpenTelemetry's own versioning.

A floor that does not pass is brought to Jioh before a range is rewritten.

### 2. The Python wrapper's ranges

| Distribution | Range |
| --- | --- |
| `opentelemetry-api` | `>=1.39.0,<2` |
| `opentelemetry-sdk` | `>=1.39.0,<2` |
| `opentelemetry-exporter-otlp-proto-http` | `>=1.39.0,<2` |
| `opentelemetry-instrumentation` | `>=0.60b0` |
| `wrapt` | `>=1.16.0,<3` |

### 3. The TypeScript wrapper is on the 2.x line

At `0.1.0` the TypeScript wrapper is on OpenTelemetry JavaScript's 2.x line. An agent whose own OpenTelemetry setup is on 3.x is not supported yet, and the wrapper's README says so.

### 4. The TypeScript wrapper's ranges

| Package | Stated as | Range |
| --- | --- | --- |
| `@opentelemetry/api` | peer | `>=1.3.0 <1.10.0` |
| `@opentelemetry/instrumentation` | dependency | `^0.223.0` |
| `@opentelemetry/exporter-trace-otlp-http` | dependency | `^0.223.0` |
| `@opentelemetry/sdk-trace-node` | dependency | `^2.12.0` |

`engines.node` stays `>=22.12`.

### 5. The latest end is the lockfile

The lockfiles move to the published latest, and CI's existing jobs are the run at the latest end.

- `uv.lock`: OpenTelemetry 1.45.2, `opentelemetry-instrumentation` 0.66b2 and `wrapt` 2.5.2, with `google-adk` 2.15.0.
- `yarn.lock`: `@opentelemetry/api` 1.9.1, `@opentelemetry/instrumentation` and `@opentelemetry/exporter-trace-otlp-http` 0.223.2, and `@opentelemetry/sdk-trace-node` 2.12.1.

### 6. The floor run

The floor end runs in CI on Linux x64, in `.github/workflows/checks.yml`. For each wrapper it holds the packages of decisions 2 and 4 at their floors, read from the wrapper's manifest, and runs both suites: the wrapper's own test suite, and its driver's cases of the wrapper capture suite.

- Python: OpenTelemetry 1.39.0, `opentelemetry-instrumentation` 0.60b0 and `wrapt` 1.16.0.
- TypeScript: `@opentelemetry/api` 1.3.0, `@opentelemetry/instrumentation` and `@opentelemetry/exporter-trace-otlp-http` 0.223.0, and `@opentelemetry/sdk-trace-node` 2.12.0.

### 7. A new OpenTelemetry release

`_dev/tools/upstream_check.mjs` gains a reading: for each OpenTelemetry package the two wrappers' manifests state, and `wrapt`, its published latest beside the version the lockfile resolves; on npm, the `latest-2` tag as the wrapper's line beside `latest` as the 3.x line; and the `@opentelemetry/api` range `@google/adk`'s published latest states.

A newer release is not one of the re-pin procedure's three events and moves no pin. It is handled at the check: the lockfile moves to it, CI runs both ends, and the tested latest in the root README and the two wrappers' READMEs is written again. Where ADK's cap holds the Python lockfile below the published latest, the spec's opening line on the check says so. A failure at the new latest adds a sub-task to the phase that meets it.

### 8. Finding 30

Finding 30 of `_dev/otel-findings.md` keeps its number and gains a standing line: it does not hold. The trace SDK's 3.0 was released on 2026-10-20 as `@opentelemetry/sdk-trace` 3.0.0, the package in place of `@opentelemetry/sdk-trace-node` and `@opentelemetry/sdk-trace-base`, which 3.x removes; and the 2.x packages' cap on the API below 1.10.0 is the rule the migration guide states.

### 9. The documents

- SPEC.md's "Supported versions": a bullet for OpenTelemetry, with decision 1's rule, the Python wrapper from OpenTelemetry 1.39.0 below 2, and the TypeScript wrapper on OpenTelemetry JavaScript's 2.x line with `@opentelemetry/api` from 1.3.0 below 1.10.0.
- The root `README.md`'s "What Spectra supports": a bullet with the two ranges and the tested latest.
- Each wrapper's README, under "Installing": its ranges and the tested latest; the TypeScript wrapper's, decision 3's line on 3.x.
- The root `CHANGELOG.md`'s `0.1.0` section: the wrapper's line gains the ranges.
- `_dev/re-pin-procedure.md`: decision 7.
- `_dev/otel-findings.md`: decision 8.
- `_dev/TODO.md`: the 10.13 line names this spec and gains its done line; the Backlog gains decision 10's lines.

### 10. The backlog

- The TypeScript wrapper on OpenTelemetry JavaScript 3.x, the API at 1.10, `@opentelemetry/sdk-trace` 3.x and Node 22.15: taken up at the first of `@google/adk`'s published latest stating the API at 1.10 or later, an adopter on 3.x asking, and 2027-09-30, the end of 2.x's fixes, approaching. How it moves, one build changing lines or a second build for 3.x, is decided in the sub-task that takes it up.
- A scheduled CI run on OpenTelemetry's newest releases outside the lockfile, which sees the releases ADK's cap keeps out of it.
- The Python versions the Python wrapper runs under: `requires-python` states `>=3.10`, and CI runs 3.12 alone.

### 11. Done

Sub-task 10.13 is done when, with no test skipped or marked:

- both manifests state the ranges of decisions 2 and 4;
- CI passes on one commit: its existing jobs on the lockfiles of decision 5, the binary test run on all five platforms among them, and the floor run of decision 6;
- the upstream check prints decision 7's reading;
- the smoke check on the published agent SDKs passes by hand on the packing command's files, and the done line names the versions it resolved;
- the documents read as decision 9 has them.

The done line carries the CI run, its commit and the counts.

## Invariants

- Nothing is published.
- No range states an end that no run in CI has passed on.
