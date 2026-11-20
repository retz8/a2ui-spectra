# Sub-task 10.7 — The install check

The install check: an adopter's install of the binary on all five platforms, through `npx`, `uvx` and the install script, from the stand-in registries the release workflow publishes into and, after a real publish, from the real registries; and what it establishes about the operating system's download warning. Sub-task 10.7 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 10, the rehearsal, and the fact its decision 17, no paid signing, leaves to this sub-task, under SPEC.md's "Distribution and names". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-21, read `upstream/main` at `7edb9b4ac` (2026-11-20), 45 commits after the pin `0888f88b2`, seven after the reading the 10.6 spec opens with, and found no event: npm carries no new release, upstream's commit `5dc1410b3` (2026-11-20) moving its Angular renderer to Angular 22 in source alone; PyPI's releases are the ones sub-task 10.14 took; the three v1.0 schemas and the v1.0 basic catalog are unchanged, `specification/versions.json` is unchanged and the five watch-list items are open; no commit on a held-by finding's paths is its fix; no OpenTelemetry release inside a stated range is newer than the lockfiles resolve; and upstream's two install scripts and their test are unchanged since the pin.

Apple, Microsoft, GitHub, the runner images and Spectra's own repo, as read on 2026-11-21:

- **The mark macOS keys on.**
  - Apple's Launch Services release notes (`developer.apple.com/library/archive/releasenotes/Carbon/RN-LaunchServices/`): "An application quarantines a file simply by assigning values to one or more quarantine properties"; of `LSFileQuarantineEnabled`, "When the value of this key is true, all files created by the application process will be quarantined by OS X."
  - Apple's Technical Note TN2206, archived, revised 2016 (`developer.apple.com/library/archive/technotes/tn2206/`): "Gatekeeper only checks quarantined files the first time they're opened."
  - Apple's Platform Security guide, "Gatekeeper and runtime protection in macOS": "Gatekeeper also requests user approval before opening downloaded software for the first time"; and "by default, all software in macOS is checked for known malicious content the first time it's opened, regardless of how it arrived on the Mac." The page does not use the word quarantine.
  - An Apple engineer's post on the Apple Developer Forums, thread 706442, "Resolving Trusted Execution Problems", not formal documentation. Its page answered a direct fetch with a verification page, and its wording is as a summarising fetcher returned it, the same on two fetches: "Unix-y networking tools, like `curl` and `scp`, don't quarantine the files they download."; "Unix-y unarchiving tools, like `tar` and `unzip`, don't propagate quarantine to the unarchived files."; "The exact circumstances under which it runs Gatekeeper is not documented and changes over time. However, running a quarantined app always invokes Gatekeeper."
  - No page read states whether npm or uv sets the quarantine attribute.
  - macOS Big Sur 11.0.1's universal apps release notes: on Apple silicon "a simple ad-hoc signature is sufficient", and "binaries signed this way cannot pass through Gatekeeper."
  - `man spctl`, on macOS 27.2: `--status`, "Query whether the assessment subsystem is enabled or disabled."
- **The mark Windows keys on.**
  - Microsoft's `about_Execution_Policies`: "programs like Internet Explorer and Microsoft Edge add an alternate data stream to files that are downloaded"; "Other methods of downloading files may not mark the files as coming from the Internet Zone.", its examples `curl.exe`, `Invoke-RestMethod` and `Invoke-WebRequest`. The stream is `Zone.Identifier` ([MS-FSCC] 5.6.1).
  - Microsoft's "Macros from the internet are blocked by default in Office": "Mark of the Web only applies to files saved on an NTFS file system, not files saved to FAT32 formatted devices."
  - No page read states whether npm, uv, `Expand-Archive` or `tar` writes or carries the stream.
  - Microsoft Defender SmartScreen's overview: "SmartScreen protects against malicious files from the internet." "SmartScreen reputation for Windows app developers": an unsigned file gets "Windows protected your PC". That a launch from a terminal is not checked is stated on a Microsoft engineer's personal blog alone (`textslashplain.com`, 2023-08-23), not on Microsoft Learn.
  - Smart App Control. Its overview: "Apps cannot be run unless they are recognized by Microsoft's app intelligence services, or they are signed with a trusted certificate." The SmartScreen reputation page: "Smart App Control signature checks apply to all executable files, not just those downloaded from the Internet." Its FAQ applies to Windows 11. No page read states whether Windows Server 2025 has it.
- **Linux.** No page read describes a download-origin warning for a binary run from a terminal.
- **GitHub's hosted runners** (`actions/runner-images`).
  - macOS: the image's build scripts and the macOS 15 readmes, arm64 and Intel, say nothing of Gatekeeper.
  - Windows: `images/windows/scripts/build/Configure-WindowsDefender.ps1`, "Disables Windows Defender", sets `DisableRealtimeMonitoring = $true`; SmartScreen's state is not stated. Issue #15315 (2026-11-12): "D: drive will use ReFS instead of NTFS on Windows images from November 30, 2026".
- **GitHub Actions.** "Docker container actions can only execute on runners with a Linux operating system." (`docs.github.com/en/actions/concepts/workflows-and-actions/custom-actions`). `pypa/gh-action-pypi-publish`'s README: "Since this GitHub Action is docker-based, it can only be used from within GNU/Linux based jobs".
- **The dry run's stand-ins**, `tools/spectra/scripts/stand_ins.mjs`: Verdaccio 6.11.1 and pypiserver 2.4.2, each a local process on the one Linux runner of the dry run's publishing job, each holding what is published to it and asking no other registry for anything. The placeholders are published under a tag of their own. As built locally, the eleven npm packages are 248 MB and the PyPI files 244 MB.
- **The run's files.** The npm packages, the PyPI files, and the five archives with `checksums.txt` are uploaded to a release run as artifacts.
- **Spectra's repo.**
  - The root README holds no install text. Upstream's `a2ui` CLI README writes its two script commands as `curl -fsSL <raw GitHub URL of the script on main> | sh` and `irm <raw GitHub URL of the script on main> | iex`, and Spectra's two scripts carry the same forms in their header comments.
  - The tool's workspace package is itself named `a2ui-spectra`.
  - The npm launcher's manifest states `"engines": {"node": ">=22"}`; the launcher is a Node script that starts the binary and passes the stop on, and its tests run under Node 22 alone. CI runs on Node 22 with its bundled npm; the workflows install uv with no version named.
  - The stub agent is built by the conformance workspace and needs its dependencies. The tool's end-to-end test drives its canned A2UI conversation through the message box's API, with the browser not opened.
  - `uvx` runs the binary's `--version` on the Mac job's package check and nothing else anywhere; the npm launcher under `run` is tested in the tool's test target on all five platforms.
  - The install scripts' suite runs every case under both PowerShells, against an archive the suite builds, from the suite's own stand-in.
- **npm and PyPI.** The eleven npm names and the two PyPI names of the release are free.

## Scope

- The install check: where it runs, what stands for the adopter's machine, the installs it makes and what each must pass.
- How the five platforms' runners reach the stand-in registries, and the stand-in for GitHub.
- The order of a real run, with the install check before and after the publish.
- The root README's install commands.
- The download mark, what its absence establishes, and what stays open.
- One run by hand on Jioh's Mac.
- The Phase 10 spec, SPEC.md, `_dev/release-procedure.md`, the tool's README and `_dev/TODO.md`, brought in line.

Out of scope: publishing anything; the six libraries' install from a registry; the root README's install text beyond its commands, and every other document, sub-task 10.9; installs through pnpm, Yarn and Bun, Windows arm64 and Linux on musl; the install check's first run against the real registries, Phase 11's.

## Locked decisions

### 1. The stores travel

After its publishing steps, the job that publishes into the stand-ins uploads the stand-in npm registry's storage and the stand-in Python index's packages to the run. Each platform's install job downloads them and starts the same two stand-ins on that store. An install job publishes nothing.

### 2. Where the install check runs

In the release workflow, in both modes, and by hand.

- On a dry run, the five platforms' install jobs follow the job that publishes into the stand-ins, and read its stores.
- On a real run, they run twice: before the publish, from the stand-ins, under decision 3; and after the draft is published, against npm, PyPI and GitHub themselves.
- The install check is startable by hand against the real registries, outside any release run.
- CI does not run it.

The install jobs hold no permission beyond reading and no `release` environment. An install that fails after a real publish is run again, as the 10.6 spec's decision 10 runs a failed publishing job again.

### 3. A real run is gated on the install check from stand-ins

On a real run too, the publishing steps run into stand-ins first, and the install check runs on the five platforms from those stores. The draft job, the first job that holds the release's permissions, waits for it. The order of a real run: everything CI runs; the publishing steps into stand-ins; the install check from the stand-ins; the draft and its attestation; PyPI and npm; the draft published; the install check against the real registries.

### 4. What stands for the adopter's machine

The workspace is on the runner for the stub agent and the check's own script alone. Each install runs in a fresh folder outside the checkout, with an empty npm cache and an empty uv cache of its own, and the registries are named by environment alone.

### 5. The install commands come from the root README

The check reads its install commands out of the root README's install section and runs them as written, adding its own arguments alone. This sub-task writes that section's four commands behind the README's status line: the `npx` command, the `uvx` command, and the shell script's and the PowerShell script's commands in the form the scripts' header comments carry. The text around them is sub-task 10.9's.

From the stand-ins, the two script commands change by the raw GitHub origin alone, which becomes the stand-in's. The `npx` and the `uvx` commands run unchanged.

### 6. The stand-in for GitHub

From the stand-ins, a stand-in for GitHub on the runner serves the commit's install script at the path the README's command names, a releases list holding the one release, and the run's five archives with `checksums.txt`.

### 7. The installs

On each of the five platforms, four installs:

- `npx` under Node 22, the floor the launcher's manifest states, with its bundled npm;
- `npx` under the newest LTS line as resolved at the run, with its bundled npm;
- `uvx`, with uv at its latest;
- the install script. On Windows it runs under `powershell.exe` and again under `pwsh.exe`.

The run prints the Node, npm and uv versions it resolved.

### 8. What each install must pass

- `--version` prints the committed version.
- One turn under `run`: the installed Spectra launches the stub agent holding its canned A2UI conversation, the browser not opened; the check sends one message through the message box's API; the turn closes waiting for input and carries the canned surface's A2UI messages. Through `npx` and `uvx` the turn runs through the channel's own command, and after the script through the installed binary.
- The stop: after the turn the check stops Spectra as a user at a terminal does, a Ctrl-C to the foreground process group on macOS and Linux and a console Ctrl-C on Windows. The channel's command exits and the stub agent's process is gone, within a bound.

### 9. A stop that fails through `npx` or `uvx`

A stop that fails through `npx` or `uvx` is brought to Jioh before anything is changed. What is done then, a change in Spectra, a line in the README or a backlog item, and what done then means, is Jioh's.

### 10. The download mark

After each install on macOS arm64, macOS x64 and Windows x64, the check fails when the installed binary carries the download mark: `com.apple.quarantine` on macOS, the `Zone.Identifier` stream on Windows. Each run first writes a mark on a scratch file in the same folder and reads it back. Each macOS runner's `spctl --status` is printed and not asserted. Linux asserts nothing.

### 11. What the mark's absence establishes

Sub-task 10.7 establishes that a binary installed through `npx`, `uvx` or the install scripts carries no download mark. The Phase 10 spec's decision 17 is narrowed to that. What ties the mark to the warning is the references this spec opens with: on macOS, TN2206's sentence; on Windows, `about_Execution_Policies` and SmartScreen's overview.

Three points stay open:

- Smart App Control on Windows 11, which applies to an unsigned binary however it arrived;
- SmartScreen at a launch from a terminal, which Microsoft Learn does not state;
- Gatekeeper beyond quarantine, whose circumstances Apple does not document.

Sub-task 10.9, the documents, takes this as its input: the README does not say flatly that no warning appears, and it names Smart App Control. The backlog gains a check on a Windows 11 machine with Smart App Control on.

### 12. The run by hand on Jioh's Mac

The same installs run once by hand on Jioh's Mac, the M1 Pro, from a dry run's stores, with its `spctl --status` read first. The run uses scratch folders for the installs and the caches and leaves nothing behind. The done line states the Gatekeeper state read and the outcome.

### 13. The libraries are not in the install check

The install check covers the binary alone. The preview core, the three preview adapters and the two wrappers stay with the libraries' pack check and the two smoke checks by hand. The stand-ins keep asking no other registry for anything.

### 14. Against the real registries

Against the real registries nothing is substituted and no stand-in runs. The version the installs must print is the committed version at the ref. A start by hand between the commit that sets a version and that version's release fails.

### 15. The install folders

On the runners the script installs into its default folder, as the README's command does.

### 16. Done

Sub-task 10.7 is done when, with no test skipped or marked:

- a dry run dispatched on `main` passes with the install check in it: on each of the five platforms, from the stores its publishing job left, the four installs of decision 7, read from the root README's install section, each passing decision 8's three points;
- on macOS arm64, macOS x64 and Windows x64, every installed binary carries no download mark, after a mark written to a scratch file in the same folder was read back, and each macOS runner's `spctl --status` is printed;
- the run by hand on Jioh's Mac passes;
- the root README's install section holds the four commands behind the status line, and a test in the tool's test target reads them as the check does;
- CI passes from the shared definition.

The done line carries the dry run's measured time and the install jobs' own, the Node, npm and uv versions the run resolved, and the Mac's Gatekeeper state. It states that the install check against the real registries and a real run's gate first run in Phase 11.

### 17. The documents brought in line

- The Phase 10 spec's decision 10, the rehearsal: the turn under `run`, the checked stop, a real run's gate, and the start by hand.
- The Phase 10 spec's decision 17, no paid signing: the narrowed claim of decision 11.
- SPEC.md's "Distribution and names": a release's files are installed on every platform from stand-in registries before anything is published.
- `_dev/release-procedure.md` and the tool's README, `tools/spectra/README.md`: the gate, the install check after the publish, and how it is started by hand.
- `_dev/TODO.md`: the 10.7 line names this spec; the 10.9 line gains its input, the four commands already there, no flat statement that no warning appears, and Smart App Control named; the backlog gains the Windows 11 check with Smart App Control on.
- The 10.6 spec stays as written; this spec's decision 3 states the changed order of a real run.

## Invariants

- Nothing is published.
- The stand-ins ask no other registry for anything.
- An install job publishes nothing and holds no permission beyond reading.
- The jobs that hold the release's permissions download the run's files and publish them, and do nothing else.
- The files a release publishes are the files its tests ran against and its install check installed.
- An install never resolves from the workspace.
