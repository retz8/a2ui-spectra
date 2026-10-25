# Task 3.7 — The acceptance run

Spec for sub-task 3.7 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the real viewer taken through the design canvas "Spectra viewer UI"'s three flows and its other boards, in light and dark, at the small window size and with the keyboard; what the run finds is fixed within the sub-task.

## Scope

- The agents the run uses, and the mode each runs under.
- The store the run starts with.
- The design canvas's boards the run covers, and those it does not check.
- What counts as a finding, and where each finding goes.
- The three flows by the keyboard alone, and the step's detail at two window sizes.

## Locked decisions

### 1. The agents

- Upstream's Python restaurant finder at `020a9d6f`.
- AG2's agent with its scripted model, in three sessions: the card at v0.9.1, the function call at v1.0, and the failure at v1.0.
- The stub agent's flawed booking conversation.
- The file-upload summarizer, and the stub agent waiting for a cancel, cancelled by the host: each sent its recorded requests from the coverage roster through the wire proxy, as a second host.

The Node restaurant finder is not in the run.

### 2. `run` and `attach`

The three AG2 sessions run under `a2ui-spectra run`. Every other agent is attached with `a2ui-spectra attach`.

### 3. The store

Before the first session, the store is moved aside to a dated folder, not deleted. The Python restaurant finder's session comes first, so Flow 1 starts on the first screen. The store then builds up across the sessions, each later session showing the earlier sessions' turns.

### 4. The boards

The run covers:

- the Flows page: Flow 1, sending a first message and watching the turn; Flow 2, finding out what went wrong; Flow 3, continuing the conversation;
- the Screens and foundations page's Screens and States rows;
- the Foundations row — Foundations, Components and states, Icons and the Icon component — as the reference for what the viewer draws;
- the Turn view details page.

Two are not checked, and the done commit names them: the Input step board's A2UI action as the turn's input, and the Components not under the root board.

### 5. What counts as a finding

Any difference of design between the viewer and a board — the layout, an element missing or extra, the wording, a state, spacing, colour, behaviour — is a finding. It is fixed in the viewer, or, where the board is wrong, the board is amended on the design canvas. A difference of content between the real agent's turns and a board's is not a finding, nor is a feature of a later phase. A fault in an agent or in upstream's SDK is recorded in `_dev/a2ui-findings.md` and not fixed here. A route of the run that does not work, such as a second host's turns through the wire proxy, is a finding.

### 6. Dark

In dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light.

### 7. The keyboard

Each of the three flows is done once by the keyboard alone, in light at full width, from its first board to its last. A flow that cannot be finished without the mouse is a finding.

### 8. The step's detail at two window sizes

The step's detail's Collapse and Expand, and `n` with the detail closed, are pressed at 1200 × 760 and on a tall window, as tall as the browser's screen allows. The done commit records the tall window's size.
