# Spectra viewer

Spectra's viewer: a React app built with Vite. The `a2ui-spectra` tool in [`../spectra/`](../spectra) copies its build and serves it.

## Commands

From `tools/spectra_viewer/`:

- `yarn build`: type-checks the app and builds it into `dist/`.
- `yarn test`: runs the tests. The workspace has none yet.
- `yarn lint` and `yarn lint:fix`: ESLint with the root ESLint preset and React's hooks rules.
- `yarn format` and `yarn format:check`: Prettier, with the root `.prettierignore`.

From the repository root, `yarn build:all`, `yarn test:all`, `yarn lint:all` and `yarn format:check:all` run the same across every workspace.
