# Sub-task 10.14 — The published Python releases

The local patches of `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a` giving way to PyPI's releases, the smoke check on the published agent SDKs, and the documents' statements about those releases. Sub-task 10.14 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, added by the 10.5 spec's decision 19, under SPEC.md's "Supported versions". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-20, read `upstream/main` at `496df0e76` (2026-11-19), 38 commits after the pin `0888f88b2`, the reading the 10.5 spec opens with, and found one event: PyPI carries a new release of the three packages Spectra patches locally to the pin, `a2ui-core` 0.7.0, `a2ui-agent-sdk` 0.12.0 and `a2ui-a2a` 0.4.0, published on 2026-11-17. It found no other event.

The releases, as read on 2026-11-20:

- **Their commit.** The tags `python/a2ui-core/v0.7.0`, `python/a2ui-agent-sdk/v0.12.0` and `python/a2ui-a2a/v0.4.0` sit on `d63fd4306`, a descendant of the pin. Each wheel on PyPI holds the same files as the package's `src/a2ui/` at `d63fd4306`, byte for byte, none missing and none added.
- **The four commits on those packages between the pin and `d63fd4306`.**
  - `8da650142` (#4187): `a2ui-core` enforces the basic catalog's function argument and return-type validation, a breaking change in its changelog: a string or a boolean refused on an integer or number field such as `length.min`, the `anyOf` required branches enforced, a scheme-prefixed URI required on a `"format": "uri"` field such as `openUrl.args.url`, and a nested call's `returnType` checked on the surfaces before v1.0.
  - `6dc53374b` (#4248): strict mypy on the experimental Elemental and Atom formats, type annotations alone, on names the Python wrapper does not hook.
  - `d63fd4306` (#4251): `a2ui-core`'s binder resolving a property that references `FunctionCall` directly, and accepting the `path` key of a v1.0 `ChildList` template.
  - `07735d6a6` (#4258), the release's preparation: `a2ui-agent-sdk` 0.12.0 requires `a2ui-core >=0.7.0,<0.8.0`, and `a2ui-a2a` 0.4.0 requires `a2ui-agent-sdk >0.11.0`.
- **The envelope keys.** `a2ui-core` 0.7.0 and `a2ui-agent-sdk` 0.12.0 emit the `@` form of v1.0's envelope keys; `a2ui-core` 0.6.0 carries no `@catalogId`.
- **`a2ui-adk`**, which Spectra does not patch, is at 0.3.0 of 2026-11-10 on PyPI and requires `a2ui-agent-sdk >0.10.0`.
- **A trial on the releases**, in a scratch clone of `abda384` with the three patches removed as the re-pin procedure's "Removing a local patch" has it: the lock changed in those three packages alone; pyink, mypy and the build passed; pytest passed 57 of 57 and the wrapper capture suite 103 of 103, 61 Python cases and 42 TypeScript, on macOS arm64. Two cases send function calls, `express_check_positional` and `express_system_call`; none sends a function call with arguments of the wrong type.

## Scope

- The three local patches removed, and Spectra's Python build and suites run on PyPI's releases.
- The smoke check on the published agent SDKs.
- The documents' statements about those releases, the support rule in SPEC.md and the re-pin procedure's rule for a new release.

Out of scope: publishing anything; the npm packages' local patches, which stay at the pin.

## Locked decisions

### 1. The pin stays

The pin stays at `0888f88b2`. The copied files, the `a2ui-upstream` worktree and the six npm packages patched by tarball stay at the pin. The pin's move waits for upstream's v1.0 releases.

### 2. The three patches removed

The local patches of `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a` are removed under the re-pin procedure's "Removing a local patch", and Spectra's Python build and suites run on PyPI's `a2ui-core` 0.7.0, `a2ui-agent-sdk` 0.12.0 and `a2ui-a2a` 0.4.0.

### 3. A release past the pin replaces the patch

The re-pin procedure's rule for a new release reads that a release carrying the pin's state, at the pin or past it, replaces the package's local patch; a release behind the pin leaves the patch in place.

### 4. A published latest past the pin stands for the pin's main

Where a package's published latest is past the pin, it stands for the pin's main as well, and Spectra builds against the release. SPEC.md's "Supported versions" gains this beside its rule for a published latest behind the pin. No run at the pin's own Python source is kept. The Python wrapper's floor stays `a2ui-agent-sdk` 0.11.0.

### 5. No new wrapper capture case

No case is added for the function validation of #4187.

### 6. The documents

- SPEC.md's "Upstream landscape", the Python agent SDKs: PyPI's releases of 2026-11-17, `a2ui-core` 0.7.0, `a2ui-agent-sdk` 0.12.0 and `a2ui-a2a` 0.4.0, from `d63fd4306`, past the pin, emitting the `@` form, beside `a2ui-adk` 0.3.0 of 2026-11-10; the landscape's date for the published releases notes PyPI's reading.
- SPEC.md's "Supported versions": decision 4.
- The root `README.md`'s envelope-key table: the `a2ui-agent-sdk` row's published latest is 0.12.0 with `a2ui-adk` 0.3.0, and emits the `@` keys; the sentence above the table says npm's releases predate the rename and PyPI's of 2026-11-17 emit the `@` form.
- `conformance/README.md`'s paragraph on the drivers: the Python driver depends on `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a` from PyPI at 0.7.0, 0.12.0 and 0.4.0.
- `_dev/upstream-pin.json`: the three packages' `patch` is `null`.
- `_dev/re-pin-procedure.md`: decision 3.
- The Phase 10 spec's decision 4, the gate on `0.1.0`: `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a` leave its list of the local patches that may stand at the release.

These stand: the root `README.md`'s line on the upstream packages Spectra supports; the Python wrapper's README on the release it was written against and its floor; `conformance/README.md`'s lines on the upstream builds the records were read off.

### 7. Done

Sub-task 10.14 is done when, with no test skipped or marked:

- CI passes on the commit that removes the patches: the Python checks, and the binary test run on all five platforms, the wrapper capture suite's Python driver running on the releases;
- the smoke check on the published agent SDKs passes by hand, and its done line names the versions it resolved;
- the documents read as decision 6 has them.

The done line carries the CI run, its commit and the counts.

## Invariants

- Nothing is published.
