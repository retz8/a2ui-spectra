# a2ui-spectra-preview

The preview protocol of [Spectra for A2UI](../../../README.md), and its framework-free core.

**To preview your own catalog in Spectra, install an adapter, not this package:** [`a2ui-spectra-preview-react`](../react/README.md), [`a2ui-spectra-preview-lit`](../lit/README.md) or [`a2ui-spectra-preview-angular`](../angular/README.md). Each brings this core with it.

## For the author of an adapter

Spectra's viewer loads a catalog's preview page in an iframe and speaks the preview protocol to it over `postMessage`: A2UI messages go in; what the page renders, its errors, the surface's data model and the actions a press makes come out. Every page announces itself with a ready message carrying its protocol number, `2`, and the catalogs it draws.

The package has two entries:

- `a2ui-spectra-preview`: the protocol's messages and `startPreviewPage`, which runs the page's side of the protocol. An adapter gives it four things: making a processor from the catalogs, feeding it one message, mounting a surface, and tearing down.
- `a2ui-spectra-preview/web-core`: what every web adapter does with `@a2ui/web_core`'s message processor, whichever framework draws its surfaces: the action handler, watching each surface for its errors and its data model, and guarding web core's universal elements. It takes `@a2ui/web_core` `^0.16.1` as a peer dependency; the main entry does not import it.

[The preview](../../../docs/design/preview.md) is the protocol's full account: each message, the page's loads and answers, how a page is chosen for a surface, what a page reports, a press, and the version mismatch. The React, Lit and Angular adapters beside this folder are the worked examples.

## Development

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-preview build
yarn workspace a2ui-spectra-preview test
yarn workspace a2ui-spectra-preview lint
yarn workspace a2ui-spectra-preview format:check
```

The tests run under Node's test runner, the web core part's against a real web core processor.
