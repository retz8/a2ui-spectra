# Task 1.1 — The workspace

Spec for sub-task 1.1 of Phase 1 — Foundation (`_dev/docs/spec/phase-1-foundation.md`): the root workspace with upstream's tooling, the LICENSE file, the test workspace with no tests yet, the one-job CI workflow and SPEC.md's upstream reference line, with the gates green in CI. Upstream's conventions are read from `upstream/main` at 059b8d34, the Phase 1 pin.

## Scope

- The root Yarn workspace with upstream's tooling.
- The test workspace, with the standard script targets and no tests.
- The LICENSE file.
- The one-job CI workflow and the setup action it calls.
- SPEC.md's upstream reference line.
- The gates green in CI.

## Locked decisions

### 1. Where the test workspace lives

The shared test data directory, `conformance/`, is itself the test workspace. It is private and named `a2ui-spectra-conformance`.

### 2. The test workspace's targets

All six of upstream's standard script targets: `build`, `lint`, `lint:fix`, `test`, `format` and `format:check`. Build reports that the workspace has no build step. Lint and lint:fix report that it has no lint configuration. Test uses upstream's no-tests fallback. Format and format:check run Prettier.

### 3. Root tooling

Upstream's root comes in whole: Prettier, TypeScript, syncpack and wireit as dev dependencies at upstream's version ranges; the Prettier config and ignore file, the editor config, the syncpack config and the ESLint preset; the root scripts; Yarn 4.13.0 with the node-modules linker. Left out: the Google Artifact Registry auth package, the `@a2ui` registry scope, the resolutions, and every entry naming a package or path Spectra does not have. The root workspace is private and named `a2ui-spectra-workspace`.

### 4. What the format check covers

Prettier skips the `_dev/` working area and the `.claude/` folder. SPEC.md, the README and CLAUDE.md are formatted, and SPEC.md is reformatted once in this sub-task.

### 5. CI

Upstream's composite setup action is copied, with its Node setup pinned by commit hash like every other action. The one job runs install, build, lint, format check and test through the root scripts. The syncpack check does not run in CI.

### 6. The CI gate

Work happens directly on `main`, with no branch. The gates are green when CI passes on the push to `main`.

### 7. LICENSE

Upstream's Apache 2.0 text, verbatim.

### 8. Git ignore

Upstream's Yarn, wireit and build-output entries.

### 9. SPEC.md's upstream reference line

Only its commit moves, to `upstream/main` at 059b8d34. Its facts hold at that commit.

## Open items

- Whether Spectra's fixtures are exempt from Prettier, as upstream's conformance test data is. Decided in sub-task 1.3, the shared test data.
