# Backlog — The preview page answering for its document

Version 2 of the preview protocol: at each load of a page's iframe the viewer asks which document is there, and the document answers, so that the viewer no longer pairs a load with a `ready` by their order and timing. The backlog item of `_dev/TODO.md`, "The preview page saying which document it is", taken before Phase 9. It replaces decision 13 of the sub-task 8.5 spec, `_dev/docs/spec/task-8.5-the-catalogs-loop.md`, a load paired with its ready.

## Scope

- The preview protocol's version 2: the `ping` and `pong` messages.
- The preview core, the React, Lit and Angular adapters, Spectra's built-in page and the three sample pages on version 2.
- The viewer: a page's load and its answer, when a page's time to answer starts, how long a page that has not loaded holds the surfaces behind it, and the time-based pairing deleted.
- The Preview pane's line for a page that is still loading, drawn on the canvas first.
- The tests and the documents.

## Locked decisions

### 1. The viewer asks, the document answers

At each load of a page's iframe the viewer sends the page a numbered question, and the document that is there answers with the same number. An answer counts only for the latest load's number. A document whose adapter has not started does not hear the question, and the viewer asks again, with the same number, when that document's `ready` arrives. A broken document never answers.

### 2. The messages

`a2ui-spectra-preview/ping`, from the viewer to the page, and `a2ui-spectra-preview/pong`, from the page to the viewer. Each carries `load`, a number that starts at 1 for a page's first iframe load and goes up by one at each later load. `ping` is the protocol's second message from the viewer, beside `render`.

### 3. The page

The core listens for `ping` before it sends `ready`, so a document that has said `ready` can always answer. `ready` keeps its shape and carries no document id.

### 4. Version 2 only

The protocol's version becomes `2`, and the viewer speaks `2` only. A page on `1` is a mismatch, as a page on any other version is today, and is reloaded every five seconds as a mismatched page is today, so that an upgraded page is picked up. The core, the three adapters and the built-in page move in the same change. The time-based pairing is deleted: the five-second window a `ready` was owed its load for, and the one-second margin for a second `ready` of the same document.

### 5. A load

A ready page whose iframe loads is reloading until the load is answered. The 200 ms delay before the Preview header says so stays, so a healthy page shows nothing.

### 6. A `ready`

A `ready` that arrives while a load is unanswered: the viewer asks again with that load's number, and sends the render once the answer comes. A `ready` that arrives with no load unanswered: as today, the page is ready and the render is sent. This covers a page whose `ready` comes before its load, and React's `StrictMode` saying `ready` twice.

### 7. A page's time to answer starts at its load

A document has five seconds from its iframe's load to answer. With no answer in that time the page is unanswered and claims nothing, and the viewer sets its address again, as today. Until the load the page is waiting, and the viewer leaves it alone and does not restart it, however long the load takes. A page whose server accepts the connection and never answers stays waiting.

### 8. A page that has not loaded holds the surfaces behind it for five seconds

After five seconds without a load, routing passes the page by while it goes on loading: the built-in page draws what it can, and the viewer does not restart the load. When the page answers, the surfaces it claims move to it, as with a page that answers late today. For a surface nothing else can draw, the pane's line reads "`<page>` is still loading", where it reads "`<page>` has not answered" for a page that loaded and stayed silent.

### 9. The canvas

The canvas "Spectra viewer UI" gains one line form on its "Components and states" board, "`<page>` is still loading", drawn before the build.

### 10. The tests

- Unit tests for the new rules.
- The sample pages' browser test.
- One case for a slow first load.
- One case for two reloads in quick succession.

### 11. The documents

- The preview protocol's prose.
- The viewer's README.
- The sub-task 8.5 spec, amended in place: its decision 13, a load paired with its ready.
- `_dev/TODO.md`: the backlog item is removed.

## Invariants

- The `ready` message's fields, the `render`, `report`, `data-model` and `action` messages, and the Preview pane's layout do not change.
- No rule of the viewer's depends on the order in which a page's load and its messages arrive, or on the time between them, apart from the five seconds a document has to answer and the five seconds a page that has not loaded holds the surfaces behind it.
