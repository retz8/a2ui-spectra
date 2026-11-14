# Phase 9 — Upstream v1.0 and supported versions

The upgrade to upstream's v1.0 as its current version; which protocol versions and which upstream SDKs Spectra supports; the basic root README. Phase 9 of SPEC.md's roadmap, between Phase 8, the dev loop, and Phase 10, shipping. The design authority is SPEC.md, in particular its "v1 coverage", "The wrapper", "Upstream landscape" and "Repo" sections.

Upstream since Spectra's pin, `9e8a9bac5` (2026-11-02), as read at `upstream/main` `0888f88b2` (2026-11-13), 227 commits later:

- v1.0 is stable and current: `specification/v1_0/README.md` reads "This specification is stable. Breaking changes go into a future major version", and the new `specification/versions.json` gives v1.0 `current`, v0.9.1 and v0.9 `previous`, v0.8 `deprecated`.
- On a v1.0 component the envelope keys `catalogId`, `accessibility`, `metadata` and `checks` became `@catalogId`, `@accessibility`, `@metadata` and `@checks`: core SDKs and renderers read both forms (PR #4037), the specification, the catalogs and the agent SDKs emit the `@` form alone (PR #4044), and the bare form's removal is open (issue #4082). v0.9 and v0.9.1 keep the bare keys.
- A second rename of the v1.0 wire is open and unmerged: child references and actions as `@child`, `@action` and `@functionCall` (issue #2791; PR #4170, reading both forms; PR #4171, emitting the new one; issue #4168, removing the old one).
- PyPI carries a release of 2026-11-10, `a2ui-agent-sdk` 0.11.0 with `a2ui-core` 0.6.0, `a2ui-a2a` 0.3.0 and `a2ui-adk` 0.3.0, cut before the envelope rename, so emitting the bare keys. It no longer exports the format prompt generator classes from `a2ui.inference_formats` and the format packages (PR #3568), which Spectra's Python wrapper names there.
- npm carries no release since 2026-11-02: `@a2ui/web_core` 0.15.0, `@a2ui/react` 0.15.0, `@a2ui/lit` 0.15.0, `@a2ui/angular` 0.14.0 and `@a2ui/agent` 0.1.0, none of which reads the `@` envelope keys.

## Scope

In scope:

- The pin's move to upstream's current code, and the procedure that moves it.
- The v1.0 component envelope keys in the checks, the viewer and the preview, in both forms.
- The Python wrapper on the agent SDK's API as of 0.11.0; both wrappers' captures at the pin.
- The coverage roster's v1.0 recordings at the pin.
- Which protocol versions and which upstream packages Spectra supports, stated in SPEC.md and the root README.
- SPEC.md's upstream facts at the pin; the basic root README.
- The design canvas's Phase 9 boards and the acceptance run.

Out of scope:

- `@child`, `@action` and `@functionCall` while unmerged, under decision 6.
- v1.0's `callAgentFunction` and `rendererFunctionResponse`, the agent-function round trip, shown and answered from the preview. Backlog, as it is.
- A second SDK API shape in the wrappers. Backlog, as it is.
- A scheduled run of the upstream check.
- What Spectra does when a protocol version becomes deprecated, under decision 4.
- Whether Spectra ships with a local patch of an upstream package inside its binary, when upstream has not published by then. Phase 10's.
- Spectra's relation to upstream's `a2ui` CLI. Phase 11's.
- The install steps and the demo in the root README. Phase 10's and Phase 11's.

## Locked decisions

### 1. Upstream's current code is the reference

Spectra follows upstream's current code, `upstream/main`, and not its latest published release. The pin starts the phase at `0888f88b2`. It governs what Spectra takes from upstream: the copied protocol schemas and catalog definitions, the copied conformance catalogs, the `a2ui-upstream` worktree the samples run in, the upstream packages Spectra builds against, and the API the wrappers are written against. Where a package's published latest is behind the pin, Spectra patches it locally to the pin's state, temporarily; when npm or PyPI carries it, the local patch is removed and the published release is used.

### 2. When the pin moves

Upstream is checked at the start of each sub-task and again before the acceptance run. The pin moves, or a local patch gives way, on three events only:

- npm or PyPI carries a new release of a package Spectra uses: that package's local patch is removed and the published release is used.
- A pull request that changes the v1.0 wire format is merged: the pin moves.
- A bug in upstream that Spectra is held by is fixed: the pin moves.

### 3. The phase's sub-tasks are not fixed at its start

An upstream check that finds one of decision 2's events adds the sub-task that handles it to the phase.

### 4. The protocol versions Spectra supports

v0.9, v0.9.1 and v1.0: the versions upstream's `specification/versions.json` gives as `current` or `previous`. A version that file moves to `deprecated` is the signal to deprecate it in Spectra, and the upstream check reads the file. What Spectra then does is decided in the phase that meets it, under SPEC.md's rule that every release reads and replays the records of every closed version.

### 5. The v1.0 component envelope keys, in both forms

On a v1.0 component Spectra reads `@catalogId`, `@accessibility`, `@metadata` and `@checks`, `@catalogId` choosing the catalog the component is checked against. The bare keys are judged as upstream's core SDKs and renderers judge them during the transition, under the v1.0 evolution guide's "Component envelope mixin keys": a bare `catalogId`, `accessibility`, `metadata` or `checks` is accepted where the component's schema declares no property of that name, and a component carrying both the bare key and the `@` key is rejected. An accepted bare key passes, marked as the legacy form. When upstream removes its fallback, issue #4082, Spectra removes its own. v0.9 and v0.9.1 are judged as before.

### 6. `@child`, `@action` and `@functionCall` only once merged

Merged while the phase is open, the rename moves the pin under decision 2 and is handled in the phase. Unmerged at the phase's close, it becomes a backlog item.

### 7. The Python wrapper's floor is `a2ui-agent-sdk` 0.11.0

The hook table is written against the agent SDK's API as of 0.11.0, which is main's, and the version floor becomes `a2ui-agent-sdk >= 0.11.0`. 0.10.0 and earlier are left unpatched with the one log line. The TypeScript wrapper's hooked names stand as they are, `@a2ui/agent` being 0.1.0 on npm and on main with every hooked name present.

### 8. The upstream packages Spectra supports

For each upstream package an adopter brings, the agent SDKs the wrappers patch and the renderers the preview adapters take as peers, Spectra supports the pin's main and the package's published latest. The suites and their expectations are held against the pin. The published latest gets a smoke check. When upstream publishes and a local patch gives way, the two are one.

### 9. The re-pin procedure

One procedure covers the upstream check, what is read and which of decision 2's events it finds, and the move, what is copied again and run again. Its first run is this phase's move to `0888f88b2`. It covers `specification/versions.json` and the standing of the findings in `_dev/a2ui-findings.md` at the new pin. It runs at the start of each sub-task of this phase and at the start of each later phase.

### 10. SPEC.md's upstream facts

SPEC.md's upstream facts are written again as read at the pin: "The gap", with upstream's roadmap as it now stands, `tools/inspector` and `tools/editor` deleted and the `a2ui` CLI; "Upstream landscape"; the "Upstream reference" line under "Repo"; "The wrapper"'s supported SDKs; "v1 coverage" where decisions 4 and 8 change it. Spectra's relation to the `a2ui` CLI goes under "Open".

### 11. The basic root README

What Spectra is and does, in the present tense; the protocol versions and the upstream packages it supports, under decisions 4, 7 and 8, the bare envelope keys' handling included; the packages in the repo, each linked to its own README for build and run steps.

### 12. The backlog

Two items enter the phase: the re-pin procedure, and the coverage roster's v1.0 axis recorded again at the pin, the Node restaurant finder's booking stream. Two items keep their place with their text brought to the pin: the A2UI step for A2UIVerse's agents, its release now 0.11.0, and the hover link between a tree node, the message's lines and the drawn component, the renderers still not marking the DOM with component ids.

### 13. The design artifact comes first

The legacy form's marking is drawn first on the design canvas "Spectra viewer UI", in light and dark, and the build follows it.

### 14. The acceptance run

The last sub-task, through the tunnel, after an upstream check, at the pin as that check leaves it:

- The three samples, the Python restaurant finder, the Node restaurant finder and the custom-components example, give what Phase 8's acceptance run gave, the A2UI step on the two Python samples included.
- A v1.0 turn carrying the `@` envelope keys passes the checks and is drawn in the preview.
- A v1.0 turn carrying the bare envelope keys passes, marked as the legacy form.
- The smoke check passes on the published latest of each package under decision 8.

## Invariants

- Spectra follows merged upstream code only.
- v0.9 and v0.9.1 turns are checked, drawn and replayed as before the phase.
- An adopter needs nothing unpublished: every upstream package an adopter brings is supported at its published latest.
- A local patch of an upstream package is temporary and is removed when the published release carries its state.
