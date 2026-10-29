# Phase 4 — Checks and preview

Catalog and structural checks; the preview protocol and its core; the built-in basic catalog preview; the React, Lit and Angular preview adapters; the preview you can press; preview widths; the message box sending the agent's credentials from the shell, never recorded. Phase 4 of SPEC.md's roadmap, between Phase 3, the viewer's UI, and Phase 5, inside the turn. The design authority is SPEC.md, in particular its "Features", "Preview", "Adopter path" and "Engineering decisions" sections. The record is turn record v0.1, amended as decision 9 says.

## Scope

In scope:

- The catalog, structural and binding checks, run on the server and shown in the viewer.
- The config file, with the agent's URL, the catalog paths, the preview pages and the headers as its first settings.
- The catalog definitions Spectra knows: the basic catalogs built in, the configured and the inline ones; served to the viewer; used by the checks, by Structure and by the rejection count.
- The message box advertising the configured catalogs, and sending the agent's credentials from the shell.
- The preview protocol and its core; the React, Lit and Angular adapters; the built-in basic catalog preview; the Preview tab, its widths and its render errors.
- Pressing a control: the action and the data model snapshot into the composer, and sent through the message box as the next turn.
- The turn record's amendments.
- The design canvas's Phase 4 boards.
- The sample catalog apps, one per framework, the tests, and the acceptance run.
- SPEC.md's upstream reference line at the new pin.

Out of scope:

- Light and dark preview variants, and the Flutter and SwiftUI adapters. After v1.
- The preview reloading when the catalog changes. Phase 8.
- Shipping the adapters. Phase 9.
- The adapter as the renderer-side tap inside a real host app.
- The screenshot: reserved in the protocol, produced by no adapter of this phase.
- The message box sending the configured catalogs inline. Backlog.
- v1.0's `callAgentFunction` and `rendererFunctionResponse`, the agent-function round trip. Backlog.
- A `--header` option on the command line.

## Locked decisions

### 1. Upstream pin

Phase 4 reads upstream at `upstream/main` 409ded29c (2026-10-24). Copied at it: the basic catalogs of v0.9, which also serves v0.9.1, and of v1.0, and v1.0's catalog definition meta-schema. The protocol schemas copied in Phase 2 are diffed against the pin and re-copied only where they changed. SPEC.md's upstream reference line moves to the pin. Packages installed from npm are taken at their published versions: `@a2ui/web_core` 0.14.0, `@a2ui/react` 0.14.0, `@a2ui/lit` 0.14.0 and `@a2ui/angular` 0.13.0.

### 2. The config file

An optional `a2ui-spectra.json` in the working directory Spectra is launched from, committed in the adopter's repo, with a `--config <path>` option on both entry points to point elsewhere. Its settings in this phase: the agent's URL, which `attach`'s argument and `run`'s option may then omit; the catalog paths; the preview pages; and the headers. A command-line option takes precedence over the file, and the file over the default. Ports and the allowed hosts stay command-line only.

### 3. Catalog definitions

A surface's catalog id is resolved in order: the basic catalogs built in; the catalogs configured by path, each carrying its own `catalogId`; the inline catalogs the hosts sent in the conversation's messages up to and including the turn. The v0.9.1 basic catalog URL is a second id of the v0.9 basic catalog. A surface whose id resolves nowhere gets none of the three new checks, and is recorded and shown as not checked with the id as the reason. The API serves the definitions Spectra knows.

### 4. The message box's offer

Under each protocol version, the message box advertises the basic catalog and every configured catalog whose protocol version matches: a definition that names "1.0" under v1.0, one that names no version under v0.9 and v0.9.1. It advertises only; it sends no catalog inline.

### 5. Credentials from the shell

The config's agent entry holds a `headers` map. Each value is a string in which `${VAR}` is replaced from Spectra's environment when the box sends, so the file holds variable names only. The box adds the headers to every request it makes to the agent, the card fetch included, and the wire proxy forwards them as it forwards any host's. A variable that is not set is reported at start, and the box refuses to send, naming it, where the composer already says why it cannot send.

### 6. The catalog check

Per message, as the schema check runs. Each component the agent sent, in `updateComponents` and in a v1.0 `createSurface`, is validated against its catalog's component schema, and a v0.9 function call and theme against the catalog's `anyFunction` and `theme`. The engine is Ajv with the real catalog bound where the stand-in sits today.

### 7. The structural check

At the turn's close, on the surfaces the turn touched, as they stand after the conversation's earlier turns and then this turn are fed through web core, the way the viewer's replay and the rejection count build them. For each touched surface: every child id resolves, a component has the id `root`, nothing loops back on itself, no id is given to two components in one message, no component is unreachable from the root, and in v1.0 the catalog's composition rules, `allowedParents` and `allowedChildren`, hold; and every surface a message names was created. The engine is web core's surface model: a walk over its child references for what it let into the state, and its own refusal, in its words, for what it did not, a cycle, a duplicate id and a broken composition rule. Surfaces the turn did not touch are not re-checked.

### 8. The binding check

On the same state as the structural check. Every path a touched surface's components bind to, a path inside a template resolved against the template's items, has a value in the surface's data model when the turn closes. An unfilled path is a finding. The catalog's schema says which props are bindings, and web core's data model answers the lookup.

### 9. The checks in the record

Turn record v0.1 is amended in place. A check event lists the surfaces it skipped, each with the catalog id it named and its reason, `no_definition` or `not_created`; the catalog id attribute is dropped. A finding's `path` is a JSON Pointer from the turn object to the offending value, one convention for all four checks, written into the prose with the code table of all four checks. Phase 1's full fixtures and the record's schema follow.

### 10. The checks in the viewer

The findings of the three checks join the one problem count as Phase 3 has it, in Phase 3's problem blocks. A web core rejection of a message that a finding points into folds under the finding as a quiet line and is not counted; one on a message with no finding stays a counted problem. The header's check list grows to the four checks, and shows the "Not checked" form with its reason for a surface with no definition.

### 11. Structure and the rejection count on real catalogs

The viewer's replay and the server's rejection count register a real catalog, built from its definition, for every catalog Spectra knows, so a configured catalog's surface nests as the basic catalog's does and its bad props are rejected the same way. The permissive stand-in remains for an id with no definition.

### 12. The preview protocol

A message set that names no carrier: A2UI messages go in; render errors, the shown surface's data model and actions come out. The screenshot message is reserved in the protocol, produced by no adapter of this phase and asked for by no viewer of this phase; it arrives with the first adapter that cannot be embedded. The web adapters carry the protocol over `postMessage` between the viewer and the page in an iframe.

### 13. The core and the adapters

A framework-free core holding the protocol, with thin React, Lit and Angular adapters that take the renderer as a peer dependency at the versions of decision 1. The core takes web core as a peer dependency and holds, on an entry of its own, the processor setup the three adapters share: the action handler, each surface's errors and data model, and the guard on web core's universal elements; each adapter makes its own processor. The Angular adapter reads the page's own `provideA2Ui` config, and is built as upstream builds `@a2ui/angular`, with the ng-packagr builder in partial compilation. They are workspaces in this repo, named with the `a2ui-spectra` prefix, and ship in Phase 9.

### 14. The built-in preview

The basic catalog previews through a page of Spectra's own, served by Spectra and built with the React adapter on upstream's React renderer, loaded in an iframe like any adopter's page, so the viewer has one path. It renders v0.9, v0.9.1 and v1.0, the v1.0 basic catalog being web core's universal custom elements hosted by the React renderer.

### 15. Routing a surface to a page

When a page is ready it tells Spectra which catalog ids and protocol versions it renders, taken from the catalogs it passes to its renderer; the built-in page claims the basic catalog ids and the v0.9.1 alias. A surface goes to the first page, configured pages in config order and the built-in page last, whose claims cover the catalog ids its messages name, at its protocol version as web core's compatibility rule matches it. A surface no page claims shows "No preview for catalog <id>", with how to add one, and names each page that has not answered. The config's preview setting is a list of pages.

### 16. The Preview tab

It shows one surface, the switcher's, as it stood right after the selected step, as Structure shows it, and keeps up with a live turn step by step while following. The page receives the A2UI messages that name the surface, the conversation's earlier turns' and the turn's own up to that step, and runs them through its own processor with its real catalog implementation. Preview and Structure are panes side by side, both shown by default, each hidden by its toggle, with a draggable divider between them; the toggles and the divider are remembered in the browser as the dividers are.

### 17. Widths

Two presets, Narrow and Wide, switched in the Preview tab's header, the choice remembered in the browser as the dividers are. Narrow is a phone-like width and Wide is the Preview pane's width; the numbers are settled on the design canvas. The frame scrolls when the surface is taller than the pane.

### 18. Render errors

The page reports three kinds of render error: a component that throws while drawing, an error web core reports on the surface, and a message the page's processor refuses. Each is a problem of the turn in view: a component failure on the step whose message carried the component, a refused message on that message's step, a web core error on the component's step or else the outcome step; counted in the header and on the turn's row while the turn is in view, reachable with `n`, and shown on the Preview tab. A component failure always counts; a refused message or a web core error on a step with a problem of the viewer's own folds under it as a quiet line. It is not recorded.

### 19. Pressing a control

Typing in the preview changes the page's own data model, and pressing fires the renderer's action handler; the adapter reports the action with the page's data model at that moment. The viewer shows the exact wire message the agent would receive, in the turn's protocol version: the `action` envelope with its name, surface id, source component id, timestamp and resolved context, v1.0's `userMessage` when the component has one, and the data models under the version's metadata key. It lands in the composer as a pending action in place of text, its JSON shown in the turn record's form, with Send and Discard. The composer's rules from Phase 3 hold unchanged: it sends only in a conversation the message box started, says why when it cannot, and is held while a turn is open; sending from an older turn's state is allowed. Sent, it is one host message carrying the action as an A2UI part, with the box's capabilities. It opens a turn like any other, its row's input the action's name. Every host message the box sends, a text as an action, carries in its metadata the data models of every active surface created with `sendDataModel`, as the surfaces stand at the step in view, the shown surface's from its preview page.

### 20. The sample catalog apps and the proof

One sample catalog, shared by one sample catalog app per framework under `samples/preview/`: a v0.9 definition holding the basic catalog's components and functions and one custom component, upstream's `CustomSlider`, implemented once per framework, each app with the preview page SPEC.md's adopter path describes and its own committed `a2ui-spectra.json`. Each is started by the end-to-end test and doubles as the adopter's worked example. The React adapter is also proven on one A2UIVerse catalog in the acceptance run, with a preview page added on A2UIVerse's side.

### 21. The design artifact comes first

The phase's first sub-task draws Phase 4's boards on the existing Design canvas "Spectra viewer UI", in light and dark: the Preview tab with a surface drawn in it, its width switch, the "No preview for catalog <id>" state, and a render error on the tab and in the step's detail; the composer holding a pending action with Send and Discard, and refusing one with its reason; the header's check list with four checks, and the "Not checked" form for a surface with no definition; the findings of the three new checks in the step's detail.

### 22. Tests

Unit tests of the checks over Phase 1's full fixtures, which carry the expected catalog, structural and binding events and serve as the oracle, a fixture corrected only where it is wrong against the specs; over the recordings, the flawed booking conversation with its known mistakes and the restaurant finders passing; and over hand-written cases for each finding code. A2UIVerse's CircleCI recording gets its catalog definition copied into the test data. Unit tests of the core's protocol. The browser end-to-end test, on Playwright's Chromium, starts the three sample catalog apps one at a time, each with its own config file, on one A2A version, against the stub agent picking the sample catalog by negotiation; it previews a turn through each, presses a control, sends the action and sees the turn land. The conformance action is unchanged: its expected records carry no check events.

### 23. The acceptance run

The last sub-task, through the tunnel: the Python and TypeScript restaurant finders in the built-in preview through the three flows, pressing a restaurant's button and submitting the booking form; the flawed booking conversation's findings across all four checks; A2UIVerse's CircleCI agent with its configured catalog, its credentials from the shell and a preview page on A2UIVerse's side proving the React adapter; the Lit and Angular samples by hand; every new board in light and dark. What it finds is fixed within the sub-task. Every preview page the remote browser loads needs its own tunnel port; the built-in page needs none beyond Spectra's.

## Invariants

- No credential is ever in the record. Wire events keep parts and metadata only; HTTP headers are not recorded; the config file holds variable names, never values.
- A record states what happened, and check events judge it. A render error is the browser's and is not recorded.
