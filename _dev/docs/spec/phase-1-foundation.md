# Phase 1 — Foundation

Covers Phase 1 of `_dev/TODO.md`: the repo shaped like an upstream tool, Apache 2.0, CI; the turn record spec's first version, its OpenTelemetry attribute names and shared test data. The design authority is SPEC.md, in particular its "Turn record", "Engineering decisions" and "Governance" sections.

## Scope

In scope:

- The root workspace with upstream's tooling.
- The turn record spec's first version: its schema, its prose, and the OpenTelemetry attribute names Spectra defines.
- The shared test data for the turn record, and the test workspace that validates it in CI.
- The LICENSE file.
- CI.
- SPEC.md's upstream reference line, updated to the pinned commit.

Out of scope:

- The contribution rule, moved to Phase 10.
- The nightly routine's repo setup (labels, repo-committed skills, routine registration): an off-phase chore.
- Python. The root uv workspace, its formatter, type checker and CI job come in Phase 6 with the Python wrapper.
- Any package other than the test workspace. Each later phase adds its packages when it starts.
- Reserving the package names on npm and PyPI before Phase 9.
- Field-level design of the turn record, including how its version is numbered and declared. That belongs to the turn record sub-task's own grill.

## Locked decisions

### 1. Upstream pin

Phase 1 copies upstream's conventions from `upstream/main` at 059b8d34 (2026-10-20). SPEC.md's upstream reference line is updated to that commit as part of Phase 1.

### 2. The record's first version defines the full v1 shape

Every event kind the v1 features need is defined in the first version, including the model call, tool call and A2UI step parts whose writers arrive in later phases. Later phases implement writers and readers against it. Any amendment bumps the record version.

### 3. What Phase 1 scaffolds

The root workspace with upstream's tooling, plus only what Phase 1 fills: the turn record spec, its schema and its shared test data. Each later phase adds its packages when it starts.

### 4. Where the spec and the test data live

Upstream's split, mirrored: the spec, schema and prose in one root directory, the shared test data in another, both plain directories found by path, with a small test workspace validating the examples against the schema in CI. TypeScript or Python consumers of the schema come in the phase that first needs them.

### 5. Normative form

JSON Schema on draft 2020-12 is the normative definition of the record file, with a prose document beside it. The OpenTelemetry attribute names Spectra defines are listed in the prose and used as names in the schema.

### 6. GenAI conventions pin

The model-call names are taken from `open-telemetry/semantic-conventions-genai` at commit 8538971b (2026-10-21), which declares schema version `1.42.0-dev`. The commit, the date and the schema version are recorded in the prose. Moving the pin is a spec change with a version bump.

### 7. Namespace

Every attribute the record defines itself uses the `a2ui.` namespace. No attribute name carries Spectra's name. The names are proposed to upstream A2UI as they are.

### 8. Shared test data

Upstream's shape: a case list naming turn record fixtures that must validate and ones that must fail, with the reason; fixtures as JSON files, hand-written, at least one covering each event kind the record defines and one full turn with everything present. Validation against the schema is Phase 1's only action. Each later phase adds the cases and actions its capture path needs.

### 9. Licence

The LICENSE file with Apache 2.0 only. No per-file headers until the move, where they are added in one sweep.

### 10. CI

One workflow, one job: install, build, lint, format check and test, on push to main and on pull requests, on Node 22, with upstream's install and action-pinning practices.

### 11. OpenTelemetry findings

Issues found in OpenTelemetry's GenAI semantic conventions are recorded in `_dev/otel-findings.md` for upstream contribution, in the shape of a2uiverse's `_dev/a2ui-findings.md`.
