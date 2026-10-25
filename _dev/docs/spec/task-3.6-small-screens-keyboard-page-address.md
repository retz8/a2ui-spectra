# Task 3.6 — Small screens, the keyboard and the page address

Spec for sub-task 3.6 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the turn list's strip and overlay on a small window, the dividers and the composer, the keys, and the page address. The Phase 3 spec's decisions apply, as amended here.

## Scope

- The turn list's strip and overlay below 1,280px wide, and the page's minimum width.
- The dividers remembered in the browser, and the step's detail closed by hand.
- The composer growing as you type.
- The keys, and the list of keys.
- The page address holding the turn and the step, and the browser's history.
- The design canvas's amendments.
- The tests, the Phase 3 spec's amendments and the viewer's README.
- Done when the design canvas's small-window boards, the overlay and the list of keys work in the viewer as drawn, and the keys and the page address work as this spec has them.

## Locked decisions

### 1. The small window

Below 1,280px wide, the turn list collapses to the strip. The page's minimum width is what the strip's layout needs, about 740px; a narrower window scrolls sideways.

### 2. The strip

The strip holds one status icon per turn, in the turn list's order with every group open. Each icon is a button that selects its turn. A turn with problems carries a small red dot on its icon, and its tooltip reads "<input> · <N> problems". The strip's top button opens the overlay. The strip is one Tab stop, and the up and down arrows select its turns.

### 3. The overlay

The overlay is a floating panel with no dimming: the full turn list, with its title, count, search and groups, at 296px beside the strip, over the turn view. It closes when a turn is selected, on Esc, on a click outside it, and when the strip's button is pressed again. Opened by the strip's button, it puts focus on the selected turn in its list; opened by `/`, in its search. Closing it puts focus back on the strip's button. When the window grows past 1,280px with the overlay open, the full turn list takes its place.

### 4. The dividers

Each divider — the turn list and the turn view, the timeline and the result, the result and the step's detail — is remembered in the browser: one position each, the same for every turn and in both layouts. For the step's detail, what is remembered is its height when open.

### 5. The step's detail closed by hand

A step's detail closed by hand stays closed while the turn stays in view. Opening another turn on a step opens it. Nothing of it is kept in the browser.

### 6. The composer

The composer grows with its text, up to six lines, then scrolls inside, and goes back to one line once sent. Enter sends and Shift+Enter starts a new line; Enter while an input method is composing does not send. "Enter to send" stays as drawn.

### 7. The turn list's keys

The turn list is one Tab stop, and its group headers leave the Tab order. The up and down arrows select the turn they land on, and land on the group headers too, which leaves the selection as it is; turns in closed groups are skipped. The right arrow opens a group, the left arrow closes it, and the left arrow on a turn moves to its group's header. Arrowing to an older turn stops following the newest, and arrowing to the newest again resumes it, as selecting it does. The strip and the overlay move the same way.

### 8. The timeline's keys

The timeline is one Tab stop. The up and down arrows select the row they land on, a delivery's row included; on an open turn, the first press stops following. Under the problems filter, they move only through the rows it keeps. Home selects the first row. End selects the last, and on an open turn resumes following, as Jump to latest does.

### 9. Next problem

`n` selects the next step with a problem in the turn in view, in timeline order, and Shift+`n` the previous one, each wrapping around at the ends. On an open turn, it picks the step and stops following. The step's detail opens on the problem.

### 10. The other keys

`l` jumps to the latest step, as Jump to latest does. `/` focuses the turn list's search; on a small window, it opens the overlay with its search focused. `?` opens the list of keys. Esc closes the overlay or the list of keys. A single-character key does nothing while typing in a field, or with Ctrl, Cmd or Alt held.

### 11. The list of keys

The list of keys is a small centred dialog, in sections: the turn list, the timeline, problems and the composer. `?` opens it, and so does a keyboard button at the foot of the rail, beside the theme switch. Esc or a click outside it closes it.

### 12. The page address

The page address holds the turn and the selected step, picked or landed on, by the step's id. While a live turn is followed, it holds only the turn. An address with a step opens that step as picked. An address with only the turn opens it as the Phase 3 spec has it: following the newest step, landing on the first problem, or the final state.

### 13. The history

Changing the turn — by a click, the arrows, the strip or the overlay — adds an entry to the browser's history; changing the step replaces it. Back walks through the turns viewed, each on the step it was left on. The viewer's own moves — following a new turn, landing on a problem, the filter moving a selection it hides — replace the entry.

### 14. A step not in the turn

An address whose step is not in its turn opens the turn as an address with only the turn does, and the step is dropped from the address, replacing the entry.

### 15. The design canvas's amendments

The amendments are drawn first, in light and dark, and the build follows them:

- The small-window board's strip icons become buttons with a hover state, and a turn with problems carries the dot.
- The small-window board gains its dark twin.
- The overlay open over the small window, in light and dark.
- The list of keys, with the rail's keyboard button, in light and dark.
- The Components and states board gains the composer grown to several lines, and the rail's keyboard button with its hover state.

The new boards sit in the Screens and foundations page's States row, beside the small-window board.

### 16. Tests

Unit tests under Node's test runner cover reading and writing the address with its step; which changes add a history entry and which replace it; the next and previous problem wrapping around; the strip's order and its problem dots; the turn list's keys over turns and group headers, closed groups skipped; and the timeline's Home and End, End resuming following. The live check through the tunnel covers the new boards in light and dark, at 1200 × 760 and at the minimum width; Flow 2 by the keyboard alone, with the arrows, `n` and Shift+`n`, `/`, `?` and Esc; a live turn followed again with `l` and with End; a reload keeping the turn and the step; and Back walking through the turns. It runs with the stub agent's flawed booking conversation and upstream's Python restaurant finder at `020a9d6f`.

### 17. The Phase 3 spec's amendments

Small screens read: the composer is one line until typing, then grows, up to six lines. The step's detail starts collapsed to its title line until a step is selected. Below 1,280px wide, the turn list collapses to a strip of status icons, each selecting its turn, that opens as an overlay. Every divider can be dragged, and its position is remembered in the browser.

The keyboard and the page address read: the page address holds the turn and the selected step; changing the turn adds an entry to the browser's history, and changing the step replaces it. The up and down arrows move through the turn list and through the timeline, each one Tab stop, the turn list's groups opened and closed with the right and left arrows. `n` goes to the next problem, with Shift for the previous one; `/` focuses the turn list's search; `l` jumps to the latest step; Enter sends from the composer and Shift+Enter starts a new line; `?` lists the keys, as does a button at the foot of the rail.
