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

An hourglass, labelled "Legacy form" wherever it stands alone, as its accessible name and its tooltip: after the problem mark on the timeline row, after the id on the node's row in Structure, at the right end of the bare key's line, before the detail's first line and before the opened node's line. The header keeps its check mark, and the tooltip's row carries no icon.

### 4. What is counted

Components. The number shows in the tooltip's check row and in the step's detail. The header's label and the timeline row's mark carry no number.

### 5. The header's label

"No problems · legacy form" on a turn that is otherwise clean. With no problems the remarks chain, "No problems · not fully checked · legacy form". With problems the label stays as it is, such as "4 problems". The tooltip says everything in both cases. The label is not pressable for the legacy form.

### 6. The header's tooltip

The remark sits on the Catalog check's row, "Passed · 3 components in the legacy form", the remark in muted grey after "Passed", and the tooltip 440 px wide while a row carries it. A surface whose catalog has no definition gets no legacy mark.

### 7. The timeline row

The hourglass on the row of the step that carried the components. A step that also has a problem carries the problem mark with its count, then the hourglass.

### 8. The step's detail

Two lines above the message, with no box, the hourglass before them where a problem block has its icon. The first, in the strong muted grey, gives the number of components and names the bare keys they carry, "3 components carry bare envelope keys, the legacy form: `checks`, `accessibility`". The quiet second line, 12 px in muted grey, gives the v1.0 form and says the bare keys are accepted during upstream's transition: "The v1.0 form is `@checks`, `@accessibility`. The bare keys are accepted during upstream’s transition." The keys in monospace. No link. On a step that also has a problem, the problem's block comes first, then the legacy form's two lines, then the message.

### 9. The bare key's line in the message

A band one step darker than the block, in the grey the canvas uses for borders, with the hourglass at the line's right end. The bare key's line is the line holding the key. A problem's line keeps its soft red, and one message can carry both; the component rejected for carrying both keys has its bare key's line in soft red. A folded line carries the band of a bare key inside it, as it carries a problem's mark.

### 10. Structure

The hourglass on the node's row. The opened node's properties list the bare key as written, and the node carries one quiet line under them, inside the properties' box, naming the bare keys the component was written with, such as "Legacy form: `checks`". Nothing leads from the line to the message.

### 11. From the header to the marked steps

Nothing. The marked steps are found by their icon in the timeline, there is no filter for them, and a turn with only the legacy form opens as a clean turn does.

### 12. What carries no mark

The turn list row and its strip, the surface switcher, the preview, the fixture view and the replay verdict, and the A2UI step's parse rows and raw text. A v0.9 or v0.9.1 turn, a bare key the component's own schema declares as a property, and a surface whose catalog has no definition get no mark at all.

### 13. Where the boards go

"Turn view details" gains a row, "The legacy form", with three boards in light:

1. The step selected: the header reading "No problems · legacy form", the hourglass on the step's timeline row, the detail's two lines, and the bare keys' lines marked in the message. The step's detail maximized.
2. The header's tooltip open on the Catalog check's row with its count, and in Structure a marked node opened to its line, the TextField. The step's detail closed.
3. The legacy form beside a problem in the same step: one component carrying both keys rejected, drawn as a problem is drawn, and the other components carrying the quiet mark, folded, each folded line with its band. The step's detail maximized.

The first and the third get dark twins. The "Components and states" board gains the mark's forms, the chained label "No problems · not fully checked · legacy form" among them. The "Icons" board gains the hourglass. No flow, no small-window board, nothing on the Screens row, no new keys. The `@` keys on a clean turn get no board.

### 14. What the boards draw

Spectra's stub agent, a canned v1.0 booking form. Three components are in the legacy form: a TextField and a DateTimeInput each with a bare `checks`, and a Button with a bare `accessibility`. On the third board a ChoicePicker carries both `checks` and `@checks`. The check values follow the `required` checks of the strathweb-a2ui BookingWizard recording, written as v1.0 writes them. Illustrative values and the exact wording are settled on the canvas.

On the canvas: the input "Book a table at Han Il Kwan", the reply "Here is the booking form.", one delivery of four parts, a Text, `createSurface`, `updateComponents` and `updateDataModel`, and the turn waiting for input. The messages declare `"version": "1.0"`. The surface `booking` holds six components: a Column `root` with the children `name`, a TextField; `date`, a DateTimeInput; `time`, a ChoicePicker of 18:00, 19:00, 20:00 and 21:00; and `submit`, a Button whose child is the Text `submit_label`, "Book", its action the event `book`. Each envelope key is written after `component`. The checks read `{"condition": {"@call": "required", "args": {"value": {"path": "/name"}}}, "message": "We need a name for the booking."}`, with `/date` and "Pick a date.", and `/time` and "Pick a time.". The ChoicePicker carries `@checks` on the first two boards and both keys on the third; the Button's bare `accessibility` is `{"label": "Book the table"}`.

### 15. The rejection's words

Web core's own sentence at the pin, "Component 'time' cannot specify both '@checks' and legacy 'checks'.", with the code drawn as the catalog check's findings are, "VALIDATION_FAILED · catalog check, A2UI v1.0".

### 16. What other sub-tasks and documents take from this

- Sub-task 9.3: for each component in the legacy form, the record carries its surface, its id and the bare keys it carries, on a catalog check that still passes. 9.3 settles the rejection's code and may reword its sentence, and the board follows it. If 9.3 lands the legacy form on a check other than the catalog check, the tooltip's row moves on the canvas.
- Sub-task 9.4: the marking built as the row draws it.
- The stub agent's canned v1.0 conversation: which sub-task adds it is left to those sub-tasks.
- The Phase 3 spec, amended in place: decision 9, problems, gains the legacy form as a mark that is not a problem.
- The Phase 4 spec, amended in place: decision 10, the checks in the viewer, gains the legacy form on the Catalog check's row and in the header's label.
- `_dev/TODO.md`: the 9.1 line names this spec.
