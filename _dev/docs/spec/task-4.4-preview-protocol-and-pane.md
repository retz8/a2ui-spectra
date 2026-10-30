# Sub-task 4.4 — The preview protocol, the core, the React adapter and the Preview pane

The preview protocol and its core, the React adapter, the built-in basic catalog page, and the Preview pane in the viewer. Sub-task 4.4 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, carrying out its decisions 12 to 18: the preview protocol, the core and the adapters, the built-in preview, routing a surface to a page, the Preview tab, the widths and render errors; sub-task 4.1's decisions 9 and 10, the result pane as two panes and the turn list collapsing at any width; and the tests of the Phase 4 spec's decision 22 that concern the core's protocol.

## Scope

- The message set and the core.
- The React adapter.
- The built-in basic catalog page, built and served by Spectra.
- The viewer: the Preview pane beside Structure with its toggle and divider, routing a surface to a page, the Narrow and Wide widths, the "No preview" state, render errors in the problem count, and the turn list's collapse button.
- The unit tests and the done line.
- The Phase 4 spec's amendments and `_dev/TODO.md`.

Out of scope: the pending action in the composer and sending it, sub-task 4.5; the Lit and Angular adapters, the sample catalog apps and the end-to-end test through them, sub-task 4.6; the screenshot, as the Phase 4 spec has it.

## Locked decisions

### 1. A render carries the full list; the core applies the difference

Each render sends the whole list of messages up to the selected step. The core remembers the list it applied last. When the new list begins with the old one, it feeds only the tail into the existing processor; otherwise it recreates the processor and feeds the whole list. Messages are fed one at a time, each throw caught.

### 2. The list is the shown surface's messages

A render carries the messages that name the switcher's surface, across the conversation's earlier turns and the turn up to the selected step, and that surface's id. A page's processor holds one surface. Switching the surface changes the list, and the core recreates the processor. This amends decision 16 of the Phase 4 spec, which named the conversation's A2UI messages.

### 3. Claims are derived from the catalogs

A page's claims are the catalog objects it passes to the renderer, each with its catalog id and protocol version; the adopter declares nothing. The viewer matches a surface by catalog id, and by version with web core's compatibility rule: a 0.9 catalog serves v0.9 and v0.9.1 surfaces, a 1.0 catalog serves v1.0 only. The built-in page passes the v0.9 and v1.0 basic catalogs and a copy of the v0.9 basic catalog under the v0.9.1 alias id, so it claims the alias itself and routing is one rule, matching the claim. This amends decision 15 of the Phase 4 spec, which gave the alias to the built-in page as a rule of its own.

### 4. Three kinds of render error

The page reports three kinds, each tagged with its kind: a component that throws while drawing; an error web core reports on the surface through its error channel; and a message the page's processor refuses. A component failure is always counted. A web core error or a refused message is counted only when the viewer has no problem of its own on that message's step; when it has one, the report folds under that problem as a quiet line, as sub-task 4.3 folds a web core rejection under a finding. The "Problems only" filter keeps every step a render error has been on while the turn is in view; where a turn lands follows the record's problems only. This amends decision 18 of the Phase 4 spec.

The wordings, drawn on the design canvas's "Components and states" board. Each problem block has three lines: the sentence, the page's own text, and "Preview page · not recorded".

- **A component failure:** "<type> <id> did not render.", or "A component did not render." with no id, then the error's name and message.
- **A refused message:** "The preview page refused this message.", then the code and web core's message.
- **A web core error:** web core's own sentence, then its code with "A2UI web core in the preview page".
- **The folded lines:** "The preview page also refused this message · <message>" and "The preview page also reported · <sentence>".

The Preview pane's strip lists the sentence of every report of the render, counted or folded.

### 5. Reports are tied to their render

Each render carries a running number, and the page tags every report with the number of the render it belongs to. The viewer drops a report whose number is not the current render's, and clears the Preview pane's error strip when it sends a new render. With a render that extends the last, the core sends the surface's earlier reports again under the new number; each report is sent once per processor.

### 6. Where a report is placed

The viewer places a report from what it carries. A component failure carries the component's id and type, and sits on the step whose message carried that component, the turn's own message that last carried it in the render's list, marking the line of the component's id. A refused message carries its index in the render's list, and sits on that message's step. A web core error carries its code and text, and the component id when web core gives one; it sits on that component's step, or on the outcome step when it names none. A report whose message is an earlier turn's sits on the outcome step; a refused message of an earlier turn, which that turn counts, folds there as a quiet line.

### 7. Loading the pages

The viewer learns the configured pages from the session payload it loads at connect, as `previewPages`. It loads every page at connect, the built-in one and each configured one, each in its own iframe mounted for the session outside the viewer's React tree, laid over the Preview pane's frame when a surface is routed to it and hidden otherwise.

### 8. A page that does not answer

A configured page that sends no ready message within a few seconds is unanswered and claims nothing. A surface no answered page claims shows the "No preview for catalog <id>" state with a second quiet line naming each page that has not answered. The viewer reloads an unanswered page's iframe every few seconds until it answers. There is no button.

### 9. Two pages claiming one catalog

Configured pages win in their config order, and the built-in page comes last, as the fallback. The first page whose claims cover every catalog id the surface's messages name, at its version, takes it. A page still waiting for its first answer ahead of it in that order holds the surface, which shows "Loading the preview pages…" until the page answers or is unanswered. The Preview pane's header names the page drawing the surface in a quiet note, its URL or "built-in".

### 10. Trust across the iframe boundary

The viewer sends each render to its iframe's window with the page's origin as the target, the origin taken from the configured URL or the viewer's own for the built-in page, and accepts a message only when it comes from one of its own iframes, which also tells it which page spoke. The viewer loads each page with a query parameter carrying the viewer's own origin as the browser sees it. The core reads it, sends the ready message and every report to that origin only, and ignores messages from any other. A page opened on its own, with no parameter, shows one line saying it is a Spectra preview page and previews only inside Spectra.

### 11. The protocol's version

The ready message carries the protocol's version, starting at 1; no other message does. The viewer accepts a page whose version it speaks. A page with another version is treated as unanswered, its quiet line reading "preview page speaks protocol <n>, this Spectra speaks <m>".

### 12. The action message

The message set includes the action message: web core's action payload, with its name, surface id, source component id, timestamp, context and v1.0's `userMessage`, and the page's data model snapshot at that moment. The React adapter sends it from the processor's action handler. The viewer of this sub-task receives it and does nothing with it; sub-task 4.5 uses it.

### 13. Where the packages live, and their names

The core and the adapters are a group of workspaces under `typescript/preview/`: the core in `typescript/preview/core`, the React adapter in `typescript/preview/react`, and the Lit and Angular adapters of sub-task 4.6 beside them. The core is named `a2ui-spectra-preview` and the React adapter `a2ui-spectra-preview-react`, with `-lit` and `-angular` to follow. At the move they become `@a2ui/spectra-preview` and `@a2ui/spectra-preview-react`.

### 14. The core and what an adapter gives it

The core carries everything that is not the framework's: reading the viewer's origin from the page's address, the ready message and its claims, the render difference of decision 1, the running number, feeding one message at a time with each throw caught, the three report shapes and the action message, the window's error events, and a guard on a custom element class's updates for components drawn as web components. An adapter gives the core four things: making a processor from the catalogs, feeding it one message, mounting a surface, and tearing down. The Lit and Angular adapters give the same four.

### 15. The React adapter

The adapter exports one React component whose only required prop is the catalogs. The adopter's page is their app's root with that component inside it, wrapped in the same providers their real host uses. Underneath, the adapter creates the processor, derives the claims, runs the protocol through the core, mounts the surface the render names, and puts every catalog component in a boundary of its own that reports the failing component's id and type with the error's text, so one bad component leaves the rest drawn. A React implementation gets an error boundary around its view. Web core's universal elements, which both basic catalogs are drawn with at `@a2ui/react` 0.14.0, v0.9's included, are guarded at their updates through the core's guard on their shared base class, which names the element's component. What neither sees is caught through the window's error events, an uncaught error and a promise rejected with no handler, once a render has come, and reported with no component id. The adapter takes `@a2ui/react` 0.14, `@a2ui/web_core` 0.14 and React 18 or 19 as peer dependencies.

### 16. The built-in page

The built-in page is its own private workspace, `tools/spectra_basic_preview`, named `a2ui-spectra-basic-preview`: a small Vite app using the React adapter's component with the three basic catalogs of decision 3. The tool's build copies its output beside the viewer's, under `preview/` in the same served folder, and the server's static route serves the page's own index for that path. It is served from Spectra's own origin and loaded in an iframe like any configured page. Its root carries upstream's `a2ui-light` class, so the basic catalog's styles keep the page light in both of the viewer's themes.

### 17. The turn list's collapse moves

On a wide window the turn list slides between its width and the strip's in 200ms, easing out. The list, held at its width, is clipped to the card's shape as the panel narrows and revealed as it widens, while the strip fades in over it where it lands, or away as it opens. The list stays mounted while collapsed, hidden under the strip. With reduced motion it switches at once. Dragging the divider never collapses it.

### 18. Tests

Unit tests under Node. The core's protocol logic takes its transport and its adapter as arguments and is tested with fakes: the claims derived from catalogs, the three cases of the render difference, the running number, feeding one message at a time with a throw turned into a refusal report, the three report shapes, the action message, and the origin filter. The viewer's model layer is tested for routing by claims with web core's compatibility rule and the config order, placing a report on its step, and the fold of a report the viewer already knew. The server is tested for the page served under `preview/`. The React adapter has no browser test in this sub-task; sub-task 4.6's end-to-end test covers it through the React sample app.

### 19. Other documents

- The Phase 4 spec is amended in place: decision 15, the alias claimed by the built-in page and the config order with the built-in page last; decision 16, the list narrowed to the surface's own messages; decision 18, the three kinds of render error and the fold.
- `_dev/TODO.md`: the 4.4 line names this spec, and its done line gains the render error.
- The design canvas "Spectra viewer UI": the "Components and states" board's problem blocks gain the preview page's three wordings and its folded lines; the Preview boards' header names the page drawing the surface; the "No preview" board gains the line for a page that has not answered.
- The READMEs of the core, the React adapter and the built-in page; the viewer's and the tool's READMEs.
- `_dev/a2ui-findings.md` gains findings 27 and 28: the React renderer catching no component's failure, a basic catalog component that throws reaching the page as an unhandled rejection that names nothing; and web core's error channel naming the component only inside its sentence.

### 20. Done when

The unit tests pass and, by hand through the tunnel, the Python and Node restaurant finders' surfaces are drawn in the Preview pane from the built-in page, in light and dark, with the width switch, the toggles and the turn list's collapse; and one render error is seen in the Preview pane's strip and counted, from the flawed booking conversation if its recording produces one, otherwise provoked once by hand.

## Invariants

- Render errors and every other report stay in the viewer. The server and the record never see them.
- No credential is ever in the record.
