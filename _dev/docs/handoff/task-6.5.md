# Task 6.5 — The A2UI step in the viewer: handoff

Spec: `_dev/docs/spec/task-6.5-a2ui-step-in-viewer.md`. The line stays `[WIP]`.

## Where it stands

Everything in the spec but the by-eye part of its done line is committed on `main`, 9efcc76 to 92ff3ac, not pushed: the four readers proved on the wrapper capture suite, the model's rules, the rows and problems, `a2uiStepErrors` in the listing, the parse's and the failed prompt generation's detail, the retry, Read by, the UI section, the hint, tree node selection and the node in the address, the header's formats and catalogs, the retried-parse full record `full_record_retried_parse.json` and its validator case, the documents of decision 14, and the canvas's retry board with the prefix break's sentence. The viewer's tests, the tool's listing test, the conformance validator, lint, format, the Vite build and the binary build are green locally.

## Blocked on

A smoke run of the binary on the retried-parse record drew no surfaces: every message was rejected. The pin's v1.0 schema and every wrapper capture record carry `"version": "1.0"`; `@a2ui/web_core` 0.14.0 and the tool's v1.0 schema copy expect `"v1.0"`. The backlog's move to web_core 0.15.0, with the v1.0 schemas and the basic catalog copy re-copied at the pin, runs first as an off-phase chore on `main`.

## Next

1. After the chore: the binary on the retried-parse record in the local store, Flow 6 walked by eye through the tunnel, in light and dark, and the retry turn at 1,200 × 760.
2. The live part: the Python restaurant finder on Gemini under `run`, the wrapper on, through the tunnel; a parse row, its raw text linked both ways with the tree, the UI section folded in the request, the format and the catalog in the header.
3. Both need a forwarded port borrowed from A2UIVerse, 5173 so far, once Jioh says its server is idle.
4. CI green on `main` after a push, then the 6.5 line's done line and its tick.
