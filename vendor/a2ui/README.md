# Upstream's npm packages at the pin

Tarballs of `a2ui-project/a2ui`'s npm packages, built at the pin that [`_dev/upstream-pin.json`](../../_dev/upstream-pin.json) names, under that repository's Apache 2.0 licence. Each stands in for its package's published release, whose state is behind the pin, until npm carries the pin's state. A tarball states the version number of the release it stands in for.

| Tarball                      | Package             | Built from                         |
| ---------------------------- | ------------------- | ---------------------------------- |
| `a2ui-web_core-0.15.0.tgz`   | `@a2ui/web_core`    | `typescript/core/web_core`         |
| `a2ui-markdown-it-0.2.2.tgz` | `@a2ui/markdown-it` | `typescript/renderers/markdown-it` |
| `a2ui-react-0.15.0.tgz`      | `@a2ui/react`       | `typescript/renderers/react`       |
| `a2ui-lit-0.15.0.tgz`        | `@a2ui/lit`         | `typescript/renderers/lit`         |
| `a2ui-angular-0.14.0.tgz`    | `@a2ui/angular`     | `typescript/renderers/angular`     |
| `a2ui-agent-0.1.0.tgz`       | `@a2ui/agent`       | `typescript/agents/a2ui_agent`     |

The root `package.json` points each package at its tarball with one `resolutions` line; the workspaces' declared versions and the preview adapters' peer ranges are left as they are. [`_dev/tools/build_upstream_tarballs.mjs`](../../_dev/tools/build_upstream_tarballs.mjs) builds them in the `a2ui-upstream` worktree through each package's own publish preparation, and writes the `resolutions` lines and the pin file's entries.

Removing one package's patch, when npm carries its state: delete its `resolutions` line and its tarball, set its `patch` to `null` in the pin file, and run `yarn install`.
