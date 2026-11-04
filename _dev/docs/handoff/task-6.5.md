# Task 6.5 — The A2UI step in the viewer: handoff

Spec: `_dev/docs/spec/task-6.5-a2ui-step-in-viewer.md`. The line stays `[WIP]`.

## Where it stands

Everything in the spec but the by-eye part of its done line is committed on `main`, not pushed: 9efcc76 to 92ff3ac for the sub-task, then 8aaaddd, which scrolls a selected tree node's range into view in the raw text and adds the tool's `src/viewer_end_to_end.test.ts`, Flow 6 walked in Chromium on the retried-parse full record, under Node and the binary.

The built-in preview page now bundles the Material Icons font, declared to hide an icon's name while it loads, so a basic catalog `Icon` draws its glyph, not its name; the tool's `src/viewer_end_to_end.test.ts` checks it on the same record.

The blocker is gone: the off-phase chore 39138b7 moved the tool, the viewer and the preview packages to web core 0.15.0 and v1.0's bare `1.0`, and 4a69f9f settled its backlog lines. On the rebuilt binary, the retried-parse record lists no rejection, and its final tree draws.

Flow 6 was walked headless on the local binary in light, dark and at 1,200 × 760, each board as the canvas draws it, and through the tunnel on 5173 with Claude in Chrome in light and dark, the reload included. The screenshots are in this session's scratchpad, `/private/tmp/claude-501/-Users-jiohin-Desktop-future-of-sw-a2ui-spectra/1fb4046f-f2dc-4f54-b7ad-3d6a3e3dcf40/scratchpad/flow6/`, which the system clears.

## Next

1. The retry turn at 1,200 × 760 by eye through the tunnel, on a port borrowed from A2UIVerse, 5173 so far, once Jioh says its server is idle: the browser window, maximized, did not take Claude in Chrome's resize.
2. The live part: the Python restaurant finder at the pin on Gemini under `run`, the wrapper on, through the tunnel; a parse row, its raw text linked both ways with the tree, the UI section folded in the request, the format and the catalog in the header. No environment on the machine runs it yet: the repository's own `.venv` holds the pinned `a2ui-agent-sdk` 0.10.0, `a2ui-adk` 0.2.0 and the wrapper but no `a2a-sdk`, and `../a2ui-upstream/.venv` holds `a2ui-agent-sdk` 0.9.1.dev171, below the wrapper's floor. Installing an upstream sample's packages was refused by this session's permission check, so the install needs Jioh's go-ahead or Jioh's own hands.
3. CI green on `main` after a push, then the 6.5 line's done line and its tick.
