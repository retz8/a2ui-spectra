# The re-pin procedure

The upstream check and the pin's move. The pin is the commit of `a2ui-project/a2ui` that Spectra takes from upstream: the copied protocol schemas and catalog definitions, the copied conformance catalogs, the `a2ui-upstream` worktree the samples run in, the upstream packages Spectra builds against, and the API the wrappers are written against.

## The pin file

[`upstream-pin.json`](upstream-pin.json), read by the scripts and written by them:

- `pin`: the commit and its date;
- `copies`: each copied file, its upstream path and its place in Spectra; a copy that is not an unchanged copy carries `alterations`, each a JSON merge patch (RFC 7386) with the number of its finding in `a2ui-findings.md`;
- `packages`: each upstream package Spectra uses, on npm or PyPI, and its `patch` when it is patched locally to the pin: a tarball under `vendor/a2ui/`, or a uv git source in the root `pyproject.toml`;
- `watch`: the upstream issues and pull requests the check reads;
- `heldBy`: the findings Spectra is held by, each with the upstream paths whose change would be its fix.

The scripts, from the repository root:

| Script                                         | What it does                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node _dev/tools/upstream_check.mjs`           | Fetches `upstream` in `../A2UI` and prints what happened since the pin. It decides nothing.                                                                                                 |
| `node _dev/tools/upstream_move.mjs <commit>`   | Copies every listed file from a commit on upstream main, applies each copy's alterations and prints each one applied, verifies every copy, writes the uv git sources' commit and the new pin. |
| `node _dev/tools/build_upstream_tarballs.mjs`  | Builds each npm package patched by tarball in the `a2ui-upstream` worktree at the pin, through the package's own publish preparation, and points the root `resolutions` and the pin file at each tarball. |
| `node _dev/tools/smoke_published_renderers.mjs` | The smoke check on the published renderers, under [its heading](#the-smoke-check-on-the-published-renderers). |

## The check

At the start of each sub-task and each phase, and before an acceptance run.

1. Run `node _dev/tools/upstream_check.mjs`. It prints `upstream/main`'s commit and date and:
   1. the commits since the pin, as a count and a list per area Spectra uses;
   2. each copied file, unchanged or differing between the pin and `upstream/main`;
   3. each upstream package's published latest on npm and PyPI, with its date, beside the version Spectra has and the version the pin's source states, the locally patched ones flagged;
   4. `specification/versions.json` at `upstream/main`, each version's status, with a change from the pin marked: a new version, or a supported version (v0.9, v0.9.1, v1.0) moved to `deprecated`;
   5. the watch list, each item open, merged or closed;

   and the commits since the pin that touch each held-by finding's upstream paths.
2. Judge which event has happened. The pin moves, or a local patch gives way, on three events only:
   - **npm or PyPI carries a new release of a package Spectra uses**, in reading 3. That package's local patch is removed and the published release is used, under [Removing a local patch](#removing-a-local-patch). The release must carry the pin's state; one that is behind it leaves the patch in place.
   - **A pull request that changes the v1.0 wire format is merged**: a watch-list item merged, or a commit under `specification/` in reading 1 or a copied file differing in reading 2 that changes the v1.0 messages. The pin moves.
   - **A bug in upstream that Spectra is held by is fixed**: read each commit listed under a held-by finding and judge whether it is the fix. The pin moves.

   A supported version moved to `deprecated` in reading 4 is the signal to deprecate it in Spectra; what Spectra then does is decided in the phase that meets it.
3. The spec written at the sub-task's or the phase's start opens with what the check read: `upstream/main`'s commit and date, and which event it found or that it found none. An event adds to the phase the sub-task that handles it.

## The smoke check on the published renderers

`node _dev/tools/smoke_published_renderers.mjs`, from the repository root after `yarn build:all`, by hand, with Playwright's Chromium installed and the sample pages' ports, 9831 to 9833, free. It exits non-zero on a failure; CI does not run it.

It builds the React, Lit and Angular sample pages, `samples/preview/`, in a scratch project outside the workspace, as an adopter has them: Spectra's preview core and adapters packed from the repository, the pages' sources beside them, and the renderers and web core from npm at their latest, installed with Yarn. The repository's install and lockfile are left as they are. Spectra, built from the repository on the pin's web core, attaches to the stub agent's canned conversation and uses each page. For each page: it loads and answers Spectra with the catalogs it claims; the sample catalog's v0.9.1 surface is drawn; the page reports no error; one press comes back as the action. No v1.0 envelope key is involved. The run prints the versions it resolved.

It runs:

- at the check, when reading 3 shows a new npm release of `@a2ui/react`, `@a2ui/lit`, `@a2ui/angular` or `@a2ui/web_core`;
- at the close of sub-task 9.4;
- at an acceptance run.

## The move

On an event that moves the pin, to a commit on `upstream/main`, normally its head.

1. **A held-by finding fixed at the new commit.** Delete its alteration from the pin file before the move, so that its altered copy becomes an unchanged copy. A workaround in code or a test expectation is left in place and listed in the move's outcome under the sub-task that owns the area.
2. **The copies.** Run `node _dev/tools/upstream_move.mjs <commit>`. It refuses a commit that is not on `upstream/main`, and leaves the pin as it was when a listed file is missing at the commit or a copy does not verify. An alteration that changes nothing at the commit is printed as such: upstream carries it, and the alteration is deleted from the pin file.
3. **The worktree**, `../a2ui-upstream`, detached at the new pin:
   1. `git -C ../a2ui-upstream checkout --detach <commit>`.
   2. In the worktree, `uv sync --all-packages --locked`, then the Python wrapper and the OpenTelemetry set beside the samples installed again, since the sync removes them: `uv pip install --python .venv/bin/python -e ../a2ui-spectra/python/a2ui_spectra_instrumentation opentelemetry-distro opentelemetry-exporter-otlp-proto-http`, and the instrumentations `opentelemetry-bootstrap -a requirements` lists for the venv.
   3. In the worktree, `yarn install`, with the TypeScript wrapper's install, `node_modules/a2ui-spectra-instrumentation`, moved out before it and back after.
   4. The three core samples, the Python restaurant finder, the Node restaurant finder and the custom-components example, each started as its README says, its agent card fetched from `/.well-known/agent-card.json`, and stopped. No message is sent.
   5. The workspace-level `CLAUDE.md`, one folder up, names the new pin in its line on `a2ui-upstream`, by hand.
4. **The local patches.**
   - npm: `node _dev/tools/build_upstream_tarballs.mjs`, then `yarn install`.
   - PyPI: `uv lock`, then `uv sync --all-packages --locked`; the move wrote the new commit into the uv git sources.
   - A package whose published release now carries the pin's state has its patch removed, under [Removing a local patch](#removing-a-local-patch).
5. **The findings.** Each finding in `a2ui-findings.md` is read again at the new pin, and its standing line written in the file: it holds at the pin; it is fixed upstream, with the commit and the pull request; or it is changed, with what differs now. A standing is established by reading the finding's component paths at the pin and, where the finding has a reproduction runnable without a model key or a running sample, by running it against the worktree. A fixed finding stays in the file with its number. A finding Spectra carries something for, a workaround in code, an altered copy or a test expectation that encodes the bug, gets its held-by line saying what Spectra carries and where, and is listed in the pin file's `heldBy` with its upstream paths. The file's header names the pin.
6. **The suites.** Everything `.github/workflows/ci.yml` runs, from a clean build: `yarn clean:all`, then `WIREIT_CACHE=none yarn build:all`, since `tsc -b` does not see a package changed under `node_modules`; the binary; lint, format, `pyink`, `mypy`, `pytest`; `yarn test:all`; and the tool's tests against the binary.
   - A case that fails at the new pin is marked expected-to-fail with the sub-task that owns it, under [The expected-to-fail mark](#the-expected-to-fail-mark).
   - A break of the build, a type check or lint, in TypeScript or in Python, gets the smallest change that builds and passes, listed under the sub-task that owns the area; its behaviour stays that sub-task's. A change that is more than mechanical, such as an API that is gone with no direct replacement, is brought to Jioh before it is made.
7. **The outcome**, in the spec of the sub-task that made the move: per owning sub-task, the marked cases, the mechanical build changes, and any workaround or test expectation whose finding is now fixed.

### Removing a local patch

- npm: delete the package's `resolutions` line in the root `package.json` and its tarball under `vendor/a2ui/`, set its `patch` to `null` in the pin file, and run `yarn install`.
- PyPI: delete the package's source line in the root `pyproject.toml`, set its `patch` to `null` in the pin file, give the Python driver's dependency in `conformance/wrapper_driver/python/pyproject.toml` the release's version, and run `uv lock`.

## The expected-to-fail mark

Each runner's own mark, under which the case still runs: Node's test runner's `todo`, pytest's `xfail` with `strict=True`, Playwright's `test.fail`; a wrapper capture case in `conformance/wrapper_capture/` carries `expected_to_fail`, a reason per language, which its harness runs as `todo`. A YAML case is marked at the smallest unit its harness can mark.

The reason starts with the owning sub-task in one fixed form, `Sub-task N.M, at the pin: `, followed by why the case fails. Each sub-task removes its own marks. Every mark:

```
grep -rnE "Sub-task [0-9]+\.[0-9]+, at the pin: " --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=_dev .
```

One sub-task's marks: the same search for `Sub-task 9.5, at the pin: `. The acceptance run requires the search to be empty.
