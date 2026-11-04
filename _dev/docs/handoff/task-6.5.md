# Task 6.5 — The A2UI step in the viewer: handoff

Spec: `_dev/docs/spec/task-6.5-a2ui-step-in-viewer.md`. The line stays `[WIP]`.

## Where it stands

Everything in the spec is committed on `main`, not pushed, and the done line is met but for CI: 9efcc76 to 92ff3ac for the sub-task, then 8aaaddd, which scrolls a selected tree node's range into view in the raw text and adds the tool's `src/viewer_end_to_end.test.ts`, Flow 6 walked in Chromium on the retried-parse full record, under Node and the binary.

The built-in preview page now bundles the Material Icons font, declared to hide an icon's name while it loads, so a basic catalog `Icon` draws its glyph, not its name; the tool's `src/viewer_end_to_end.test.ts` checks it on the same record.

The live part is done, through the tunnel on 5173 with Claude in Chrome, in light and dark: the pin's Python restaurant finder, its source from upstream `9e8a9bac5` with the released `a2ui-agent-sdk` 0.10.0, `a2ui-adk` 0.2.0, `a2ui-a2a` 0.2.0, `a2ui-core` 0.5.0 and `a2a-sdk` 0.3.25 in an environment of its own, on Gemini under `run` with the wrapper on under `opentelemetry-instrument`. The turn showed its parse rows, the raw text linked both ways with the tree, the UI section folded in the request, "Direct JSON · basic, v0.9" in the header, and A2UI finding 31's retry. It found the model call a parse read tied wrongly, the retry's stream to the first call, whose `get_restaurants` argument "New York" its input quotes; ddb35cc fixed it.

The blocker is gone: the off-phase chore 39138b7 moved the tool, the viewer and the preview packages to web core 0.15.0 and v1.0's bare `1.0`, and 4a69f9f settled its backlog lines. On the rebuilt binary, the retried-parse record lists no rejection, and its final tree draws.

Flow 6 was walked headless on the local binary in light, dark and at 1,200 × 760, each board as the canvas draws it, and through the tunnel on 5173 with Claude in Chrome in light and dark, the reload included, and at 1,200 × 760 in a frame of that size laid over the page, as the maximized window did not take a resize. The screenshots are in this session's scratchpad, `/private/tmp/claude-501/-Users-jiohin-Desktop-future-of-sw-a2ui-spectra/1fb4046f-f2dc-4f54-b7ad-3d6a3e3dcf40/scratchpad/flow6/`, which the system clears.

## Next

1. CI green on `main` after a push, then the 6.5 line's done line and its tick.
