# Sub-task 6.1 — The design artifact

Phase 6's boards on the existing Design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, which the later sub-tasks follow. Sub-task 6.1 of the Phase 6 spec, `_dev/docs/spec/phase-6-the-a2ui-step.md`, whose decision 17 names the boards.

## Scope

- The boards decision 17 of the Phase 6 spec names: a `parse` step with the raw text and each component's characters linked both ways with the tree; a failed parse with its rejected blocks marked as problems; a retry marked with its cause; the inference format and the catalog version; the prompt's UI section marked inside the model call's exact request; the model call a parse read, linked both ways; a toolset tool call shown as its parse; a turn with no A2UI step events saying how to switch the wrapper on.
- A failed prompt generation.
- Flow 6, finding out why a turn retried and where the model's text went wrong.
- Nothing in the viewer's code.

## Locked decisions

### 1. Where the boards go

"Turn view details" gains a row, "The A2UI step", with eight boards: a parse selected, a tree node and its range linked; a failed parse, its rejected block marked; a retry selected, with its cause; a model call's request with its UI section open, with the inference format and the catalog in the header and in the section's label, the Phase 6 spec's board of the inference format and catalog version and its board of the UI section drawn as one; a model call with "Read by the parse"; a toolset tool call as its parse; a turn with no A2UI step events, its hint open; a failed prompt generation. Flow 6 is a new row on the Flows page. "Components and states" gains the parse row's forms, plain, streamed, toolset and with a problem; the failed prompt generation's row; the retry tag; the UI section's label line, folded and open; the two forms of a parse error's problem block; the "Read from" and "Read by" lines; the sentences of decision 10; and the hint of decision 21. "Icons" gains the parse's and the prompt generation's icons. The "Screens" row of "Screens and foundations" gains a pair, "Turn with the A2UI step", light and dark.

### 2. What the boards draw

| Board | Drawn from |
| --- | --- |
| A parse with a node and its range linked | The Node restaurant finder in Express, a Card selected, its range holding its children |
| A failed parse, its rejected block marked | The custom-components example, the `createSurface` naming `inline_catalog`, A2UI finding 32 |
| A retry with its cause | The same example's retry 1, whose own parse fails again |
| The UI section in the request, with the format and the catalog | The Node restaurant finder in Express |
| A model call with "Read by the parse" | The Python restaurant finder's retry call, read whole |
| A toolset tool call as its parse | The community rizzcharts sample |
| No A2UI step events, the hint open | The Python restaurant finder without the wrapper |
| A failed prompt generation | The conformance test record `prompt_generation_failed.json`: "Catalog example.com:contacts declares no components." |
| Flow 6, the Screens pair and the small window | The Python restaurant finder, its retry on "Surface default already exists", A2UI finding 31 |

A value the record leaves open, such as a catalog's version or exact offsets, is illustrative and settled on the canvas.

### 3. Flow 6, finding out why a turn retried and where the model's text went wrong

Four boards:

1. "Open the turn: 1 problem in the header, and it opens on the failed parse." The parse is selected, its problem block reading "The parse stopped on this block: Surface default already exists."
2. "Show text: the rejected block is the reply’s second copy, from its createSurface default on." The raw text is scrolled to the start of the red-soft block, the whole block between its tags, the whole reply visible once above it.
3. "Select the next model call: Retry 1, after the parse failed." The retry tag on its row, the grey sentence and the parse's link in its detail.
4. "In the final tree, select a component: the retry's parse opens with its text marked." The node selected, its range in the teal tint.

### 4. The A2UI step on the timeline

A `parse` is a row among the steps, ordered by its start time, drawing a bar from its start to its end. A `prompt_generation` has no row: it shows as the UI section in the model call's request, decision 18. A failed prompt generation is the one exception, decision 7.

### 5. What a parse row says

The label is "Parse"; the muted target is the inference format by the names SPEC.md uses, Direct JSON, Express, Elemental and Atom, with "· streamed" for a stream: "Parse · Express", "Parse · Express · streamed". A failed parse is the same row with the problem mark. A parse that names no inference format has no muted target.

### 6. The toolset's tool call

`SendA2uiToClientToolset`'s `send_a2ui_json_to_client` tool call is one row, its parse's: "Parse · send_a2ui_json_to_client · Direct JSON". ADK's span for the tool call has no row of its own; it joins the parse's "From the agent's spans" section, and what the toolset returned to the model, the error a failed parse sends back included, is a "Returned to the model" block after "Raw text". With ADK's spans and no wrapper, the tool call stays a tool row read from spans.

### 7. A failed prompt generation

A failed `prompt_generation` in a turn is a row, "Prompt generation · Direct JSON", with the problem mark, counted as one problem. Its detail is the problem block, "The SDK could not write the prompt's UI section: Catalog example.com:contacts declares no components." over "A2uiCatalogError · A2UI SDK, Python", then the spans section. A failed prompt generation that falls in no turn stays out of every turn.

### 8. The parse's detail

The header row: "Parse", its target as decision 12 has it, its offset and its duration. Then, in order:

1. The problems, one problem block per parse error, decision 11.
2. A "Read from" line: the model call the parse read, as a teal link, such as "The reply of gemini-3.6-flash at +2.0 s", or "Tied to no model call".
3. "Raw text", open: the parse input, its component ranges as decision 9 draws them, each rejected block in red-soft.
4. "Messages", folded: the A2UI messages the parse produced, as a JSON block, those a failed parse produced before its error included.
5. "From the agent's spans", folded: the section a call has, its source line as decision 12 names it.

A failed parse that was retried also shows "Retried by the call at +5.0 s", a teal link that selects the retry.

### 9. Component ranges in the raw text

The raw text is plain at rest; only rejected blocks are tinted, in red-soft, each whole, between its tags. Hovering outlines the innermost component under the pointer. Clicking selects that innermost component: its own range, its statement in Express or its object in Direct JSON, takes the teal-soft selection tint, and its tree node is selected. Selecting a tree node tints its range and scrolls it into view. Text outside any component, such as the model's prose, the `<a2ui>` tags or data model lines, stays plain and links to nothing; a range with no node in the tree shown is drawn and selectable, and links to nothing.

### 10. When component ranges are not worked out

A grey sentence above "Raw text" says why: "No component ranges · the parse names no inference format", or "No component ranges · the Express reader could not read this text"; the text stays plain, and selecting a tree node marks nothing in it. On a text read only in part, the components read before the break are linked, the rest is plain, and the sentence reads "Component ranges up to character 1,204 · the Express reader stopped there". No other reader is tried when the format is not stated.

### 11. A parse error's problem block

The first line is a short lead naming what happened, then the SDK's message: "The parse stopped on this block: Surface default already exists." for the error that ended the parse, "The stream rejected this block and read on: …" for a block a stream read past. The second line is the error's class and the SDK: "A2uiIntegrityError · A2UI SDK, Python". "↓ Show text" scrolls to the block's red-soft mark in "Raw text"; an error that cannot be placed in the text marks none.

### 12. The source of an A2UI step span

A `parse` or `prompt_generation` span is named by its scope, in the detail header's target and in the spans section's source line: the header's target "Express · streamed · a2ui-spectra-instrumentation 0.1.0", the source line "a2ui-spectra-instrumentation 0.1.0", with no "spans" word. A native hook's or an agent's own spans show their own scope the same way. A span with no scope name reads "A2UI step spans".

### 13. The result pane while a parse is selected

Selecting a parse shows the surfaces as they stood after the last wire message traced to it. When no wire message traces to it, the surfaces show as they stood right after the parse.

### 14. Selecting a tree node

Clicking a node's row selects it; its chevron still opens its properties. Selecting a node also selects the parse it came from: the timeline's selection moves to that parse, its detail opens with the component's range tinted and scrolled into view, and the node stays selected. The result pane follows decision 13, its as-of note saying which state it shows. A node traced to no parse is selected and nothing else happens.

### 15. The page address

The selected tree node joins the page address, as its surface id and component id, replacing the entry as a change of step does. A reload brings back the node, its parse and its tinted range. A node no longer in the tree shown is dropped.

### 16. A retry

A retry's row carries a grey "Retry 1" tag after the call's name, before the problem mark's column, keeping its width as the timeline narrows. Under the retry's title line, a grey sentence takes the first line of the slot: "Retry 1 · the reply of the call at +2.0 s failed to parse · Surface default already exists", the failed parse a teal link that selects it; the prefix break's sentence sits under it as on any other call. A retry is grey, never red, and not counted.

### 17. The model call a parse read

Under a model call's "Response" label, one line per parse that read it: "Read by the parse at +4.8 s · Express", each a teal link that selects the parse. Nothing is marked inside the call's output text.

### 18. The UI section in the request

The UI section keeps its place in the request's text as a bounded region, folded by default, opening with a label line, "Generated by the A2UI SDK · Express · basic, v1.0", the format and the catalog as decision 19 has them. The section sits on a faint neutral tint, neither teal nor red, its label line on it; unfolded, its text sits under the label and ends in a thin closing line. The developer's own text around it stays plain. The prefix break's marker falling inside the section opens it. The section is marked the same way in whichever part of the request holds it.

### 19. The inference format and the catalog version

The header's quiet line gains the inference format and the catalog after the A2UI version: "A2UI v1.0 · Express · basic, v1.0", the catalog named as the agent dialog names it. The format comes from the turn's `prompt_generation` and `parse` events, the catalog from its `prompt_generation` events; a turn holding several distinct ones lists each once, in order of first use, and what the events do not state is left out. A turn with no A2UI step events keeps the header as it is.

### 20. The header's second line

The turn header's second line adds "· 1 retry" after the model call count, only when the turn has retries: "3 model calls · 1 retry · 1 tool call · …", retries counted as their tags number them. Nothing else about the A2UI step joins the second line.

### 21. A turn with no A2UI step events

On a turn that holds model calls and A2UI messages but no `prompt_generation` or `parse` event, each model call's detail carries a grey sentence under its "Response" label: "No A2UI step recorded · switch the wrapper on to see which text became which component", followed by a folded "How to switch it on" block with both languages side by side: Python's install and its launch under `opentelemetry-instrument`, or its one line; TypeScript's install and its launch through `--import`, or its one line; each a code block with Copy. Under `a2ui-spectra attach`, each launch line's caption adds "with the variables on the first screen set in the agent’s shell", and the launch drops `a2ui-spectra run --`. The lines are the two packages' READMEs'.

### 22. Dark twins and the small window

Dark twins: the Screens pair, the Python restaurant finder's retry turn with the failed parse selected; the board of a parse with a node and its range linked; the board of the UI section in the request. One small-window board, 1,200 × 760 in light, draws the same retry turn, the detail narrow, the raw text wrapping, the retry tag and the problem mark keeping their width while the muted targets give way.

### 23. Keys

No new keys. The list of keys is unchanged.

### 24. What other sub-tasks and documents take from this

- The Phase 6 spec, amended in place: decision 13 gains a failed prompt generation as one problem, on its own row; decision 17 gains the board of a failed prompt generation, and draws the board of the inference format and catalog version and the board of the UI section as one.
- Sub-task 6.2: the viewer can place each rejected block in the parse input, for "↓ Show text"; and the viewer can tell that ADK's `send_a2ui_json_to_client` tool span and the toolset's parse are the same tool call, for decision 6's one row. How the record carries these is 6.2's.
- Sub-tasks 6.3 and 6.4: the packages' READMEs give the lines decision 21's hint shows.
- Sub-task 6.5: done when the artifact's Flow 6 row works in the viewer.
