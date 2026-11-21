# Sub-task 10.11 — The skill

A skill, in the Agent Skills format, for a coding agent using Spectra: one skill that sets Spectra up in an adopter's repository and debugs an A2UI agent with it, usable on any agent platform that reads the format. Sub-task 10.11 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its scope line "A skill for a coding agent using Spectra". Nothing is published.

The upstream check at this sub-task's start, on 2026-11-21, read `upstream/main` at `5ff1b05f0` (2026-11-20), 50 commits after the pin `0888f88b2`, the commit the 10.9 spec opens with, and found no event: npm and PyPI carry no new release of an upstream package; the three v1.0 schemas and the v1.0 basic catalog are unchanged, `specification/versions.json` is unchanged and the five watch-list items are open; no commit has landed on a held-by finding's paths since the 10.9 spec's reading; no OpenTelemetry release inside a stated range is newer than the lockfiles resolve; and upstream's two install scripts and their test are unchanged since the pin.

The Agent Skills format is as its specification states it, https://agentskills.io/specification, read on 2026-11-21.

## Scope

In scope:

- The skill, `skills/a2ui-spectra/`: `SKILL.md` and its Windows file, `references/windows.md`.
- A test in the tool's test target holding the skill's statements to the built binary and the stub agent, and its frontmatter to the Agent Skills format.
- The root README's lines on getting the skill, for each agent product the trial passed on.
- The trial of the skill by hand, on three agent products.
- `CHANGELOG.md`'s `## 0.1.0` section gaining a line for the skill.
- Phase 11's section of `_dev/TODO.md` gaining the trial of an agent setting Spectra up from the skill.

Out of scope:

- A helper script bundled with the skill.
- A new subcommand on the binary, for sending a turn, reading one, or printing or installing the skill.
- The skill carried in the binary's packages or in any release artifact.
- A plugin marketplace entry.
- A coding agent tried on Windows.
- A coding agent setting Spectra up from the skill against the real registries. Phase 11's.
- Publishing anything.

## Locked decisions

### 1. One skill, for setting Spectra up and for debugging with it

One skill covers both. The debugging loop is its body; setup is a short section that points to the READMEs and the design docs of sub-task 10.9 and does not restate them.

### 2. A live turn goes through the HTTP routes, called with `curl`

The command has no subcommand that sends a message or prints a turn's record. The skill teaches the routes under `/api/` that `docs/design/api.md` describes, called with `curl`: the send, which answers with the turn's trace id, and the turn's record, asked for until the turn has closed.

### 3. The skill lives at `skills/a2ui-spectra/`

In this repository, at its root, as upstream has `skills/a2ui/`. The adopter copies the folder into their agent's skills folder, and the root README says how. The skill is read from `main` and is tied to no installed version.

### 4. `SKILL.md`, and one reference file for Windows

`SKILL.md` holds the whole loop and the short setup section. The commands PowerShell writes differently are in `references/windows.md`, which `SKILL.md` links and a coding agent reads on Windows alone. What the skill does not hold, the wrapper, the preview page and the config file's tool servers among them, it reaches by GitHub URLs on `main` to the documents of sub-task 10.9. The Agent Skills specification advises keeping `SKILL.md` under 500 lines.

### 5. What the loop covers

The skill teaches as steps:

1. starting the agent under `a2ui-spectra run` without the browser, in the background, and knowing it is ready;
2. sending a message and getting the turn's trace id;
3. waiting for the turn to close and reading its record: the outcome, the A2UI messages and the checks' problems;
4. reading inside the turn where capture reached it: the model request and raw response, tool calls, and the A2UI step's parse errors and retries;
5. sending an A2UI action as the next turn;
6. restarting the agent and reading its output after a code change;
7. saving a turn as a fixture, replaying it with `a2ui-spectra replay`, and running `a2ui-spectra test` as the regression check after a fix.

`a2ui-spectra attach` has one line, saying when to use it. The preview is left out: the skill says it is the person's to look at in the viewer.

### 6. The name and the trigger

The skill's name is `a2ui-spectra`, the folder's name, as the format requires. Its description triggers when an A2UI agent's output needs to be seen, checked, debugged or regression-tested, and when Spectra is named. It does not trigger on building with A2UI as such, which is upstream's `a2ui` skill's. The skill neither mentions nor depends on upstream's skill.

### 7. Two proofs: a test in CI, and a trial by hand

- A test in the tool's test target runs every command and every `curl` request the skill states against the built binary and the stub agent, and checks each answer has the shape the skill says; it checks the frontmatter against the Agent Skills format's rules. The release workflow's dry run and the acceptance run, sub-task 10.10, cover it as part of that target.
- One trial by hand, at the sub-task's close, shows a coding agent gets through the whole loop with the skill alone.

### 8. The trial's target

A copy of upstream's Python restaurant finder, `samples/agent/adk/restaurant_finder` at the pin, on Gemini, with a fault planted in the agent's own code or prompt. The fault is chosen during the sub-task's work and, before the trial, confirmed by hand to show in Spectra as a problem on the turn. The coding agent is given the skill and a plain complaint, and nothing else.

### 9. The trial's agent products

The trial runs on Claude Code, Codex CLI and Gemini CLI, each a fresh session with the skill installed the way that product reads skills. Jioh installs Gemini CLI and signs it in. The root README states the skills folder of each product the trial passed on, read from that product's own documentation, and names no other product.

### 10. Windows

`SKILL.md` is written for a POSIX shell. The Windows file holds what differs alone: `curl.exe`, the JSON body's quoting, the background start and stop, and the two waits. The test of decision 7 runs the POSIX commands on the POSIX platforms and the Windows file's commands on the Windows runner. No coding agent is tried on Windows.

### 11. What the trial proves before anything is published

The skill's setup section is written as it reads after the release, under the Phase 10 spec's decision 16, the documents are written in their released form. The trial's repository comes with Spectra already set up: the built binary on the path, the wrapper's wheel from the packing command installed in the agent's environment, and the config file written. The trial proves the debugging loop. The setup section is held by the test of decision 7 and by its install commands matching the READMEs' word for word. A coding agent setting Spectra up from the skill is tried in Phase 11, against the real registries.

### 12. The rules of conduct

The skill gives the coding agent seven rules:

1. Ask before installing Spectra, or adding the wrapper or the preview adapter, to the person's repository.
2. Never claim how a surface looks.
3. Stop what it started: the `a2ui-spectra run` process and the agent under it, when the work is done.
4. Ask before committing a fixture.
5. Say what a step costs before taking it, and prefer the free ones, a replay with everything recorded and `a2ui-spectra test`, for re-checking a fix. For a single live turn the agent states the cost and proceeds; before a loop of many live turns it asks.
6. Trust the binary over the skill: where `a2ui-spectra <command> --help` or an API answer differs from the skill's text, the binary is right.
7. Report from the record: a claim that a turn passed or failed quotes the record's outcome and problems.

### 13. What a pass is

On each of the three products, judged from the session's transcript and the repository it leaves:

1. the agent loaded the skill on its own from the complaint, without being told Spectra's name;
2. it started the agent under `a2ui-spectra run`, sent a turn through the API, and read the turn's problems from the record;
3. it named the planted fault from what Spectra showed, and fixed it in the agent's code;
4. it sent the turn again and quoted a record without that problem;
5. it left a fixture that `a2ui-spectra test` passes, uncommitted, and asked about committing it;
6. it stopped the processes it started, and made no claim about how the surface looks.

All three products pass all six points. A failure is read for its cause. One the skill's wording caused: the skill is fixed and all three run again. One the product caused: the done line records it with its evidence, the product is left out of the root README's list, and Jioh decides whether the sub-task closes on two.

### 14. The frontmatter

The frontmatter states the licence as Apache 2.0 and carries no field specific to one agent product.

## Invariants

- Nothing is published.
- Nothing in the binary, its packages or the release workflow changes for the skill.
- The skill's body uses nothing specific to one agent product: a shell, `curl` and the binary.
- Every command and request the skill states is held to the built binary by a test.
