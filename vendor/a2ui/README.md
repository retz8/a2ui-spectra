# Upstream's pin

[`upstream-pin.json`](upstream-pin.json) names the pin, the commit of `a2ui-project/a2ui` that Spectra takes from upstream, and lists:

- `copies`: each file copied from upstream at the pin, its upstream path and its place in Spectra; a copy that is not an unchanged copy carries its alterations, each a JSON merge patch with its reason;
- `packages`: each upstream package Spectra uses, on npm or PyPI, and its `patch` when it is patched locally to the pin.

## Local patches

A package whose published release is behind the pin is patched locally: a tarball in this folder, built from upstream's source at the pin through the package's own publish preparation, under that repository's Apache 2.0 licence, stating the version number of the release it stands in for. The root `package.json` points the package at its tarball with one `resolutions` line, and the pin file's `patch` names the tarball.

No package is patched locally: every `patch` is `null`, and this folder holds no tarball.

## Removing a patch

When npm carries a package's state, its patch is removed: delete its `resolutions` line and its tarball, set its `patch` to `null` in the pin file, and run `yarn install`.
