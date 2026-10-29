# a2ui-spectra-preview

The preview protocol of Spectra for A2UI, and its framework-free core. A catalog's preview page runs the core through one of the adapters, `a2ui-spectra-preview-react` in [`../react/`](../react) for now, and Spectra's viewer loads the page in an iframe and speaks the protocol to it. An adopter installs an adapter, not this package.

## The protocol

A message set that names no carrier: A2UI messages go in; render errors, the shown surface's data model and actions come out. The web adapters carry it over `postMessage` between the viewer and the page in an iframe.

| Message      | From   | What it carries                                                                                                                                                                                                                                                                        |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`      | page   | The protocol's version, `1`, and the page's claims: each catalog it renders, by its id and the protocol version its definition targets, taken from the catalog objects the page passes to its renderer.                                                                                |
| `render`     | viewer | A running number, a surface id, and every A2UI message that names the surface, the conversation's earlier turns' and the turn's own up to the step selected, in order.                                                                                                                 |
| `report`     | page   | The number of the render it belongs to, and one report: a component that threw while drawing, with its id and type when the page knows them; an error web core reported on the surface, with its code; or a message the page's processor refused, with its index in the render's list. |
| `data-model` | page   | The number of the render it belongs to, the shown surface's id, and its data model as the agent's messages and the user's typing left it: sent whenever it changes, and once more for each render that leaves it as it was.                                                            |
| `action`     | page   | The number of the current render, web core's action payload, and the surface's data model at that moment.                                                                                                                                                                              |

The screenshot's message type is reserved; no adapter produces it yet.

- **The render difference.** Each render carries the full list. The core remembers the list it applied last: when the new list begins with it, for the same surface, only the tail is fed into the processor that holds the surface; otherwise the processor is recreated and the whole list fed. Messages are fed one at a time, and a throw is reported as a refused message.
- **Reports and renders.** Every report is tagged with its render's number. With a render that extends the last, the surface's earlier reports are sent again under the new number, since they still describe what is drawn. A report is sent once per processor.
- **Trust.** The viewer loads the page with its own origin in the `a2ui-spectra-viewer` query parameter. The page sends to that origin only, and takes messages only from its parent window at that origin. A page opened with no parameter shows one line saying it is a Spectra preview page and previews only inside Spectra.
- **Errors outside a component.** The window's error events, an uncaught error and a promise rejected with no handler, are reported once a render has come, as a component failure with no id.

## The core

`startPreviewPage` runs the page's side of the protocol. An adapter gives it four things: making a processor from the catalogs, feeding it one message, mounting a surface, and tearing down. The processor's surfaces report actions, their data models as they change, web core's errors and component failures through the events the core hands to the processor it asks for. `windowTransport` and `windowErrors` are the web carrier. `guardElementUpdates` guards a custom element class's updates, for components drawn as web components, such as web core's universal elements, which an error boundary of the page's framework does not see.

## Commands

From `typescript/preview/core/`:

- `yarn build`: compiles `src/` into `dist/`.
- `yarn test`: builds, then runs the unit tests under Node's test runner.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.
