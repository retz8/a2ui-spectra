# a2ui-spectra-preview-lit

The Lit preview adapter of Spectra for A2UI: one custom element that lets Spectra's viewer draw your catalog's surfaces with your own implementation, on upstream's Lit renderer, at the versions your real host uses. It runs the preview protocol through the core in [`../core/`](../core).

## Adding a preview page

1. Add the adapter as a dev dependency. It takes `@a2ui/lit` 0.14, `@a2ui/web_core` 0.14 and Lit 3 as peer dependencies, so the preview runs on yours.
2. Add a small page to the catalog's dev server, with `<a2ui-spectra-preview>` where your real host places its surfaces, inside the context providers it uses, given the catalogs your host passes to its message processor:

   ```ts
   import 'a2ui-spectra-preview-lit';
   import {html, render} from 'lit';

   import {myCatalog} from './catalog';

   render(
     html`<a2ui-spectra-preview .catalogs=${[myCatalog]}></a2ui-spectra-preview>`,
     document.getElementById('root')!,
   );
   ```

3. Name the page's URL in Spectra's config file, under `preview`.

The element draws upstream's `<a2ui-surface>` in its own light DOM, so the page's styles reach the surface as they reach it in the host. The catalogs are read once, when the element is first connected with them. They are the page's claims: Spectra sends the page every surface whose catalog one of them carries, at a compatible protocol version. Opened on its own, outside Spectra, the page shows one line saying what it is.

The sample catalog app in [`../../../samples/preview/lit/`](../../../samples/preview/lit) is a worked example.

## What it reports

- **A component that throws while drawing**, with its id and type. Every Lit component, the basic catalog's and your own, is one of web core's universal elements, guarded at its updates through the core's web core part; the rest of the surface stays drawn.
- **An error web core reports on the surface** through its error channel, such as an unknown component type.
- **A message the page's processor refuses.**
- **The surface's data model**, as it is created and whenever the agent's messages or typing in the page change it.
- **An action**, with the surface's data model at that moment, when a control is pressed.

## Commands

From `typescript/preview/lit/`:

- `yarn build`: builds the core, then compiles `src/` into `dist/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

The adapter has no unit tests of its own. What it shares with the other adapters is the core's web core part, unit-tested there; the browser end-to-end test, `tools/spectra/src/samples_end_to_end.test.ts`, covers the rest through the Lit sample catalog app.
