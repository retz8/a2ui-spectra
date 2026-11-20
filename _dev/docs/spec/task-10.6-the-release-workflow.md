# Sub-task 10.6 — The release workflow

The release workflow, started by hand, and its dry run; the release notes and the root `CHANGELOG.md`; the npm placeholders' command; and the procedure for the steps done by hand. Sub-task 10.6 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 9, the release workflow, and, for the dry run, its decision 10, the rehearsal, under SPEC.md's "Distribution and names". Nothing is published. Its build starts after sub-task 10.13, the wrappers' OpenTelemetry versions, as the Phase 10 spec's decision 19 orders it.

The upstream check at this sub-task's start, on 2026-11-20, read `upstream/main` at `496df0e76` (2026-11-19), 38 commits after the pin `0888f88b2`, the reading the 10.5 and 10.14 specs open with, and found no event: PyPI's releases of 2026-11-17 are the ones sub-task 10.14 took, and npm carries no new release, upstream's commit `979eaee49` (2026-11-18) bumping its npm packages' versions with nothing on npm yet; `specification/versions.json` is unchanged, the five watch-list items are open, and upstream's two install scripts and their test are unchanged since the pin.

Upstream's release workflows, npm, PyPI, GitHub and Spectra's own CI, as read on 2026-11-20:

- **Upstream's `a2ui` CLI release**, at the pin (`.github/workflows/release-cli-binaries.yml`). It starts on a `cli-v*` tag push or by hand, with a version, a dry-run switch and a draft switch. A real run must be dispatched from `main`, "Non-dry-run releases must be dispatched from main", and its version must equal `pubspec.yaml`'s; a dry run may name another. A real run requires a `## <version>` section in `dart/a2ui_cli/CHANGELOG.md`, "Please move notes from ## Unreleased to ## $VERSION before releasing"; a dry run only warns, and an empty section falls back to one generic line. It attests every file of its release with `actions/attest-build-provenance`, a step a dry run skips, and makes the tag through `gh release create "$TAG" --target "$TARGET_COMMIT"`.
- **Upstream's Python release**, at the pin (`.github/workflows/release-pypi.yml`). It publishes through Google's OSS Exit Gate, not through PyPI's trusted publishing. It requires `main` for every run, pushes its tags once staging has succeeded, "Past this point the artifacts are staged and the release is going ahead, so the tags become permanent", and cuts `## Unreleased` into the version's section itself, onto a branch. Its header: "builds and tests run in an unprivileged `build` job with default `contents: read` permissions. Third-party dependencies and build backends never execute in the `release` job, which isolates `id-token: write` and `contents: write` exclusively to trusted staging, tagging, and publishing steps."; and "Renaming or moving this file breaks releases until the internal config is updated to match."
- **Upstream's npm packages**, at the pin, are published by hand through `typescript/scripts/publish_npm.mjs`; no workflow publishes them.
- **Upstream's changelogs**, at the pin, one per package: a `## Unreleased` section on top, then one `## <version>` section per release, newest first, each a list of entries with breaking changes marked in bold (`dart/a2ui_cli/CHANGELOG.md`, `python/a2ui_agent/CHANGELOG.md`).
- **npm's trusted publishing** (`docs.npmjs.com/trusted-publishers`, `docs.npmjs.com/cli/v12/commands/npm-trust`).
  - "Package must exist: The package you're configuring must already exist on the npm registry." The setting sits in "your package settings on npmjs.com"; no page read describes a publisher for a package that does not exist yet.
  - A publisher names the user, the repository, the workflow's filename and an optional environment: "Enter only the filename, not the full path"; "All fields are case-sensitive and must be exact."; "Existing trusted publisher connections cannot be changed. … To change them, delete the connection and create a new one." It names no ref.
  - "A newly created trusted publisher configuration must complete its first successful publish within 2 days."
  - "Configurations created after Sep 03, 2026 are automatically set to allow npm stage publish, and you can choose whether to also permit direct publishing with npm publish."
  - "npm does not verify your trusted publisher configuration when you save it. … errors will only appear when you attempt to publish."
  - Of a workflow that calls another: "validation checks the calling workflow's name instead of the workflow that actually contains the publish command".
  - "Trusted publishing requires npm CLI version 11.5.1 or later and Node version 22.14.0 or higher."
  - Provenance "happens by default—you don't need to add the --provenance flag", when publishing through trusted publishing, from a public repository, a public package.
- **npm's staged publishing** (`docs.npmjs.com/staged-publishing`). "A maintainer must then review and explicitly approve the staged package — with two-factor authentication (2FA) via the CLI or npmjs.com — before it becomes publicly available." Staging a package that does not exist yet, "npm publishes a placeholder version of the package with the version 0.0.0-stage". Of approving in batches: "Batch actions are independent. If one version fails, other versions can still succeed. Successful actions are not rolled back.", and they "are rolling out gradually and may not be available on your account yet". Whether a staged version published under a trusted publisher carries provenance is not stated.
- **npm's provenance** (`docs.npmjs.com/generating-provenance-statements`). "To publish a package with provenance, you must build your package with a supported cloud CI/CD provider using a cloud-hosted runner."
- **npm's unpublish policy** (`docs.npmjs.com/policies/unpublish`). "Once package@version has been used, you can never use it again." A new package can be unpublished within 72 hours "as long as no other packages in the npm Public Registry depend on your package"; whether one version of a package others depend on can be unpublished is not stated. "`npm deprecate <package>@<version> "<message>"` to deprecate a specific version".
- **PyPI's trusted publishers** (`docs.pypi.org/trusted-publishers/`). "You can configure a 'pending' publisher that will create the project when used for the first time". A publisher names the owner, the repository, the workflow's filename and an optional environment: "Configuring an environment is optional, but strongly recommended". "Reusable workflows cannot currently be used as the workflow in a Trusted Publisher." "PyPI does not allow for a filename to be reused, even once a project has been deleted and recreated." (`docs.pypi.org/publishing/troubleshooting/`).
- **PyPI's attestations.** With `pypa/gh-action-pypi-publish`: "Generating signed digital attestations for all the distribution files and uploading them all together is now on by default for all projects using Trusted Publishing." (its README). With uv: "uv publish does not currently generate attestations" (`docs.astral.sh/uv/guides/package/`).
- **GitHub's artifact attestations.** Of `actions/attest-build-provenance`: "new implementations should use `actions/attest` instead." (its README). `actions/attest` takes its subjects from a glob or from a checksums file: "Each of the artifacts identified in the checksums file will be listed as a subject for the attestation." (its README). For a public repository the attestation "is also written to an immutable transparency log that is publicly readable on the internet." (`docs.github.com/en/actions/concepts/security/artifact-attestations`). A consumer verifies with `gh attestation verify`.
- **GitHub's releases.** "Only users with push access will receive listings for draft releases." (`docs.github.com/en/rest/releases/releases`). Immutable releases, generally available since 2025-10-28, a repository setting (`docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases`): the tag "is locked to a specific commit, cannot be changed, and cannot be deleted while the release exists"; "All files attached to the release (such as binaries and archives) are protected from modification or deletion."; the title and the notes stay editable; "creating an immutable release automatically generates a release attestation"; and the recommended flow, "Create the release as a draft. Attach all associated assets to the draft release. Publish the draft release."
- **GitHub Actions.** "Once a workflow has run at least once, you can dispatch it against any branch or tag via the GitHub API or GitHub CLI." (`docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows`). Of an environment: "Selected branches and tags: Only branches and tags that match your specified name patterns can deploy to the environment."; required reviewers are available for public repositories on the Free plan, and "Only one of the required reviewers needs to approve the job for it to proceed." (`docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`). Of a job run again: jobs not run again "keep their outputs from the previous attempt"; that a job run again finds the files the first attempt uploaded is not stated (`docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs`).
- **Spectra's CI**, `.github/workflows/ci.yml`: the `ci` job on Linux x64, with the version check, the Python checks, lint, the format check, the tests under Node and the libraries' packing command with its check; the Mac job that builds the five binaries and makes and checks the binary's packages; the binary test run on the four POSIX platforms; the binary test run on Windows x64. The last three runs took 13 min 49 s to 15 min 22 s. No package and no pack is uploaded.
- **The libraries' packs.** The packing command's check, `tools/spectra/scripts/check_libraries.mjs`, compares every file of every pack with the build's or the repo's file, byte for byte, a `.d.ts` file's declaration-map comment removed, and installs and loads each pack outside the workspace. The tests under Node run in the same job on the same build.
- **What a release publishes.** Eleven npm packages: the launcher `a2ui-spectra`, the five platform packages, the preview core, the three preview adapters and the TypeScript wrapper. Seven files on PyPI: the five wheels of `a2ui-spectra`, and the Python wrapper's wheel and sdist. On GitHub, the five archives and `checksums.txt`. The launcher pins its five platform packages to the exact version, and each adapter pins the preview core exactly.
- **Spectra's repo.** It holds no `CHANGELOG.md`. The preview protocol's version is one constant in the preview core, `typescript/preview/core/src/protocol.ts`. `@a2ui/web_core`, `@a2ui/react` and `@a2ui/markdown-it`, compiled into the binary, are patched locally to the pin, as `_dev/upstream-pin.json` records; the third-party notices are built from what the tool's build, the viewer's build and the basic preview's build each report they bundled.

## Scope

- The release workflow: what it takes, where it may be dispatched from, what it runs, what it refuses, and what a real run publishes and in which order.
- Its dry run.
- A real run that fails after its first publish.
- The provenance each published file carries.
- The root `CHANGELOG.md` and the release notes.
- The npm placeholders and their command.
- The procedure for the steps done by hand.
- The Phase 10 spec, SPEC.md, `_dev/TODO.md` and the tool's README, brought in line.

Out of scope: publishing anything; the npm and PyPI accounts, the trusted publishers, the `release` environment, the immutable releases setting and the placeholders, made for real, Phase 11's; the install check, its installs on the five platforms and the operating-system warning fact, sub-task 10.7; the wrappers' OpenTelemetry versions, sub-task 10.13; the root README's install text, sub-task 10.9.

## Locked decisions

### 1. The version input

The version input is a confirmation. It must equal the committed version, on a dry run and a real run alike, and the run fails at its first step otherwise. The version changes only through a `set:version` commit on `main`.

### 2. The ref

A real run is refused unless it was dispatched from `main`. A dry run starts from any ref.

### 3. What the workflow runs

The release workflow runs everything CI runs, on the commit it was dispatched on, from one definition shared with CI. Every publishing job waits for all of it.

### 4. The libraries' packs

The libraries' packs are tested by the packing command's check alone, as CI runs it. The smoke check on the published renderers and the smoke check on the published agent SDKs stay by hand, as a step before a real run.

### 5. The tag

The workflow creates the tag `v<version>`, on a real run only, at the commit the run was dispatched on. The tag appears when the draft release is published, at the end of the run. A dry run makes no tag. A real run refuses at its first step when the tag or a release of that version already exists.

### 6. A new npm name's first publish

The first publish of a new npm package name cannot go through trusted publishing: a trusted publisher is configured on a package that already exists. Each of the eleven npm names is created by hand on the release day with a placeholder version, its trusted publisher is then configured, and `0.1.0` goes through the workflow under trusted publishing, with provenance. The workflow has no path for a missing name.

### 7. The placeholders

A placeholder is a pre-release version below `0.1.0`, holding a manifest, the licence and a README that says the first release is on its way and names the repository. One command in the repo makes all eleven. After `0.1.0` is public, each placeholder version is deprecated with a message naming `0.1.0`.

### 8. Direct publishing on npm

The workflow publishes to npm directly, not through staged publishing, and each of the eleven trusted publishers allows it. The five platform packages are published before the launcher, and the preview core before the adapters.

### 9. The order of a real run

A real run creates a draft release holding the five archives, `checksums.txt` and the notes, and attests the files. It then publishes to PyPI and to npm. Last, it publishes the draft, which is when the tag and the release become public. The order between PyPI and npm is not fixed.

### 10. A real run that fails after its first publish

A real run is resumable. Before each publish, the step asks the registry whether that version is already there: it skips the file when the registry's copy has the same checksum as the run's file, and fails when the checksum differs. After a failure, the failed job is run again in the same run, from the same uploaded files, and finishes the release; nothing is rebuilt.

When a published file itself turns out wrong, the version is abandoned: the cause is fixed, the version moves to the next patch number and a new run publishes everything, and the abandoned version is deprecated on npm and yanked on PyPI.

That a job run again finds the files the first attempt uploaded is established in this sub-task, by running a job again in a dry run.

### 11. The provenance each channel carries

Each channel carries its own. GitHub's attestation covers the five archives, named through `checksums.txt`. The eleven npm packages carry npm's provenance. The seven PyPI files carry PyPI's attestations, and the PyPI publishing step uses the tool that produces them.

### 12. No unpublished upstream code

A real run refuses, before its publishing stage, when any npm package bundled into the binary resolves to a local patch, and names the packages. The list comes from what the builds report they bundled. A dry run prints the same finding and goes on.

### 13. The environment

The real run's publishing jobs run in one GitHub environment that only `main` may deploy to, with no required reviewer. Each of the thirteen trusted publishers, eleven on npm and two on PyPI, names it. The dry run's publishing job does not use the environment.

### 14. The two names

The workflow's file is `release.yml` and the environment is named `release`. The publishing jobs sit in the release workflow's own file, not in a workflow it calls; the build and the tests may be called workflows shared with CI.

### 15. The jobs that hold the release's permissions

The jobs that hold the release's permissions, the identity token the registries trust, write access to the repository's contents, the permission to write attestations and the `release` environment, download the run's files and publish them, and do nothing else: no workspace install, no build, no test and no stand-in. The dry run's publishing job is a separate job that holds none of those permissions and no environment.

### 16. Immutable releases

The repository's releases are immutable. The setting is switched on once, by hand, before the first release, in Phase 11.

### 17. The dry run at the publishing stage

A dry run starts a stand-in npm registry and a stand-in Python index on its publishing job's runner and runs the same publishing steps as a real run, in the same order, with the same already-there check; the registry's address and the credential alone differ. The placeholders' command runs against the stand-in npm registry first, so that `0.1.0` is published over placeholders. The dry run attests nothing and exchanges nothing with npm or PyPI.

### 18. The dry run and GitHub

A dry run touches nothing on GitHub: no tag, no draft and no attestation. It extracts the notes and prints them in the run's summary, and the archives and `checksums.txt` are among the files uploaded to the run. Its jobs hold no write permission on the repository.

### 19. The changelog

One root `CHANGELOG.md` for all seven packages, in upstream's shape: a `## Unreleased` section, then one `## <version>` section per release. The version's section is written by hand in the commit that sets the version. The workflow takes the notes from that section, and a missing or empty one fails the run at its first step, on a dry run and a real run alike. This sub-task creates the file with its `## 0.1.0` section.

### 20. The preview protocol in the release notes

The workflow adds to the release notes the preview protocol version the release speaks and, when it differs from the previous release's, that it changed and that preview pages need this release's adapters. The GitHub release's notes are the changelog's section and those generated lines.

### 21. The procedure for the steps done by hand

`_dev/release-procedure.md`, beside the re-pin procedure, written in this sub-task and first carried out in Phase 11. It covers:

- once, before the first release: the npm and PyPI accounts, with two-factor authentication; the `release` environment held to `main`; immutable releases switched on; the eleven npm placeholders; their trusted publishers, each naming `release.yml` and `release` and allowing direct publishing, made within two days of the run; PyPI's two pending publishers;
- before each release: the upstream check; the two smoke checks; the commit that sets the version and writes the changelog's section; a dry run;
- the real run, and what to read when it ends;
- when a run fails: the failed job run again; and when a published file is itself wrong, the version abandoned, deprecated on npm and yanked on PyPI.

### 22. The operating-system warning fact

That an install through `npx`, `uvx` or the install scripts meets no operating-system warning is established in sub-task 10.7, the install check, and how is that sub-task's.

### 23. Done

Sub-task 10.6 is done when, with no test skipped or marked:

- a dry run dispatched on `main` passes: everything CI runs; the binary's packages and the libraries' packs uploaded to the run; the eleven placeholders, then the eleven npm packages and the seven PyPI files, published into the stand-ins in the order of decisions 8 and 9; the notes from `## 0.1.0`, with the generated preview protocol lines, in the run's summary; the three locally patched packages reported; no tag, no draft, no attestation and nothing public;
- within that run, a second pass of the publishing steps skips every file as already there with the same checksum, and the dry run's publishing job, run again alone, finds the first attempt's files;
- the first step's refusals, the refusal of decision 12 and the publishing steps' refusal of a file already there with a different checksum are each covered by a test that runs in CI, outside any real run;
- `CHANGELOG.md` and `_dev/release-procedure.md` are written;
- CI passes from the shared definition.

The done line states that the draft, the attestation, the trusted publishing exchange and the draft's publication first run in Phase 11.

### 24. The documents brought in line

- The Phase 10 spec's decision 6, no package name is held before the release: the npm names are taken at the release by a placeholder.
- The Phase 10 spec's decision 9, the release workflow: a new npm name's first publish cannot go through trusted publishing.
- The Phase 10 spec's decision 17, no paid signing: sub-task 10.7 establishes the operating-system warning fact.
- The Phase 10 spec's decision 20, Phase 11: the steps done once by hand, the `release` environment, immutable releases, the placeholders with their trusted publishers, PyPI's pending publishers, and the placeholders' deprecation.
- `_dev/TODO.md`: the 10.6 line names this spec; the 10.7 line gains the operating-system warning fact and that the install check reuses the dry run's stand-ins; Phase 11's paragraph gains the placeholders.
- The tool's README, `tools/spectra/README.md`: the placeholders' command, and how a dry run is started.
- SPEC.md's "Distribution and names": the npm packages and the PyPI files carry their registries' own provenance, and a published GitHub release is immutable.

## Invariants

- Nothing is published.
- The files a release publishes are the files its tests ran against.
- A dry run holds no write access to the repository and leaves nothing behind in it.
- The tag names a commit whose files passed.
- The release page never names a version a registry lacks.
- No Spectra artifact ships upstream code that upstream has not released.
