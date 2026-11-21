# Sub-task 10.12 — The agent instructions

An `AGENTS.md` file for any coding agent, and everything that is Jioh's own workflow taken out of git: the `CLAUDE.md` file, the Claude Code settings file and the `_dev/` folder. Sub-task 10.12 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, whose scope has "An `AGENTS.md` file, and the `CLAUDE.md` file turned into a local file".

The upstream check at the sub-task's start read `upstream/main` at `5ff1b05f0` (2026-11-20), 50 commits after the pin, `0888f88b2` (2026-11-13), and found no event: npm and PyPI carry no new release of an upstream package, the npm versions bumped in source on 2026-11-18 (#4294) not being published; no commit changes the v1.0 messages; the five watch-list items are open; no commit on a held-by finding's paths is its fix; upstream's install scripts are untouched. The v0.9 basic catalog, copied twice, is gone from its path at `upstream/main`, moved to `catalogs/basic/v0_9/` by #4150.

## Scope

In scope:

- A root `AGENTS.md`.
- `CLAUDE.md` retired from git.
- `.claude/settings.json` taken out of git.
- `_dev/` taken out of git as a whole, the pin file moved out of it first.
- The committed documents and comments that link or cite into `_dev/`, reworded.

Out of scope:

- Rewriting the pushed history, under decision 9.
- A private repository or any other backup for `_dev/`, under decision 6.

## Locked decisions

### 1. Who `AGENTS.md` is for

`AGENTS.md` is for any agent, not for Claude: the coding agent of anyone who is interested in Spectra and cloned it. That clone holds this repository and nothing beside it: no `../A2UI`, no A2UIVerse, no daily-work harness, no design canvas.

### 2. What `AGENTS.md` says

`AGENTS.md` is concise, at most 40 lines, and holds six things, each pointing at an existing document:

1. What Spectra is: the one-sentence description `SPEC.md` and the root README share.
2. Where things are: the root README's "In this repo" table, `SPEC.md` as the design authority, `docs/design/` for how each part works.
3. Building, running and testing: no guessed commands, each package's README has its steps; a Yarn workspace built with `wireit`, with upstream's standard script targets, and the Python wrapper a uv project.
4. Using Spectra, as opposed to changing it: the skill in `skills/a2ui-spectra/`.
5. Contributions, as `SPEC.md`'s "Governance" has them: until the move into upstream no outside code is merged, issues and discussion are welcome, and an agent opens no pull request here.
6. Instruction files stay vendor-neutral, as upstream's `AGENTS.md` asks.

It says nothing about `_dev/`, phases, the pin or the daily-work harness.

### 3. `CLAUDE.md` is retired

`CLAUDE.md` leaves git and is listed in `.gitignore`. On Jioh's machine it is replaced with a symlink to `AGENTS.md`; the symlink is local and not committed.

### 4. What `CLAUDE.md` said moves to `CLAUDE.local.md`

Everything today's `CLAUDE.md` says goes to `CLAUDE.local.md`: the "Daily-work harness" section whole, its commit convention and push-in-batches rule included; the "Neighbours" section, both the upstream pair and the A2UIVerse pair; the upstream check before the work; the viewer's design canvas; the no-popups rule; the rest of its conventions.

### 5. The Claude Code settings file

`.claude/settings.json`, which enables the `daily-work-harness` and `diagram-design` plugins, moves to `.claude/settings.local.json` and leaves git. The repository then holds no Claude-specific file.

### 6. `_dev/` is gitignored as a whole

Anything related to the daily-work harness and Jioh's personal workflows is gitignored. `_dev/` leaves git and is listed in `.gitignore`: `TODO.md`, `TODO-done.md`, `docs/`, `a2ui-findings.md`, `otel-findings.md`, `re-pin-procedure.md`, `release-procedure.md` and `tools/`. Only the pin file moves out, under decision 7.

`_dev/` is local only. It has no backup beyond the commits already pushed, and a spec'd sub-task can no longer be delegated to the nightly Routine, whose clone holds no spec.

### 7. The pin file

`upstream-pin.json` moves to `vendor/a2ui/upstream-pin.json` and is split. The committed file keeps `pin`, `copies` and `packages`, the one alteration's finding number replaced by a one-line reason. `upstream`, `watch` and `heldBy` go to a file of Jioh's own in `_dev/`, which the check and move scripts read beside the committed one.

### 8. Nothing committed links or cites into `_dev/`

Each committed link or citation into `_dev/` is reworded to state the fact itself: the 11 links to the two findings files, in four design docs and the conformance catalogs README; the places that name a finding by number; the links to the recording tools in `conformance/README.md`, which keeps saying how its data was recorded; the release procedure's mentions in the release workflow and two scripts. The three READMEs that link the pin file link its new place.

### 9. The pushed history stays

The commits already pushed are left as they are. `_dev/` and `CLAUDE.md` stay readable in them.

### 10. Done when

1. A fresh clone of `main` holds no `CLAUDE.md`, no `.claude/` and no `_dev/`, and `.gitignore` lists all three.
2. `AGENTS.md` is at the root with decision 2's six contents, vendor-neutral, at most 40 lines.
3. `vendor/a2ui/upstream-pin.json` holds `pin`, `copies` and `packages` only, and the three READMEs link it there.
4. No committed document links or cites into `_dev/`, and CI's link check passes.
5. CI passes on the commit with the test counts it had before it.
6. On Jioh's machine: `CLAUDE.md` is a symlink to `AGENTS.md`; `CLAUDE.local.md` holds everything today's `CLAUDE.md` said; `.claude/settings.local.json` enables the two plugins; the upstream check script runs from the local `_dev/` against the split pin file.

No new test is added: the link check covers `AGENTS.md` as it does every tracked Markdown file.

One leftover stands: the recorded AG2 test data carries a catalog id that is a URL containing `_dev/tools/ag2_agent_function_catalog_v1_0.json`, an identifier inside a recording that is never fetched.
