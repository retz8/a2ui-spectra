# Task 3.4 — Flow 2, finding what went wrong

Spec for sub-task 3.4 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the design canvas "Spectra viewer UI"'s Flow 2, finding out what went wrong. The Phase 3 spec's decisions apply, as amended here.

## Scope

- A turn opening on its first problem.
- The count as a filter.
- The offending JSON line in the step's detail.
- The problem blocks' text.
- The stub agent's flawed booking conversation, and its recording in the coverage roster.
- The design canvas's amendments.
- The unit tests, the Phase 3 spec's amendments and `_dev/TODO.md`.
- Not in scope: the composer continuing the conversation in view and saying when the agent waits for input (sub-task 3.5); the turn list's strip and overlay, remembered dividers, the composer growing, the keys, the next-problem key among them, and the step in the page address (3.6).
- Done when the design canvas's Flow 2 row works in the viewer.

## Locked decisions

### 1. Opening on the first problem

A closed turn with problems opens on its first problem in timeline order, with the step's detail open, however it is reached: from the turn list, from its search, or coming back to it. A turn whose only problem is a problem of the whole turn opens on its outcome.

### 2. The filter belongs to one turn

Every turn opens with all its steps, and the filter is turned on for the turn in view. As the Flow 2 row's second board draws it: the count is pressed, the Steps header gives the steps kept out of all the turn's steps with "Problems only" and "Show all", and a delivery's row stays as the group header above its steps with problems. Pressing the count again, or Show all, turns it off.

### 3. The selection under the filter

Turning the filter on moves a selection it hides to the first problem. A selection the filter keeps stays, a delivery's row kept as a group header included. Turning the filter off leaves the selection where it is.

### 4. Which problems mark a line

The schema check's findings mark the line their pointer names. Web core's rejections mark a line where web core says where: a component that fails its catalog's schema at the property Zod names inside it, and a message that fails web core's Zod parse at the issue's path. A rejection that names only the message, such as a surface not found, marks none.

### 5. What a mark covers

A pointer at a single value marks its line. A pointer at an object or an array marks its opening line.

### 6. Reaching the marked line

A problem block that marks a line can be pressed, and scrolls its line into view. The step's detail opens at its top.

### 7. Marks inside a fold

A folded line carries the mark of a line inside it. Pressing the problem block unfolds what hides its line, then scrolls to it. The marks are in the step's own JSON block only, not in the delivery it arrived in.

### 8. The problem's text

A problem block leads with its source's own text, as sub-task 2.4 set for the schema check's findings. When web core says no branch of its message union fits, the text is cut to the issues of the branch of the message's own type, in web core's own form.

### 9. The flawed booking conversation

The stub agent gains a flawed booking conversation behind its own flag, with a card naming it "Flawed Booking Agent". It replies with one delivery carrying the Flow 2 row's flaws: a Button with a property its catalog does not define, an `updateComponents` to a surface never created, and an `updateDataModel` that names no surface. Sub-task 3.7's flawed booking agent is this conversation.

### 10. The design canvas's amendments

Before the build: the Flow 2 row's third board marks the `updateDataModel`'s opening line; the row's three boards show the texts the stub agent's turn produces; the Components and states board draws the pressable problem block's hover state and a folded line carrying a mark.

### 11. Tests

The flawed booking conversation is recorded once as a roster recording beside the stub agent's others, with its conformance case, and the coverage roster in `conformance/README.md` gains it. Unit tests under Node's test runner, fed with that recording, cover the filter, its rows, its count and the selection it moves; a closed turn opening on its first problem; the line each problem marks; and the union text cut to its branch. Components have no unit tests. The Flow 2 row is checked live through the tunnel against its three boards, in light and dark, with the stub agent's flawed booking conversation.

### 12. The Phase 3 spec's amendments

- The step's detail: a problem block that marks a line scrolls to it when pressed, and a folded line carries the mark of a line inside it.
- Problems: the count filters the turn in view, and a problem that says where it is marks its line in the step's JSON.

### 13. `_dev/TODO.md`

- 3.4 gains the stub agent's flawed booking conversation and its recording, and names this spec.
- 3.7's flawed booking agent becomes the stub agent's flawed booking conversation.
