# Sub-task 8.5 — The catalog's loop

A changed catalog definition read again while Spectra runs, and a preview page that reloads itself. Sub-task 8.5 of the Phase 8 spec, `_dev/docs/spec/phase-8-the-dev-loop.md`, carrying out its decision on a preview page that reloads itself and its decision on a changed catalog definition. It gives the viewer what the sub-task 8.1 spec, `_dev/docs/spec/task-8.1-design-artifact.md`, takes from this sub-task: per configured file, its path as the config names it, the time of the definition in force, and for a failed read its time and the reader's error.

## Scope

- The configured catalog files watched under `run` and `attach`, each read again on a change: what judges a read, a failed read, a changed id or protocol version, the message box's offer.
- The catalog listing's new fields, the stream event and the terminal's lines.
- The viewer on the event, and what recorded turns show after a change.
- The agent popover's failed-read lines and its Catalog row for a file the card does not advertise.
- The Preview pane: a page's load paired with its ready, the reloading state, the stopped-answering state.
- The canvas's reloading board, redrawn.
- The tests and the documents.

Out of scope: the rest of the viewer's Phase 8 work, sub-task 8.6; the acceptance run through the tunnel, sub-task 8.7; applying a changed config file; the preview protocol and the adapters, which stay as they are; the headless commands, `replay` and `test`, which watch nothing.

## Locked decisions

### 1. The viewer's side is built here

Sub-task 8.5 builds the viewer's side of its three boards on the canvas's row "The dev loop": "The preview page reloading", "The preview page stopped answering" and "The agent popover: a catalog file that did not read, the last good definition in force". The agent popover's failed-read lines, its Catalog row for a file the card does not advertise and the Preview header's reloading note are this sub-task's, beside the server's work, and not sub-task 8.6's, the viewer.

### 2. What judges a read

The rules that judge a configured file at start judge every read after it: the file exists and can be read; it is valid JSON holding an object; it names a `catalogId`; it passes its version's rules, the catalog definition meta-schema for 1.0 and a JSON Schema that compiles for 0.9 or no version; web core's `fromJson` loads it and drops no component or function the file names; and its id is neither one another configured file carries nor a basic catalog's. A read that fails any of them is a failed read, and the last good definition stays in force. At start nothing changes: a file that fails stops Spectra, there being no last good definition to keep.

### 3. A file that passes replaces its definition

A file that passes replaces its definition whatever changed in it. A new `catalogId` or protocol version is taken: the old id is no longer known, and the message box advertises the ids in force from its next message on.

### 4. When a file is read

A changed file is read after the quiet spell of 100 ms that the save watcher and the fixtures folder watcher use. A file that is gone at that moment is a failed read, and it is read again when it reappears. A turn that is open when the file changes is checked at its close against the definition in force then.

### 5. A read that changes nothing

A read that gives the same definition by value, such as a save with no edit or a formatter's rewrite, says nothing: no terminal line, no stream event, and the time of the definition in force stays. A read that clears a failed one is the exception, with the good read's line and the event, and the time of the definition in force moves to that read, the definition being the same or not: every good read that is said moves the time.

### 6. The listing and the event

| What | Name |
| --- | --- |
| The stream event, carrying nothing | `catalogs_changed` |
| On a configured entry, the file's path as the config file names it | `path` |
| On a configured entry, when the definition in force was read, as an ISO 8601 UTC time to the millisecond | `readTime` |
| On a configured entry, a read that stands failed, with its time and its error, present until a later read succeeds | `failedRead`, holding `time` and `error` |

Built-in entries carry none of the three. The error is the reason alone, without the file's path: the parser's own message for a file that is not valid JSON, otherwise the start-time sentence with the path taken off its front, such as "names no catalogId". The event is sent after each read that changes the listing.

### 7. The terminal's lines

- **A good read:** "./inline_catalog_0.9.json changed. Its catalog definition was read again."
- **A good read with a new id:** the same, then "Its catalog id is now <new>, no longer <old>."
- **A failed read:** "./inline_catalog_0.9.json changed and did not read: <error>. The definition read before stays in force."

The file is named as the config file names it, as the viewer names it. The save watcher's restart line keeps its own form, relative to the working directory. The failed line carries no clock time. No line is added at start: "Catalogs configured: <ids>" stays as it is.

### 8. What recorded turns show after a change

The views worked out from the registry follow the definition in force, for every turn, the recorded ones included: the turn list's rejection count, Structure and the data model, and the A2UI step's link from raw text to components. Check events stay as written. No mark is drawn on a turn checked under an earlier definition. A turn naming an id that is no longer known is drawn through the stand-in catalog, as any id that resolves nowhere is.

### 9. The viewer on the event

On `catalogs_changed` the viewer reloads everything it loads at connect, as it does on `agent_state`, so the turn list's counts move with Structure.

### 10. Where the watch sits

- **Inside a folder the save watcher watches:** the catalog file is told through that watch, with no watch of its own. This holds under an ignored or `!`-excluded folder too, the recursive watch covering it: there the save restarts nothing, and the file is still read again. Elsewhere in a watched folder a save of a catalog file restarts the agent as any file does, as the sub-task 8.3 spec, `_dev/docs/spec/task-8.3-logs-and-save-watcher.md`, has it.
- **Anywhere else:** the file's folder gets one non-recursive watch, opened at start, shared by the catalog files in it. This is the case under `attach`, under `run` with `watch` off, and for a file outside every watched folder.

### 11. A watch that fails, a removed folder, a symbolic link

- A watch that cannot be set up, or fails while Spectra runs, does not stop Spectra. The terminal names the folder and the system's reason, and says its catalog files are not read again until Spectra is started again.
- A folder removed while Spectra runs is not picked up when it reappears.
- A catalog path that is a symbolic link is watched by the link's folder, so a write to its target is not told on macOS. The tool's README says to name the real path.

### 12. A save missed under `attach`

Where the fixtures folder keeps its own watch, under `attach` and under `run` where restart on save does not watch the folder that holds it, that watch opens a new watch on the fixtures folder when the folder first appears. On macOS opening a watcher drops the other watchers' events for a moment, the sub-task 8.3 spec's finding, so a catalog save landing in that moment can go untold, and the old definition stays in force until the file's next save. This is accepted, and the tool's README states it. It can happen once per repo, at the first Save as fixture, the folder existing at every later start.

### 13. A load paired with its ready

A page's `ready` and its iframe's load event arrive in either order, and the viewer cannot see a page on another origin begin to reload. Measured in Chromium on the development machine, over 36 documents: the React, Lit and Angular sample pages, each on its dev server, load first and say ready 0 to 15 ms later, every time; Spectra's built-in page, a production build, says ready first and loads 5 to 6 ms later on every reload; and the React sample, under React's `StrictMode`, says ready twice per document in the same millisecond. So the two are paired in both directions:

- A load that arrives while a ready is owed one changes nothing, and nothing is owed after it.
- A ready that arrives while a load is waiting unanswered answers it, and is owed nothing.
- A ready within one second of the page's last ready, with no load between, is the same document's, and changes nothing owed. The one second is a margin over the measured 0 ms.
- Any other ready is owed one load, its own document's, for five seconds, the answer window the pane already uses.
- Any other load is a new document that has not answered, and waits for its ready: a ready page goes to reloading, and the five-second timer is armed. A page that is waiting, unanswered or speaking another protocol version is left as it is.
- The viewer's own reload of an unanswered page clears what is open.
- A second `ready` from a ready page stays what it is today, the render sent again.

Once a document has both loaded and answered nothing is owed, so a reload into a document that does not answer is caught at once in both orders. Known misreads, each wrong for up to five seconds or until the page's next load: two reloads within one second of a page whose ready comes first, and such a page's document replaced by a broken one before its own load arrived.

### 14. The pane while a page reloads

Reloading is a state of its own, apart from waiting. The page's iframe stays laid over the pane, showing whatever the reloaded document draws, with the note and the spinner in the Preview header. The note and the spinner show once the page has been reloading for 200 ms, the state itself changing at once, so a healthy page, which answers within the measured 15 ms of its load, shows nothing. The page keeps its last claims: a surface it was drawing stays routed to it, and a surface it never claimed routes on as before. A render asked for meanwhile is sent on the fresh ready. What the page reported stays in the pane's strip, and the fresh ready clears it as today.

### 15. A page that stops answering

After five seconds with no ready a reloading page is unanswered and claims nothing, under the rule the pane already has, and the viewer reloads it every few seconds as it does any unanswered page. On the sub-task 8.1 spec's two boards the contact card, in the basic catalog, falls to the built-in page, and the floor plan, in the catalog only that page claims, shows "No preview for catalog" with the line that the page has not answered.

### 16. The popover before a card has answered

Under `run`, before any card has answered, a configured file whose read stands failed gets its Catalog row: the popover holds Address, that row with its two lines, and Mode. The first screen's rule, the popover holding Address and Mode alone until a card has answered, describes the case with no failed read.

### 17. The tests

The rules are tested without any file event; real saves appear only in the command-line cases, where a case that saves a file saves it again until Spectra says so.

Without file events, in the tool's unit tests:

- The re-read: a good read replaces the definition; each start-time failure and each id clash keeps the last good one and records the failed read; a new id or protocol version moves the id map and the offer; the same definition by value changes nothing; a good read clears a failed one.
- The listing: `path`, `readTime` and `failedRead` on configured entries, none on built-in ones.
- The checks: a turn closed after a change is judged against the definition in force.
- The watch's placement: a file in a save-watched folder told through that watch, any other through one watch per folder.

The command-line cases, under Node and against the binary:

1. Under `attach`, a save with an edit: the terminal's line, `catalogs_changed`, the listing's new definition and later `readTime`; the next turn's check event follows the new definition, and the earlier turn's stays as written.
2. A save that breaks the JSON, then one that fixes it: the failed line and `failedRead`, the old definition in force, then both cleared.
3. A save that changes the `catalogId`: the listing's id, and the new id in the next message's offer.
4. Under `run`, the file in the watched folder: one save both restarts the agent, naming the file, and reads the definition again.
5. A save with no edit: no line and no event, shown by a later edit's event being the only one.

In the viewer's unit tests:

- The pairing: ready then load, load then ready, an unowed load on a ready page in either order, a second ready of the same document, the owed load lapsing after five seconds, an unowed load leaving any other state alone.
- Routing: a reloading page keeps its claims, and loses them when unanswered.
- The header's note: the URL alone for a page just reloading, and "· reloading" once it has been for 200 ms.
- The popover: the two failed-read lines, and the row for a file the card does not advertise.
- The stream: `catalogs_changed` reloads the connect set.

In the browser:

- Through the sample catalog apps, on each of the React, Lit and Angular sample pages: the page reloaded in its frame, the surface drawn again and the header's note back to the URL alone. All three, each adapter sending its ready at a different moment.
- Through one sample catalog app: its dev server stopped and the frame reloaded, giving the reloading note, then the line that the page has not answered, then the surface again once the server is back.
- In the viewer's own browser test, one case for the popover: the catalog file broken, the two lines shown, then gone after the fix.

### 18. Done when

The tests pass under Node and against the binary. There is no hand check through the tunnel in this sub-task: the acceptance run, sub-task 8.7, has the preview reload on the three sample pages and a catalog definition change.

### 19. The documents

- The tool's README: the `catalogs` setting's line, which says a changed definition needs a restart; the catalog registry section with the re-read, its rules and its limits; the `GET /api/catalogs` row; the stream's new event.
- The viewer's README: the reloading state, the pairing, the popover's lines.
- The Phase 8 spec, amended in place: its decision on a preview page that reloads itself takes the pairing and the frame; its decision on a changed catalog definition takes decisions 2 to 9.
- The sub-task 8.1 spec, amended in place: the reloading sentence becomes that the frame stays on the page and shows what the reloaded document draws, and the board's title follows; the first screen's popover rule gains the failed file's row.
- The sub-task 4.2 spec, `_dev/docs/spec/task-4.2-config-and-catalogs.md`, amended in place: its decision that configured catalogs are read once at start, and its decision that the viewer loads the listing once at connect.
- The canvas "Spectra viewer UI": the reloading board redrawn with the frame empty under the reloading note, and retitled to say the frame is kept.
- `_dev/TODO.md`: the 8.5 line names this spec and gains the popover's lines and the header's note; the backlog gains the preview page saying which document it is, in a later version of the preview protocol, so that the viewer's pairing of loads and readies is no longer needed.
- `SPEC.md`, the config schema, `_dev/a2ui-findings.md` and `_dev/otel-findings.md`: no change.

## Invariants

- A recorded check event is what Spectra judged at capture; no definition change rewrites it.
- The turn record is untouched: nothing of a catalog file's reads goes into it.
- The preview protocol stays at version 1, and the adapters are unchanged.
- Every catalog watch is opened at start; none is opened while Spectra runs.
- No test asserts a count that depends on the machine's speed.
