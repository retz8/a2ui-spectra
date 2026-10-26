# Sub-task 4.1 — The design artifact

Phase 4's boards on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which the later sub-tasks follow. Sub-task 4.1 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, whose decision 21 names the boards and whose decision 17 leaves the Narrow and Wide numbers to the canvas.

## Scope

- The boards decision 21 of the Phase 4 spec names: the Preview tab with a surface drawn in it and its width switch; the "No preview for catalog <id>" state; a render error on the tab and in the step's detail; the composer holding a pending action with Send and Discard, and refusing one with its reason; the header's check list with four checks and the "Not checked" form for a surface with no definition; the findings of the catalog, structural and binding checks in the step's detail.
- The Narrow and Wide numbers.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the boards go

The new boards join the canvas's existing pages, not a fourth page: pressing the preview and sending or discarding the action as a "Flow 4" row on the Flows page; the Preview tab, the check list and the findings as new rows on the "Turn view details" page. Dark twins are drawn for the two pieces of new chrome only, the Preview tab with a surface and the composer holding a pending action, as Phase 3 drew dark twins for its new chrome and judged the rest on the dark palette.

### 2. The frame and the widths

Narrow is 384px, Tailwind's `sm` container width, so the viewer draws the frame with a stock utility; the switch labels it "Narrow · 384". Wide fills the pane. The surface sits centred on the pane's tinted canvas with a thin border marking the frame's edge and no device chrome. The frame keeps the preview page's own background in both themes, so in dark mode it reads as a light panel; that is what the adopter's page looks like, and the viewer does not tint it.

### 3. The render error

On the Preview tab, a compact strip above the frame: one 12px row per error, the problem mark and a plain sentence naming the component, such as "DateTimeInput dateTimeInput_fbfcc3af did not render."; the surface stays drawn under it as the renderer left it. In the step's detail, the error is one more problem block in Phase 3's form: the same plain sentence first, the page's own error text alone on the quiet second line, such as "RangeError: Invalid time value", and a short third line, "Preview page · not recorded"; a render error carries no code of Spectra's.

### 4. The "No preview" state

Two lines centred in the frame's place: "No preview for catalog `<id>`" with the id in monospace, and under it in the quiet grey, "Add a page built with a Spectra preview adapter to the config's preview pages." No link. The sentence names the adapter and the config without fixing the config's key, which belongs to sub-task 4.2.

### 5. The pending action in the composer

The pending action replaces the text box with a title line naming the action, its source component and its surface, and below it the wire message as one of Phase 3's foldable JSON blocks with its copy button, the envelope open and the data model snapshot folded, capped at the composer's six-line height and scrolling past it. Send and Discard sit where the send button sits, Send in teal as the main action and Discard quiet. The line naming the conversation stays under it, unchanged.

### 6. The refused pending action

Send stays, disabled and grey as it is while nothing is typed; Discard stays live; the reason takes the quiet line's place, in grey, since red is kept for failed turns and problem counts. Two wordings are drawn: "Started by another host or in an earlier run · an action can only be sent in a conversation the message box started", and "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment", the variable in monospace. One Flow 4 board shows the other-host refusal in place; both wordings also join the composer's states on the "Components and states" board, the unset-variable one applying to typed text too.

### 7. The check list with four checks

One row per check, as Phase 3 has it, each reading its result and protocol version, such as "Catalog · v1.0 · passed". A check that skipped a surface reads "Catalog · not checked for `booking` · no definition for catalog `<id>`", and one that skipped every surface "Catalog · not checked · no definition for catalog `<id>`". The summary gains a third form, "No problems · not fully checked", for a turn where nothing was found but a check skipped a surface; "No problems" keeps meaning every check ran clean, and Phase 3's bare "Not checked" stays for a turn no check could run on. The count form is unchanged when there are findings.

### 8. Where a structural or binding finding sits

A finding that names a component, such as a child id that resolves nowhere, a component unreachable from the root, a composition rule broken or a bound path with no value, sits on the step whose message carried that component and marks the line of the child id or the binding, as decision 18 of the Phase 4 spec does for render errors. A surface-wide finding, such as no component with the id `root` or two of them, sits on the outcome step. A binding finding names the path and the component, not the step that set the data model. Sub-task 4.3, the three checks, follows the board on this.

### 9. The result pane: two panes, not tabs

Preview and Structure are panes side by side, in place of Phase 3's tabs, each shown or hidden by its own toggle in the pane's header, both on by default, with a draggable divider between them; the toggles and the divider are remembered in the browser. With Narrow chosen the Preview pane hugs the 384px frame and Structure takes the rest; with Wide the two share the width equally until the divider is moved. Structure shows the tree beside the data model, and the tree above the data model when its pane is narrower than about 480px, which at 1,440px wide is whenever both panes are on. Phase 3's boards keep Structure alone, drawn as the state with Preview toggled off. A hover link between a tree node, the message's lines and the drawn component goes to the backlog: upstream's React and Lit renderers do not mark the DOM with component ids at the Phase 4 pin, so the link needs an upstream hook or a renderer-side tap, not this phase's adapters. This amends Phase 3's decision 8, the result pane, and Phase 4's decisions 16 and 17, the Preview tab and the widths, in place.
