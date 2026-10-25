# Phase 3 — The viewer's UI

The viewer's frame, layout and visual design, drawn first as a design artifact that the build follows. Phase 3 of SPEC.md's roadmap, between Phase 2, first turn on screen, and Phase 4, checks and preview.

## Scope

- The design artifact, the phase's first sub-task: every screen and state below, in light and dark.
- The skeleton: the frame, the turn list, the turn view, the composer, the live turn, small screens, the keyboard and the page address, the first screen.
- The visual design on top of it: identity, status, type, surfaces, step types, theme, motion.
- The changes to the message box's server and the API that these decisions need: continuing the conversation in view, and the agent card's details and example prompts.
- Not in scope: the features later phases bring. They take the places this phase makes: the preview in the result pane (Phase 4), model and tool calls on the timeline and tokens in the header (Phase 5), Fixtures in the rail and Save as fixture and Replay in the header (Phase 7), Re-run in the header and Restart and Logs in the context bar (Phase 8).

## Locked decisions

### 1. The design artifact comes first

The phase's first sub-task is a design artifact showing every screen and state of this spec: the Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2. Every later sub-task follows it. The details the decisions below leave open, such as the exact teal, the drawing of the mark and the icon for each step type, are settled in it.

### 2. The character: a product, neat and clean, not a devtool

Monospace appears only inside JSON and code. Times, durations, message types and ids are set in the sans, with tabular digits. Ids are shown sparingly. A problem leads with a plain sentence, and its code comes second.

### 3. The frame: a left rail and a context bar

A left rail holds Spectra's mark with its name under it, and the sections: Turns, joined by Fixtures in Phase 7. A context bar above the turn list and the turn view shows the attached agent's name, the mode (`run` or `attach`), the live status and the wire proxy's address with a copy button. A popover on the agent's name holds the agent's URL, the A2A version, and the A2UI versions and catalogs its card advertises. The live status replaces the separate bar that says the live stream is down. From Phase 8, Restart and Logs sit on the right of the context bar, and the logs open as a drawer at the bottom of the page.

### 4. The turn list: grouped by conversation

The turn list is a column grouped by conversation, newest first, each group titled by its first message and the agent, with its number of turns. Each row shows the turn's status, its time, its input, its duration and its problem count. The list follows the newest turn, has a search, and can be collapsed.

### 5. The turn view: the result in view, the steps beside it

The turn view shows the timeline of the turn's steps beside the result pane. Selecting a step shows the surfaces as they stood right after it.

### 6. The steps

A step is one A2UI message, text part or status update. When one delivery carries several, they are grouped under it with its arrival time. Phase 5's model calls and tool calls join the same timeline.

### 7. The step's detail: a split under the result

The selected step's detail, its content and its problems, sits in a split under the result pane, resizable and collapsible.

### 8. The result pane: Preview and Structure

The result pane shows the agent's reply text in a strip above two tabs: Preview, and Structure, which shows the tree and the data model side by side. A surface switcher in the pane's header lists the surfaces the turn touched first, each with its problem mark. Until Phase 4's preview, Structure is the only tab.

### 9. Problems: marks on the steps, one count, the count as a filter

One count covers every source of problems: the checks' findings, the processor's rejections and a failed turn's reason, and later the parse errors, retries and the preview's render errors. It shows on the turn's row and in its header. Each step with a problem carries a mark and its count. The header's count acts as a filter that narrows the timeline to the steps with problems. A problem of the whole turn, such as a failure reason, is the timeline's last step. A turn with problems opens on its first problem.

### 10. The turn header: led by the input

The turn's input is the header's title, with the outcome and the problem count beside it. One quiet line below holds the start time, the duration, the A2UI version, the agent and short ids with copy buttons. Actions sit on the right.

### 11. The composer: docked under the turn view

The message box is a composer docked under the turn view; there is no chat column. The grouped turn list carries what was sent, and the agent's reply, its text and its surfaces, shows in the result pane. The composer names the conversation it continues, says when the agent is waiting for input, and offers a new conversation.

### 12. The composer's conversation

The composer continues the conversation in view when the message box started it. Otherwise, sending starts a new conversation, and the composer says so. The box knows the conversations it started while Spectra runs; a box conversation from an earlier run is not continued.

### 13. The live turn: following the newest step

While a turn is open, the timeline follows the newest step and the result shows the latest state. Selecting a step stops following, and "Jump to latest" resumes it. When the turn closes while following, the view lands on the first problem, or on the final state when there is none.

### 14. Small screens

The composer is one line until typing, then grows. The step's detail starts collapsed to its title line until a step is selected. Below about 1,300px wide, the turn list collapses to a strip of status icons that opens as an overlay. Every divider can be dragged, and its position is remembered in the browser.

### 15. The keyboard and the page address

The page address holds the turn and the selected step. The up and down arrows move through the turn list and through the timeline, each one Tab stop. A key goes to the next problem, with Shift for the previous one; `/` focuses the turn list's search; a key jumps to the latest step; Enter sends from the composer and Shift+Enter starts a new line; `?` lists the keys. The exact keys are settled in the build.

### 16. The first screen

With no turns, the turn view shows, centred: the agent's name and its live status; the agent card's skill examples as prompts that fill the composer in one click; and the second route, the wire proxy's address to point a host app at, with a copy button. The composer is focused.

### 17. Identity: Spectra's own mark, A2UI's teal

Spectra has its own mark: a card with a lens over its corner, the card solid outside the lens and see-through under it, a lens to view an agent that draws UI. Its one accent is teal, the primary colour of A2UI's documentation site, used only for selection, focus, links and the main action.

### 18. Status: colour for trouble and for a completed turn's badge

Each outcome (completed, waiting for input, failed, cancelled, open) has its own icon shape, in grey, with a neutral label. Red is kept for failed turns and problem counts. A completed turn's status badge is green. The open turn's spinner is teal.

### 19. Step types: shape, not colour

Each step type has its own icon shape, in grey. Only the selected row is teal, and only problems are red.

### 20. Type: compact, Inter

The scale steps in 2px: 18px for the turn's title, 16px for pane titles, 14px for body text and rows, and 12px for metadata, monospace and section labels in small capitals. List rows and steps are about 32px tall. The typeface is Inter, bundled with the viewer.

### 21. Surfaces: raised panels on a soft canvas

The rail and the context bar sit on a light grey canvas. The turn list and the turn view are panels with rounded corners and a small gap around them. Inside a panel there are no nested boxes: sections are separated by spacing and small labels, and JSON sits on one tinted block. In dark mode, the panels are lighter than the canvas.

### 22. Theme

The page follows the system's light or dark setting by default. A System, Light and Dark switch at the foot of the rail overrides it, remembered in the browser.

### 23. Motion: brief

Panels collapse and expand in about 150 to 200ms, new steps and new turns fade in, and selection eases rather than jumps. All motion stops when the system asks for reduced motion.

## Invariants

- Every font and asset is bundled with the viewer; the page fetches nothing from outside Spectra.
