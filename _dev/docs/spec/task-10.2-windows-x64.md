# Sub-task 10.2 — Windows x64

Spectra working on Windows x64, the agent's process tree started, restarted and ended, and the binary test run on a Windows runner on every push and pull request. Sub-task 10.2 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 7, that Spectra works on Windows x64 natively, including starting, restarting and ending the agent's process tree under `a2ui-spectra run`, and, for Windows, its decision 8, that on every push and pull request each platform's runner runs the tool's test target against that platform's binary.

The upstream check at this sub-task's start, on 2026-11-15, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, and found no event: no commit in an area Spectra uses, every copied file unchanged, no new release on npm or PyPI, `specification/versions.json` unchanged, the five watch-list items open, and no commit touching a held-by finding's paths.

Spectra and Windows before the sub-task, as read on 2026-11-15. Nothing below has been run on Windows. Bun is read at tag `bun-v1.4.4`, libuv at the commit that tag vendors, `oven-sh/libuv@8023581`, Node's documentation at its `main`, and Microsoft's at Microsoft Learn.

- **The agent's process tree in Spectra.** On macOS and Linux the agent leads its own process group; a stop sends the group SIGTERM, waits 10 seconds, then sends it SIGKILL (`tools/spectra/src/agent_process.ts`). On Windows the same code ends the direct child alone, at once, and sees no grandchild. The command after `--` starts without a shell.
- **Spectra's own stop.** Spectra's stop signals are SIGINT and SIGTERM, with SIGHUP on macOS and Linux; the first begins the stop and the second forces the agent (`tools/spectra/src/session.ts`). Stopped by a signal, Spectra exits with 128 plus the signal's number. On Windows the agent shares Spectra's console.
- **What Spectra prints to paste.** Each redirection variable is printed as a POSIX `export` line, in the terminal and on the viewer's first screen; the help text's example is a POSIX one.
- **The tool's test target.** 78 test files: seven run Spectra as a process, against the binary when one is named, and 71 run in-process under Node. Four cases are skipped off POSIX: the force-kill, the whole group stopped when Spectra stops, a group member outliving the command, and a save while the agent is down. The tests stop Spectra with SIGTERM, 33 times across seven files, and assert exit code 143 at 43 places. The suites need Node, uv with Python 3.12, and Playwright's Chromium.
- **CI.** The Windows job downloads the Windows x64 binary and runs its `--version`, with no checkout.
- **Line endings.** Spectra's root has an `.editorconfig` with `end_of_line = lf` and no `.gitattributes`, as upstream's root has at the pin. The wrapper capture cases' text files are compared against recorded character offsets, with their line endings kept.
- **Ending a process on Windows.** libuv treats SIGTERM, SIGKILL and SIGINT alike: "Unconditionally terminate the process" (`src/win/process.c`). "When the system is terminating a process, it does not terminate any child processes that the process has created" (Microsoft Learn, "Terminating a Process"). No Bun or Node API asks a process to stop.
- **The signals a Windows process receives.** Under Bun 1.4.4, Ctrl+C arrives as SIGINT, Ctrl+Break as SIGBREAK and the console window's close as SIGHUP, after which "the program is given approximately 10 seconds to perform cleanup" (libuv, `docs/src/signal.rst`); a SIGTERM listener never fires.
- **Console control events.** `GenerateConsoleCtrlEvent` "Sends a specified signal to a console process group that shares the console associated with the calling process"; a Ctrl+C "cannot be limited to a specific process group"; "CTRL+BREAK signals always cause the handler functions to be called" (Microsoft Learn, `GenerateConsoleCtrlEvent`). In a process group made with `CREATE_NEW_PROCESS_GROUP`, "CTRL+C signals will be disabled for all processes within the new process group" (Microsoft Learn, "Process Creation Flags"). Bun sets that flag only together with `DETACHED_PROCESS`, under which the child "does not inherit its parent's console".
- **Job Objects.** "After a process is associated with a job, by default any child processes it creates using CreateProcess are also associated with the job"; `TerminateJobObject` "Terminates all processes currently associated with the job"; `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` "Causes all processes associated with the job to terminate when the last handle to the job is closed" (Microsoft Learn). libuv puts each child that is not detached into a job of that kind, set so that "only the processes that we explicitly add are affected, and *their* subprocesses are not".
- **Native calls from the binary.** Two routes to a Job Object, neither established in a compiled Windows binary: `bun:ffi`, which Bun's documentation calls "experimental, with known bugs and limitations"; and Bun's no-orphans switch, "a kill-on-close Job Object" every descendant inherits, documented for `bun run`.
- **Batch files.** `npm`, `yarn` and `npx` are batch files on Windows. Node refuses to start one without a shell. Bun resolves a bare name itself, trying `.exe`, `.cmd`, `.bat`, then `.com`, in the working folder and then along `PATH`, without reading `PATHEXT`; given a batch file, it refuses an argument holding any of `"%&|<>^` or a line break (`src/which/lib.rs`, `src/runtime/api/bun/js_bun_spawn_bindings.rs`). Bun's lint documentation says of `npm` that "you can't start a script without a shell".
- **Names.** Windows reserves "CON, PRN, AUX, NUL, COM1 … COM9 … LPT1 … LPT9", and "these names followed immediately by an extension"; "Do not end a file or directory name with a space or a period" (Microsoft Learn, "Naming Files, Paths, and Namespaces"). The fixture name rule and the store's conversation name rule both accept such names.
- **Python's streams.** On Windows, "Non-character devices such as disk files and pipes use the system locale encoding (i.e. the ANSI codepage)"; `PYTHONIOENCODING` overrides the encoding of the standard streams; UTF-8 mode, the default from Python 3.15, covers "files, stdio, and pipes" (Python's `sys` and command-line documentation, PEP 686). Spectra decodes the agent's output as UTF-8 and sets `PYTHONUNBUFFERED=1` unless the developer's environment sets it.
- **Environment variables.** "On Windows operating systems, environment variables are case-insensitive" (Node, `process.env`). Spectra sets and reads variables by exact name.
- **A refused port.** On Windows a bind fails with `WSAEACCES` when "another application, service, or kernel mode driver is bound to the same address with exclusive access" (Microsoft Learn, Windows Sockets error codes). Spectra reports `EADDRINUSE` alone as a taken port.
- **The runner.** `windows-latest` is Windows Server 2025, and its default shell is PowerShell (GitHub's workflow syntax reference and the `actions/runner-images` repository).

## Scope

- Spectra's behaviour on Windows x64: the commands `a2ui-spectra run` takes, the agent's process tree started, restarted and ended, Spectra's own stop, and what Spectra prints, names, reads and sets there.
- The binary test run on `windows-latest` on every push and pull request, and the workflow started by hand that runs it alone.
- The tool's test target passing on Windows against the Mac-built Windows x64 binary.
- The tool's README, the help text and SPEC.md, brought in line.

Out of scope: Spectra's development workflow on Windows beyond what the binary test run needs; Git Bash and Windows on arm64; an upstream sample or a model key on the Windows runner; the agent's tree dying with Spectra on macOS and Linux; the name of the Windows npm package, sub-task 10.3; the PowerShell install script, sub-task 10.5; the minimum operating-system versions a README states and the root README's install text, sub-task 10.9.

## Locked decisions

### 1. The runner is where Windows is established

The `windows-latest` runner is the one place Spectra's Windows behaviour is established. A workflow started by hand runs the Windows job alone, with the every-push workflow's own job definition. It is kept after the sub-task closes.

### 2. The environments

Spectra is held to PowerShell and cmd. Git Bash is not claimed and not tested. WSL is the Linux binary's. Windows on arm64 is not claimed.

### 3. What of Spectra's source runs on Windows

The sub-task answers for what the binary test run needs on Windows: the install, the build of what the tool's test target depends on, and the test target against the Mac-built binary. Nothing else of the development workflow is claimed there.

### 4. The bar

The sub-task is done when every test of the tool's test target passes on `windows-latest` against the Mac-built Windows x64 binary, on every push and pull request, none skipped or marked, in the job that replaces the 10.1 spec's start check. Every behaviour the suite asserts is asserted on Windows; a test branches on the platform for its means only and asserts the same outcome. A behaviour Windows itself does not have is brought to Jioh, case by case, before it is left out. A failure that cannot be fixed within Spectra, a fault in Bun or in the runner image, is brought to Jioh before anything is done about it.

### 5. Stand-ins only

Windows is proven with the test target's stand-ins and the launch cases of decision 6. No upstream sample runs on Windows and no model key goes to the Windows runner.

### 6. The commands `run` takes

On Windows `a2ui-spectra run` takes a command as Bun resolves it: a bare name finds an `.exe`, a `.cmd`, a `.bat` or a `.com`, so that `run -- npm run dev` works as SPEC.md writes it. The whole tree of such a command is started, restarted and ended. An argument a batch file cannot safely take is refused, and it, like any command that cannot be started, is reported in Spectra's own line, naming the argument, the reason and the way out. Spectra does not escape arguments for `cmd.exe`.

The stub agent is started directly, through an npm script and through `uv run`, and each is started, restarted and ended with no process of its tree left.

### 7. The tree's end

On Windows the agent's tree is ended with the promise a process group gives on macOS and Linux: every process the agent's command started is ended, one whose parent has already exited included. It is ended through a Job Object.

### 8. The tree dies with Spectra

On Windows the agent's whole tree dies with Spectra, however Spectra ends.

### 9. Asked before ended

On Windows a stop or a restart asks the agent's tree to stop with a console Ctrl+Break, waits the 10 seconds it waits on macOS and Linux, then ends the Job Object. The README says which event an agent on Windows receives.

### 10. The terminal's Ctrl+C

On Windows the terminal's Ctrl+C reaches Spectra alone. The agent hears of the stop from Spectra, in decision 9's order, and a second Ctrl+C forces it.

### 11. Ctrl+Break and the console's close

On Windows, Ctrl+Break and the console window's close are stops, as Ctrl+C is. A Ctrl+Break at the keyboard reaches the agent from the console as well as from Spectra. Ctrl+Break is tested. The window's close is tested if the runner can drive it; if not, it is built without a test of its own, and the spec and the README say so.

### 12. Exit codes

Spectra stopped on Windows exits with 128 plus the signal's number, as on macOS and Linux: 130 after Ctrl+C, and 149 after Ctrl+Break, 128 plus SIGBREAK's number on Windows, 21, the number confirmed on the runner.

### 13. What Spectra says about the agent's end

On Windows an end Spectra caused is reported in words for that, with no signal name: one text for an agent that stopped when asked, one for an agent Spectra ended after the 10 seconds. An exit the agent took unasked stays "exited with code N" on every platform. Jioh sees the texts when they are written.

### 14. The binary's alone

The handling of the agent's tree on Windows is the compiled binary's alone. Under Node on Windows it is not claimed, and Spectra says so there. The in-process cases that assert the tree's start and end assert the same outcome against the binary on Windows.

### 15. How the tests ask Spectra to stop

On Windows the tests ask Spectra to stop with a console Ctrl+C, generated by a helper that only the tests use and that is not part of the binary. No stop request over HTTP is added.

### 16. The first run

The sub-task opens with a run on `windows-latest`, through the workflow started by hand, that establishes, before anything is built on them:

1. that a batch-file launcher, the stub agent behind an npm script, starts from the compiled binary with no shell, and that an argument with a refused character is refused;
2. that a Job Object can be made and used from the compiled binary, through `bun:ffi` or Bun's no-orphans switch, on a runner whose processes may already be inside a job;
3. that ending the Job Object ends a grandchild whose parent has already exited, and that killing Spectra ends the whole tree;
4. that the agent can be started in its own process group while sharing Spectra's console, so that the terminal's Ctrl+C does not reach it and Spectra's Ctrl+Break does;
5. what a Node agent and a Python agent each do on that Ctrl+Break, with a handler and without one, and what a `cmd.exe` between Spectra and the agent does with it;
6. that the tests' helper can send a console Ctrl+C and Ctrl+Break to one Spectra under test without the event reaching the test runner or another test's Spectra, and whether it can close that console;
7. that the agent's address as the tests write it, `http://localhost:<port>`, reaches a server bound to `127.0.0.1` from the binary.

The run's results are written into this spec as measured. A point that comes back "no" reopens the decision that rests on it, with Jioh, before more is built: decisions 7 and 8 do not fall to `taskkill` without it, and decisions 9, 10 and 15 are not dropped without it.

#### The first run, as measured

On `windows-latest`, through the workflow started by hand, in two passes: run 43675351343 on `8d8e02f` and run 43676844196 on `518bbf9`, each with a probe compiled by Bun 1.4.4 on the runner, `_dev/tools/windows_first_run/` at `518bbf9`. The launcher is Spectra's own binary started again, detached, so that it leads a process group of its own.

1. Yes. `npm run <script>`, given to Bun.spawn in the compiled binary with no shell, ran `npm.cmd`, its tree `cmd.exe`, `node`, `cmd.exe`, `node`, every process in the job. An argument holding `&` for the batch file was refused by Bun: "The argument 'args[3]' contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received "a&b"".
2. Yes. Through `bun:ffi` the compiled binary made a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, put a detached process into it, read its processes with `QueryInformationJobObject` and ended them with `TerminateJobObject`, the binary itself already inside a job at its start.
3. Yes. A detached Node grandchild, and a Python one, ran on in the job after their parent exited, and `TerminateJobObject` ended them. `TerminateProcess` on the binary ended the launcher, the agent and the agent's detached child.
4. Yes, with the launcher leaving the console. The launcher attached to Spectra's console with `AttachConsole`. The terminal's Ctrl+C reached Spectra and neither a Node nor a Python agent with handlers for it; Spectra's Ctrl+Break to the launcher's group reached both agents and not Spectra. A launcher that stays on the console is ended by that Ctrl+Break within 5 ms, its own SIGBREAK listener not called, and the agent's direct child with it, through the launcher's own libuv job; a launcher that leaves the console with `FreeConsole` once the command has started lives until the command exits.
5. A Node agent and a Python agent without a handler end at once, with `STATUS_CONTROL_C_EXIT`, `0xC000013A`; with a SIGBREAK handler, the handler runs and the agent exits as the handler says. Under `npm run`, the batch file's `cmd.exe` prints "Terminate batch job (Y/N)?" and, with no input, ends; under `cmd /d /c <program>`, `cmd.exe` waits for the program and exits with its code; under `uv run`, the Python agent's handler runs. No case left a process in the job.
6. Yes. The helper started each Spectra in a console of its own, with `CREATE_NEW_CONSOLE`, and its Ctrl+C and Ctrl+Break reached that Spectra alone, not the test runner and not another Spectra so started. It closed the console by posting `WM_CLOSE` to its window; a Spectra that exits 300 ms after the SIGHUP that follows exited with 129. The window's close is tested.
7. Yes. `http://localhost:<port>` from the binary reached a server bound to `127.0.0.1`, in 5 ms.

Measured beside the points: SIGBREAK is 21 in the compiled binary's `os.constants.signals`; and Bun 1.4.4 cuts an exit code past 255 to its low eight bits, both in `process.exit` and in a child's code, `3221225786` reading 58. The launcher reads the command's whole exit code from the command's own process handle.

### 17. The lines to paste

On Windows every line Spectra prints for the developer to paste is in a form PowerShell and cmd take. `a2ui-spectra attach` prints the redirection variables as a PowerShell block and a cmd block, each labelled, and the viewer's first screen shows both, each with its own copy button. The help text's example follows the same rule. On macOS and Linux nothing changes. The first screen's change is drawn on the Design canvas "Spectra viewer UI" before it is built.

### 18. Paths and names

On Windows what Spectra prints as a path is in Windows' own form. A fixture's name is written with `/` on every platform. In what the developer gives Spectra, the config file's paths and the path given to `a2ui-spectra replay`, both separators are taken on Windows.

### 19. Names Windows cannot hold

Save as fixture refuses a name Windows cannot hold, on all five platforms, with a line saying why. On Windows the store stores and reads back a turn whose conversation id is such a name.

### 20. The agent's output encoding

On Windows Spectra sets `PYTHONIOENCODING=utf-8` for the agent, unless the developer's environment sets it or `PYTHONUTF8`. Nothing is set for other runtimes.

### 21. Variable names

On Windows a variable Spectra sets for the agent replaces the developer's variable of that name in any case, and a variable Spectra reads from its own environment is found in any case. The config file's rule for a tool variable's name stays the POSIX one on every platform.

### 22. A port the system refuses

On Windows a port the system refuses with an access error is reported as one Spectra cannot have: the terminal names the port, says the system would not give it, and names the option that moves it. The tests' port finder moves on to another port.

### 23. Line endings

A `.gitattributes` file makes every text file LF at checkout on every machine.

### 24. The documents

The sub-task keeps the tool's README and the help text true for Windows: the environments Spectra is held to, the rule for a command, how the agent's tree is started and ended, the stops and their exit codes, the two blocks `attach` prints, the names refused, the encoding variable, and CI's fifth platform.

SPEC.md is amended in two places: "Redirection", where the viewer's first screen shows the variables with one copy button, gains a copy button per shell on Windows; "Engineering decisions", where the CLI and local server are written against Node's standard APIs, gains the exception that on Windows the agent's process tree is handled through native Windows calls that only the compiled binary makes.

### 25. The backlog

The backlog gains two items: fixture names and conversation names that differ only in case, which collide on Windows and on macOS's default file system; and a stop request over Spectra's local HTTP server, for a script or a coding agent.

### 26. Left to the build

How the tests end their own helper processes on Windows, such as the sample pages' dev servers, is the build's; no promise of Spectra's rests on it. The wording of each new terminal line is the build's, the texts of decision 13 shown to Jioh.
