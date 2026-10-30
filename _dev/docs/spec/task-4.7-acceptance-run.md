# Task 4.7 — The acceptance run

Spec for sub-task 4.7 of Phase 4 — Checks and preview (`_dev/docs/spec/phase-4-checks-and-preview.md`), carrying out its decision 23, the acceptance run: the real viewer, through the tunnel, taken through the design canvas "Spectra viewer UI" in light and dark, with the built-in preview, the Lit and Angular samples, and a preview page on A2UIVerse's side for its CircleCI agent; what the run finds is fixed within the sub-task.

## Scope

- The agents the run uses, the mode each runs under, and the order of their sessions.
- The store the run starts with, the tunnel's ports and the run's config files.
- The design canvas's boards the run covers, and where the states no agent produces come from.
- What counts as a finding, and where each finding goes, A2UIVerse's included.
- The flows each session carries, the keyboard, dark and the window sizes.
- What the Lit, Angular and CircleCI sessions cover.
- The CircleCI catalog's `ComponentCommon` fix and the preview page on A2UIVerse's side.
- The other documents and the done line.

## Locked decisions

### 1. The agents

- Upstream's Python restaurant finder at `020a9d6f`, on Gemini.
- Upstream's Node restaurant finder at `020a9d6f`, on its stub model.
- The stub agent, in its flawed booking conversation and in its canned A2UI conversation.
- A2UIVerse's CircleCI agent in deterministic mode, signed in as its fake account.

### 2. `run` and `attach`

The CircleCI agent runs under `a2ui-spectra run`, its URL taken from its config file, which holds the agent's URL, the catalog path, the preview page and the `Authorization` header naming a variable. Its token is issued by the agent itself from a first start before Spectra's, and set in Spectra's environment; if the token does not survive the agent's restart, the CircleCI agent is attached instead. Every other agent is attached with `a2ui-spectra attach`.

### 3. The store and the sessions

The run starts from an empty store, in a folder of its own. Every Spectra start is launched from that folder, with the session's config file passed by `--config`, so the store builds up across the sessions, each later session showing the earlier sessions' turns. The sessions, in order:

1. the Python restaurant finder;
2. the Node restaurant finder;
3. the stub agent's flawed booking conversation;
4. the stub agent's canned A2UI conversation with no config, for "Not fully checked" (decision 7);
5. the Lit sample;
6. the Angular sample;
7. the CircleCI agent.

### 4. The tunnel

Two borrowed ports: 5173 for Spectra, and a second one, chosen when the run starts, taken in turn by the Lit sample's page, the Angular sample's page and A2UIVerse's page. The run's config files are uncommitted copies in the run's folder, naming each page by its tunnel URL. The samples' committed config files are unchanged.

### 5. The boards

The run covers the whole canvas as sub-task 3.7 covered it, and every board Phase 4 added:

- the Flows page, Flows 1 to 4;
- the Screens and foundations page's Screens and States rows;
- the Foundations row — Foundations, Components and states, Icons and the Icon component — as the reference for what the viewer draws;
- the Turn view details page.

A board whose state none of the run's agents produces is not checked, and the done commit names it. "No preview for catalog <id>" is seen in the CircleCI session, on the Lit and Angular sessions' turns in the sample catalog.

### 6. The binding check's finding

The stub agent's flawed booking conversation gains a second turn: its reply to a second message creates a new surface whose component binds a path the data model never fills. Its first reply is unchanged, and with it its recording in the coverage roster, its conformance case, sub-tasks 3.4's and 4.3's tests and the Flow 2 boards. The second turn has a unit test, as the stub's other behaviours have.

### 7. "Not fully checked"

In the fourth session, the stub agent's canned A2UI conversation is attached with no config, and one request is sent by hand through the wire proxy as a second host, its capabilities offering the sample catalog. The stub answers in the sample catalog, which Spectra has no definition for in that session, and the turn stays "Not fully checked" in every later session.

### 8. The render error

One render error is provoked by hand on the built-in page and checked against the board in light and dark. The flawed booking's `updateComponents` refused by the built-in page's processor is checked as it comes, folded under its catalog finding. The Lit and Angular adapters' wording rests on sub-task 4.6's done line.

### 9. What counts as a finding

Sub-task 3.7's rule, unchanged. Any difference of design between the viewer and a board — the layout, an element missing or extra, the wording, a state, spacing, colour, behaviour — is a finding. It is fixed in the viewer, or, where the board is wrong, the board is amended on the design canvas. A difference of content between the real agent's turns and a board's is not a finding, nor is a feature of a later phase. A fault in an agent or in upstream's SDK is recorded in `_dev/a2ui-findings.md` and not fixed here, A2UIVerse's as decision 10 has it. A route of the run that does not work is a finding.

### 10. A fault on A2UIVerse's side

A fault inside A2UIVerse's CircleCI app, its agent or its catalog, is fixed from this sub-task in A2UIVerse's repo. A fault in A2UIVerse's shared code, the agent kit or Stellify, goes to A2UIVerse's backlog. A fault that is upstream's is recorded in `_dev/a2ui-findings.md`.

### 11. The CircleCI catalog's `ComponentCommon`

Each component definition of A2UIVerse's CircleCI catalog gains the protocol's `ComponentCommon` reference, as upstream's basic catalog has it, committed in `a2uiverse-apps` from this sub-task before the CircleCI session. Spectra's test data, the CircleCI recording and its copied catalog definition, stays as it is.

### 12. The preview page on A2UIVerse's side

A small page inside `circleci-catalog`, served by a new Vite dev script of that package, draws the React adapter inside the catalog's `Provider` with its theme, passing the catalog; `circleci/a2ui-spectra.json` sits beside it. The page takes the React adapter and the core as tarballs packed from this repo. The page, its dev script, its config file and the dependency stay uncommitted in A2UIVerse until the adapter is on npm; this spec and the done commit record what the page was.

### 13. The flows

- The Python restaurant finder: Flow 1 from the first screen; Flow 3 on its turn asking for input; Flow 4's first three boards, a restaurant's "Book Now" pressed and sent, then the booking form filled and submitted.
- The Node restaurant finder: the same press and submit on its own conversation; Flow 4's refusal board, from a press in the Python session's conversation.
- The flawed booking conversation: Flow 2, then its second turn.

### 14. The keyboard

Each of the four flows is done once by the keyboard alone, in light at full width, from its first board to its last, in the session that carries it, after its pass with the mouse. Flow 4 is done on the built-in page: the press reached by Tab into the preview, the action sent with Enter, and Escape tried once to discard. A flow that cannot be finished without the mouse is a finding.

### 15. Dark

Sub-task 3.7's rule: in dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light. What a preview page draws inside the frame is the page's own look and is not judged in dark; the frame, its surroundings and the rest of the viewer are.

### 16. Window sizes

The step's detail's Collapse and Expand, and `n` with the detail closed, are pressed at 1200 × 760 and on a tall window, as tall as the browser's screen allows. At 1200 × 760, on the built-in page, the Preview pane is seen at Narrow and at Wide beside Structure, each with the turn list open and collapsed, with the panes' toggles and divider.

### 17. The Lit and Angular sessions

For each, through the tunnel, at Narrow and Wide, in light and dark: the stub's surface in the sample catalog drawn by the sample's page; the slider moved, the Button pressed, the action sent, and the turn landing with the volume echoed; then the slider moved again and a text typed and sent, the new turn's "The host's data model" block carrying the new volume from the page.

### 18. The CircleCI session

Through A2UIVerse's page, at Narrow and Wide, in light and dark: the recent runs from a typed message; then the four beats, each pressed in the preview, its pending action sent and its turn landing: a run opened, a failed job opened, a rerun proposed and declined, a rerun proposed again and confirmed. The confirm ends waiting for input, the token holding only the first sign-in's scope, and the composer says so as in Flow 3.

### 19. Other documents

- `_dev/TODO.md`: the 4.7 line names this spec; the backlog's CircleCI catalog line is removed once the fix lands; the Phase 9 line gains A2UIVerse's CircleCI preview page committed in A2UIVerse, on the published React adapter.
- `conformance/README.md` and the stub agent's header comment: the flawed booking conversation's second turn, its recording in the coverage roster unchanged.
- `_dev/a2ui-findings.md` and the design canvas: as decision 9 has it.
- A2UIVerse: as decisions 10, 11 and 12 have it.
- The Phase 4 spec, SPEC.md and the turn record are unchanged.

### 20. Done when

- Every session of decision 3 has been through its part, and every board of decision 5 seen in light and dark.
- Every finding has gone where decisions 9 and 10 send it.
- The unit tests, the stub's second turn included, and both end-to-end tests pass after the fixes, under Node and against the binary, locally and in CI.
- This spec gains what the run fixed, the design canvas's amendments and the A2UI findings recorded, as sub-task 3.7's did.
- The done commit names the boards not checked, the tall window's size and the A2UIVerse commit the CircleCI session ran against.

### 21. What the run fixed

- The preview page's refusal of an earlier turn's message folds as a quiet line on the turn's last step, uncounted, since the earlier turn counts it; every later turn of the conversation counted it again, on its Input step while open and its outcome once closed.
- A render error marks the line of its component's id, as the render error board draws it.
- The preview page's controls take the Preview pane's place in the Tab order: a stop in the pane hands focus to the shown page, and focus leaving a page by Tab or Shift+Tab comes back beside the pane; the iframes sit outside the viewer's tree, after the composer.

### 22. The design canvas

No board is amended. The boards that draw the result pane with Preview toggled off, a state the viewer reaches by its toggle, are checked in that state and named in the done commit.

### 23. A2UI findings

No new finding. The Python restaurant finder creating its surface again in a streamed turn is finding 14, and the Node restaurant finder's stub creating `stub-notice` again in every turn is finding 17.

### 24. Components left unreachable by a repaint

A surface an agent repaints in place with a new `root`, as the Python restaurant finder's second turn and the CircleCI agent's rerun proposal do, leaves its earlier components unreachable, and the structural check reports them on every turn that touches the surface. It is content in this run. Whether those components are judged, and judged again on each later turn, goes to the backlog.

## Invariants

- Nothing committed in A2UIVerse depends on this repo.
