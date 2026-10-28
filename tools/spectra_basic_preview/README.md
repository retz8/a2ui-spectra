# Spectra's built-in preview page

The page that draws the basic catalog's surfaces in Spectra's Preview pane, with no setup: the basic catalogs of v0.9 and v1.0, and the v0.9 one again under the v0.9.1 basic catalog's URL, on upstream's React renderer, through the React preview adapter in [`../../typescript/preview/react/`](../../typescript/preview/react) exactly as an adopter's page uses it. The `a2ui-spectra` tool in [`../spectra/`](../spectra) copies its build beside the viewer's and serves it under `preview/`; the viewer loads it in an iframe like any configured page, after them.

The page stays light in both of the viewer's themes, as a host's page is: its root carries upstream's `a2ui-light` class, which the basic catalog's styles follow.

## Commands

From `tools/spectra_basic_preview/`:

- `yarn build`: builds the React adapter, type-checks the page and builds it into `dist/`.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset and React's hooks rules.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.
