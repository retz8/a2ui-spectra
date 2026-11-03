# Sub-task 6.5 — The A2UI step in the viewer

The viewer's share of Phase 6: the four position readers and the component ranges in the raw text, linked both ways with the tree; the retry, the model call a parse read and the parse a tree component came from, computed when shown; the UI section marked in the model call's request; parse errors and failed prompt generations as problems; the boards and Flow 6 of the 6.1 design spec built. Sub-task 6.5 of the Phase 6 spec, `_dev/docs/spec/phase-6-the-a2ui-step.md`, carrying out its decisions 8, the UI section in the request; 10, retries; 11, component ranges; 12, the model call a parse read; 13, parse errors as problems; and 14, the parse a tree component came from; and building the boards of the 6.1 design spec, `_dev/docs/spec/task-6.1-design-artifact.md`, whose decisions 4 to 22 fix their look.

## Scope

- The four readers, Direct JSON, Express, Elemental and Atom, and the component ranges they state; the raw text with its ranges, hover and selection, linked both ways with the tree, as the 6.1 spec's decisions 9, 10, 14 and 15 draw them.
- The retry, the model call a parse read and the parse a tree component came from, computed when shown, and what they draw: the retry tag and sentences, "Read from", "Read by the parse", "Retried by the call", and the result pane while a parse is selected.
- The UI section marked in the request; the inference format and the catalog on the header's quiet line; the retry count on its second line.
- Parse errors and failed prompt generations as problems, in the viewer and in the server's listing.
- The parse row, the toolset's row, the parse's detail, the failed prompt generation's row, the hint on a turn with no A2UI step events, and the page address.
- The viewer's tests, and a new full record for Flow 6.
- Out of scope: the wrappers and the drivers, sub-tasks 6.3 and 6.4; the live walks of the four targets, sub-task 6.6; any change to how the proxies, the receiver or the wrappers record.

## Locked decisions

### 1. What a selected node tints

The tint is the reader's one range for the selected component, in every format. A component range is one contiguous span, as the record's shape has it: in Express a parent's range holds its children's text because the notation nests them; in Direct JSON a child's object is tinted only when the child is selected. Hover's innermost component means the same in both.

### 2. The readers

Four hand-written positional scanners in the viewer's model, one per notation, with no new runtime dependency. A reader runs by the parse's `a2ui.parse.inference_format` alone; a parse that states none gets no ranges, and a stated `a2ui.parse.components` replaces the reader's output whole. Each reader finds blocks as the pinned SDK's lexer does — the format's tags, its string and comment skipping, fence and edge-backtick stripping, the one recovered block without an open tag — and `a2ui.parse.wrapped` false makes the whole input one block. Each names a component by the compiler's own id rule, the generated ids of inline and unnamed components included. The Direct JSON reader reads the v0.9 and later component shape. A reader's output is its ranges and, on a text it cannot finish, the offset it stopped at and the reason, for the sentences of the 6.1 spec's decision 10, no component ranges or ranges up to a character. A range's surface id is the block's own surface statement, else the surface the parse's messages give that component id, else the SDK's default surface.

### 3. How the readers are proved

The wrapper capture suite is the oracle: for every case whose parse produced messages, the reader's ranges name exactly the components those messages hold, by surface id and component id, and each range's text, read on its own, is that component — the JSON object in Direct JSON, the `Type(` call in Express, the `<ui-…` tag in Elemental, the `(Type` form in Atom. Hand-written texts with exact offsets cover the scanner's own behaviour: nested extents and the innermost rule, a block that stops part way, an unwrapped text, a fenced block, and the one recovered block without an open tag. The viewer's test runner takes `wrapper_capture` among its inputs.

### 4. The retry's two sentences

On a retry, the retry's grey sentence takes the first line of the slot under the title line, and the prefix break's sentence sits under it as on any other call. The 6.1 spec's decision 16, which put the retry sentence in the place of the prefix break's, is amended, and the canvas's retry board gains the second line.

### 5. The UI section in the request

The viewer finds the section by the placement rule of the 6.2 spec's decision 11: a request holds the text when one string value contains the whole of it. Every occurrence in every model call of the turn is marked, each with its own label line. A request that holds the text nowhere marks nothing and says nothing; the header still names the format and the catalog from the turn's events.

### 6. The A2UI step's problems in the listing

The server's listing gains one field, `a2uiStepErrors`: the count of a turn's `exception` span events on its `parse` events plus its failed `prompt_generation` events — the problems of the Phase 6 spec's decision 13, each parse error one and a failed prompt generation one. A `parse` whose status is an error but that carries no `exception` event counts as one problem. The viewer mirrors the rule, and both are pinned by tests on the same records, as `failedCalls` is.

### 7. The toolset's row

A `parse` carrying `gen_ai.tool.name` whose parent is a `tool_call` event of the turn, or that shares its `gen_ai.tool.call.id`, joins that tool call's row, which takes the parse's label. The row's problems are the parse's errors; the tool span's status shows in the spans section and is not counted beside them. The row is addressed as any merged row is, by the proxy's span id, else the innermost span's.

### 8. A step arriving live or by amendment

A `parse` or `prompt_generation` arriving on a live turn, or by `turn_amended` on a held record, is handled as any received span is: everything computed from the record is recomputed, the retry, the ranges and the two ties included. "First component" on the header's second line is unchanged.

### 9. The page address

The selected node joins the address after the step, as its surface id and component id, each segment encoded: `#/turns/<traceId>/steps/<stepId>/nodes/<surfaceId>/<componentId>`.

### 10. The hint

The lines of the hint on a turn with no A2UI step events are constants in the viewer, copied from the two packages' READMEs; the `attach` sentence shows when the session's mode is `attach`.

### 11. Flow 6's record

A new full record, assembled by hand from the wrapper capture suite's texts, beside the two full records in the turn record test data: the `surface_already_exists` failing text as the first call's reply and its parse, a retry call with the failure appended, a valid Direct JSON text as its reply and its parse, and the wire delivery. The existing restaurant finder full record, whose second turn states its retries, is the stated-retry case.

### 12. Tests

The readers on the suite, decision 3. The inferred retry, the model call a parse read and the parse a component came from on the new record; a stated retry winning on the restaurant finder record. Hand-written with the existing builders: the tie by time with one fit and with several, a stated range winning, the toolset's tie by parent and by call id, the UI section marked in a span-only call, and a parse arriving by `turn_amended`. `a2uiStepErrors` on the same records in both workspaces.

### 13. Done line

Done when, through the tunnel with the real binary, the Python restaurant finder on Gemini under `run` with the wrapper on shows a parse row, its raw text linked both ways with the tree, the UI section folded in the request, and the format and the catalog in the header; Flow 6 is walked by eye on the new record placed in the local store; each in light and dark, and the retry turn in the small window; the readers are green on the suite; the viewer's and the tool's tests are green; and the gates are green in CI.

### 14. Other documents

- The Phase 3 spec's decision 9, one count covering every source of problems: retries are marked with their cause and not counted.
- The Phase 6 spec, in place: decision 13 gains a parse with error status and no `exception` event as one problem.
- The 6.1 design spec's decision 16, and the canvas's retry board.
- The tool's README: `a2uiStepErrors` in the listing. The viewer's README: the parse row and its detail, the ranges, the retry, the UI section, the hint, and the node in the address.
- `conformance/README.md`: the new full record, and the viewer's tests reading the wrapper capture suite.
- `_dev/TODO.md`: the 6.5 line names this spec and gains the done line.
- Unchanged: SPEC.md, the turn record prose and schema, the config schema. The findings files gain nothing unless the work finds something.

## Invariants

- The record states what happened. The retry, the component ranges, the model call a parse read and the parse a component came from are computed when shown and never stored, apart from a retry or a range a producer states itself.
- A retry is grey, never red, and not counted.
