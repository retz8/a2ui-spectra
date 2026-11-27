# a2ui-spectra-preview-react

Your own catalog's surfaces in [Spectra for A2UI](../../../README.md)'s Preview pane, drawn by upstream's React renderer and your own components, at the versions your real host uses. It is one component, `SpectraPreview`, that runs the preview protocol for your page.

In Spectra's turn view, the Preview pane draws each surface on your catalog from your page, and its header names the page. Press a control there, and Spectra shows the exact action your agent would receive, with the data model, ready to send as the next turn.

## Install

A dev dependency of your catalog's app:

```sh
npm install --save-dev a2ui-spectra-preview-react
```

`@a2ui/react`, `@a2ui/web_core`, `react` and `react-dom` are peer dependencies: your app's own copies are the ones used.

## Set it up

1. Add a small page to your catalog's dev server, with `SpectraPreview` inside the providers your real host wraps its surfaces in, and the catalogs your host passes to its message processor:

   ```tsx
   import {MarkdownContext} from '@a2ui/react';
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

   Import from the renderer's package root, `@a2ui/react`: it draws every version Spectra reads, v0.9, v0.9.1 and v1.0. The catalogs are the page's claims: Spectra sends the page every surface whose catalog one of them carries.

2. Name the page's URL in Spectra's config file, `a2ui-spectra.json`, under `preview`, beside your catalog's definition under `catalogs`. The sample's config file:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/retz8/a2ui-spectra/main/tools/spectra/src/config.schema.json",
     "catalogs": ["../catalog.json"],
     "preview": ["http://localhost:9831/"]
   }
   ```

The sample catalog app in [`samples/preview/react/`](../../../samples/preview/react/README.md) is the full example: a catalog with a custom component, its React implementation and this page.

## What it supports

| Package              | Range                  | Tested at                                  |
| -------------------- | ---------------------- | ------------------------------------------ |
| `@a2ui/react`        | `^0.16.1`              | upstream's main at `7a776e7a4`, and 0.16.1 |
| `@a2ui/web_core`     | `^0.16.1`              | upstream's main at `7a776e7a4`, and 0.16.1 |
| `react`, `react-dom` | `^18.0.0 \|\| ^19.0.0` | 19.3.1                                     |

The published releases read a v1.0 component's envelope keys in both forms. See [What Spectra supports](../../../README.md#what-spectra-supports).

## When nothing shows up

**"No preview for catalog", with "Add a page built with a Spectra preview adapter to the config's preview pages."** Spectra has no page claiming the surface's catalog. Name the page's URL under `preview` in Spectra's config file, and pass the page every catalog the surface names: a page has to claim them all to draw it.

**"`<page>` has not answered".** The page loaded, but the adapter did not start, threw before it started, or the URL is not the preview page. A page that redirects to another origin is not heard either: name the address the page ends up at.

**Two protocol numbers, and the side to upgrade.** The page's adapter and the running Spectra speak different versions of the preview protocol. Move the adapter to the running Spectra's version, or upgrade `a2ui-spectra`, as the line says.

**"The preview page refused this message.", with the renderer's own error.** The renderer refused what the agent sent, such as a v1.0 component carrying both forms of an envelope key.

**"This is a Spectra preview page. It previews only inside Spectra."** The page was opened in a browser tab of its own. It draws only inside Spectra's Preview pane.

## How it works

[The preview](../../../docs/design/preview.md) explains the preview protocol, how Spectra picks the page that draws a surface, what a page reports, a press and the action it sends, and the version mismatch.

## Development

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-preview-react build
yarn workspace a2ui-spectra-preview-react lint
yarn workspace a2ui-spectra-preview-react format:check
```

The adapter has no unit tests of its own: what the three adapters share is the preview core's, tested there, and the browser end-to-end test in the tool's test target, `yarn workspace a2ui-spectra test`, runs it through the React sample.
