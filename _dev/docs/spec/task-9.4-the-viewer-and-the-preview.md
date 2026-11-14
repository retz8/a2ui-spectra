# Sub-task 9.4 — The viewer and the preview

The v1.0 component envelope keys in the viewer and the preview, in both forms; the legacy form's marking built as the canvas draws it; the smoke check on the published renderers. Sub-task 9.4 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 5, the v1.0 component envelope keys in both forms, its decision 8, the upstream packages Spectra supports, and its decision 13, the design artifact comes first, and taking what sub-task 9.1's decision 16, sub-task 9.2's handover and sub-task 9.3's decision 11 leave to it.

Upstream as sub-tasks 9.1 to 9.3 read it, `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`: none of the three events of the Phase 9 spec's decision 2. No upstream check was run at this sub-task's start, the pin having moved the same day. npm's latest, read on 2026-11-14: `@a2ui/web_core` 0.15.0, `@a2ui/react` 0.15.0, `@a2ui/lit` 0.15.0 and `@a2ui/angular` 0.14.0, each of 2026-11-02.

The viewer and the preview at the pin, before the sub-task:

- The viewer's, the preview core's and the tool's preview cases pass on the pin's web core and renderers, and the sample pages and the built-in preview build, as sub-task 9.2's handover says.
- No committed test draws a component carrying an envelope key, in either form. The browser end-to-end tests draw a v0.9.1 surface on each of the three sample pages and one v1.0 surface, with no envelope key, on the built-in page. Each sample page claims the one sample catalog, in v0.9.
- Structure's properties box lists what web core's message processor stored: a v1.0 component's bare `checks` and `accessibility` under `@checks` and `@accessibility`, moved to the end, and neither `metadata` nor `catalogId`, in either form.
- The viewer collects catalog ids under the key `catalogId` only. A v1.0 component whose `@catalogId` names a catalog with no definition gets no stand-in catalog: the viewer's replay has web core refuse its `updateComponents` with "Catalog not found: <id>", and the preview routes the surface as if it named its own catalog alone.
- The published web core has a v1.0 processor and the v1.0 basic catalog under the pin's catalog id, and refuses the whole `updateComponents` when a component carries an `@` envelope key: "Validation failed for component 'TextField' (name): root: Unrecognized key(s) in object: '@checks'". It accepts and draws a v1.0 component whose envelope keys are all bare. Established through web core's processor and the React renderer; for Lit and Angular by reading.
- At the pin the React and Lit renderers draw the basic components through web core's own elements, where web core's binder reads `@checks`; the Angular renderer reads `@checks` in its own binder.
- The third board of the canvas's row "The legacy form" draws the stub agent's both-forms booking form with one problem and all six components in Structure.

## Scope

In scope:

- The canvas "Spectra viewer UI": the third board of the row "The legacy form" with its dark twin, and the forms the "Components and states" board gains.
- The legacy form's marking in the viewer, at the five places the 9.1 spec's decision 1 names.
- Structure's properties box, and the viewer's collecting of a component's `@catalogId`.
- The v1.0 envelope keys drawn in the browser end-to-end tests, on the built-in page and on the three sample pages; the sample pages claiming the v1.0 basic catalog.
- The smoke check on the published renderers, and its place in the re-pin procedure.
- The documents of decision 21.

Out of scope:

- The viewer's raw-text readers. Sub-task 9.9's, under decision 17.
- Which published renderer release reads which form of the envelope keys, in the root README and the adapters' READMEs. Sub-task 9.7's.
- The smoke check on the published agent SDKs. Sub-task 9.5's.
- The preview adapters' peer ranges, which stay as sub-task 9.2's decision 8 left them.
- SPEC.md, the turn record and the config schema.

## Locked decisions

### 1. The order of the work

Sub-task 9.3 is committed on `main` before any of this sub-task's implementation; the marking is built on the record, the stub agent's three forms and the conformance data as 9.3 leaves them. The canvas is drawn before the viewer's code.

### 2. The canvas's amendments

Drawn before the build, on the canvas "Spectra viewer UI":

| Where | What |
| --- | --- |
| "Turn view details", the row "The legacy form", the third board and its dark twin | The header reading "2 problems"; the `updateComponents` step's timeline row with the problem mark and 1, then the hourglass; the step's detail with the rejection's block, web core's line folded under it, the legacy form's two lines, then the message; the last step, "Waiting for input", with the problem mark and 1, holding `ROOT_MISSING` in the sentence "The surface 'booking' has no component with the id 'root': web core refused the updateComponents that carried one."; Structure with no components, so with no hourglass; the preview empty |
| "Components and states", the section "The legacy form" | The one-component, one-key sentences of decision 4 |
| "Components and states", the section "The legacy form" | The Catalog check's row "1 finding · 3 components in the legacy form" |
| "Components and states", the section "The legacy form" | The line that is an accepted bare key and a finding at once, of decision 8 |
| "Components and states", the section "The legacy form" | The folded web core line on the detail beside a problem |

### 3. What is counted

The turn's number, in the header tooltip's Catalog check row, is the count of distinct surface-and-component-id pairs among the turn's `a2ui.check.legacy_form` entries. A component sent twice in the legacy form counts once; one sent bare and later sent again with the `@` key in the same turn still counts. A step's detail counts the components of its own message, so the steps' numbers can add up to more than the turn's.

### 4. The sentences

The verb follows the number of components and the noun the number of distinct keys.

| Where | One component, one key | One component, two keys | Several components, one key |
| --- | --- | --- | --- |
| The tooltip's Catalog check row | "Passed · 1 component in the legacy form" | the same | "Passed · 3 components in the legacy form" |
| The detail's first line | "1 component carries a bare envelope key, the legacy form: `checks`" | "1 component carries bare envelope keys, the legacy form: `checks`, `accessibility`" | "3 components carry a bare envelope key, the legacy form: `checks`" |
| The detail's second line | "The v1.0 form is `@checks`. The bare key is accepted during upstream’s transition." | "The v1.0 form is `@checks`, `@accessibility`. The bare keys are accepted during upstream’s transition." | as the first column |

The opened node's line in Structure reads "Legacy form: `checks`", further keys after a comma. The keys are named in the order they first appear in the step's message, its components read top to bottom.

### 5. The Catalog check's row

The remark sits directly after the row's result and before anything about skipped surfaces: "1 finding · 3 components in the legacy form"; "Passed · 2 components in the legacy form · not checked for `menu` · no definition for catalog". A row whose every surface was skipped carries no remark.

### 6. The node's hourglass in Structure

A node carries the hourglass when the component object standing after the selected step was carried by a message of this turn in the legacy form. A component sent bare and sent again with the `@` key later in the turn has the hourglass after the earlier step and none after the later one. A component standing from an earlier turn of the conversation, which this turn's messages did not carry, has none.

### 7. Structure's properties box

The box lists the standing component as the message wrote it, for every component: its own keys, all but `id` and `component`, in the order the agent wrote them. A bare `checks` reads `checks`; `@metadata` and `@catalogId` are listed. The tree's shape, the children and the bound-path summary on the node's row stay web core's.

### 8. The line that is an accepted bare key and a finding at once

Where a finding's pointer ends at an accepted bare key, the line is soft red and keeps the hourglass at its right end. The component still counts, and its node keeps the hourglass. The line of the component rejected for carrying both forms stays as the 9.1 spec's decision 9 has it, soft red with no hourglass.

### 9. A check event without the attribute

A catalog check event that carries no `a2ui.check.legacy_form` reads as one with an empty array. A stored turn is shown as recorded: its findings stand, and nothing is checked again or rewritten.

### 10. A fixture's turn

A fixture's turn is marked as any turn is: its header, tooltip, timeline row, step detail, message and Structure. "The fixture view" in the 9.1 spec's decision 12, what carries no mark, is the fixture's own parts: the fixtures list's rows, the fixture's controls and the replay verdict with its line.

### 11. `@catalogId` in the viewer

The viewer collects every string under `catalogId` or `@catalogId`, at any depth, in any version, for the replay's stand-in catalogs and for the preview's routing. The two tests that cover a component's own catalog gain twins written with `@catalogId`.

### 12. Where the envelope keys are drawn in a browser test

On the built-in page, the stub agent's v1.0 booking form in its three forms: the `@` form drawn with its check messages; the bare form drawn the same, with the legacy form's marking in the viewer; the both-forms form with an empty preview and its two problems. Each sample page also claims the v1.0 basic catalog, and the `@` form and the bare form are drawn through the React, Lit and Angular adapters. The sample catalog itself stays a v0.9 catalog. The stub agent is used as sub-task 9.3 leaves it, with no fourth form.

### 13. The `@` form on a preview page whose renderer predates it

The page's refusal and its surface error stand as counted problems in the renderer's own words, as the viewer draws any preview page's reports. Spectra adds nothing. Supported at the published latest means the adapter mounts on the published renderer, draws what that renderer draws and reports what it refuses.

### 14. What the smoke check requires

For each of the React, Lit and Angular sample pages, built on the published latest of its renderer and of web core: the page loads and answers Spectra with the catalogs it claims; the sample catalog's v0.9.1 surface, the one the browser end-to-end test uses, is drawn; the page reports no error; one press comes back as the action. No v1.0 envelope key is involved. The run prints the versions it resolved.

### 15. How the smoke check installs the published renderers

A scratch project outside the workspace, as an adopter has it: Spectra's preview core and adapters packed from the repo, the three sample pages' sources beside them, the renderers and web core from npm at their latest, installed with Yarn. Spectra, built from the repo on the pin's web core, attaches to the stub agent and uses those pages. The repo's install and lockfile are unchanged.

### 16. Where the smoke check lives and when it runs

A script under `_dev/tools/`, run by hand, exiting non-zero on failure, named under its own heading in `_dev/re-pin-procedure.md`. It runs at the upstream check when the third reading shows a new npm release of a renderer or of web core, at this sub-task's close and at the acceptance run. CI does not run it.

### 17. The raw-text readers

A sub-task of its own in Phase 9, 9.9, with its own spec, parallel with 9.3 to 9.6. It takes the reported defects of the viewer's Express and Atom readers against upstream's compilers at the pin, the envelope keys' part included, and starts by confirming each with a failing case. This sub-task touches no reader.

As reported, unconfirmed: a component's envelope key declared in its own properties keeping a positional slot; the positional order read from a definition's top-level `properties` alone, without `allOf`; the first of two catalogs' definitions of a component name winning, v0.9 before v1.0; a check expression taking a positional slot in Express; a check written with parentheses stopping the Express reader; v1.0's system call `@index()` stopping the Express reader's lexer; the Atom reader mislinking a bare string child of a basic container.

### 18. What existing rules decide

- On the both-forms turn with the built-in page answering, the page's own refusal and its surface error fold as quiet lines under the two problems, the count stays 2, and the preview pane's strip carries the page's refusal line above the empty frame. The third board draws what the viewer draws for that turn.
- A step carrying only the legacy form is not a step with a problem: the header's filter and the keys that step through problems pass it.

### 19. Left to the build

The tooltip's 440 px width while a row carries the remark, as the 9.1 spec fixed it; the hourglass as an icon of the viewer's own icon module, as the canvas's "Icons" board draws it; how each sample page builds its v1.0 basic catalog; how the viewer finds the standing component's written object; the smoke script's name, and what it shares with the browser tests' helpers.

### 20. The tests, the browser cases and the hand pass

- Unit tests on the rules of this spec: the count of distinct components; the sentences in singular and plural, with the keys' order; the Catalog check row's forms; the standing-object rule in Structure, in both cases of decision 6; the properties as written; the line that is a bare key and a finding at once; the check event without the attribute; the `@catalogId` twins.
- Browser cases, in Chromium, on the stub agent's v1.0 booking form: the three forms on the built-in page, with the marking's five places on the bare form and the two problems on the both-forms form; the `@` form and the bare form drawn on each of the three sample pages.
- One hand pass through the tunnel on the binary with the stub agent's three forms: each board of the row "The legacy form" set against the viewer in light and dark, and the header's chained label looked at once on the small window.
- The smoke check on the published renderers, run once and passing.

### 21. The documents

- The viewer's README: the legacy form's marking, Structure's properties as the message wrote them, and `@catalogId`.
- The three sample pages' READMEs: the v1.0 basic catalog they claim.
- The sub-task 9.1 spec, amended in place: its decisions 13 and 14, where the boards go and what the boards draw, take the third board of decision 2; its decision 8, the step's detail, takes decision 4; its decision 6, the header's tooltip, takes decision 5; its decision 9, the bare key's line in the message, takes decision 8; its decision 10, Structure, takes decisions 6 and 7; its decision 12, what carries no mark, takes decision 10.
- The sub-task 4.6 spec and the Phase 4 spec's decision 20, the sample catalog apps, amended in place: the sample pages claim the v1.0 basic catalog beside the one sample catalog.
- `_dev/re-pin-procedure.md`: the smoke check on the published renderers, under its own heading.
- The Phase 9 spec, amended in place: its scope gains the raw-text readers at the pin.
- `_dev/TODO.md`: the 9.4 line names this spec; the 9.9 line.
- SPEC.md, the turn record and the config schema: no change.

### 22. Done when

All of these hold on `main`:

1. The canvas carries decision 2's amendments.
2. The viewer draws the legacy form as the row "The legacy form" draws it, under decisions 3 to 10.
3. The unit tests and the browser cases of decision 20 pass, under Node and against the binary, locally and in CI.
4. The hand pass of decision 20 is made.
5. The smoke check exists as decision 16 has it and passes on npm's latest.
6. The documents of decision 21 are written.
7. CI is green on GitHub.

## Invariants

- A legacy-form entry is not a problem: the problem count, the turn list's rows and the filter are untouched by it.
- The viewer shows a stored turn as its record says.
- Spectra's own web core is the pin's, in the smoke check as elsewhere; only the preview page's packages are the published ones.
- v0.9 and v0.9.1 turns are drawn as before the sub-task.
