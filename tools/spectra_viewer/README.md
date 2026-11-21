# Spectra viewer

The page of [Spectra for A2UI](../../README.md): the turn list, the turn view, the preview pane, the composer, the fixtures and the logs, in the browser. It is a React app built with Vite. It is never installed on its own: the `a2ui-spectra` command in [`../spectra/`](../spectra/README.md) copies its build, serves it on the viewer's port with the API and the live stream, and compiles it into the binary.

The page follows the design canvas "Spectra viewer UI", https://claude.ai/artifact/EiYG8HSHhGhPfDkMaRexQ2, where every change to it is drawn first.

[The viewer](../../docs/design/viewer.md) explains what each area of the page shows and what it is derived from; [The API](../../docs/design/api.md), the routes and the stream it reads.

## Development

React, with Radix primitives and the resizable panels shadcn/ui wraps, on Tailwind in A2UI Composer's configuration (`components.json`); `@a2ui/web_core` for the surfaces, and the preview protocol's messages from [`a2ui-spectra-preview`](../../typescript/preview/core/README.md). Inter and JetBrains Mono are bundled from Fontsource, so the page fetches nothing from outside Spectra.

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-viewer build
yarn workspace a2ui-spectra-viewer test
yarn workspace a2ui-spectra-viewer lint
yarn workspace a2ui-spectra-viewer format:check
```

The tests run under Node's test runner, on the conformance suite's recordings and records and the turn record fixtures. The page's browser end-to-end tests run in the tool's test target, `yarn workspace a2ui-spectra test`.
