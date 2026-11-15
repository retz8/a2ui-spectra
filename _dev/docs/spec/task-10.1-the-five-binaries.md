# Sub-task 10.1 — The five binaries, and CI on the four POSIX platforms

The binary built for macOS arm64, macOS x64, Linux x64, Linux arm64 and Windows x64, and the binary test run on macOS arm64, macOS x64, Linux x64 and Linux arm64 on every push and pull request. Sub-task 10.1 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 7, that `0.1.0` ships a binary for those five platforms, and, for the four POSIX platforms, its decision 8, that on every push and pull request each platform's runner runs the tool's test target against that platform's binary, with lint, the format check, the Python checks and the tests run under Node staying on Linux x64 alone.

The upstream check at this sub-task's start, on 2026-11-15, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, and found no event: no commit in an area Spectra uses, every copied file unchanged, no new release on npm or PyPI, `specification/versions.json` unchanged, the five watch-list items open, and no commit touching a held-by finding's paths.

The build and its surroundings before the sub-task, as read and measured on 2026-11-15:

- **Spectra's build and CI.** The tool's `build:binary` builds the host's binary alone, into `dist/a2ui-spectra`, with Bun pinned exactly at 1.4.4. CI is one job on `ubuntu-latest`, which builds that binary and runs the tool's test target against it. The tool's test target has run on Linux x64, in CI, and on macOS arm64, on the development machine, and nowhere else.
- **Cross-compilation.** Bun's documentation lists all five platforms among its cross-compilation targets (`bun.com/docs/compiler/executables`). On macOS arm64, Bun 1.4.4 compiled the tool for each of the other four.
- **The x64 runtime.** Bun 1.4.x has one x64 runtime: "On x64, Bun ships a single binary that targets Nehalem (SSE4.2) and selects AVX2/AVX-512 code paths at runtime" (the same page).
- **The macOS signatures.** Bun's source at tag `bun-v1.4.4` (`src/exe_format/macho.rs`) gives an arm64 macOS target an ad-hoc signature on any host, and never signs an x64 macOS target. Measured on macOS arm64: the host's binary carries a valid ad-hoc signature; the macOS x64 binary cross-compiled there carries Bun's own signature, which `codesign` reports as invalid; an ad-hoc signature put on it by `codesign` verifies. The signed macOS x64 binary has not been run.
- **The host's binary and the macOS arm64 binary.** On macOS arm64, the binary built for the explicit macOS arm64 target and the host's binary have the same SHA-256.
- **The runtimes.** Bun fetches each target's runtime at build time from the npm registry, as the package `@oven/bun-<target>` at its own version (`src/options_types/compile_target.rs`); no integrity check was found in what was read of the download. Bun's `--compile-executable-path` takes a runtime file in place of the download. `yarn.lock` holds a checksum for no `@oven/bun-*` package, the host's included. The npm registry publishes a `dist.integrity` value for each of `@oven/bun-darwin-aarch64`, `@oven/bun-darwin-x64`, `@oven/bun-linux-x64`, `@oven/bun-linux-aarch64` and `@oven/bun-windows-x64` at 1.4.4.
- **Upstream's `a2ui` CLI.** Upstream's `release-cli-binaries.yml` at the pin builds each of its five binaries on its own platform's runner, `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-15-intel`, `macos-latest` and `windows-latest`; its compile tool's target "must match host target" (`dart/a2ui_cli/tool/compile.dart`). It names its targets `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64` and `windows-x64` and its files `a2ui-<target>`, with `.exe` on Windows, and checks each binary it builds by its `--version`.
- **GitHub's runners.** `ubuntu-latest` is Ubuntu 24.04, `macos-latest` is macOS 26 on arm64 and `windows-latest` is Windows Server 2025; Linux arm64 has no `-latest` label; `macos-15-intel` is announced as available until August 2027 (GitHub's runner reference and the `actions/runner-images` repository). Standard runners are free for a public repository, which this one is.

## Scope

- The build of the five binaries: its host, the runtimes it embeds and their check, and the macOS signatures.
- CI on every push and pull request: the build, the binary test run on the four POSIX platforms, and the Windows x64 binary's start check.
- The tool's test target passing on the four POSIX platforms.
- The Phase 10 spec's decision 17, brought in line.

Out of scope: Spectra working on Windows and the binary test run on a Windows runner, sub-task 10.2; the name of the Windows npm package, sub-task 10.3; that an install through `npx`, `uvx` or the install scripts meets no operating-system warning, sub-task 10.6; the minimum operating-system versions a README states, sub-task 10.9.

## Locked decisions

### 1. One build, cross-compiled

One build produces all five binaries by cross-compilation, from one build of the viewer and one bundling of the tool.

### 2. The build runs on a Mac and signs

The build runs on macOS. Bun ad-hoc signs the macOS arm64 binary. The build ad-hoc signs the macOS x64 binary with Apple's `codesign`, as one of its steps. The build confirms both macOS signatures before it hands the files on.

### 3. The runtimes are checked

The repo holds npm's published integrity value of each of the five runtime packages at the pinned Bun version. The build fetches the five packages itself, checks each against the repo's value, and gives its runtime to Bun. A package that does not match fails the build.

### 4. The platforms' names

The five platforms are named as upstream names them: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64` and `windows-x64`. The files are named `a2ui-spectra-<name>`, with `.exe` on Windows. The name of the Windows npm package is sub-task 10.3's.

### 5. `build:binary` stays the host's binary

`yarn build:binary` stays the host's binary at `dist/a2ui-spectra`. The five are built by a command of their own.

### 6. Every push tests the Mac build's own files

On every push and pull request one job builds the five, and each platform's job fetches its own file from that job and runs the tool's test target against it.

### 7. The runners

Upstream's five labels, with the build on `macos-latest`.

| Platform | Runner |
| --- | --- |
| macOS arm64 | `macos-latest` |
| macOS x64 | `macos-15-intel` |
| Linux x64 | `ubuntu-latest` |
| Linux arm64 | `ubuntu-24.04-arm` |
| Windows x64 | `windows-latest` |

### 8. The Windows x64 binary's start check

A job on `windows-latest` fetches the Windows x64 binary and runs `a2ui-spectra --version`, nothing more. Sub-task 10.2 replaces the job with the binary test run.

### 9. No skip and no mark

Sub-task 10.1 is done when every test of the tool's test target passes on all four POSIX platforms, against the Mac-built binary. A failure is fixed in this sub-task, in Spectra's code or in the test. One that cannot be fixed within Spectra, a fault in Bun or in a runner image, is brought to Jioh before anything is done about it.

### 10. The Phase 10 spec's decision 17

The second paragraph of the Phase 10 spec's decision 17, "No paid signing", keeps its first fact, that an install through `npx`, `uvx` or the install scripts meets no operating-system warning, for the release workflow's sub-task. Its second fact, whether a macOS binary Bun compiles on a Linux runner carries the ad-hoc signature, is removed, with nothing added in its place.
