# Sub-task 9.1 — The design artifact

The legacy form's marking on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which sub-task 9.4 follows. Sub-task 9.1 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 13, the design artifact comes first, for the legacy form of its decision 5: a v1.0 component's bare `catalogId`, `accessibility`, `metadata` or `checks`, accepted where the component's schema declares no property of that name.

Upstream as read at `upstream/main` `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, in none of Spectra's areas. Every copied file unchanged, npm carrying no release since 2026-11-02 and PyPI none since 2026-11-10, `specification/versions.json` unchanged, the five watch-list items open, no commit on a held-by finding's paths. None of the three events of the Phase 9 spec's decision 2.

## Scope

- The legacy form's marking at each level of the viewer it shows at: the turn header and its tooltip, the timeline row, the step's detail, the message and Structure.
- The legacy form beside a problem in one step, the problem a component carrying both the bare key and the `@` key.
- A row of boards on the "Turn view details" page, dark twins, the mark's forms on the "Components and states" board and its icon on the "Icons" board.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the legacy form shows

On the bare key's line in the step's message, on the component's node in Structure, on the step's timeline row, in the step's detail, and in the turn header's check state with its tooltip. The turn list row stays as it is, and the problem count is untouched.

### 2. The mark's tone

Quiet, with no new colour: muted text with its own icon, as "No problems · not fully checked" is in the header. It is told apart from a problem by icon and word.

### 3. The icon

An hourglass, labelled "Legacy form" wherever it stands alone. The header keeps its check mark.

### 4. What is counted

Components. The number shows in the tooltip's check row and in the step's detail. The header's label and the timeline row's mark carry no number.

### 5. The header's label

"No problems · legacy form" on a turn that is otherwise clean. With no problems the remarks chain, "No problems · not fully checked · legacy form". With problems the label stays as it is, such as "4 problems". The tooltip says everything in both cases. The label is not pressable for the legacy form.

### 6. The header's tooltip

The remark sits on the Catalog check's row, "Passed · 3 components in the legacy form". A surface whose catalog has no definition gets no legacy mark.

### 7. The timeline row

The hourglass on the row of the step that carried the components. A step that also has a problem carries the problem mark with its count, then the hourglass.

### 8. The step's detail

Two lines above the message. The first gives the number of components and names the bare keys they carry, such as "3 components carry bare envelope keys, the legacy form: `checks`, `accessibility`". The quiet second line gives the v1.0 form, `@checks`, `@accessibility`, and says the bare keys are accepted during upstream's transition. No link. On a step that also has a problem, the problem's block comes first, then the legacy form's two lines, then the message.

### 9. The bare key's line in the message

A band one step darker than the block, in the grey the canvas uses for borders, with the hourglass at the line's end. A problem's line keeps its soft red, and one message can carry both.

### 10. Structure

The hourglass on the node's row. The opened node carries one quiet line under its properties naming the bare keys the component was written with, such as "Legacy form: `checks`, `accessibility`". Nothing leads from the line to the message.

### 11. From the header to the marked steps

Nothing. The marked steps are found by their icon in the timeline, there is no filter for them, and a turn with only the legacy form opens as a clean turn does.

### 12. What carries no mark

The turn list row and its strip, the surface switcher, the preview, the fixture view and the replay verdict, and the A2UI step's parse rows and raw text. A v0.9 or v0.9.1 turn, a bare key the component's own schema declares as a property, and a surface whose catalog has no definition get no mark at all.

### 13. Where the boards go

"Turn view details" gains a row, "The legacy form", with three boards in light:

1. The step selected: the header reading "No problems · legacy form", the hourglass on the step's timeline row, the detail's two lines, and the bare keys' lines marked in the message.
2. The header's tooltip open on the Catalog check's row with its count, and in Structure a marked node opened to its line.
3. The legacy form beside a problem in the same step: one component carrying both keys rejected, drawn as a problem is drawn, and the other components carrying the quiet mark.

The first and the third get dark twins. The "Components and states" board gains the mark's forms, the chained label "No problems · not fully checked · legacy form" among them. The "Icons" board gains the hourglass. No flow, no small-window board, nothing on the Screens row, no new keys. The `@` keys on a clean turn get no board.

### 14. What the boards draw

Spectra's stub agent, a canned v1.0 booking form. Three components are in the legacy form: a TextField and a DateTimeInput each with a bare `checks`, and a Button with a bare `accessibility`. On the third board a ChoicePicker carries both `checks` and `@checks`. The check values follow the `required` checks of the strathweb-a2ui BookingWizard recording, written as v1.0 writes them. Illustrative values and the exact wording are settled on the canvas.

### 15. The rejection's words

Web core's own sentence at the pin, "Component 'time' cannot specify both '@checks' and legacy 'checks'.", with the code drawn as the catalog check's findings are, "VALIDATION_FAILED · catalog check, A2UI v1.0".

### 16. What other sub-tasks and documents take from this

- Sub-task 9.3: for each component in the legacy form, the record carries its surface, its id and the bare keys it carries, on a catalog check that still passes. 9.3 settles the rejection's code and may reword its sentence, and the board follows it. If 9.3 lands the legacy form on a check other than the catalog check, the tooltip's row moves on the canvas.
- Sub-task 9.4: the marking built as the row draws it.
- The stub agent's canned v1.0 conversation: which sub-task adds it is left to those sub-tasks.
- The Phase 3 spec, amended in place: decision 9, problems, gains the legacy form as a mark that is not a problem.
- The Phase 4 spec, amended in place: decision 10, the checks in the viewer, gains the legacy form on the Catalog check's row and in the header's label.
- `_dev/TODO.md`: the 9.1 line names this spec.
