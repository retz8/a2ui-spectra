# a2ui-spectra-preview-angular

Your own catalog's surfaces in [Spectra for A2UI](../../../README.md)'s Preview pane, drawn by upstream's Angular renderer and your own components, at the versions your real host uses. It is one standalone component, `SpectraPreviewComponent`, that runs the preview protocol for your page.

In Spectra's turn view, the Preview pane draws each surface on your catalog from your page, and its header names the page. Press a control there, and Spectra shows the exact action your agent would receive, with the data model, ready to send as the next turn.

## Install

A dev dependency of your catalog's app:

```sh
npm install --save-dev a2ui-spectra-preview-angular
```

`@a2ui/angular`, `@a2ui/web_core` and Angular are peer dependencies: your app's own copies are the ones used.

## Set it up

1. Add a small page to your catalog's dev server, an application bootstrapped with the same `provideA2Ui` config your real host's app config has, and `provideMarkdownRenderer` when your host uses one, whose root component holds `<a2ui-spectra-preview />`:

   ```ts
   import {provideA2Ui, provideMarkdownRenderer} from '@a2ui/angular';
   import {renderMarkdown} from '@a2ui/markdown-it';
   import {Component, provideZonelessChangeDetection} from '@angular/core';
   import {bootstrapApplication} from '@angular/platform-browser';
   import {SpectraPreviewComponent} from 'a2ui-spectra-preview-angular';

   import {myCatalog} from './catalog';

   @Component({
     selector: 'app-preview',
     imports: [SpectraPreviewComponent],
     template: '<a2ui-spectra-preview />',
   })
   class PreviewPage {}

   bootstrapApplication(PreviewPage, {
     providers: [
       provideZonelessChangeDetection(),
       provideA2Ui({catalogs: [myCatalog], useUniversalComponents: true}),
       provideMarkdownRenderer(renderMarkdown),
     ],
   });
   ```

   Import from the renderer's package root, `@a2ui/angular`: it draws every version Spectra reads, v0.9, v0.9.1 and v1.0. The basic catalog's components it exports are web core's own elements, which it draws only with `useUniversalComponents: true`; a catalog of Angular components alone draws without it. The component takes no inputs: it reads the page's renderer config. The config's catalogs are the page's claims: Spectra sends the page every surface whose catalog one of them carries. Its `actionHandler` is not called: a press goes to Spectra. Its `processorOptions` are the options your host makes its message processor with, such as its `validationConfig`, so that the preview validates as your host does. Its `version`, `validationConfig`, `adapterRegistry`, `defaultTimeoutMs` and `maxAgentCallCacheEntries` are used; `reportErrorsOnly` is not, so that every message the renderer refuses is reported; and its channel to the agent, `outboundListener`, `unifiedOutbound` and `errorHandler`, is not used, so that nothing in the preview goes out through it. A component that calls an agent function fails in the preview, as an error on the surface.

2. Name the page's URL in Spectra's config file, `a2ui-spectra.json`, under `preview`, beside your catalog's definition under `catalogs`. The sample's config file:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/retz8/a2ui-spectra/main/tools/spectra/src/config.schema.json",
     "catalogs": ["../catalog.json"],
     "preview": ["http://localhost:9833/"]
   }
   ```

The sample catalog app in [`samples/preview/angular/`](../../../samples/preview/angular/README.md) is the full example: a catalog with a custom component, its Angular implementation and this page.

## What it supports

| Package                                        | Range     | Tested at                                  |
| ---------------------------------------------- | --------- | ------------------------------------------ |
| `@a2ui/angular`                                | `^0.16.0` | upstream's main at `7a776e7a4`, and 0.16.0 |
| `@a2ui/web_core`                               | `^0.16.1` | upstream's main at `7a776e7a4`, and 0.16.1 |
| `@angular/core` and the other Angular packages | `^22.2.3` | 22.3.0                                     |

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

From the repository root, after `yarn install`, on Node 22 at 22.22.3 or later:

```sh
yarn workspace a2ui-spectra-preview-angular build
yarn workspace a2ui-spectra-preview-angular lint
yarn workspace a2ui-spectra-preview-angular format:check
```

The adapter has no unit tests of its own: what the three adapters share is the preview core's, tested there. The tool's test target, `yarn workspace a2ui-spectra test`, runs it in Chromium twice over: the preview adapters' browser test frames its page in [`tools/spectra_preview_test_pages/`](../../../tools/spectra_preview_test_pages/README.md), and the browser end-to-end test runs it through the Angular sample.
