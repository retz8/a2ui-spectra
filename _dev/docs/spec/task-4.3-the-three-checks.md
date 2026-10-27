# Sub-task 4.3 — The three checks

The catalog, structural and binding checks on the server, the turn record's amendments, and the checks in the viewer. Sub-task 4.3 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, carrying out its decisions 6 to 10: the catalog check, the structural check, the binding check, the checks in the record and the checks in the viewer; and the tests of its decision 22 that concern the checks.

## Scope

- The catalog, structural and binding checks, run at the turn's close beside the schema check, on the agent's A2UI messages.
- Turn record v0.1 amended in place: the skipped list, the catalog id dropped, the path convention and the code table in the prose; the schema and Phase 1's full fixtures following, with the fixture generator.
- The viewer: the findings in the one problem count and in the problem blocks; web core's rejections folded by step; the header's four check rows and their not-checked forms; the listing's count.
- The design canvas's amendment for the folded line, before the build.
- Unit tests of the checks over Phase 1's fixtures, the recordings and hand-written cases; the viewer's unit tests.
- The Phase 4 spec's amendments, the tool's README and `_dev/TODO.md`.

Out of scope, as the Phase 4 spec has it: the preview protocol, the Preview pane and render errors in the count, sub-task 4.4; the conformance action, whose expected records carry no check events.

## Locked decisions

### 1. The fold by step

A web core rejection on a step that carries a check finding is not a problem of its own: it becomes a quiet line under that step's problem blocks and is not counted. A rejection on a step with no finding stays a counted problem. The server's listing count applies the same fold, so the turn's row, its header and its problem blocks agree.

### 2. The check event's shape

`a2ui.check.catalog_id` is dropped. A new `a2ui.check.skipped` attribute, an array of entries each with the surface id, the catalog id when the surface named one, and a reason code, is required on the catalog, structural and binding events, empty when nothing was skipped, and not allowed on the schema event. `a2ui.check.passed` keeps meaning no findings: a check with skipped surfaces and no findings passes.

### 3. The reason codes

`no_definition`: the surface's catalog id resolves to no definition. `not_created`: the surface does not exist in the state, for lack of a `createSurface` or because web core rejected its `createSurface`.

### 4. Touched surfaces and coverage

A surface is touched when any A2UI message the agent sent in the turn names it, whatever the message type. The structural and binding checks cover the touched surfaces as they stand at the turn's close; surfaces the turn did not touch are not re-checked. A surface the turn deletes with `deleteSurface` and that is gone at the close is neither checked nor listed as skipped. A surface whose catalog id resolves nowhere is skipped by all three checks with `no_definition`.

A surface the turn names but that no `createSurface` in the conversation created is one structural finding, `SURFACE_NOT_CREATED`, on the first message of this turn that names it; the catalog and binding checks skip it with `not_created`. A surface whose `createSurface` exists but was rejected by web core gets no structural finding and is skipped by all three checks with `not_created`.

### 5. Catalogs resolve as Structure resolves them

A surface's or a component's catalog id resolves in the Phase 4 spec's order, the built-in basic catalogs, the configured catalogs, then the inline catalogs; the inline catalogs are those the hosts sent in the conversation's messages up to and including this turn, as the viewer's replay and the rejection count collect them. This amends decision 3 of the Phase 4 spec, which named the turn's own host message alone.

### 6. The finding's path

One convention for all four checks, written into the turn record prose: a finding's `path` is a JSON Pointer from the turn object to the offending value, through the wire output event, its part, the part's content and, for an array, the message's index. A catalog finding points at the offending property inside the component. A dangling child points at the child id itself: an element of `children`, the `child` value, or a template reference's `componentId`. A binding finding points at the binding object. An unreachable component points at the component. A never-created surface points at the first message of this turn naming it. A surface-wide finding carries no path.

### 7. A finding on a component from an earlier turn

When the component a finding names was carried by an earlier turn's message, the finding has no path and its message names the component and the surface. The viewer places it on the outcome step.

### 8. One event per check per turn, always four

Every turn with a known protocol version records all four check events, under the schema check's rule: a check with nothing to judge records `passed` true with empty findings and an empty skipped list; a turn with no version from anywhere records no check event. Each event's `a2ui.check.protocol_version` follows the schema check's rule, the version the agent's first A2UI message declares, else the turn's. In a mixed-version turn each component is validated against its own message's version and the state is built per message, as web core builds it.

### 9. The catalog check

Per message, as the schema check runs: each component in `updateComponents` and in a v1.0 `createSurface` is validated with the protocol's own component definition and the real catalog bound where the stand-in sits, cut to the branch of the component's type. One finding per Ajv error, code `VALIDATION_FAILED`, its message Ajv's text. A type the catalog has no entry for is one finding, `COMPONENT_UNKNOWN`. A function call inside a component is cut to its own function's branch the same way, an unknown function one finding, `FUNCTION_UNKNOWN`; v1.0's calls are reached through the bound catalog, v0.9's by an explicit pass over the function call objects. A v0.9 `createSurface` theme is validated against the catalog's `theme`. The catalog for a component is its own `catalogId` in v1.0 when it names one, else the surface's; a component whose own id resolves nowhere is not checked and adds a skipped entry for its surface with that id and `no_definition`.

### 10. The structural check

On each touched surface as it stands at the close, a walk from `root` over web core's child references: a child id with no component is `CHILD_NOT_FOUND`, a component the walk never reaches is `COMPONENT_UNREACHABLE`, no component with the id `root` is `ROOT_MISSING`, a surface-wide finding. What web core throws on this turn's `updateComponents` messages becomes one structural finding on that step with web core's sentence: a cycle or self-reference is `CYCLIC_REFERENCE`, a duplicate component id in one batch is `DUPLICATE_COMPONENT_ID`, a broken composition rule is A2UI's `UNALLOWED_PARENT` or `UNALLOWED_CHILD`. Web core's depth limit stays a rejection of web core's alone. This amends decision 7 of the Phase 4 spec, whose list of conditions gains the never-created surface and the duplicate id.

### 11. The binding check: what is a binding

Web core's schema behaviour tree over the catalog entry's schema says which properties of a component are dynamic, action, structural or static. A binding is a dynamic property holding `{"path": …}` in v0.9 or `{"@path": …}` in v1.0; an action's `context` values and v1.0's `userMessage`; a binding inside a function call's `args`; and a template's list path. A template component's bindings are scoped to each item of its list; the template component is checked through its template only, never standalone.

### 12. The binding check: filled

A binding is filled when its resolved path exists in the surface's data model at the close, whatever the value, `null` and the empty string included. A relative path outside a template resolves against the root, as web core resolves it. A template's list path must exist; when it holds an array, the template component's bindings are resolved against each item's scope, an empty array checks nothing, and a binding unfilled in some items is one finding whose message names how many items lack it and the first. Codes: `BINDING_PATH_UNFILLED` for an unfilled path, `BINDING_LIST_NOT_ARRAY` for a template's list path holding a value that is not an array.

### 13. The codes, in the prose

The turn record prose gains the code table of all four checks, the schema check's five codes included, and the tool's README points to it. The codes of the three new checks: `VALIDATION_FAILED`, `COMPONENT_UNKNOWN` and `FUNCTION_UNKNOWN` for the catalog check; `CHILD_NOT_FOUND`, `COMPONENT_UNREACHABLE`, `ROOT_MISSING`, `CYCLIC_REFERENCE`, `DUPLICATE_COMPONENT_ID`, `SURFACE_NOT_CREATED`, `UNALLOWED_PARENT` and `UNALLOWED_CHILD` for the structural check; `BINDING_PATH_UNFILLED` and `BINDING_LIST_NOT_ARRAY` for the binding check.

### 14. The findings' order

A check event's findings are ordered by the message and the component they point at; findings with no path come last.

### 15. The folded line and the canvas

The folded rejection is one line under the step's problem blocks, "A2UI web core also rejected this message · <web core's sentence>", in the quiet grey. It is drawn on the design canvas "Spectra viewer UI", on the "Turn view details" page's findings row, before the build.

### 16. The header's rows

The rows are in the checks' order: Schema, Catalog, Structural, Binding, each reading its result and protocol version as sub-task 4.1's board has them. Several skipped surfaces with one reason are listed in the row, "Catalog · not checked for `booking`, `confirmation` · no definition for catalog `<id>`"; with different reasons the "for `<surface>` · <reason>" pair repeats, each catalog id in monospace, and `not_created` reads "surface never created". Phase 3's bare "Not checked · <reason>" stays for a turn with no check event. The live turn is unchanged: the four events land at the close.

### 17. The listing's count

The server's listing row gives the findings total across the four checks and the rejections that no finding's step covers. A turn's problem count is the findings, the unfolded rejections and a failed outcome.

### 18. The fixtures' corrections

Phase 1's two full fixtures are corrected in four ways only: the binding findings' paths in the turn-rooted form; `a2ui.check.catalog_id` dropped and an empty `a2ui.check.skipped` added on every catalog, structural and binding event; the check events the fixtures lack added, the restaurant finder's first turn gaining catalog and binding events, the custom components sample's first turn a catalog event and its second a binding event; and nothing else. The fixture generator under `_dev/tools/` follows.

### 19. Tests

Unit tests run the checks over Phase 1's full fixtures, reproducing their check events; over the recordings, the flawed booking conversation yielding one schema finding on the `updateDataModel` with no surface id, one catalog finding on the Button's `colour`, two structural findings, `CHILD_NOT_FOUND` for the root Column's `time` and `SURFACE_NOT_CREATED` for `confirmation`, no binding finding, and `confirmation` skipped by the catalog and binding checks with `not_created`; and the restaurant finders clean. Hand-written cases cover each code, `UNALLOWED_PARENT` and `UNALLOWED_CHILD` on upstream's composition catalog from the test data, the binding codes with a template over items, an empty list and a non-array, the two skip reasons, a finding on a component from an earlier turn, mixed versions, the v0.9.1 alias, an inline catalog sent in the first turn only, and the fold by step in the listing's count. Viewer unit tests cover the four header rows and their skip wordings, the fold, and the listed count. The flawed booking's four problems are four distinct defects, with three web core lines folded.

### 20. Other documents

- The Phase 4 spec is amended in place: decision 3, the inline catalogs collected across the conversation's host messages; decision 7, the structural check's conditions and web core's throws as its findings; decision 9, the record's shape as decisions 2 and 6 here fix it; decision 10, the fold.
- The turn record prose and schema carry decisions 2, 6, 7, 8, 13 and 14.
- The tool's README documents the four checks and points to the prose for the codes and the path convention.
- `_dev/TODO.md`: the 4.3 line names this spec.

### 21. Done when

The unit tests pass and, through the tunnel, the flawed booking turn shows its findings across the four checks and its folded web core lines as sub-task 4.1's boards draw them, in light and dark, with the Python restaurant finder's booking showing no problems beside it.

## Invariants

- A record states what happened, and check events judge it. Web core's rejections are not recorded.
- No credential is ever in the record.
