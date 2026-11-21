# Spectra's built-in preview page

The page that draws the basic catalogs' surfaces in [Spectra for A2UI](../../README.md)'s Preview pane, with no setup: the v0.9 and v1.0 basic catalogs, and the v0.9 one again under the v0.9.1 basic catalog's URL, on upstream's React renderer, through the React preview adapter exactly as an adopter's page uses it. It is never installed on its own: the `a2ui-spectra` command in [`../spectra/`](../spectra/README.md) copies its build beside the viewer's, serves it under `preview/` and compiles it into the binary.

[The preview](../../docs/design/preview.md) explains how the viewer loads it, after the pages the config file names, and what it draws.

## Development

From the repository root, after `yarn install`, on Node 22:

```sh
yarn workspace a2ui-spectra-basic-preview build
yarn workspace a2ui-spectra-basic-preview lint
yarn workspace a2ui-spectra-basic-preview format:check
```

The build builds the React adapter first. The page has no unit tests of its own; the tool's browser end-to-end tests draw on it.
