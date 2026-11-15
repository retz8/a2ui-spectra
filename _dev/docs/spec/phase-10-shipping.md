# Phase 10 — Shipping

Spectra made release-ready: the binary for five platforms, packaged for npm, PyPI and GitHub releases, with the install scripts; the release workflow and its rehearsal; the documents in their released form. Nothing is published in this phase. Phase 10 of SPEC.md's roadmap, between Phase 9, upstream v1.0 and supported versions, and Phase 11, the release. The design authority is SPEC.md, in particular its "Distribution and names", "Turn record", "Preview", "Supported versions" and "Governance" sections.

The upstream check at the phase's start read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin, `0888f88b2` (2026-11-13), and found no event: the commit touches no area Spectra uses, every copied file is unchanged, npm and PyPI carry no new release of an upstream package, the five watch-list items are open, and no commit touches a held-by finding's paths.

## Scope

In scope:

- The binary built for five platforms, and Spectra working on Windows x64.
- CI's binary test run on all five platforms.
- The binary's packages for npm, PyPI and GitHub releases, and the six library packages in their published form.
- The install scripts.
- The release workflow, its dry run, and the install check that together are the rehearsal.
- Turn record `v0.1`'s closing review, the newer-record rule, and the preview mismatch line.
- The licence material a release carries.
- The root README's install steps, the packages' READMEs as a DX product, the design docs in `docs/design/`, and a stable public URL for the config file's schema.
- A skill for a coding agent using Spectra.
- An `AGENTS.md` file, and the `CLAUDE.md` file turned into a local file.
- SPEC.md's roadmap, distribution, preview and open list, and `_dev/TODO.md`'s phases, brought in line with this spec.

Out of scope:

- Publishing anything, to npm, PyPI, TestPyPI or a public GitHub release. Phase 11's.
- Removing the local patches of `@a2ui/web_core`, `@a2ui/react` and `@a2ui/markdown-it`, closing turn record `v0.1`, the npm and PyPI accounts and their trusted publishers, and deleting the root README's status line. Phase 11's.
- A2UIVerse's CircleCI preview page committed in A2UIVerse. Phase 11's.
- The demo, the contribution rule and the proposal. Phase 12's.
- Holding the package names before the release, under decision 6.
- Linux on musl. Homebrew and `dart pub global`, after v1 as SPEC.md has them.
- An update check, usage counts, and signing with a paid developer identity, under decisions 12 and 17.
- The versioning of a package on a registry Spectra does not publish to yet, under decision 2.

## Locked decisions

### 1. The first release is `0.1.0`

The first release is `0.1.0`, on the registries' default channel: npm's `latest` and a normal PyPI release. Turn record `v0.1` closes with it.

### 2. One version for the release's packages; compatibility rests on the contracts

The seven packages of `0.1.0` carry one version and are released together from one tag, `v0.1.0`: the binary, on all its channels; the preview core, `a2ui-spectra-preview`; the React, Lit and Angular preview adapters; and the TypeScript and Python wrappers, both named `a2ui-spectra-instrumentation`.

A package's version makes no compatibility claim. The binary judges a wrapper by the turn record version its spans follow, and a preview page by the preview protocol version it announces. Nothing in Spectra compares package versions.

A package on a registry Spectra does not publish to yet has its versioning decided in the phase that adds it.

### 3. No release carries upstream code that upstream has not released

No Spectra artifact ships upstream code that upstream has not published. `0.1.0` holds until upstream publishes.

### 4. The gate on `0.1.0`

`0.1.0` waits for upstream's npm release of the three packages compiled into the binary, `@a2ui/web_core`, `@a2ui/react` and `@a2ui/markdown-it`, carrying the pin's state. It waits for nothing else: the local patches of `@a2ui/lit`, `@a2ui/angular`, `@a2ui/agent`, `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a`, which Spectra uses to build and test and does not distribute, may stand at the release.

### 5. Phase 10 ends at release-ready; the release is a phase of its own

Phase 10 ends when Spectra is release-ready, proven by a rehearsal that publishes nothing public. The release is Phase 11, started when the upstream check reports the npm release of decision 4. The case, the demo, the contribution rule and the proposal, is Phase 12.

Work that follows the release may be brought forward when upstream's release is delayed.

### 6. No package name is held before the release

No package is published to hold a name. The names are taken at the release. As read on 2026-11-15, all eight are free: on npm, `a2ui-spectra`, `a2ui-spectra-preview`, `a2ui-spectra-preview-react`, `a2ui-spectra-preview-lit`, `a2ui-spectra-preview-angular` and `a2ui-spectra-instrumentation`; on PyPI, `a2ui-spectra` and `a2ui-spectra-instrumentation`.

### 7. The platforms

`0.1.0` ships a binary for five platforms, the five upstream's `a2ui` CLI ships for: macOS arm64, macOS x64, Linux x64, Linux arm64 and Windows x64. Spectra works on Windows x64 natively, including starting, restarting and ending the agent's process tree under `a2ui-spectra run`.

### 8. What a platform's binary must pass

On every push and pull request, each of the five platforms' runners runs the tool's test target against that platform's binary. Lint, the format check, the Python checks and the tests run under Node stay on Linux x64 alone.

### 9. The release workflow

A release is made by one GitHub Actions workflow, started by hand, taking a version and a dry-run switch.

- It builds the five binaries once, runs the binary test run on each platform against those files, and publishes those same files.
- It publishes to npm and PyPI through trusted publishing, and creates the GitHub release with checksums and a build provenance attestation.
- The release notes come from a root `CHANGELOG.md`.
- A release that changes the preview protocol says so in its release notes.

Whether the first publish of a new npm package name can go through trusted publishing is established in the workflow's sub-task; npm's documentation, as read on 2026-11-15, places the trusted publisher in an existing package's settings and says nothing of a package that does not exist yet.

### 10. The rehearsal

The rehearsal is the release workflow's dry run and an install check.

The install check runs on all five platforms. The dry run's packages are served from stand-in registries inside the workflow, and each platform's runner installs as an adopter does: through `npx`, through `uvx`, and through the install script reading the workflow's own files. Each install ends with `a2ui-spectra --version` and one turn from the stub agent. The README's install commands are run as written.

The same install check runs after the real publish, against the real registries.

### 11. The install scripts

A shell script for macOS and Linux and a PowerShell script for Windows, served from this repo's `main` on raw GitHub, behaving as the install scripts of upstream's `a2ui` CLI do:

- the platform is detected and its archive downloaded from the GitHub release; on Linux with musl the script stops and says musl is not supported;
- the download is verified against the release's checksums before it is installed;
- the install needs no `sudo`: into `$XDG_BIN_HOME`, else `~/.local/bin`, and on Windows into a folder under `%LOCALAPPDATA%\Programs`; `A2UI_SPECTRA_INSTALL_DIR` names another folder;
- the latest release is installed by default; `A2UI_SPECTRA_VERSION` names another;
- on macOS and Linux no shell file is edited, and when the folder is not on `PATH` the script prints the line to add; the Windows script adds the folder to the user's `PATH`.

### 12. The binary makes no request of its own

The binary never contacts the network on its own: no update check and no usage counts. The requests that leave it are the agent's card, the agent's turns, and what its proxies forward for the agent.

### 13. Turn record `v0.1` before it closes

- A closing review of turn record `v0.1` asks one question: whether anything in it would later have to be changed or removed, as opposed to added to. It reads the record against AG-UI's shapes and against the backlog items that touch the record, and makes its amendments while `v0.1` is a draft.
- The newer-record rule is built as SPEC.md states it: a record of a version newer than the release knows is refused, with a line saying it is newer.
- The closing itself is Phase 11's.

### 14. The preview protocol is matched exactly

The viewer and a preview page speak one preview protocol version. On a mismatch the preview is off and everything else works, and the mismatch line names which side to upgrade.

### 15. The licence material a release carries

- A third-party notices file, generated at build from what is bundled, carried in every artifact: the release archives, each npm package and each wheel. It covers Bun's runtime and the libraries it links, the bundled npm packages with upstream's among them, the viewer's fonts, and LiteLLM's price table. For the LGPL parts it points to Bun's source and its relinking steps.
- Each published package carries its own copy of `LICENSE`.
- The root `LICENSE` loses its MIT block for `eval/bin/transcrypt`, a file this repo does not hold.
- SPEC.md's open list gains the LGPL code the binary links through Bun, for upstream's maintainers to weigh at the move.

### 16. The documents are written in their released form

Phase 10 writes every README, and the viewer's hint for switching on a wrapper, as they read after the release. The root README keeps one status line at its top saying Spectra is not released yet and runs from source; Phase 11 deletes it.

The packages' READMEs are a DX product, their details moved to design docs in `docs/design/`, as A2UIVerse has them.

### 17. No paid signing

The binaries are not signed with a paid developer identity. The macOS binaries carry an ad-hoc signature and the Windows binaries are unsigned. A release's integrity rests on its checksums and its build provenance attestation. The README says how to clear the operating system's warning on a binary downloaded by hand from the release page.

One fact is established on the runners in the release workflow's sub-task: that an install through `npx`, `uvx` or the install scripts meets no such warning.

### 18. The platform packages' names

The npm packages that hold the binary, one per platform, are named with the `a2ui-spectra` prefix, as SPEC.md has every package: `a2ui-spectra-darwin-arm64`, `a2ui-spectra-darwin-x64`, `a2ui-spectra-linux-x64`, `a2ui-spectra-linux-arm64` and `a2ui-spectra-windows-x64`.

### 19. The sub-tasks

| Sub-task | What it achieves | Starts |
| --- | --- | --- |
| 10.1 The five binaries, and CI on the four POSIX platforms | The binary built for all five platforms; the binary test run on macOS arm64, macOS x64, Linux x64 and Linux arm64 on every push and pull request | At once |
| 10.2 Windows x64 | Spectra working on Windows, the agent's process tree started, restarted and ended; the binary test run on a Windows runner | After 10.1 |
| 10.3 The binary's packages | The npm launcher with one package per platform, the PyPI wheel per platform, the release archives with their checksums; the third-party notices file in each | After 10.1 |
| 10.4 The libraries' published form | The preview core, the three preview adapters and the two wrappers publishable: one version set in one place for all seven packages, each with its licence, none referring to the workspace | At once |
| 10.5 The install scripts | The shell script and the PowerShell script | After 10.3 |
| 10.6 The release workflow | The workflow and its dry run; the release notes; the procedure for the steps done by hand | After 10.3 and 10.4 |
| 10.7 The install check | An adopter's install on all five platforms from stand-in registries | After 10.5 and 10.6 |
| 10.8 The contracts at release | Turn record `v0.1`'s closing review and its amendments; the newer-record rule; the preview mismatch line | At once |
| 10.9 The documents | The root README with the install steps behind its status line; the packages' READMEs; the design docs; the viewer's hint for switching on a wrapper; a stable public URL for the config file's schema | The design docs at once; the install text after 10.5 |
| 10.10 The acceptance run | The rehearsal, on all five platforms | Last |
| 10.11 The skill | A skill, in the Agent Skills format, for a coding agent using Spectra | After 10.9, before 10.10 |
| 10.12 The agent instructions | An `AGENTS.md` file; the `CLAUDE.md` file turned into a local file | At once |

Sub-tasks 10.1, 10.4, 10.8 and 10.12, and the design docs of 10.9, run in parallel.

### 20. Phase 11, the release

Phase 11 holds what waits for upstream's release:

- the local patches of `@a2ui/web_core`, `@a2ui/react` and `@a2ui/markdown-it` removed, and the suites run on published upstream;
- the npm and PyPI accounts and their trusted publishers;
- turn record `v0.1` closed, and `0.1.0` published;
- the install check against the real registries, and the root README's status line deleted;
- A2UIVerse's CircleCI preview page committed in A2UIVerse, on the published React adapter. A2UIVerse's CircleCI catalog is on `@a2ui/react` 0.14.0 and the React adapter takes `^0.15.0`, so A2UIVerse moves its renderer first.

## Invariants

- Nothing is published in Phase 10.
- No Spectra artifact ships upstream code that upstream has not released.
- Nothing in Spectra compares package versions.
- The binary makes no request of its own.
- The files a release publishes are the files its tests ran against.
