# The release procedure

The steps of a release done by hand, around the release workflow, [`.github/workflows/release.yml`](../.github/workflows/release.yml), whose steps are the commands of [`tools/spectra/scripts/release.mjs`](../tools/spectra/scripts/release.mjs). A release publishes, at one version: on npm, the launcher `a2ui-spectra`, its five platform packages, the preview core `a2ui-spectra-preview`, the preview adapters `a2ui-spectra-preview-react`, `a2ui-spectra-preview-lit` and `a2ui-spectra-preview-angular`, and the TypeScript wrapper `a2ui-spectra-instrumentation`; on PyPI, the five wheels of `a2ui-spectra` and the Python wrapper's wheel and sdist, `a2ui-spectra-instrumentation`; on GitHub, the release `v<version>`, holding the five archives and `checksums.txt`.

## Once, before the first release

1. **The accounts.** An npm account and a PyPI account, each with two-factor authentication.
2. **The `release` environment.** In the repository's settings, under Environments, the environment `release`, its deployment branches and tags set to the selected branch `main`, with no required reviewer.
3. **Immutable releases.** In the repository's settings, under Releases, release immutability switched on.
4. **The npm placeholders.** Each of the eleven npm names is created by publishing its placeholder, `0.0.0-placeholder`, under the dist-tag `placeholder`. From `tools/spectra/`, logged in with `npm login`:

   ```
   yarn pack:placeholders
   node scripts/release.mjs npm --placeholders --registry https://registry.npmjs.org/ --files dist/placeholders
   ```

   npm asks for the second factor at each publish. The command skips a placeholder npm already holds with the same checksum, so that it can be run again after a failure.

5. **The npm trusted publishers.** For each of the eleven packages, in its settings on npmjs.com, a trusted publisher for GitHub Actions: the user `retz8`, the repository `a2ui-spectra`, the workflow `release.yml` and the environment `release`, every field exact, allowing direct publishing with `npm publish` as well as staged publishing. A trusted publisher must complete its first publish within two days of its creation, so the eleven are made within two days before the real run.
6. **PyPI's pending publishers.** On pypi.org, under the account's publishing settings, a pending publisher for each of the two projects, `a2ui-spectra` and `a2ui-spectra-instrumentation`: the owner `retz8`, the repository `a2ui-spectra`, the workflow `release.yml` and the environment `release`. The first publish creates the project.

## Before each release

1. **The upstream check**, as [the re-pin procedure](re-pin-procedure.md) has it. A real run refuses while an npm package bundled into the binary resolves to a local patch.
2. **The two smoke checks**, the smoke check on the published renderers and the smoke check on the published agent SDKs, by hand, as the re-pin procedure has them.
3. **The commit that sets the version**, on `main`: `yarn workspace a2ui-spectra set:version <version>`, and in the root [`CHANGELOG.md`](../CHANGELOG.md) the entries under `## Unreleased` moved into a section `## <version>` below it, which is the release notes. CI passes on that commit.
4. **A dry run** on that commit:

   ```
   gh workflow run release.yml --ref main -f version=<version> -f dry-run=true
   ```

   It passes, and its summary holds the release notes, with the preview protocol's lines, every file in the stand-ins, and each install of the install check from the stand-ins on the five platforms.

## The real run

```
gh workflow run release.yml --ref main -f version=<version> -f dry-run=false
```

It refuses at its first step unless the version is the committed version, it was dispatched from `main`, the changelog's section is there and not empty, and neither the tag `v<version>` nor a published release of it exists. It runs everything CI runs, the publishing steps into the stand-ins and the install check from their stores on the five platforms, as a dry run does. Nothing is published before that install check has passed. Then it creates the draft release holding the five archives and `checksums.txt` and attests the archives, publishes to PyPI and to npm, publishes the draft, which makes the tag, and last runs the install check again on the five platforms, against npm, PyPI and GitHub themselves.

When it ends:

- the install check against the registries has passed on the five platforms;
- the release page of `v<version>` holds the six files and the notes, and the tag names the commit the run was dispatched on;
- `gh attestation verify <archive> --repo retz8/a2ui-spectra` verifies each archive downloaded from it;
- each of the eleven npm packages shows the version with its provenance on npmjs.com, and each of the seven PyPI files its attestation on pypi.org.

After the first release, each placeholder is deprecated with a message naming the release:

```
npm deprecate <name>@0.0.0-placeholder "A placeholder; install 0.1.0 or later."
```

## The install check by hand

The install check against the real registries runs outside any release run, from the Actions tab's "Run workflow" on `install_check.yml` or with

```
gh workflow run install_check.yml --ref main
```

Each install must print the committed version at the ref, so it fails between the commit that sets a version and that version's release.

## When a run fails

- **A job failed.** The failed job is run again in the same run, from the Actions tab's "Re-run failed jobs" or with `gh run rerun <run-id> --failed`, an install of the install check after the publish among them. Nothing is rebuilt: it downloads the files the run uploaded, and each publishing step skips a file already there with the same checksum. A draft an earlier attempt made is completed with the files it lacks.
- **A published file is wrong.** The version is abandoned. The cause is fixed, the version moves to the next patch number with its own changelog section, and a new run publishes everything. The abandoned version is deprecated on npm, `npm deprecate <name>@<version> "<message>"` for each of the eleven packages, and yanked on PyPI, in each of the two projects' release settings. A draft release of the abandoned version, never published, is deleted.
- **A draft of the version is left from an earlier run.** A draft is not visible to the first step. The draft job completes it when every file it holds has the run's checksum, and refuses it otherwise; a draft from another commit is deleted before the run.
