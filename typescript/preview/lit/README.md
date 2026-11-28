# a2ui-spectra-preview-lit

Your own catalog's surfaces in [Spectra for A2UI](../../../README.md)'s Preview pane, drawn by upstream's Lit renderer and your own components, at the versions your real host uses. It is one custom element, `<a2ui-spectra-preview>`, that runs the preview protocol for your page.

In Spectra's turn view, the Preview pane draws each surface on your catalog from your page, and its header names the page. Press a control there, and Spectra shows the exact action your agent would receive, with the data model, ready to send as the next turn.

## Install

A dev dependency of your catalog's app:

```sh
npm install --save-dev a2ui-spectra-preview-lit
```

`@a2ui/lit`, `@a2ui/web_core` and `lit` are peer dependencies: your app's own copies are the ones used.

## Set it up

1. Add a small page to your catalog's dev server, with `<a2ui-spectra-preview>` where your real host places its surfaces, inside the context providers it uses, given the catalogs your host passes to its message processor:

   ```ts
   import 'a2ui-spectra-preview-lit';
   import {html, render} from 'lit';

   import {myCatalog} from './catalog';

   render(
     html`<a2ui-spectra-preview .catalogs=${[myCatalog]}></a2ui-spectra-preview>`,
     document.getElementById('root')!,
   );
   ```

   The element draws upstream's `<a2ui-surface>` in its own light DOM, so your page's styles reach the surface as they reach it in your host. The catalogs are the page's claims: Spectra sends the page every surface whose catalog one of them carries.

   The element's class is `SpectraPreviewElement`, and importing the package defines it as `<a2ui-spectra-preview>`. Its two properties are set as properties, not attributes, and read when the element is first connected with its catalogs; disconnected, it stops, and connected again, it starts anew with what it then holds:

   - `catalogs`: the catalogs your host passes to its message processor, implementations and all.
   - `processorOptions`, optional, set before `catalogs`: the options your host makes its message processor with, such as its `validationConfig`, so that the preview validates as your host does. Its `version`, `validationConfig`, `adapterRegistry`, `defaultTimeoutMs` and `maxAgentCallCacheEntries` are used; `reportErrorsOnly` is not, so that every message the renderer refuses is reported; and its channel to the agent, `outboundListener`, `unifiedOutbound` and `errorHandler`, is not used, so that nothing in the preview goes out through it. A component that calls an agent function fails in the preview, as an error on the surface.

2. Name the page's URL in Spectra's config file, `a2ui-spectra.json`, under `preview`, beside your catalog's definition under `catalogs`. The sample's config file:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/retz8/a2ui-spectra/main/tools/spectra/src/config.schema.json",
     "catalogs": ["../catalog.json"],
     "preview": ["http://localhost:9832/"]
   }
   ```

The sample catalog app in [`samples/preview/lit/`](../../../samples/preview/lit/README.md) is the full example: a catalog with a custom component, its Lit implementation and this page.

## What it supports

| Package          | Range     | Tested at                                  |
| ---------------- | --------- | ------------------------------------------ |
| `@a2ui/lit`      | `^0.16.0` | upstream's main at `7a776e7a4`, and 0.16.0 |
| `@a2ui/web_core` | `^0.16.1` | upstream's main at `7a776e7a4`, and 0.16.1 |
| `lit`            | `^3.3.3`  | 3.3.3                                      |

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
yarn workspace a2ui-spectra-preview-lit build
yarn workspace a2ui-spectra-preview-lit lint
yarn workspace a2ui-spectra-preview-lit format:check
```

The adapter has no unit tests of its own: what the three adapters share is the preview core's, tested there. The tool's test target, `yarn workspace a2ui-spectra test`, runs it in Chromium twice over: the preview adapters' browser test frames its page in [`tools/spectra_preview_test_pages/`](../../../tools/spectra_preview_test_pages/README.md), and the browser end-to-end test runs it through the Lit sample.
