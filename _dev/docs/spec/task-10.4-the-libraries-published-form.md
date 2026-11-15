# Sub-task 10.4 — The libraries' published form

The six libraries made publishable: the preview core, `a2ui-spectra-preview`; the React, Lit and Angular preview adapters; and the TypeScript and Python wrappers, both named `a2ui-spectra-instrumentation`. One version set in one place for the seven packages of a release, the binary the seventh, each library with its licence, none referring to the workspace. Sub-task 10.4 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out, for the libraries, its decision 2, one version for the release's packages, and its decision 15, the licence material a release carries, under SPEC.md's "Distribution and names". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-15, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, and found no event: no commit in an area Spectra uses, every copied file unchanged, no new release on npm or PyPI, `specification/versions.json` unchanged, the five watch-list items open, and no commit touching a held-by finding's paths.

The libraries, the registries and upstream, as read and measured on 2026-11-15:

- **The version.** The literal `0.0.1` sits in eleven places: `tools/spectra/src/version.ts`, which the binary prints and the binary's packaging command reads; eight workspace `package.json` files, the tool's, the viewer's, the built-in basic preview's and the five npm libraries'; the Python wrapper's `pyproject.toml` and its `version.py`. The three sample preview pages state `0.0.1` as well. The two wrapper drivers of the wrapper capture suite and the root `pyproject.toml` state `0.0.0`; `conformance` and the root `package.json` state none. One test holds `version.ts` equal to the tool's `package.json`, and nothing holds the rest together. Both wrappers report their own version as their instrumentation scope's version.
- **A pack of each library today.** `yarn pack` in each npm library's folder and `uv build` in the Python wrapper's. No pack holds a `LICENSE`; each manifest states `Apache-2.0`. Each npm pack's manifest carries `"private": true`, the `scripts`, the `wireit` block and the `devDependencies`, and the adapters' `workspace:^` on the preview core has become `^0.0.1`. The core's, the React adapter's and the Lit adapter's packs hold `dist/.tsbuildinfo`. Every `.js.map` carries its source text, `inlineSources` being on in each `tsconfig.json`; every `.d.ts.map` names a file under `src/`, which no pack holds. The sdist holds `tests/` and `.gitignore`. No npm manifest states a `repository`, `homepage` or `bugs`, and the Python wrapper has no `[project.urls]`. The largest pack is 40 KB.
- **What the libraries bundle.** Nothing. The four TypeScript libraries are `tsc` output, and the Angular adapter's built file imports `@a2ui/angular`, `@angular/core`, `@angular/common` and `a2ui-spectra-preview` by name.
- **The preview pages and the core.** An adopter installs an adapter, and the core arrives as its dependency; the three sample pages import nothing from the core. The preview protocol's version is set in the core.
- **The READMEs.** Each of the six libraries' READMEs links into the repo by relative path: the root README's support statement, the sample pages, the turn record document, `conformance/`.
- **The binary's packages**, from sub-task 10.3. The npm launcher and the five platform packages state `repository`, with `tools/spectra` as its `directory`; the wheel states `Repository`. None states a homepage or an issues page.
- **The root `LICENSE`** ends with an MIT block for `eval/bin/transcrypt`, a file this repo does not hold; the binary's packages carry the root file.
- **The two smoke checks**, `_dev/tools/smoke_published_renderers.mjs` and `_dev/tools/smoke_published_agent_sdks.mjs`, each pack the libraries themselves, through `yarn pack` and a wheel built from the repository, into a scratch project outside the workspace. They run by hand, as `_dev/re-pin-procedure.md` says; CI runs neither.
- **Upstream's npm packages**, at the pin. Each carries its own literal version, bumped by `typescript/scripts/increment_version.mjs`, and the packages release separately: `@a2ui/angular` is at 0.14.0 beside `@a2ui/web_core` 0.15.0. `typescript/scripts/prepare-publish.mjs` writes the manifest that is published: an internal `workspace:` dependency becomes a caret range on the package's version, `scripts`, `wireit`, `files` and `devDependencies` are deleted, and the README and the root `LICENSE` are copied in. `@a2ui/web_core` and `@a2ui/agent` list `dist` and `src` in `files`; `@a2ui/react` lists `dist` alone. Each states `repository` with its own `directory`, `homepage` and `bugs`.
- **Upstream's Python packages**, at the pin, take their version from git tags through `hatch-vcs`. On PyPI, `a2ui-agent-sdk` 0.11.0 is a wheel and an sdist.
- **Angular's packages**, released together under one version, state each other exactly: `@angular/common` 21.2.25 has `@angular/core` `21.2.25` as its peer, and `@angular/platform-browser` 21.2.25 states `@angular/core` and `@angular/common` the same way.
- **OpenTelemetry's JavaScript packages on npm.** The TypeScript wrapper depends on `@opentelemetry/exporter-trace-otlp-http` `0.223.0`, `@opentelemetry/instrumentation` `0.223.0` and `@opentelemetry/sdk-trace-node` `2.12.0`, each exact, and takes `@opentelemetry/api` as a peer at `>=1.3.0 <1.10.0`. `@opentelemetry/api` 1.10.0 was published on 2026-10-20. `@opentelemetry/sdk-trace-node` is deprecated, "Use @opentelemetry/sdk-trace package", its latest 2.12.0. `@opentelemetry/core` and `@opentelemetry/sdk-trace` are at 3.1.1. `@opentelemetry/instrumentation` and `@opentelemetry/exporter-trace-otlp-http` are at 0.301.2 and require the API at `>=1.10.0 <1.11.0` and `^1.10.0`. What moving the wrapper to those releases takes has not been read.

## Scope

- Where the version of the seven packages is set, the places that carry it, and its value.
- The command that packs the six libraries and the command that checks the packs, and their run in CI.
- What each pack holds, and what its manifest states.
- The root `LICENSE`.
- The two smoke checks taking the packing command's files.
- The binary's packages stating the issues page.
- The Phase 10 spec's decision 19, `_dev/TODO.md` and `_dev/re-pin-procedure.md`, brought in line.

Out of scope: publishing anything; the TypeScript wrapper's OpenTelemetry dependencies, the ranges both wrappers state for OpenTelemetry and the OpenTelemetry releases they support, sub-task 10.13; the READMEs and their links into the repo, sub-task 10.9; what the release workflow does with its version input, what it tests the packs with, its trusted publishing and attestation, sub-task 10.6.

## Locked decisions

### 1. Where the version is set

The version is set in one committed source, `tools/spectra/src/version.ts`. Every place that carries it holds the same literal. One command writes the version into every such place, and a check, run in CI, fails when any place differs from the source.

### 2. The places that carry the version

The seven released packages alone: `version.ts` and the tool's `package.json` for the binary; the `package.json` of the preview core, of the three preview adapters and of the TypeScript wrapper; the Python wrapper's `pyproject.toml` and its `version.py`.

The workspace packages that are never published carry no release version: each states `0.0.0`, and neither the command nor the check covers them.

### 3. The version's value

Sub-task 10.4 sets `0.1.0`. The version is three numbers; a pre-release version is not provided for.

### 4. The packing command and its check

One command, apart from the binary's packaging command, packs the six libraries into the files a registry receives: five npm tarballs, and the Python wrapper's wheel and sdist. A second command checks them. CI runs both on every push and pull request. The release workflow publishes those files and packs nothing itself.

### 5. The packed manifest of an npm library

The packing command writes each npm library's packed manifest. It keeps what an install reads: the name, the version, the description, the licence, `type`, `exports`, `files`, `sideEffects`, `engines`, `keywords`, `dependencies`, `peerDependencies`, and the fields of decision 9. It drops `private`, `scripts`, `wireit` and `devDependencies`.

The manifests in the repo stay `"private": true`.

### 6. What an npm library's pack holds

- the packed manifest;
- `LICENSE`, the root file, copied in when the pack is made;
- `README.md`, the package's own;
- the built JavaScript, with its source maps;
- the `.d.ts` type files.

No declaration map, no `src/`, no test file and no `.tsbuildinfo`. No third-party notices file: the libraries bundle nothing.

### 7. An adapter's dependency on the preview core

Each adapter's pack states `a2ui-spectra-preview` at the exact version of the release.

### 8. The Python wrapper's files

A wheel and an sdist. The wheel holds the module, with `LICENSE` under `dist-info/licenses/`. The sdist holds `pyproject.toml`, `README.md`, `LICENSE` and `src/`, and nothing else. The `LICENSE` is the root file, copied in when the pack is made.

### 9. Where a package says it comes from

Each of the seven packages states the repository and the issues page, and no homepage. An npm library states its own folder as the repository's `directory`. The binary's packages gain the issues page.

### 10. The root `LICENSE`

The root `LICENSE` loses its MIT block for `eval/bin/transcrypt`, as the Phase 10 spec's decision 15 has it, in this sub-task.

### 11. What the check establishes

For every pack:

- it holds exactly the files of decision 6 or decision 8;
- its manifest states the source's version, the repository and the issues page; an adapter's states the preview core at the exact version; none carries `private`, `scripts`, `wireit`, `devDependencies` or a `workspace:` reference;
- its `LICENSE` is the root file, byte for byte;
- every `exports` target exists in the pack;
- every import in its built code resolves to a file in the pack, or to a dependency or peer its manifest declares.

On CI, each pack is installed outside the workspace and loaded: the core's and the TypeScript wrapper's tarballs by npm into one scratch project, both imported under Node; each adapter's tarball, with the core's, by npm into a catalog app's scratch project of its own, after the peers its pack states, its renderer among them, and every import of its built code resolved there; the wheel by uv into a fresh environment, the Python wrapper imported and its OpenTelemetry entry point found.

### 12. The smoke checks

The smoke check on the published renderers and the smoke check on the published agent SDKs take the packing command's files and pack nothing themselves. They stay by hand: at this sub-task's close, and wherever `_dev/re-pin-procedure.md` runs them.

### 13. The wrappers' OpenTelemetry versions are a sub-task of their own

Sub-task 10.4 packs each wrapper with the dependencies its manifest states, and its check establishes nothing about them. Which OpenTelemetry releases the TypeScript and Python wrappers support, and the ranges their manifests state, are sub-task 10.13, which starts at once, in parallel with this one, and comes before the release workflow of sub-task 10.6.

### 14. The READMEs' links

Sub-task 10.4 packs each README as it is and checks nothing about it. That a packed README's relative links do not resolve where it is shown is sub-task 10.9's, for all seven packages.

### 15. Done

Sub-task 10.4 is done when, with no test skipped or marked:

- on CI, the version check passes, every place of decision 2 stating `0.1.0`;
- on CI, the packing command's seven files pass the check of decision 11, each installed outside the workspace and loaded;
- the binary's packages pass their own check with the issues page stated;
- both smoke checks pass, by hand, on the packing command's files.

### 16. The documents brought in line

- `_dev/TODO.md`: a line for sub-task 10.13, the wrappers' OpenTelemetry versions; sub-task 10.6 after 10.3, 10.4 and 10.13; the 10.9 line gaining that a packed README's relative links do not resolve where it is shown.
- The Phase 10 spec's decision 19: sub-task 10.13 in its table and among the sub-tasks that run in parallel, and sub-task 10.6 after 10.3, 10.4 and 10.13.
- `_dev/re-pin-procedure.md`: the two smoke checks' text, which has them pack from the repository themselves.
- The READMEs that state the commands: the version's command, and the libraries' packing command and its check.

## Invariants

- Nothing is published.
- Every released package states the version `version.ts` holds.
- A pack's manifest and built files refer to nothing in the workspace.
- A library's pack is made by the packing command alone.
