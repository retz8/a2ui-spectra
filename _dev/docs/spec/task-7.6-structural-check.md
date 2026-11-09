# Sub-task 7.6 — The structural check judging this turn's components

The structural check reporting `COMPONENT_UNREACHABLE` for a component this turn's messages carried only, and the documents that state the rule following. Sub-task 7.6 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, carrying out its decision 15, the structural check judges this turn's components, which amends the Phase 4 spec's structural check.

## Scope

- `COMPONENT_UNREACHABLE` on the structural check: which components it is reported for.
- The other structural findings, unchanged.
- The unit tests on the check and the checks test over the A2A capture records.
- Turn record v0.1's prose, the tool's README, the Phase 4 spec's decision 7 and the 4.3 spec's decision 10, amended in place; the 7.6 and 7.7 lines in `_dev/TODO.md`.

Out of scope: the viewer and the design canvas, which do not change; Phase 1's fixtures, none of which carries the finding; the backlog item, removed at 0da3a8e when Phase 7 was marked WIP.

## Locked decisions

### 1. The components judged

`COMPONENT_UNREACHABLE` is reported for a component this turn's messages carried, added or updated, that the walk from `root` does not reach at the close, with its path. A component an earlier turn carried that this turn sends again is this turn's. A component an earlier turn left unreachable is not reported again, so a surface repainted in place, `root` or a parent sent again with new children, gets no finding for the earlier turn's children. A surface this turn leaves without a root reports `ROOT_MISSING` and this turn's own components as unreachable beside it, as today.

### 2. The other structural findings

`CHILD_NOT_FOUND` and `ROOT_MISSING` judge the surface as it stands at the close, an earlier turn's defect included: an earlier turn's component the root still reaches that names a child no component defines, and a surface an earlier turn left without a root that this turn touches, are reported as today, a finding on an earlier turn's component carrying no path. Decision 1 narrows `COMPONENT_UNREACHABLE` alone.

### 3. The tests

Three unit cases on the structural check: a surface repainted in place by this turn, `root` sent again with new children, gets no finding for the earlier turn's children; a component this turn adds to an earlier turn's surface that nothing reaches gets a finding with its path; a component an earlier turn carried that this turn sends again, still unreachable, gets a finding with its path. The checks test over the A2A capture records expects no structural finding on the strathweb booking wizard's second turn, which sends `step` and `nav` again with new children and leaves the first step's components behind; its comment says so.

### 4. The documents

- Turn record v0.1's prose, amended in place: the structural check's bullet and the code table's `COMPONENT_UNREACHABLE` row each gain "this turn's messages carried", and the bullet gains the sentence "A component an earlier turn left unreachable is not reported again". The path paragraph's sentence on a finding about a component an earlier turn's message carried stays, for decision 2's findings. The schema does not change.
- The tool's README: the structural check's paragraph gains "this turn's messages carried".
- The Phase 4 spec's decision 7, the structural check, and the 4.3 spec's decision 10, the structural check's codes, amended in place with the same clause. The 4.7 spec's decision 24, components left unreachable by a repaint, stays as the run's record.
- `_dev/TODO.md`: the 7.6 line names this spec and the work above; the 7.7 line gains, from 7.6, that the Python restaurant finder's second turn gets no `COMPONENT_UNREACHABLE` from its repaint, seen in the viewer's checks.
