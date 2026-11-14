# The Lit sample catalog app

The Lit sample catalog app of Spectra for A2UI: the sample catalog's Lit implementation and its preview page, built with the Lit preview adapter, `a2ui-spectra-preview-lit` in [`typescript/preview/lit/`](../../../typescript/preview/lit). It is the worked example of the adopter's side of the preview: a catalog with a custom component, its implementation, and the page Spectra draws its surfaces with.

## The sample catalog

[`../catalog.json`](../catalog.json), shared by the React, Lit and Angular samples, is a v0.9 catalog definition: the A2UI v0.9 basic catalog's components and functions, copied, and one custom component, `CustomSlider`, under the id `https://github.com/retz8/a2ui-spectra/blob/main/samples/preview/catalog.json`. It names no protocol version, so it serves v0.9 and v0.9.1 surfaces. A `CustomSlider` has a label, a value, a minimum and a maximum; it binds a number and writes it back to the data model as it is dragged, as upstream's Lit and Angular explorers have it.

The page also claims the A2UI v1.0 basic catalog, `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`, which Spectra knows built in, so a v1.0 surface on it is drawn here rather than on Spectra's built-in page, with its renderer's own reading of the v1.0 component envelope keys. The sample catalog itself stays a v0.9 catalog.

## Files

- `src/custom_slider.ts`: the custom component's Lit implementation, one of web core's universal elements.
- `src/catalog.ts`: the sample catalog: the Lit renderer's v0.9 basic catalog's components and functions and the custom slider, under the definition's id; and the v1.0 basic catalog, web core's `@a2ui/web_core/catalogs/basic/v1`, which the Lit renderer draws through web core's own elements.
- `src/main.ts`: the preview page: `<a2ui-spectra-preview>` with the sample catalog and the v1.0 basic catalog, where a host using them places its surfaces.
- `index.html`: the page, kept light with upstream's `a2ui-light` class, as a host's page is.
- `vite.config.ts`: the dev server, on the port the config file names, which must be free.
- `a2ui-spectra.json`: Spectra's config file: the catalog definition, for the checks and the message box's offer, and the preview page.

## Running it with Spectra

After `yarn build:all` from the repository root:

1. From `samples/preview/lit/`, `yarn dev` serves the preview page at http://localhost:9832/ on Vite.
2. From `conformance/`, `node dist/stub_agent/stub_agent.js --canned-a2ui` starts the stub agent at `http://127.0.0.1:10013`. Offered the sample catalog, its canned conversation answers in it: a surface asking how loud, with a `CustomSlider` bound to the volume and a Button whose action carries it.
3. From `samples/preview/lit/`, `node ../../../tools/spectra/dist/cli.js attach http://127.0.0.1:10013` starts Spectra with this folder's `a2ui-spectra.json`, and its store in `.a2ui-spectra/`, which git ignores.
4. In the viewer, send a message from the composer. The surface is drawn in the Preview pane from this page, its URL named in the pane's header. Moving the slider and pressing the Button lands the action in the composer; sending it, the stub answers with the volume.

The browser end-to-end test, `tools/spectra/src/samples_end_to_end.test.ts`, runs the same with this folder's `a2ui-spectra.json` as written, and draws the stub agent's v1.0 booking form, `--v1-booking`, on this page in its `@` form and its bare form. The smoke check on the published renderers, `_dev/tools/smoke_published_renderers.mjs`, builds this page in a scratch project on npm's latest of its renderer and of web core.

## Commands

From `samples/preview/lit/`:

- `yarn dev`: serves the preview page at http://localhost:9832/.
- `yarn build`: builds the Lit preview adapter, then type-checks and builds the app into `dist/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.
