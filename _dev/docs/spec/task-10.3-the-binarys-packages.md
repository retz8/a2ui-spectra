# Sub-task 10.3 — The binary's packages

The binary packaged for npm, PyPI and GitHub releases: the npm launcher with one package per platform, the wheel per platform, the release archives with their checksums, and the third-party notices file in each. Sub-task 10.3 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out, for the binary, SPEC.md's "Distribution and names", the Phase 10 spec's decision 15, the licence material a release carries, and its decision 18, the platform packages' names. Nothing is published.

The upstream check at this sub-task's start, on 2026-11-15, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, and found no event: no commit in an area Spectra uses, every copied file unchanged, no new release on npm or PyPI, `specification/versions.json` unchanged, the five watch-list items open, and no commit touching a held-by finding's paths.

The binaries, the registries and the tools Spectra ships as, as read and measured on 2026-11-15:

- **The five binaries.** 94.5 MB for macOS arm64, 103.5 MB for macOS x64, 114.4 MB for Linux x64, 114.5 MB for Linux arm64 and 120.6 MB for Windows x64; under `gzip -9`, 43.3 MB, 45.8 MB, 54.2 MB, 54.1 MB and 57.0 MB, 254 MB together. The Linux binaries name glibc's loader as their interpreter and need glibc 2.17 at most; both macOS binaries state a minimum of macOS 13.0. Bun's documentation states the same floors, "Bun requires macOS 13.0 or later" and "Bun's glibc binaries require glibc 2.17 or newer", and "Windows 10 version 1809 or later" (`bun.com/docs/installation`). The Linux binaries have not been run on musl, and the Windows binary has run on x64 alone.
- **The source map.** "The `--sourcemap` argument embeds a sourcemap compressed with zstd" (`bun.com/docs/compiler/executables`); the build also writes a `.map` file beside each binary.
- **Biome 2.6.7 on npm.** The launcher `@biomejs/biome` is a Node script with ten `optionalDependencies` pinned to the exact version and no install script. It runs the platform's binary with `spawnSync` and, where it finds none, prints one message and exits 1. Each platform package holds the binary at its root, with `os` and `cpu`, and `libc` on Linux, and no README. Its Windows packages are named `win32`.
- **Turborepo 2.11.11, workerd 1.20261115.1 and esbuild 0.28.2 on npm.** Turborepo and workerd name their Windows packages `windows`. Turborepo's launcher stays until the binary has ended, passes SIGTERM and SIGHUP on, does not pass SIGINT on, and marks the binary's environment so that a signal arriving twice is counted once. Workerd has a `postinstall` script and falls back to a downloaded binary; Turborepo's launcher runs `npm install` for a missing platform package. The platform packages of esbuild and Turborepo set `"preferUnplugged": true`; Biome's set nothing.
- **A Node launcher on a stop**, measured on Node 22.15.0 against a child that takes 2 seconds to stop. Under `spawnSync`, a SIGTERM sent to the launcher ends the launcher at once and never reaches the child, and a SIGINT sent to the launcher's process group ends the launcher 2 seconds before the child has stopped. A launcher that passes every signal on gives the child a SIGINT sent to the group twice. The tool's README says of Spectra's stop, "A second Ctrl-C forces it at once."
- **Ruff 0.17.5 on PyPI.** A wheel per platform, built by maturin, tagged `py3-none-<platform>`: the binary at `ruff-0.17.5.data/scripts/ruff`, a small `ruff` Python module, and the licence under `dist-info/licenses/`. Its Linux wheels carry both forms of the glibc 2.17 tag, `manylinux_2_17_x86_64.manylinux2014_x86_64`. It publishes an sdist, and its wheel states `MIT` as its licence.
- **A trial wheel.** Hatchling 1.33.0 through `uv build`, on macOS arm64, built a wheel around the macOS arm64 binary, 43.4 MB, the binary inside with the built binary's SHA-256, and `uvx` ran `a2ui-spectra --version` from it; the same setup built a Linux x64 wheel, 54.3 MB, and a Windows x64 wheel, 57.2 MB, each with the tag it was given. Neither of those two was installed.
- **The wheel tags.** `macosx_{x}_{y}_{arch}` indicates "that the wheel is compatible with macOS `x.y` or later", and "for macOS 11 and higher, the tag is `macosx_{x}_0_{arch}`"; `manylinux_{x}_{y}_{arch}` names the glibc version supported (`packaging.python.org/en/latest/specifications/platform-compatibility-tags/`).
- **PyPI's limits.** "By default, PyPI limits the size of individual files to 100.0 MB" and "the total size of all files in a project to 10.0 GB" (`docs.pypi.org/project-management/storage-limits/`). Five wheels of 254 MB together reach the project limit after about 39 releases.
- **npm's fields.** `os`: "The host operating system is determined by `process.platform`". `libc`: "This field only applies if `os` is `linux`"; it is on npm 11's page and not on the pages of npm 8, 9 and 10, and the npm version that first honoured it was not found (`docs.npmjs.com/cli/v11/configuring-npm/package-json`). No limit on a package's size was found in npm's documentation.
- **Upstream's `a2ui` CLI release**, at the pin (`.github/workflows/release-cli-binaries.yml`, `scripts/public/install_cli.sh` and `install_cli.ps1`). Per platform, an archive `a2ui-v<version>-<target>.tar.gz`, `.zip` on Windows, flat, holding the binary as `a2ui`, `LICENSE` and `README.md`, and the raw binary `a2ui-<target>` beside it "for direct curl / updater download"; one `checksums.txt` written by `sha256sum *`. The install scripts download the archive, find its name in `checksums.txt` and expect the binary at the archive's top level. The PowerShell script accepts an ARM64 host and installs the x64 binary. Upstream holds no notices file.
- **What the binary bundles.** The tool's own source, its tests left out, imports `@a2ui/web_core`, `@bufbuild/protobuf` and `ajv`, and `tools/spectra/package.json` lists `ajv` under `devDependencies`. Bun 1.4.4's `bun build` has `--metafile`, "a JSON file with metadata about the build"; the viewer and the built-in basic preview are built by Vite. The viewer's fonts are npm packages. Outside any npm package, the binary holds upstream's copied schemas and catalogs, the `copies` of `_dev/upstream-pin.json`; code generated from OpenTelemetry's proto files, `tools/spectra/proto/`, Apache 2.0; and LiteLLM's price table, `tools/spectra/src/prices/`, with its `NOTICE`.
- **Bun's licence statement.** The runtime package `@oven/bun-darwin-aarch64@1.4.4` holds the binary, a `package.json` and a README, and no licence file. Bun's `LICENSE.md` at tag `bun-v1.4.4` states that Bun is MIT-licensed, that it statically links JavaScriptCore and WebKit under LGPL-2, with the relinking steps, and lists the libraries it links, each with its licence's name and a link, `tinycc` under LGPL v2.1 among them; it holds no licence text and no copyright line of a linked library. No reference was found that settles whether naming a linked library's licence, without its text, meets that licence.
- **Node's releases.** Node 20 ended on 2026-04-30; Node 22, maintained until 2027-04-30, Node 24 and Node 26 are the maintained lines (`nodejs/Release`, `schedule.json`). Spectra's CI runs Node 22.
- **Spectra's version.** A literal in `tools/spectra/src/version.ts`, which `a2ui-spectra --version` prints, and again in each `package.json`. The tool's workspace package is named `a2ui-spectra` and marked private.

## Scope

- The npm launcher package and the five npm platform packages.
- The five wheels.
- The five release archives and `checksums.txt`.
- The third-party notices file, and the licence each package carries.
- The command that makes them, and its run in CI.
- The Phase 10 spec's decision 18 and `_dev/TODO.md`, brought in line.

Out of scope: publishing anything; the install scripts, sub-task 10.5; the release workflow, its upload of the packages, its trusted publishing and attestation, and what it does with its version input, sub-task 10.6; an adopter's install on the other four platforms, sub-task 10.7; where the one version is set, sub-task 10.4; what the tool's README says, sub-task 10.9.

## Locked decisions

### 1. One packaging command, on the Mac

One command makes every package: the six npm packages, the five wheels, the five release archives and `checksums.txt`. It runs on macOS, after the five binaries are built. CI runs it on every push and pull request. The packages are uploaded as artifacts by the release workflow alone.

### 2. The npm packages' names

The launcher is `a2ui-spectra`. The platform packages are `a2ui-spectra-darwin-arm64`, `a2ui-spectra-darwin-x64`, `a2ui-spectra-linux-x64`, `a2ui-spectra-linux-arm64` and `a2ui-spectra-windows-x64`, the platforms' names of the 10.1 spec's decision 4. Each states its `os` and `cpu`, the Windows package's `os` being `win32`.

### 3. The npm launcher

The launcher is a Node script with no install script, the five platform packages its `optionalDependencies`. It stays until the binary has ended, and exits with the binary's exit code, or by the signal that ended it. It passes SIGTERM and SIGHUP on to the binary. It holds Ctrl-C without passing it on. A stop that reaches the binary both directly and through the launcher counts as one. The launcher takes no setting that names another binary.

### 4. Where there is no binary to run

The launcher refuses with a line that names the case, exits 1 and fetches nothing: on a platform outside the five, the platform found and the five supported; on Linux with musl, that musl is not supported; where the platform's package is missing, that it is missing and how to install it again. The two Linux packages carry `"libc": ["glibc"]`.

### 5. The wheel

One wheel per platform, holding the binary alone, in the scripts folder. No Python module and no sdist.

### 6. The wheel's build and its tags

Each wheel is built by hatchling through `uv build`, once per platform, from one uv project in the repo.

| Platform | Tag |
| --- | --- |
| macOS arm64 | `py3-none-macosx_13_0_arm64` |
| macOS x64 | `py3-none-macosx_13_0_x86_64` |
| Linux x64 | `py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64` |
| Linux arm64 | `py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64` |
| Windows x64 | `py3-none-win_amd64` |

### 7. Windows on arm64

Windows arm64 is not supported in `0.1.0`, on any channel. The npm launcher refuses it as a platform outside the five, and no wheel matches it. The PowerShell install script of sub-task 10.5 refuses it, departing from upstream's on this point.

### 8. The release archives and their checksums

One archive per platform, `a2ui-spectra-v<version>-<platform>.tar.gz`, and `.zip` for Windows x64, flat, the binary in it named `a2ui-spectra`, with `.exe` on Windows. No raw binary is published beside them. `checksums.txt` lists the five archives in `sha256sum`'s format.

### 9. The notices file's packages

The third-party notices file lists every npm package that contributed a file to the binary, as the tool's build, the viewer's build and the basic preview's build each report what they bundled: the package's version, its licence, its licence text, and its `NOTICE` file when it has one, read from the installed package. For a package that ships no licence text, the text is one kept by hand in the repo for that package and version, taken from its source repository. A bundled package with neither fails the build.

### 10. What no bundler reports

A list kept by hand in the repo, appended to the notices file, covers Bun's runtime and what it links, upstream's copied schemas and catalogs, OpenTelemetry's proto files and LiteLLM's price table. Its section on Bun is Bun's `LICENSE.md` at the pinned Bun version's tag, whole and unchanged. The build fails when the list's Bun version differs from the pinned Bun version.

### 11. What each artifact carries

The notices file is named `THIRD_PARTY_NOTICES.md`. One is generated per build, and every artifact of that build carries the same file.

| Artifact | What it holds |
| --- | --- |
| Release archive | the binary, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md` |
| npm platform package | the binary, `LICENSE`, `THIRD_PARTY_NOTICES.md`; no README, and a one-line `description` pointing to `a2ui-spectra` |
| npm launcher package | the launcher script, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md` |
| Wheel | the binary in the scripts folder; `LICENSE` and `THIRD_PARTY_NOTICES.md` under `dist-info/licenses/`; the README as the PyPI page's text |

The README is the tool's own, `tools/spectra/README.md`. No `.map` file goes into any artifact. Each package states `Apache-2.0` as its licence.

### 12. The version

The packaging command takes no version. It reads the version the binary is built with, from where the tool's version is set, and stamps every package and every archive's name with it. The launcher's five `optionalDependencies` are pinned to exactly that version. The version is three numbers; a pre-release version is not provided for.

### 13. The Node versions the launcher states

The launcher's `engines` states `"node": ">=22"`.

### 14. Other package managers

npm and uv are the package managers Spectra states and tests. The five platform packages carry `"preferUnplugged": true`, which no test of this sub-task covers.

### 15. Done

Sub-task 10.3 is done when, with no test skipped or marked:

- on the job that runs the packaging command, every package and archive is checked for all five platforms: it holds exactly the files of decision 11, the binary inside has the built binary's SHA-256 and its executable bit, each wheel's tag and every stated version are right, and `checksums.txt` verifies;
- on that job, its own platform's packages are installed: the launcher and the macOS arm64 package by npm from the built packages, the macOS arm64 wheel by uv, and the macOS arm64 archive extracted, each ending in `a2ui-spectra --version`;
- the launcher's tests pass in the tool's test target on all five platforms, in the binary test run, against each platform's binary laid out as its platform package: the binary found and run, its exit code handed back, the stops of decision 3 and the three refusals of decision 4.

### 16. The documents brought in line

- The Phase 10 spec's decision 18 names the five platform packages.
- `_dev/TODO.md`'s line for sub-task 10.5 says the PowerShell script refuses Windows arm64.
- `_dev/TODO.md`'s backlog gains two lines: installs through pnpm, Yarn and Bun, tested; and Windows arm64 running the Windows x64 binary under emulation, with a binary test run of its own.

## Invariants

- Nothing is published.
- The binary in every package and archive is the built binary, byte for byte.
- The launcher fetches nothing.
- A package never states a version its binary does not print.
