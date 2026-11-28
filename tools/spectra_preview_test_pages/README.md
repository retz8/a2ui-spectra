# The preview adapters' test pages

Preview pages for the browser test of [Spectra for A2UI](../../README.md)'s React, Lit and Angular preview adapters, `tools/spectra/src/preview_adapters_end_to_end.test.ts`. Each page draws a test catalog through its adapter: the v0.9 basic catalog's components and functions, and the thrower, a component of the page's own framework that draws its text and throws while drawing when its `fail` property is true. Each page also lets the test do what the framework does to the adapter: the React page changes its catalogs prop and unmounts it, the Lit page hands over its catalogs to place an element anew, and the Angular page records what its own error handler and action handler are given, and destroys the application. The package is private and never packed or published.

[The preview](../../docs/design/preview.md) explains the protocol the test speaks to the pages.

## Development

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-preview-test-pages build
yarn workspace a2ui-spectra-preview-test-pages lint
yarn workspace a2ui-spectra-preview-test-pages format:check
```

The build builds the three adapters first, then the React and Lit pages with Vite into `dist/react/` and `dist/lit/`, and the Angular page with Angular's application builder into `dist/angular/`. The tool's test target builds them before it runs.
