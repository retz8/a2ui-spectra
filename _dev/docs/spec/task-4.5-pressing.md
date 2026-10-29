# Sub-task 4.5 — Pressing

Pressing a control in the preview: the action and the data model into the composer as a pending action, and the message box sending it as the next turn. Sub-task 4.5 of the Phase 4 spec, `_dev/docs/spec/phase-4-checks-and-preview.md`, carrying out its decision 19, pressing a control, with the composer of sub-task 4.1's decisions 5 and 6 and the action message of sub-task 4.4's decision 12; and the data model on every host message the box sends, as upstream's protocol has it.

## Scope

- The pending action in the composer: where it belongs, what it shows, its keys, sending and discarding it.
- The wire message: the action's A2A part, and the data model with an action and with typed text.
- The preview protocol's data-model message, sent by the core.
- The message box's routes carrying an action and a data model.
- The stub agent's canned A2UI conversation answering an action.
- The tests, the done line and the other documents.

Out of scope: the press in a real browser under test, sub-task 4.6's end-to-end test; a local function call such as `openUrl`, which web core runs in the page and never emits as an action; v1.0's `callAgentFunction` and `rendererFunctionResponse`, on the backlog as the Phase 4 spec has it.

## Locked decisions

### 1. A pending action belongs to its conversation

A pending action belongs to the conversation of the turn it was pressed in. Selecting another turn of that conversation keeps it. Selecting a turn of another conversation, or pressing "New conversation", drops it, as Discard does.

### 2. Typed text stays under it

Text typed in the composer before the press stays under the pending action and comes back when the action leaves the composer, by Send, by Discard or by being dropped.

### 3. The newest press replaces it

A press while an action is pending replaces it, with the data model as it stood at that press.

### 4. An action keeps its own render

The viewer remembers the turn and step of every render it sends. An action is pinned to its own render's turn and step, whatever newer render has gone out since: they give its conversation and the step its other surfaces' data models are read at. When that conversation is no longer in view, it is dropped, as decision 1 has it.

### 5. The action's A2A part

The action is one A2UI message, `{version, action}`, its `version` the one the surface's own messages name, so a v0.9.1 surface's action says v0.9.1. It rides in one data part with the A2UI MIME type, `application/a2ui+json`, following the A2A versioning note in upstream's `docs/public/concepts/actions.md`: under A2A 0.3 the part's data is the message as a single object, with the MIME type in the part's metadata; under A2A 1.0 it is a one-element array, with the MIME type in the part's own media type field.

### 6. The data model with an action

The action's metadata carries the data models of every active surface of the conversation created with `sendDataModel`, as the map upstream's client data model defines, under `a2uiClientDataModel` in v0.9 and v0.9.1 and `a2uiRendererDataModel` in v1.0. The pressed surface's comes from the page, with what was typed in it; every other surface's comes from the viewer's replay at the step of the action's render; a deleted surface is left out. A value typed in another surface before switching away is not kept, since the page rebuilds its processor when the surface changes.

### 7. The data model on typed text

A text message the box sends in a conversation it started carries the same map as an action, taken at the step in view: the shown surface's data model from the page, with what was typed in it, and every other surface's from the viewer's replay at the selected step. A new conversation, and one the box did not start, carry none. The preview protocol gains a message from the page: the shown surface's data model, sent whenever it changes, tagged with the running number of its render. The core sends it, each adapter reporting the change to it, the Lit and Angular adapters of sub-task 4.6 included. The protocol's version stays 1.

### 8. What the composer shows

The pending action's JSON is the one block the design canvas draws: the message's role; the A2UI part in the turn record's form, its content exactly as the A2A part's data will be, a single object under A2A 0.3 and an array under A2A 1.0; and the metadata holding the data model under its A2UI key. The capabilities, the ids and the A2A part's own fields are not shown.

### 9. The viewer builds the A2UI layer, the server the A2A layer

The viewer builds the action message and the data model map, exactly as the composer shows them, and posts them on the message box's send route, whose body carries a text or an action, never both or neither, with the data model and the conversation. The server places them in the A2A part and the message's metadata for the agent's A2A version, adding the capabilities, the ids and the config's headers as it does for text. An action is refused unless it continues a conversation the box started. The message box's state route tells the viewer the box's A2A version.

### 10. The keys

When an action lands, focus moves to Send, so Enter sends it. Escape, with focus in the composer, discards it, and focus goes back to the text box with the text kept under it. The list of keys gains "Discard the action · Esc".

### 11. Text says nothing of its data model

The composer shows nothing of the data model going with typed text. The new turn's Input step shows it in its "The host's data model" block, as it does for any host.

### 12. A failed send

A send that fails leaves the action pending.

### 13. The stub agent answers an action

The stub agent's canned A2UI conversation grows: its surface is created with `sendDataModel` and gains a TextField bound to the name and a Button whose action carries the name in its context. The second message greets the name from the action's context when it carries an action, and from its text part as today otherwise; either way the reply echoes the data model it received.

### 14. Tests

Unit tests under Node:

- The core: the data-model message, sent on each change, tagged with the render's running number, and from the new processor once the core recreates it.
- The viewer's model layer: the composer's message per protocol version, its `version` and v1.0's `userMessage`; its content as an object or an array by the box's A2A version; the map under its key, with every active `sendDataModel` surface, the pressed one from the page and the rest from the replay at the render's step, a deleted surface left out, and no map when no surface asked for one; text's map at the step in view; the pending action landing, replaced by a newer press, kept across its conversation's turns, dropped on leaving it or on "New conversation", pinned to an earlier render's step; the typed text coming back; the refusals and the open turn's hold.
- The server: the route's body, a text or an action and never both or neither; an action refused outside a conversation the box started; the box's request writing the part per A2A version and the data model under its key beside the capabilities.

The end-to-end test, on A2A 0.3 and 1.0 against the stub agent, under Node and against the binary: the canned conversation continued once by an action and once by text carrying a data model, the stub's reply echoing what arrived.

### 15. Other documents

- The Phase 4 spec is amended in place: decision 12, the preview protocol's message set gaining the page's data-model message; decision 19, the data model going with every host message the box sends, text included, as the map of every active `sendDataModel` surface taken at the step in view, and the composer showing the message in the turn record's form.
- `_dev/TODO.md`: the 4.5 line names this spec; the 4.6 line gains the adapters reporting the data model as it changes.
- The design canvas "Spectra viewer UI": the list of keys gains "Discard the action · Esc"; the pending state's caption reads "Enter sends it, Esc or Discard drops it"; the Flow 4 pending board's content is a single object, as an A2A 0.3 agent such as the restaurant finder receives it.
- `_dev/a2ui-findings.md` gains two findings: upstream's three sample clients sending an action unlike the extension spec and unlike each other, the React client a single object with the MIME type on the part, the Angular and Lit clients v0.8's `userAction` with no `version`, and none attaching the data model; and the extension spec's "MUST be an array" carrying no A2A version, where `docs/public/concepts/actions.md` dates the list to A2A v1.0.
- The READMEs: the tool's, for the send route's body and the state route carrying the A2A version; the preview core's, for the data-model message; `conformance/README.md`, for the canned conversation's surface and reply.

### 16. Done when

The unit and end-to-end tests pass and, by hand through the tunnel, in light and dark:

- The Python and Node restaurant finders in the built-in preview: a restaurant's "Book Now" pressed, its pending action shown and sent with Enter, the booking form's turn landing; the form filled and submitted, sent, the confirmation's turn landing; along the way a second press replacing the first, a Discard by the button and one by Escape bringing the typed text back, and a press from an older turn's step pinned there.
- The stub agent's canned A2UI conversation: a name typed in the preview's TextField reaching the new turn's "The host's data model" block, once through the Button's action and once with typed text.
- After a restart, an action pressed in the earlier run's conversation refused with "Started by another host or in an earlier run · an action can only be sent in a conversation the message box started".

## Invariants

- No credential is ever in the record.
- The turn record is unchanged: the new turn's row and Input step read an action as "Action “name”" already.
