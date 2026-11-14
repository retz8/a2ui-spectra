# Sub-task 9.3 — The checks at v1.0

The v1.0 component envelope keys in the checks, in both forms, and the v1.0 rules that come with the pin's schemas. Sub-task 9.3 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 5, the v1.0 component envelope keys in both forms, and taking what sub-task 9.1's decision 16 and sub-task 9.2's handover leave to it.

Upstream as sub-tasks 9.1 and 9.2 read it, `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`: none of the three events of the Phase 9 spec's decision 2. The upstream check at this sub-task's start, on 2026-11-14, read the same `upstream/main`, `3ed960186`, touching none of the areas Spectra uses: none of the three events.

The checks at the pin, before the sub-task, on a v1.0 component:

- `@checks`, `@accessibility` and `@metadata` pass the four checks; the function calls and the bindings inside `@checks` and `@accessibility` are judged.
- `@catalogId` is not read: the component is judged against its surface's catalog.
- A bare `catalogId`, `accessibility`, `metadata` or `checks` is one `VALIDATION_FAILED` finding of the catalog check, Ajv's unevaluated property, where web core accepts the component and stores the value under the `@` key; a binding inside a bare `checks` is not judged.
- A component carrying both forms gets the same Ajv finding on the bare key, where web core refuses the whole `updateComponents` with "Component '<id>' cannot specify both '@checks' and legacy 'checks'."
- The schema check passes a component in either form.

## Scope

In scope:

- The catalog check and the binding check on a v1.0 component's envelope keys: the `@` keys read, `@catalogId` choosing the catalog, the bare keys judged as the legacy form, the component carrying both forms rejected.
- The catalog a v1.0 function call inside a component is judged in.
- Turn record v0.1 amended in place: the legacy form on the catalog check event; the prose, the schema, the committed records and the record's conformance data following.
- The stub agent's canned v1.0 booking form, in three forms.
- Test cases holding the rules the pin's schemas express.
- The Phase 4 spec's amendments, the tool's README, `_dev/a2ui-findings.md`, `_dev/upstream-pin.json` and `_dev/TODO.md`.

Out of scope:

- The legacy form's marking in the viewer, and the viewer's code. Sub-task 9.4's.
- SPEC.md. Sub-task 9.7's.
- The A2UI regex dialect of the v1.0 basic catalog's `regex` function. Backlog, under decision 8.
- What becomes of the legacy form's attribute once upstream removes its fallback, issue #4082. The sub-task that handles that move of the pin.

## Locked decisions

### 1. Web core's code at the pin defines the judgement

"As upstream's core SDKs and renderers judge them", in the Phase 9 spec's decision 5, is web core's code at the pin, `typescript/core/web_core/src/catalog/component_envelope.ts`, of which the v1.0 evolution guide's "Component envelope mixin keys" is the summary. Spectra follows it in the four places where it is finer than that summary:

- A bare `checks` is the envelope key only on a component whose schema takes checks. On any other component it is an ordinary property, which the component's schema rejects.
- Whether a bare `catalogId` routes the component is decided by the component type's schema in the surface's default catalog, not in the catalog it names.
- A property the component's schema declares under a bare name counts against the bare key only when it is a custom property. A bare name declared in the protocol's own shape, such as `checks` as an array of check rules, is still the envelope key.
- A key is present when its value is not `undefined`: a `null` value counts, for the rejection of both forms too.

A difference between the Python core's validator, `python/a2ui_core`, and web core on these points is an upstream finding.

### 2. Spectra's own implementation, held by a differential test

Web core does not export its envelope code. The checks decide for themselves, from the catalog's definition, whether a bare key is the envelope key. A differential test feeds every envelope case both to web core's message processor and to Spectra's catalog check, and requires them to agree: on accepted or rejected, on the key web core stored the value under, and on the sentence of the rejection of both forms. When upstream removes its fallback, issue #4082, and the pin moves, the test fails on the bare-key cases, and Spectra removes its own.

### 3. The legacy form in the record

The catalog check event gains `a2ui.check.legacy_form`: an array with one entry per component object a message carried in the legacy form. An entry holds `surfaceId`; `componentId`; `keys`, the bare keys read as envelope keys, in the order the component writes them; and `path`, a JSON Pointer from the turn object to the component object, in the findings' path convention. The attribute is required on `catalog`, empty when there is none, and not allowed on the other three checks, as `a2ui.check.skipped` is on its three. `a2ui.check.passed` keeps meaning no findings. A legacy-form entry is not a finding. A component whose `id` is not a string is not listed; its bare keys are judged all the same.

### 4. The component carrying both forms

One catalog finding per pair of keys: the code `VALIDATION_FAILED`; the message web core's sentence, word for word, "Component '<id>' cannot specify both '@<key>' and legacy '<key>'."; the path at the bare key. It stands in place of Ajv's unevaluated-property finding on that key. The rest of the component is validated with the `@` key's value, so its other defects are reported as well. The component is not listed in `a2ui.check.legacy_form` for that key; another bare key it carries alone is listed.

### 5. What is judged inside an accepted bare key

The value under an accepted bare key is judged exactly as the `@` key's value: the catalog check validates it against the envelope key's schema and judges the function calls inside it, and the binding check follows the paths inside it. Each finding's pointer runs through the bare key as written. A component in the legacy form can carry findings; it is listed in `a2ui.check.legacy_form` either way. The legacy form by itself never fails a check.

### 6. No definition, no judgement

A bare key is judged only where the schema that decides it is known. A component whose own catalog has no definition stays under the catalog check's `no_definition` skip and is not listed in the legacy form. A component whose type its catalog does not define is not judged on its envelope keys: it carries `COMPONENT_UNKNOWN` alone, with no finding for both forms, and is not listed. On a surface whose default catalog has no definition, a bare `catalogId` is not followed: the component is not checked against the catalog it names and is not listed. An `@catalogId` naming a catalog with a definition is always followed, whatever the surface's default catalog; one that resolves nowhere adds the skipped entry for its surface with that id and `no_definition`.

### 7. The v0.9.1 URL keeps the v0.9 basic catalog

The registry goes on serving its copy of the v0.9 basic catalog under the v0.9.1 URL. A v0.9.1 List with `listStyle` passes the catalog check, as web core accepts it. Upstream's `specification/v0_9_1/catalogs/basic/catalog.json`, left without List's `listStyle` when `2e8a58a69` (#3956) restored it in the v0.9 file and in web core's basic catalog, is a new finding in `_dev/a2ui-findings.md`, held-by: Spectra carries the alias.

### 8. The rules that come with the pin's schemas

The rules the copied schemas and catalogs express: the four `@` envelope keys in v1.0's `common_types.json`, and `value` required on the v1.0 basic catalog's TextField. They are in force through sub-task 9.2's copies; 9.3 adds the test cases that hold them. The A2UI regex dialect, which the v1.0 basic catalog's `regex` function states in its description and web core enforces when the function runs, is not judged. The backlog gains a static check of a literal `pattern` against the dialect.

### 9. The stub agent's v1.0 booking form

9.3 adds it: a behaviour of the conformance workspace's stub agent that sends the booking form of sub-task 9.1's decision 14 in v1.0, in three forms.

- The `@` form: every envelope key written with `@`.
- The bare form: the TextField and the DateTimeInput each with a bare `checks`, the Button with a bare `accessibility`, the ChoicePicker with `@checks`.
- The both-forms form: the bare form, with the ChoicePicker carrying both `checks` and `@checks`.

9.3's tests run the four checks over each form. Sub-tasks 9.4 and 9.8 use the behaviour as it is.

### 10. What stays as it is

- The terminal: `a2ui-spectra replay` and `a2ui-spectra test` print nothing about the legacy form.
- The counts: `a2ui.check.passed`, the listing's problem count and the fold by step.
- The schema check.
- Which component is a v1.0 component: the one whose own message declares v1.0, under sub-task 4.3's decision 8.
- v0.9 and v0.9.1: a bare `accessibility` and `checks` are the envelope keys with no legacy-form entry, and an `@` key is rejected by the catalog's own schema.

### 11. What sub-task 9.4 and the canvas take from this

- The both-forms form's turn reads two problems: web core refuses the whole `updateComponents` over the ChoicePicker, the surface `booking` stands without a root at the turn's close, and the structural check reports `ROOT_MISSING` beside the catalog finding, under sub-task 4.3's decision 10. Its preview is empty. The third board of sub-task 9.1's row "The legacy form" follows.
- The folded web core line on that step repeats the finding's sentence.
- Sub-task 9.1's decision 16 says "on a catalog check that still passes": the legacy form by itself never fails the catalog check, and a finding inside the bare key can.
- The record's shape, as decision 3 fixes it.
- The stub agent's booking form writes its bindings as v1.0 does, `{"@path": "/name"}`, in the components' values and in the check rules' arguments; the boards of sub-task 9.1's row "The legacy form" follow, in place of their `{path: '/name'}`.

The 9.1 spec is left as written.

### 12. Other documents

- The turn record prose and schema carry `a2ui.check.legacy_form` with its entry's four fields, and the `catalog` check's sentence gains the bare envelope key accepted as the legacy form.
- The tool's README: the four checks' section gains the `@` keys, the legacy form, the rejection of both forms and the catalog a v1.0 function call runs in.
- The Phase 4 spec is amended in place: decision 6, the catalog check, gains `@catalogId`, the bare keys' judgement and the catalog a v1.0 function call runs in; decision 8, the binding check, the paths inside an accepted bare key; decision 9, the checks in the record, the new attribute.
- `_dev/a2ui-findings.md` gains decision 7's finding, and `_dev/upstream-pin.json` lists it among the held-by findings with its upstream path. A difference between the two cores under decision 1, met in the build, is recorded as a finding.
- `_dev/TODO.md`: the 9.3 line names this spec; the backlog gains decision 8's item.

### 13. Left to the build

How the catalog check reads a custom property out of a catalog's definition; how the stub agent chooses among its three forms; the test catalog that declares its own `metadata` or `checks` property; the new finding's number.

### 14. The catalog a function call runs in

A v1.0 function call inside a component is judged in the catalog it runs in, as web core's code at the pin decides it, `nestedCallRunsInCatalog` in `typescript/core/web_core/src/validation/payload-validator.ts`: the catalog its own `catalogId` names, else the surface's catalog, whatever catalog the component or an enclosing call names. A system function, its name starting with `@`, belongs to no catalog. A call naming a catalog with no definition is not judged and adds the skipped entry for its surface with that id and `no_definition`; a call naming no catalog, on a surface whose catalog has no definition, is not judged. The differential test of decision 2 carries a call in a component of another catalog and a call naming its own catalog.

### 15. Done when

All of these hold on `main`:

1. The mark is gone: the `todo` case of `tools/spectra/src/check/catalog_check.test.ts` runs unmarked, written on `@catalogId`, with a twin on the bare `catalogId`; the search for `Sub-task 9.3, at the pin: ` that sub-task 9.2 fixed finds nothing.
2. Hand-written cases cover each envelope key in each form: the `@` key, the bare key and both; a bare key the component's schema declares as its own property; a bare `checks` on a component that takes no checks; a `null` value; a bare `catalogId` judged in the surface's default catalog; the two no-definition cases of decision 6; a finding inside an accepted bare key, in the catalog check and in the binding check; a function call in a component of another catalog, one naming its own catalog, and one naming a catalog with no definition.
3. The differential test of decision 2 passes.
4. The stub agent's three forms yield: the `@` form clean, with an empty `a2ui.check.legacy_form`; the bare form passing, with three entries; the both-forms form one `VALIDATION_FAILED` on the ChoicePicker's bare `checks`, `ROOT_MISSING` for `booking`, and three entries.
5. v0.9 and v0.9.1 are as decision 10 has them.
6. TextField's required `value` has its case.
7. The record follows: the prose and the schema carry the new attribute; the five committed records that hold a catalog check event, under `conformance/test_data/turn_record/v0_1/`, gain the empty array; the record's conformance data gains its valid and invalid cases.
8. CI is green on GitHub.

There is no run through the tunnel; sub-task 9.8's acceptance run covers a v1.0 turn in each form.

## Invariants

- Spectra's judgement of a v1.0 component's envelope keys agrees with web core's at the pin.
- The catalog check judges every message as sent, whether or not web core accepted it.
- A legacy-form entry is not a finding, and the legacy form by itself never fails a check.
- v0.9 and v0.9.1 turns are checked as before the sub-task.
