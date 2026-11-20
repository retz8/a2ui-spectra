# Sub-task 10.5 — The install scripts

The shell install script for macOS and Linux and the PowerShell install script for Windows, ported from the install scripts of upstream's `a2ui` CLI, and the suite that runs them. Sub-task 10.5 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 11, the install scripts, and the 10.3 spec's decision 7, Windows on arm64, under SPEC.md's "Distribution and names". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-20, read `upstream/main` at `496df0e76` (2026-11-19), 38 commits after the pin `0888f88b2`, and found one event: PyPI carries a new release of three packages Spectra patches locally to the pin, `a2ui-core` 0.7.0, `a2ui-agent-sdk` 0.12.0 and `a2ui-a2a` 0.4.0, published on 2026-11-17. Their tags sit on `d63fd4306`, a descendant of the pin, 15 commits after it, carrying four commits on those packages beyond the pin; whether the published files match that commit was not read. It found no other event:

- No commit changes the v1.0 messages: the three v1.0 schemas and the v1.0 basic catalog are the same files at the pin and at `upstream/main`.
- No held-by finding is fixed. Finding 44, `@a2ui/markdown-it` 0.2.2 asking for web core `^0.14.0`: upstream's source now prepares `@a2ui/markdown-it` 0.2.3 beside web core 0.16.0, with nothing on npm yet. Finding 47, the v0.9.1 basic catalog's List lacking `listStyle`: the file moved to `catalogs/basic/v0_9_1/catalog.json` with the bug in it, and the pin file's held-by path for it is gone.
- The v0.9 basic catalog, which Spectra copies, moved to `catalogs/basic/v0_9/catalog.json`, its content unchanged; the pin file names its old path twice.
- npm carries no new release. Upstream's source states `@a2ui/web_core`, `@a2ui/react` and `@a2ui/lit` at 0.16.0, `@a2ui/angular` at 0.15.0, `@a2ui/markdown-it` at 0.2.3 and `@a2ui/agent` at 0.2.0.
- `specification/versions.json` is unchanged, and the five watch-list items are open.
- Upstream's two install scripts and their test are unchanged since the pin.

Upstream's scripts, GitHub, PowerShell and Spectra's own repo, as read on 2026-11-20:

- **Upstream's install scripts**, at the pin (`scripts/public/install_cli.sh`, `scripts/public/install_cli.ps1`).
  - Each carries Google's Apache 2.0 header, `Copyright 2024 Google LLC`.
  - Four variables: `A2UI_VERSION`; `A2UI_INSTALL_DIR`; `A2UI_REPO`, an `owner/repo` on github.com; and `A2UI_SKIP_CHECKSUM`, which at `1` skips the verification with a warning. Two error messages name the last: the one for a `checksums.txt` that fails to download, and the one for a machine with neither `sha256sum` nor `shasum`.
  - The latest release is the first entry of GitHub's releases list, read for up to five pages of 100, whose tag starts with `cli-v` and which is neither a draft nor a pre-release. A version is given as `0.1.0`, `v0.1.0` or `cli-v0.1.0`. The shell script's version check passes three dot-separated parts starting with digits, of letters, digits, dots and hyphens; the PowerShell script's passes three numbers and an optional hyphenated suffix.
  - The archive is downloaded with `curl`, and on Windows with `Invoke-WebRequest`, and its SHA-256, from `sha256sum` or else `shasum`, is compared with its line in the release's `checksums.txt`.
  - The binary alone is installed: copied into the install folder under a temporary name and renamed over the old one, the PowerShell script moving a present `.exe` aside first. The rest of the archive is deleted with the temporary folder.
  - On macOS and Linux the architecture is `uname -m`'s. On musl the shell script stops with two lines, the second "Install gcompat ('apk add gcompat') or run the CLI from source with the Dart SDK." When the install folder is not on `PATH` it prints the line to add and edits no file.
  - The PowerShell script reads `PROCESSOR_ARCHITEW6432`, else `PROCESSOR_ARCHITECTURE`, accepts `AMD64` and `ARM64`, and installs the x64 binary on both. It installs into `%LOCALAPPDATA%\Programs\a2ui\bin` and writes that folder into the user's `Path` in the registry, without expanding the entries already there.
- **Upstream's tests of them**, at the pin. `scripts/test_install_cli.sh`, a bash script of twelve cases, puts a stub `curl` and a stub `uname` on `PATH` and runs the shell script as a file under `/bin/sh`, and under `dash` and `bash` where the machine has them. Its cases: an unsupported operating system and an unsupported architecture; a good install with its checksum verified; a checksum mismatch, an archive missing from `checksums.txt`, and a missing `checksums.txt` with and without the bypass; the latest-release lookup, its paging and its failure messages; the version forms accepted and rejected. It has no case for musl. The PowerShell script is parsed for syntax errors under `pwsh` in `.github/workflows/presubmit-lint.yml` and never run. No linter runs on either script.
- **GitHub's releases.** The REST reference's "List releases" section states no order for its results. Under "Get the latest release": "The latest release is the most recent non-prerelease, non-draft release, sorted by the created_at attribute." (`docs.github.com/en/rest/releases/releases`). "The primary rate limit for unauthenticated requests is 60 requests per hour", and such requests "are associated with the originating IP address" (`docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`).
- **GitHub Actions' names for GitHub's two origins.** `GITHUB_SERVER_URL`: "The URL of the GitHub server. For example: `https://github.com`." `GITHUB_API_URL`: "Returns the API URL. For example: `https://api.github.com`." (`docs.github.com/en/actions/reference/workflows-and-actions/variables`).
- **The two PowerShells.** "Windows PowerShell is the version of PowerShell that ships in Windows." (Microsoft Learn, "What is Windows PowerShell?"). PowerShell 7's binary was renamed from `powershell(.exe)` to `pwsh(.exe)` to "support side-by-side installations of Windows PowerShell and PowerShell" (Microsoft Learn, "Differences between Windows PowerShell 5.1 and PowerShell 7.x"). GitHub's `windows-latest` is Windows Server 2025, whose image readme lists PowerShell 7.6.10 and does not list Windows PowerShell (`actions/runner-images`, `images/windows/Windows2025-Readme.md`).
- **The architecture a Windows process reports.** A 64-bit process has `PROCESSOR_ARCHITECTURE` set to `AMD64`, `IA64` or `ARM64`; a 32-bit process has `PROCESSOR_ARCHITECTURE=x86` and `PROCESSOR_ARCHITEW6432` carrying the machine's own (Microsoft Learn, "WOW64 Implementation Details", "Environment Variables"). The page says nothing of an x64 process under emulation on an arm64 machine, and "Windows 11 on Arm supports emulation of both x86 and x64 apps." (Microsoft Learn, "How emulation works on Arm").
- **Spectra's npm launcher.** It refuses by `process.platform` and `process.arch`, what Node itself reports, and its tests prove the refusal of Windows arm64 by pretending to be `win32` `arm64`.
- **Spectra's repo and CI.** `retz8/a2ui-spectra` is public and holds no release. No source file of Spectra carries a licence header, and none is derived from an upstream file. The repo's root has no `scripts/` folder. CI's binary test run runs the tool's test target on each of the five platforms against that platform's binary, the npm launcher's tests among them. The packaging command builds the five release archives and `checksums.txt` on the Mac job alone, where `yarn check:packages` extracts the macOS arm64 archive and runs `--version`. Spectra's Windows testing runs on CI's runner.

## Scope

- The shell install script and the PowerShell install script.
- The suite that runs them, and its run in CI.
- The upstream check reading upstream's install scripts and their test.
- The Phase 10 spec's decision 11 and decision 19, the re-pin procedure and `_dev/TODO.md`, brought in line.

Out of scope: publishing anything; how the install check's stand-in is served and on which runners, sub-task 10.7; the root README's install text, sub-task 10.9; what sub-task 10.14 does with the published Python releases.

## Locked decisions

### 1. A port of upstream's two scripts

The shell script and the PowerShell script are ported from upstream's `scripts/public/install_cli.sh` and `scripts/public/install_cli.ps1` at the pin, `0888f88b2`: upstream's structure and code, changed only by the departures this spec lists. Each keeps Google's Apache 2.0 header and carries a notice that Spectra changed the file, naming the upstream commit it was taken at.

### 2. The paths

`scripts/public/install.sh` and `scripts/public/install.ps1`, served from this repo's `main` on raw GitHub.

### 3. The names

The binary, the archives and the messages say `a2ui-spectra`. The four ported variables are `A2UI_SPECTRA_VERSION`, `A2UI_SPECTRA_INSTALL_DIR`, `A2UI_SPECTRA_REPO` and `A2UI_SPECTRA_SKIP_CHECKSUM`. The default repository is `retz8/a2ui-spectra`. The Windows install folder is `%LOCALAPPDATA%\Programs\a2ui-spectra\bin`. The messages name `scripts/public/install.sh` and `scripts/public/install.ps1`.

### 4. The tag and the version

A release's tag is `v<version>`. A version is given as `0.1.0` or `v0.1.0`.

### 5. The latest release

Upstream's lookup, with its tag filter changed to `v`: the first entry of the releases list, read for up to five pages of 100, whose tag starts with `v` and which is neither a draft nor a pre-release. The list's order, which GitHub's reference does not state, is relied on as upstream's scripts rely on it.

### 6. The two origins

`A2UI_SPECTRA_GITHUB_URL` names the origin the archive and `checksums.txt` are downloaded from, `https://github.com` by default. `A2UI_SPECTRA_GITHUB_API_URL` names the origin the releases list is read from, `https://api.github.com` by default. `A2UI_SPECTRA_REPO` stays beside them.

### 7. The checksum bypass

`A2UI_SPECTRA_SKIP_CHECKSUM=1` skips the verification, with upstream's warning, and the two error messages name it as upstream's do.

### 8. What is installed

The binary alone, as upstream's scripts install it. The archive's `LICENSE`, `THIRD_PARTY_NOTICES.md` and `README.md` are not laid on the adopter's disk. No reference was read that settles whether an installer discarding the notices after extraction meets every bundled licence's terms.

### 9. Windows on arm64

The PowerShell script reads upstream's two variables, `PROCESSOR_ARCHITEW6432`, else `PROCESSOR_ARCHITECTURE`, accepts `AMD64` alone, and refuses Windows arm64. What an x64 PowerShell under emulation on an arm64 machine reports is not established; the npm launcher has the same gap with an x64 Node.

### 10. musl

On Linux with musl the shell script stops with one line, that musl is not supported. Upstream's second line is not carried.

### 11. What stays as upstream's

- The version check, which passes a pre-release-shaped version; Spectra publishes three numbers alone, under the 10.3 spec's decision 12, the version, and such a version finds no archive.
- The tools: `curl` alone, and `sha256sum` or else `shasum`.
- The install, staged under a temporary name and renamed into place.
- `PATH`: on macOS and Linux the line to add is printed and no file is edited; on Windows the folder is written into the user's `Path` through the registry.
- The architecture on macOS and Linux, read from `uname -m`; a shell under Rosetta gets the x64 binary.

### 12. Following upstream's scripts

The upstream check lists the commits since the pin that touch upstream's two install scripts and their test. A change is read at the check and judged there: carried into Spectra's scripts, or recorded as not applying. It is not one of the events that move the pin. The re-pin procedure's move gains a step: the scripts' upstream diff between the old pin and the new is read.

### 13. The suite

One suite in the tool's test target, with one case table for both scripts: upstream's twelve cases, and cases for musl, the Windows arm64 refusal and the two origin variables. Each script reaches a local stand-in over HTTP through the two origin variables. Upstream's bash test is the reference for the cases and is not ported as a file.

### 14. Where the suite runs

In the binary test run, on all five platforms: the shell script on macOS arm64, macOS x64, Linux x64 and Linux arm64, the PowerShell script on Windows x64. Each test archive is built by the test, in the 10.3 spec's shape, from that platform's binary, and a good install ends with the installed binary printing its version.

On the Mac job that runs the packaging command, the shell script installs the macOS arm64 archive the packaging command made, verified against its `checksums.txt`, in place of the extraction `yarn check:packages` does.

### 15. The interpreters

On Windows, every case runs under `powershell.exe` and again under `pwsh.exe`. On the POSIX platforms, every case runs under `/bin/sh`, and the good install also under `dash` and `bash` where the machine has them. A `powershell.exe` missing on the runner is brought to Jioh.

### 16. The form

Every case runs the script piped, as the README's commands do, the stand-in serving the script. The good install also runs the script from a file.

### 17. The user's `Path` on Windows

The script is not changed for the tests. The suite reads the user's `Path` before its Windows cases and writes it back after. Its cases check that an install adds the folder and that a second install into the same folder does not add it twice.

### 18. No linter

No linter is added for either script.

### 19. Sub-task 10.14, the published Python releases

The upstream check's event adds sub-task 10.14 to Phase 10: the local patches of `a2ui-core`, `a2ui-agent-sdk` and `a2ui-a2a` giving way to PyPI's releases, the smoke check on the published agent SDKs, and the documents' statements about those releases. It runs in parallel with 10.5 and before 10.10, the acceptance run.

### 20. Done

Sub-task 10.5 is done when, with no test skipped or marked:

- every case of the suite passes in the binary test run on all five platforms, under the interpreters of decision 15 and in the forms of decision 16;
- on the Mac job, the shell script's install of the packaging command's macOS arm64 archive prints the version.

The done line carries the measured time.

### 21. The documents brought in line

- The Phase 10 spec's decision 11, the install scripts, gains the two paths, the checksum bypass, `A2UI_SPECTRA_REPO` and the two origin variables.
- The Phase 10 spec's decision 19, the sub-tasks, and `_dev/TODO.md` gain sub-task 10.14.
- `_dev/re-pin-procedure.md` says what the upstream check reads of upstream's install scripts, and the move's step for them.
- `_dev/TODO.md`'s line for sub-task 10.5 names this spec.
- SPEC.md is unchanged.

## Invariants

- Nothing is published.
- Each script differs from upstream's, at the commit its notice names, by the departures this spec lists and by nothing else.
