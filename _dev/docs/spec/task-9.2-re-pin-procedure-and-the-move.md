# Sub-task 9.2 — The re-pin procedure and the move

The upstream check and the pin's move as one procedure, and its first run, to `0888f88b2`. Sub-task 9.2 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 1, upstream's current code as the reference, its decision 2, when the pin moves, and its decision 9, the re-pin procedure.

Upstream as read at `upstream/main` `3ed960186` (2026-11-13), one commit after `0888f88b2`, a change to the documentation site's landing page (#4235). npm carries no release since 2026-11-02 and PyPI none since 2026-11-10. None of the three events of the Phase 9 spec's decision 2.

The pin against what is published:

- npm: six packages Spectra uses are behind the pin, `@a2ui/web_core` 0.15.0, `@a2ui/react` 0.15.0, `@a2ui/lit` 0.15.0, `@a2ui/angular` 0.14.0, `@a2ui/agent` 0.1.0 and `@a2ui/markdown-it` 0.2.2. A build of each at the pin states the published version number.
- PyPI: `a2ui-core` 0.6.0, `a2ui-agent-sdk` 0.11.0 and `a2ui-a2a` 0.3.0 are behind the pin; `a2ui-adk` 0.3.0 is the pin's build. Built from git at the pin the three report `0.6.1.dev45`, `0.11.1.dev45` and `0.3.1.dev45`.
- Upstream publishes no pre-release channel on either registry.
- Of the copied files, the upstream sources of six of the eight schemas and catalog definitions differ between `9e8a9bac5` and `0888f88b2`; the two copied conformance catalogs do not.

## Scope

In scope:

- The procedure: its document, the pin file, the check script, the move script, and the line in this repo's CLAUDE.md.
- The first run, to `0888f88b2`: the copied schemas and catalog definitions, the copied conformance catalogs, the upstream packages patched locally to the pin's state, the `a2ui-upstream` worktree, the findings in `_dev/a2ui-findings.md` read again.
- `main` building and CI passing at the pin, with what fails there marked for the sub-task that owns it.

Out of scope:

- SPEC.md's "Upstream reference" line. Sub-task 9.7's, the documents.
- A live turn on a sample at the pin. Sub-task 9.6's, the recordings.
- The Python wrapper's hook table at the pin's agent SDK. Sub-task 9.5's, the wrappers.

## Locked decisions

### 1. The first run's target

`0888f88b2` (2026-11-13), the Phase 9 spec's starting pin, with `upstream/main` one commit ahead of it at `3ed960186`.

### 2. The procedure's form

A procedure document and scripts for the mechanical parts, the scripts under `_dev/tools/`. The check script takes no argument and prints what happened upstream since the pin. The move script takes a commit, copies the listed files from it and writes the new pin. The document holds what a script cannot decide: which finding is one of the three events of the Phase 9 spec's decision 2, the worktree, the local patches, the findings' standing, and which suites to run.

### 3. The pin file

One machine-read file at `_dev/`'s top level, beside `a2ui-findings.md`, as the procedure document is. It holds:

- the pin's commit and date;
- the list of copied files, each with its upstream path and its place in Spectra;
- on a copied file that is not an unchanged copy, the alteration as a JSON merge patch, with its finding's number;
- the upstream packages patched locally;
- the watch list of upstream issues and pull requests;
- the held-by findings, each with its upstream paths.

The scripts read it and the move script writes it. The schemas README, `tools/spectra/src/check/schemas/README.md`, and the conformance catalogs README, `conformance/test_data/catalogs/README.md`, keep their tables, stop stating the hash and name the pin file. The workspace-level CLAUDE.md's line on the `a2ui-upstream` worktree is a by-hand step in the procedure document.

The move script copies each file, applies its listed alterations and prints each one it applied, and verifies that every copy is upstream's file at the pin plus its listed alterations.

### 4. What the check script reads

Five readings, after fetching `upstream` in the sibling fork `../A2UI`:

1. The commits since the pin, as a count and a list per area Spectra uses: the specification, the catalogs, the conformance data, the TypeScript core, renderers and agent SDK, the Python packages, the three core samples and the sample clients.
2. Each copied file, the pin against `upstream/main`: which of the pin file's copied files differ.
3. Each upstream package's published latest, on npm and PyPI, against the version Spectra has, the locally patched ones flagged.
4. `specification/versions.json` at `upstream/main` against the three supported versions: a supported version moved to `deprecated`, or a new version, printed as a change.
5. The watch list, each item with its state, open, merged or closed, read through GitHub's API. It starts with the five the Phase 9 spec names: issue #4082, the bare envelope keys' removal, and for the `@child`, `@action` and `@functionCall` rename, issue #2791, pull requests #4170 and #4171, and issue #4168.

It also prints the commits since the pin that touch the held-by findings' paths, under decision 12.

The script prints and decides nothing. Which event has happened is the procedure document's judgement step.

### 5. What makes the check run, and the trace it leaves

A line in this repo's CLAUDE.md, among its operational rules: at the start of each sub-task and each phase, the upstream check is run as the procedure document says, before the work. The line names the procedure document.

The spec written at a sub-task's start opens with what the check read: `upstream/main`'s commit and date, and which event it found or that it found none.

### 6. The state of `main` when 9.2 closes

9.2 lands the whole move. Each case that fails at the pin is marked expected-to-fail with the sub-task that owns it, and each sub-task removes its own marks. The mark is each runner's own, under which the case still runs: Node's `todo`, pytest's `xfail`, Playwright's `test.fail`. Its reason starts with the owning sub-task's number in one fixed form, so that one search over the repo lists every mark, per sub-task. A conformance suite's YAML case is marked at the smallest unit its harness can mark.

The acceptance run, sub-task 9.8, runs that search and requires it to be empty.

### 7. A break of the build

Where the move breaks the build, a type check or lint, in TypeScript or in Python, 9.2 makes the smallest change that builds and passes, and lists each such change under the sub-task that owns the area. Behaviour stays the owner's. Where the smallest change is more than mechanical, such as an API that is gone with no direct replacement, 9.2 stops and brings it to Jioh.

### 8. The npm packages' local patch

Committed tarballs, wired through root `resolutions`. A script under `_dev/tools/` builds the six packages in the `a2ui-upstream` worktree at the pin, through upstream's own publish preparation, and writes the tarballs into a folder in this repo. The root `package.json` gets one `resolutions` line per package pointing at its tarball. The workspaces' declared versions and the preview adapters' peer ranges stay as they are. The pin file lists the patched packages. Removing one patch is deleting its `resolutions` line and its tarball.

### 9. The Python packages' local patch

uv git sources at the pin's commit: one source per patched package in the root `pyproject.toml`, naming upstream's repository, the pin's full hash and the package's subdirectory, for `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a`. `a2ui-adk` comes from PyPI at 0.3.0. Removing one patch is deleting its source line and locking again.

### 10. The `a2ui-upstream` worktree

Moved, installed and started, with no turn. The worktree is detached at `0888f88b2`. Upstream's uv workspace, its Yarn workspace and Spectra's two wrappers beside the samples are installed again. The three core samples, the Python restaurant finder, the Node restaurant finder and the custom-components example, are each started and their agent card fetched. No message is sent.

The Python wrapper logging that it leaves `a2ui-agent-sdk` unpatched is expected here.

### 11. The findings read again

Each finding in `_dev/a2ui-findings.md` gets a standing line, in the findings file: it holds at the pin; it is fixed upstream, with the commit and the pull request; or it is changed, with what differs now. The file's header is brought to the pin. A fixed finding stays in the file with its number.

A standing is established by reading the finding's component paths at the pin and, where the finding has a runnable reproduction, running it against the `a2ui-upstream` worktree at the pin. A finding whose reproduction needs a model key or a running sample is judged by reading.

The findings are read again on a move only, not on a check.

### 12. Held-by findings

A finding is held-by when Spectra carries something because of it: a workaround in code, an altered copy of an upstream file, or a test expectation that encodes the bug. The reading of decision 11 writes the mark on each such finding, saying what Spectra carries and where. The pin file lists the held-by findings with their upstream paths, and the check script prints the commits since the pin that touch those paths. Whether one of them is the fix is the procedure document's judgement step.

The known candidates: finding 24, upstream's own v1.0 catalogs failing the v1.0 catalog definition meta-schema, for which the copied `composition_catalog_v1_0.json` gains `$defs.anyFunction`; finding 5, the custom-components sample reading capabilities from inside a data part, cited in a check test; finding 31, the Python restaurant finder retrying its model call on `Surface default already exists`, cited in a viewer test.

### 13. A held-by finding fixed at the new pin

An altered copy becomes an unchanged copy in the move: its alteration is deleted from the pin file before the move. A workaround in code or a test expectation is left in place and listed in the move's outcome under the sub-task that owns the area, beside the expected-to-fail marks.

### 14. Left to the build

The files' names, the pin file's format, the tarballs' folder and the exact text of the mark's fixed form.

### 15. Done when

All of these hold on `main`:

1. The procedure exists: the procedure document and the pin file at `_dev/`'s top level; the check script, the move script and the tarball build script under `_dev/tools/`; the line in this repo's CLAUDE.md.
2. The check runs: with the pin at `0888f88b2`, the check script prints its five readings.
3. The copies are at the pin: the pin file names `0888f88b2` and its date, 2026-11-13; the move script reports every copied schema, catalog definition and conformance catalog as upstream's file at the pin plus its listed alterations; the two READMEs name the pin file.
4. The packages are at the pin: the six npm tarballs committed with their `resolutions` lines and a note beside them saying what they are; the three Python packages from uv git sources at the pin, `a2ui-adk` from PyPI at 0.3.0; both lockfiles installing unchanged on a fresh checkout.
5. The worktree is at the pin, as decision 10 leaves it, and the workspace-level CLAUDE.md's line names the new pin.
6. The findings are read: each of the 46 carries its standing at the pin; the held-by findings are marked and listed in the pin file with their upstream paths.
7. CI is green on GitHub: everything `ci.yml` runs passes, the build, the binary, lint, format, mypy, pytest, the test suites and the binary's tests, each case that fails at the pin carrying its mark.
8. The handover is written: this spec's outcome lists, per owning sub-task, 9.3 the checks, 9.4 the viewer and the preview, 9.5 the wrappers and 9.6 the recordings, the marked cases, the mechanical build changes, and any workaround whose finding is now fixed.

## Invariants

- The check script decides nothing.
- Every copied file is upstream's file at the pin plus the alterations the pin file lists for it.
- The pin's hash is written once in this repo, in the pin file.
- `main` builds and its CI passes when 9.2 closes.

### 16. What the build settled

- The procedure document is `_dev/re-pin-procedure.md` and the pin file `_dev/upstream-pin.json`, a JSON file holding `pin`, `copies`, `packages`, `watch` and `heldBy`, with an `upstream` block naming the repository, the fork, its remote and the worktree.
- The scripts are `_dev/tools/upstream_check.mjs`, `_dev/tools/upstream_move.mjs` and `_dev/tools/build_upstream_tarballs.mjs`, on one shared module, `_dev/tools/upstream_pin.mjs`.
- The tarballs are under `vendor/a2ui/`, named as `npm pack` names them, beside a README.
- The mark's fixed form: the reason starts `Sub-task N.M, at the pin: `. Every mark is listed by `grep -rnE "Sub-task [0-9]+\.[0-9]+, at the pin: " --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=_dev .`.
- The copy list holds twelve files: the eight schemas and catalog definitions, the two conformance catalogs, and the TypeScript wrapper driver's two basic catalogs, `conformance/wrapper_driver/typescript/catalogs/basic_v0_9.json` from `specification/v0_9/catalogs/basic/catalog.json` and `basic_v1_0.json` from `catalogs/basic/v1/catalog.json`, which are upstream's files copied unchanged.
- The move script also writes the pin's commit into the three uv git sources in the root `pyproject.toml`; `uv.lock` carries it from there.
- The Python driver, `conformance/wrapper_driver/python/pyproject.toml`, depends on `a2ui-a2a`, `a2ui-agent-sdk` and `a2ui-core` with no version, so that the root's uv git sources apply to all three, and on `a2ui-adk==0.3.0`.
- A wrapper capture case marks a language with `expected_to_fail`, a reason per language, in `conformance/conformance_schema.json`, the harness `tools/spectra/src/receiver/wrapper_capture.conformance.test.ts`, which passes it to Node's `todo`, and `conformance/README.md`.

### 17. The first run

To `0888f88b2` (2026-11-13), `upstream/main` at `3ed960186`.

- The check at the new pin: one commit since, the documentation site's landing page (#4235), in none of Spectra's areas; every copied file unchanged; npm's latest unchanged since 2026-11-02 and PyPI's since 2026-11-10; `versions.json` giving v1.0 `current`, v0.9.1 and v0.9 `previous`, v0.8 `deprecated`; the five watch-list items open; no commit on a held-by finding's paths. None of the three events.
- The copies: the move reports all twelve as upstream's file at the pin, `composition_catalog_v1_0.json` plus finding 24's alteration. Eight differ from the previous pin's: the six of the spec's count and the driver's two.
- The packages: the six tarballs built at the pin, each stating the published version number, wired by six `resolutions` lines; `a2ui-core` 0.6.1.dev45, `a2ui-agent-sdk` 0.11.1.dev45 and `a2ui-a2a` 0.3.1.dev45 from the uv git sources, `a2ui-adk` 0.3.0 from PyPI. On a fresh copy of the tree, `yarn install --immutable` and `uv sync --all-packages --locked` install with both lockfiles unchanged.
- The worktree: detached at `0888f88b2`; its uv workspace synced, which brings upstream's `wrapt` 1.17.3; the Python wrapper installed editable again with the OpenTelemetry set it had; its Yarn workspace installed, the TypeScript wrapper's install kept. The Python restaurant finder ("Restaurant Agent", 10002), the custom-components example ("Contact Lookup Agent", 10004) and the Node restaurant finder ("Restaurant Agent", 10002) each started on the Gemini key and served its agent card; no message was sent. Switched on in the worktree's venv, the Python wrapper logs that it leaves `a2ui-agent-sdk` 0.11.1.dev45 unpatched, `DirectJsonPromptGenerator.generate` missing. The workspace-level CLAUDE.md names `0888f88b2`.
- CI, run locally from a clean build with wireit's cache off: the build, the binary, lint, format, `pyink`, `mypy`, `pytest` (3 passed, 46 xfailed), the test suites (the tool 849 with 42 `todo`, the viewer 571, the TypeScript wrapper 154, the preview core 38, the conformance package 34), and the tool's tests against the binary (849 with 42 `todo`).

### 18. The handover

Per owning sub-task, what the move leaves. No mechanical build change was needed: the build, the type checks and lint pass at the pin unchanged. No held-by finding is fixed at the pin, so no workaround or test expectation is left behind by a fix.

**9.3, the checks.**

- Marked, Node's `todo`: `tools/spectra/src/check/catalog_check.test.ts`, "uses a v1.0 component's own catalog, and skips one whose catalog has no definition": the v1.0 component schema at the pin takes `@catalogId`, and the bare `catalogId` is an unevaluated property.
- Not a failing case: at the pin, upstream's v0.9 basic catalog has List's `listStyle`, restored by `2e8a58a69` (#3956), and its v0.9.1 basic catalog does not, its List closed by `unevaluatedProperties: false`. The registry serves the v0.9 copy under the v0.9.1 URL, so a v0.9.1 List with `listStyle` passes the catalog check where upstream's v0.9.1 catalog rejects it. The TypeScript wrapper driver's `basic_v0_9.json` serves v0.9 and v0.9.1 the same way.

**9.4, the viewer and the preview.** Nothing marked: the viewer's, the preview core's and the tool's preview cases pass on the pin's web core and renderers, and the sample pages and the built-in preview build.

**9.5, the wrappers.**

- Marked, pytest's `xfail`: 46 cases in `python/a2ui_spectra_instrumentation/tests/`, every case of `test_events.py`, `test_isolation.py`, `test_provider.py` and `test_switching.py`, and all but two of `test_check.py` and all but one of `test_streams.py`: the agent SDK at the pin lacks names the hook table patches, so the wrapper leaves it unpatched.
- Marked, `expected_to_fail` in `conformance/wrapper_capture/capture_v0_1.yaml`: Python on each of the 37 cases that run in Python, for the same reason; TypeScript on `direct_json_generate`, `express_generate`, `express_generate_two_catalogs` and `generate_outside_turn`: `@a2ui/agent` at the pin writes a different UI section in its prompt than the expected records hold.
- Records to write again at the pin: the Python records of `express_generate` and `express_generate_two_catalogs` hold the Express header that finding 33's fix (`f7b795e45`, PR #3567) removed; the six Python prompt generation records hold Column's `justify` in Row's order, Python 3.12's, under finding 38.

**9.6, the recordings.** Nothing marked: the A2A, model, tool and receiver capture suites and the replay suites pass at the pin. Finding 22 is fixed in AG2 from ag2 1.2.2; Spectra's AG2 recording stays on ag2 1.2.1.

### 19. The findings read again

All 46 carry a standing line at the pin: 27 hold, 12 are changed, 7 are fixed (3, 6, 8, 13, 20, 34, and 22 in AG2). The 19 held-by findings, marked in the file and listed in the pin file with their upstream paths: 2, 4, 5, 9, 12, 24, 25, 26, 27, 30, 31, 32, 33, 35, 36, 38, 40, 41 and 42. Two findings carry a sentence that does not hold, said in their standing lines: finding 25's `examples/0.9/floor_plan.json` writes `url`, and finding 32's host sending no capabilities fails the same way.
