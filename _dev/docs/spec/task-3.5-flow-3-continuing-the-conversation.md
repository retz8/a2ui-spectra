# Task 3.5 — Flow 3, continuing the conversation

Spec for sub-task 3.5 of Phase 3 — The viewer's UI (`_dev/docs/spec/phase-3-viewer-ui.md`): the design canvas "Spectra viewer UI"'s Flow 3, continuing the conversation. The Phase 3 spec's decisions apply, as amended here.

## Scope

- The message box holding the conversations it started, and sending to the one in view.
- The API saying which conversations the box started.
- The composer naming the conversation it continues, saying when the agent is waiting for input, and saying when sending starts a new conversation.
- The design canvas's amendments.
- The tests, the Phase 3 spec's amendments and the tool's README.
- Done when the design canvas's Flow 3 row works in the viewer.

## Locked decisions

### 1. Open turns

An open turn holds the composer only in its own conversation. While it is open, the box sends in another conversation or starts a new one, so two turns can be open at once, and the turn list follows the newer one as it follows a turn from any host.

### 2. New conversation

Pressing "New conversation" changes only the composer. The turn stays in view, and the composer reads "New conversation" without the button, with the placeholder "Message <agent>". Selecting any turn, the turn list following a new turn included, puts the composer back on that turn's conversation. Sending starts the new conversation, and the view moves to its turn. What is typed in the composer stays.

### 3. A conversation the box did not start

A conversation the box did not start while Spectra runs, another host's or the box's own from an earlier run, reads "Started by another host or in an earlier run · sending starts a new conversation".

### 4. A turn whose agent names no conversation

It is not continued. The composer reads "The agent named no conversation · sending starts a new conversation".

### 5. Waiting for input

When the conversation's newest turn ended waiting for input, A2A's input-required and auth-required alike, the composer reads "Continue “<the conversation's first message>” · the agent is waiting for input", with the placeholder "Reply to <agent>".

### 6. An older turn in view

The conversation in view is the selected turn's, whichever of its turns that is. The composer's icon and its waiting wording come from the conversation's newest turn, and sending moves the view to the new turn.

### 7. Tests

Unit tests under Node's test runner cover the box holding several conversations, an open turn holding only its own, each carrying its own task id, and one continued after another was sent in; and the wording the composer picks. The end-to-end test, on both A2A versions, gains a continued conversation with the stub agent's canned A2UI conversation. The Flow 3 row is checked live through the tunnel against its four boards, in light and dark, with upstream's Python restaurant finder at `020a9d6f`. The same check covers a turn from another host through the wire proxy, a restart reading the earlier run's conversation as decision 3 has it, and two conversations with the older one continued.

### 8. The design canvas's amendments

- "The agent is waiting for your reply" becomes "the agent is waiting for input" on the Flow 3 row's first, second and fourth boards, the Screens row's turn with a problem in light and dark, and the Components and states board.
- The Components and states board's "Started by another host · sending starts a new conversation" reads as decision 3 has it, and its composer states gain decision 4's.
- The Turn view details page's boards of the booking wizard, the file uploader and the stub agent's cancelled turn, conversations the box did not start, read as decision 3 has it.

### 9. The Phase 3 spec's amendments

The composer's conversation reads: the composer continues the conversation in view, whichever of its turns is selected, when the message box started it. Otherwise, sending starts a new conversation, and the composer says so. Starting a new conversation changes only the composer, until a turn is selected. An open turn holds the composer only in its own conversation. The box knows the conversations it started while Spectra runs; a box conversation from an earlier run, and a turn whose agent names no conversation, are not continued. The tool's README describes the message box and its API routes to match.
