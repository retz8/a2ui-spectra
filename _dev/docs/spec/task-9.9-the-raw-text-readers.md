# Sub-task 9.9 — The raw-text readers

The viewer's four raw-text readers, Direct JSON, Express, Elemental and Atom, against upstream's compilers at the pin. Sub-task 9.9 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, under its scope line on the raw-text readers, taking what sub-task 9.4's decision 17 leaves to it: the seven reported defects of the Express and Atom readers, each to be confirmed by a failing case first.

The upstream check at this sub-task's start, on 2026-11-14, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, a change to the site's landing page (#4235) touching none of the areas Spectra uses, every copied file unchanged, no new release on npm or PyPI, `specification/versions.json` unchanged and the five watch-list items open: none of the three events of the Phase 9 spec's decision 2.

The readers before the sub-task, as read in Spectra's code:

- The readers were written at the earlier pin, `9e8a9bac5`. The Express and Atom readers take what they know of the catalogs from `readerCatalogOf` in the viewer's model; the Direct JSON and Elemental readers take nothing from a catalog.
- The viewer builds one body of catalog knowledge for the whole turn view, from every catalog Spectra knows, built-in and configured, and hands it to every parse. The first catalog that defines a name wins. A component's positional order is its definition's top-level `properties`, with `component`, `id` and `checks` left out by bare name; no `@` key is left out.
- The Express reader's lexer knows a check as `?name` alone and has no `@` character. The reader counts a check among a call's positional arguments.
- The Atom reader takes a bare string for a reference when it equals any id assigned so far, the parent's included, wraps the strings of an explicit `:children [...]`, reads no string in a `(:children "a" "b")` form, and ignores bare symbols.
- The oracle of sub-task 6.5's decision 3, the wrapper capture suite's texts, reads every case with no catalog. The catalog-driven part of the readers is held by one hand-written catalog in the viewer's test file. All four readers are green on the suite at the pin.
- A parse event carries the catalogs its parser checked against, `a2ui.parse.catalogs`, each with its catalog id and protocol version, and the SDK that compiled its text, `a2ui.sdk.name` and `a2ui.sdk.version`. The turn record makes each of them optional.

Upstream between `9e8a9bac5` and the pin:

- Nine commits touch the four formats' compilers, their shared schema helper and the shared block parser: #4044 (`24d1bf9c8`), the `@` envelope keys; #4025 (`ee0fe3559`), `@index` in Express; #3880 (`b1bf1ac3c`), the v0.9 conformance lowering; #3568 (`e4e8ee409`); #3567 (`f7b795e45`); #3867 (`087681ab1`); #3803 (`e7940dabf`); #3790 (`1e9ed04b5`), `extract_a2ui_json_to_parts`; and #3721 (`07fee11d3`), the Direct JSON part as an array of messages. The grammar `specification/inference_formats/express/Express.g4` changed.
- The tag of PyPI's `a2ui-agent-sdk` 0.11.0 holds eight of the nine, all but #4044. npm's `@a2ui/agent` 0.1.0 is of 2026-11-02.

Upstream's compilers at the pin, as run in the `a2ui-upstream` worktree, Python's and TypeScript's Express and Python's Atom:

- The seven reports of sub-task 9.4's decision 17 each name a place where the reader, as read, does other than the compilers do: the envelope keys' slots, `allOf`, the catalog a name is read by, a check among the positional arguments, a check with parentheses, `@index()`, and a bare string child in Atom. No case has been run.
- Of the catalogs Spectra holds, the v0.9 basic catalog declares all 18 components' properties inside `allOf`, and the v1.0 basic catalog 6 of 18.
- A name that two of a parse's catalogs define is a compile error unless the call names its catalog, `catalogId=` in Express and `:catalogId` in Atom. A v0.9 and a v1.0 catalog cannot be combined in one parse, and more than one catalog requires v1.0.
- `@index` is v1.0's one system call. `@` is accepted at the start of a function's name alone.
- Python's and TypeScript's Express compilers give the same text different component ids in these places: the `_inline_N` numbering, Python counting the components that get an `_inline_` id and TypeScript every inline component; the order the sub-schemas are walked in, for a root with its own `properties` beside an `allOf` entry declaring `component` and for an `allOf` mixin whose own nested `allOf` declares `component`; whether a `metadata` property written inline in the standard shape keeps a slot, Python dropping it and TypeScript keeping it; and a component's own check-rule property under another name, which TypeScript takes out of the positional arguments and Python keeps.
- Upstream's own compile cases, each a source text, its catalogs and the expected messages: 78 in `conformance/agent/express/compiler.yaml`, 15 for Express in `conformance/agent/multi_catalog_formats.yaml` and 4 in `conformance/agent/atom/compiler.yaml`. None pins the `_inline_N` numbering, and no Atom case has a bare string child or a generated id. No fixture catalog of upstream's declares an envelope key's name as a component's own property, and none has the two schema shapes on which the SDKs differ.
- Found beside the readers' matter: four entries of `typescript/agents/a2ui_agent/KNOWN_GAPS.md` describe Python behaviour that Python at the pin no longer has; the Express prompt lists `checks?` as TextField's last positional argument and the compiler refuses a sixth; Python binds a component's value into a check only for a first parameter named `value`, TypeScript for any first parameter matching a path-bound property; TypeScript's `Catalog.fromJson` refuses a catalog whose component declares an `@`-named property, which Python accepts; a `checks=` argument whose value is not purely check expressions is written under the bare `checks` at v1.0, in both SDKs; and in Atom, a bare string equal to a generated id becomes a reference to it, an unknown keyword property is emitted unvalidated, and a positional argument past the last slot is dropped.

## Scope

In scope:

- The seven reports of sub-task 9.4's decision 17.
- The nine upstream commits, read for what they change under the four readers.
- A reader's catalog knowledge: per parse, from the parse's own catalogs, following the compiler the parse names.
- The positional order and Atom's bare-child rule, as the compilers at the pin have them.
- New cases in the wrapper capture suite, and the oracle reading each case with its own catalogs.
- One run of the readers over upstream's own compile cases.
- The findings, and the documents of decision 16.

Out of scope:

- Anything on screen, under decision 14.
- A second set of rules for a published SDK whose compiler differs from the pin's, under decision 8.
- The readers held permanently against upstream's own compile cases. Backlog, under decision 16.
- The turn record, the wrappers' code, the config schema and SPEC.md.

## Locked decisions

### 1. What the sub-task takes

The seven reports, and a read of the nine commits: each commit's change to the Direct JSON, Express, Elemental and Atom compilers, their shared schema helper and the shared block parser is judged for whether it changes a component's id, its range, or what a reader can read. Anything found joins the reports under decision 2.

### 2. A failing case first

Each case is written into the suite and run against the reader as it stands, before any change to the reader. The case and its fix are committed together. A report whose case passes is listed as not confirmed, with what the compiler does, and its case stays in the suite. No expected-to-fail mark is added.

### 3. The cases live in the wrapper capture suite

Each report and each finding of the commit read is a case in `conformance/wrapper_capture/capture_v0_1.yaml`, its expected record written by running upstream's compiler at the pin. The readers' oracle gives each reader the catalogs its case's parse names, for every case of the suite.

### 4. The shape of the cases

One hand-written case per point, the smallest text that shows it, named for it. Express cases run in Python and TypeScript; Atom cases run in Python.

### 5. The protocol versions of the cases

Every point at v1.0. The positional order has one Express case more, in both languages, on the v0.9 basic catalog: inline components in positional slots of components declared through `allOf`. Nothing else is repeated per version.

### 6. A parse's own catalogs

A reader reads a parse with the definitions Spectra holds for the catalog ids that parse names in `a2ui.parse.catalogs`, in the order the parse lists them. Two parses in one turn on different catalogs each get their own.

### 7. Catalogs not all in hand

A reader knows only what the parse's stated catalogs give it. Every named catalog held: a name is a component only when one of them defines it. A named catalog not held: a name the held ones do not define is read by the no-catalog rule, a capitalised name that is not one of the SDKs' helpers being a component whose positional order and children are unknown. No catalogs stated: the whole text is read by the no-catalog rule.

### 8. The pin's compilers

The readers and their cases are held against the compilers at the pin, under the Phase 9 spec's decision 8. A change the commit read finds that makes a published SDK compile the same text to different ids is written in this spec's outcome and brought to Jioh as a decision of its own.

### 9. Where Python's and TypeScript's compilers disagree

A reader follows the compiler the parse names in `a2ui.sdk.name`. Each disagreement that changes a component's id is a rule with two forms, each held by its case's expected record for that language. A parse that names no SDK is read by Python's form. Each disagreement is a finding in `_dev/a2ui-findings.md` with a held-by line, listed in the pin file's `heldBy`.

### 10. The positional order

Upstream's schema helpers and Express compilers at the pin are the definition, carried in the viewer as a hand-written port, in five points, each held by its own case:

1. Properties are read from the root schema and every nested `allOf` entry, local `#/` references resolved first, in declaration order, the first occurrence winning; the entries are walked in the order of the parse's SDK.
2. No slot goes to `component`, `id`, the four `@` keys, a bare `catalogId`, `metadata` or `accessibility` the component does not declare as a custom property, or `checks` on a checkable component.
3. A custom property is one of an envelope key's name whose schema is not the standard one, judged as the parse's SDK judges it.
4. A check, or a list made only of checks, is taken out of a call's arguments before the positions are counted.
5. A call's `catalogId=` argument picks the catalog whose definition gives the order, when two of the parse's catalogs define the name.

A name two of the parse's catalogs define, called without `catalogId=`, is read by the first catalog in the parse's list that defines it. The compilers' numeric skip, a trailing number moved to a later number-typed property, is not carried.

Where upstream's fixture catalogs lack a shape, the case runs on a test catalog written for Spectra under `conformance/test_data/catalogs/`.

### 11. Atom's bare-child rule

Python's Atom compiler at the pin is the definition, in five points, each held by its own case:

1. A bare string in a container's child position is an implicit text component taking the next `node_N` id: directly, inside a positional `[...]`, and inside a `(:children "a" "b")` form.
2. A bare symbol is wrapped the same way.
3. A string equal to the id of a component already compiled into the same message is a reference and makes no component; the parent, an ancestor and a later sibling are not yet compiled.
4. A string under an explicit `:children [...]` or `:child "x"` keyword is a reference.
5. An empty string is dropped, and so is any string when the parent's catalog has no text component, a component whose only required property is named `text`, `content`, `label` or `title`.

### 12. One run over upstream's compile cases

During the build the readers are run once, by hand, over upstream's compile cases in the `a2ui-upstream` worktree at the pin, the three files named above, with nothing committed. Each case where a reader names other components than the expected messages hold is listed in this spec's outcome and brought to Jioh, who decides for each whether it joins the sub-task under decision 2 or becomes a backlog line.

### 13. The findings

Each item found beside the readers' matter becomes a finding in `_dev/a2ui-findings.md`, one each, in the file's form, reproduced again against the worktree at the pin before it is written. None carries a held-by line. The disagreements of decision 9 are findings with their held-by lines.

### 14. Nothing on screen changes

The viewer's sentences above a parse's raw text stay as they are, and the design canvas "Spectra viewer UI" is not touched.

### 15. The wiring

A test at the model's level builds a parse's knowledge from served catalogs: a catalog matched by its id, one matched by an alias, a named catalog not held, and no catalogs stated. The Phase 9 spec's decision 14, the acceptance run, gains a check by eye: one of the new Express records and one of the new Atom records opened from the local store, an inline component's text and its tree node selecting each other. This sub-task has no tunnel session of its own.

### 16. The documents

- This spec's outcome: per report, its case and the assertion it failed on, or that it was not confirmed; the judgement of each of the nine commits; the one run's mismatches with the decision on each.
- The sub-task 6.5 spec, amended in place: its decision 2, the readers, on a reader's catalog knowledge per parse and the compiler it follows; its decision 3, how the readers are proved, on the oracle giving each reader its case's catalogs.
- The Phase 9 spec, amended in place: its scope line naming the four readers; its decision 14 gaining the check by eye.
- `_dev/TODO.md`: the 9.9 line naming the four readers and this spec; the 9.8 line gaining the check by eye; at the close, the backlog gaining the readers held permanently against upstream's own compile cases, as listed copies with a harness in the viewer's tests, worded by what the one run found.
- `_dev/a2ui-findings.md` and `_dev/upstream-pin.json`: the findings, and a `heldBy` entry for each finding of decision 9.
- `conformance/README.md`: the wrapper capture section with the new cases, and which catalogs under `test_data/catalogs/` are Spectra's own.
- The viewer's README: its lines on component ranges.

### 17. Done when

Each of the seven reports has its case in the wrapper capture suite, run failing before the reader changed, or is listed as not confirmed with its case kept; each of the nine commits is judged in this spec's outcome and what it turned up has its case; the one run over upstream's compile cases is made and every mismatch carries Jioh's decision; the readers' oracle is green on the whole suite, each case read with its own catalogs, in both forms wherever the two SDKs disagree; the wiring's model tests are green; the findings are written, each reproduced at the pin, with the `heldBy` entries in the pin file; the documents of decision 16 are written; and everything CI runs is green locally from a clean build, and then on GitHub.

## Invariants

- Nothing on screen changes.
- The turn record, the wrappers' code and SPEC.md are untouched.
- The readers stay hand-written scanners in the viewer's model, with no new runtime dependency, as sub-task 6.5's decision 2 has them.
- A reader never applies a definition from a catalog the parse did not name.
- `main` is never red: a case and its fix land together.
