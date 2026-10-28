# a2ui-spectra-preview-react

The React preview adapter of Spectra for A2UI: one component that lets Spectra's viewer draw your catalog's surfaces with your own implementation, on upstream's React renderer, at the versions your real host uses. It runs the preview protocol through the core in [`../core/`](../core).

## Adding a preview page

1. Add the adapter as a dev dependency. It takes `@a2ui/react` 0.14, `@a2ui/web_core` 0.14 and React 18 or 19 as peer dependencies, so the preview runs on yours.
2. Add a small page to the catalog's dev server, with `SpectraPreview` inside the providers your real host wraps its surfaces in, and the catalogs your host passes to its message processor:

   ```tsx
   import {MarkdownContext} from '@a2ui/react/v0_9';
   import {renderMarkdown} from '@a2ui/markdown-it';
   import {SpectraPreview} from 'a2ui-spectra-preview-react';
   import {createRoot} from 'react-dom/client';

   import {myCatalog} from './catalog';

   createRoot(document.getElementById('root')!).render(
     <MarkdownContext.Provider value={renderMarkdown}>
       <SpectraPreview catalogs={[myCatalog]} />
     </MarkdownContext.Provider>,
   );
   ```

3. Name the page's URL in Spectra's config file, under `preview`.

The catalogs are read once, as the component mounts. They are the page's claims: Spectra sends the page every surface whose catalog one of them carries, at a compatible protocol version. Opened on its own, outside Spectra, the page shows one line saying what it is.

## What it reports

- **A component that throws while drawing**, with its id and type. Each React implementation in the catalogs is wrapped in an error boundary of its own, and web core's universal elements, which both basic catalogs are drawn with, are guarded at their updates; either way the rest of the surface stays drawn.
- **An error web core reports on the surface** through its error channel, such as an unknown component type.
- **A message the page's processor refuses.**
- **An action**, with the surface's data model at that moment, when a control is pressed.

## Commands

From `typescript/preview/react/`:

- `yarn build`: builds the core, then compiles `src/` into `dist/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset and React's hooks rules.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

The adapter has no unit tests of its own; the end-to-end test through the React sample catalog app covers it.
