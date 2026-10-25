# Task 3.3 — Flow 1, the first turn

Spec for sub-task 3.3 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the design canvas "Spectra viewer UI"'s Flow 1, sending a first message and watching the turn. The Phase 3 spec's decisions apply, as amended here.

## Scope

- The API serving the agent card's details and skill examples, and the agent popover.
- The first screen.
- The live turn following the newest step, Jump to latest, and landing on the first problem or the final state when it closes.
- The step's detail collapsed until a step is selected.
- The turn list following the newest turn.
- The unit tests, the Phase 3 spec's amendments and `_dev/TODO.md`.
- Not in scope: the count as a filter, a turn opening on its first problem and the offending JSON line (sub-task 3.4); the composer continuing the conversation in view and saying when the agent waits for input (3.5); the turn list's strip and overlay, remembered dividers, the composer growing, the keys and the step in the page address (3.6).
- Done when the design canvas's Flow 1 row works in the viewer.

## Locked decisions

### 1. The card's details in the API

The session's context in the API gains the agent's own URL, the one Spectra was given, the A2A versions, the A2UI extensions with their catalog ids, and the skill examples, each read from the card on the server.

### 2. The agent popover

The popover lists every A2A version and every A2UI extension the card states, in card order, v0.8 included. With no A2UI extension, it reads "None advertised". A basic catalog is shortened as the design canvas draws it, such as "basic, v1.0"; any other catalog shows its full id.

### 3. The first screen's examples

The first screen offers the first example of each of the card's skills, in card order. The "From the agent's card" section is left out when the card has no examples, and when the message box cannot send to the agent. The agent's name, its live status and the wire proxy's address stay.

### 4. Following the newest step

Only "Jump to latest" resumes following. A selected step stays selected, even when it was the newest as it was selected.

### 5. The step's detail

The step's detail is collapsed to its title line while no step is selected: while the timeline follows, and once a turn with no problems lands on its final state. It opens when a step is selected or the view lands on a problem.

### 6. The turn list following the newest turn

When following selects a new turn, its conversation's group opens, even one closed by hand. A typed search stays as typed.

### 7. Tests

Unit tests under Node's test runner cover the tool reading the card's details, fed with the agent cards in sub-task 2.3's recordings, and the viewer's following and landing: the step followed, what stops and resumes following, where a closing turn lands, and the turn the list selects. Components have no unit tests. The Flow 1 row is checked live through the tunnel against its four boards, in light and dark, with upstream's Python restaurant finder and an empty store.

### 8. The Phase 3 spec's amendments

- The frame: the agent popover lists every A2A version and A2UI extension the card states, as in decision 2.
- The first screen: the first example of each of the card's skills, as in decision 3.

### 9. `_dev/TODO.md`

- 3.3 gains the step's detail collapsed until a step is selected, and names this spec.
- 3.6 loses the step's detail collapsed until a step is selected.
