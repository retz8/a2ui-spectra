# CLAUDE.md — a2ui-spectra

> **INSTRUCTION FOR ALL AGENTS — do this before any task:** read [SPEC.md](SPEC.md) in full. It is the design authority for this project.

This file holds only the **operational rules** not covered there.

Spectra is a dev tool for the developer of an A2UI agent: attach to the running agent, see every turn, check and preview it, record and replay it. It is proposed to the A2UI community on its own and is aimed at moving into upstream's `tools/` as `@a2ui/spectra`. Until then this repo is its home.

## Neighbours

- `../A2UI/` — the fork of `a2ui-project/a2ui`, tracking it through its `upstream` remote. The protocol, schemas, agent SDKs, renderers and standard catalogs live there. Read them from the `upstream/main` ref, not the fork's working tree, and do not hardcode schema contents.
- `../a2uiverse/` and `../a2uiverse-apps/` — A2UIVerse, Spectra's first user: the platform and its five agents. Neither depends on this repo, and this repo depends on neither.

## Conventions

- **Shaped like an upstream tool from the first commit.** The shape — workspace, package name, build tooling, script targets, licence — is in SPEC.md under "Engineering decisions" and "Governance".
- **No guessed run commands.** Consult the README of the package in question for build, run and test steps.
- **No disposition popups — always plain chat.** Never use `AskUserQuestion` to present decisions or choices. Lay out the options, tradeoffs and a recommendation as plain text.
- **Local only.** Spectra runs as a local process. Nothing in this project is deployed, and there is no cloud for it.

### Daily-work harness

The dev workflow (phases → sub-tasks, dispatch, branching, wrap-up) lives in the **`daily-work-harness` plugin** — its skills (`daily-work-harness:pick-up-task` / `:wrap-up` / `:rebase-with-main` / `:grill-to-spec`) and the `daily-workflow.md` reference doc they read. Operational rules it relies on:

- **Work directly on `main`.** No branches or worktrees, and no planning unless the user explicitly says so.
- **`_dev/` lives on `main`.** `_dev/TODO.md` and everything under `_dev/docs/` is edited and committed on `main` only — never on a branch, such as a nightly routine's PR branch.
- **Implementation plans go to `_dev/docs/plan/`** as `task-<N.M>-<short>.md`.
- **Nightly routine.** A scheduled Claude cloud Routine drains `autonomous-ready` issues into labelled PRs per the harness's autonomous contract; triage with `daily-work-harness:review-nightly`. Labels must be provisioned on the repo.
- **Commit convention:** conventional commits — `<type>(phase-<N>): …` for phase/sub-task work, bare `<type>: …` off-phase.
