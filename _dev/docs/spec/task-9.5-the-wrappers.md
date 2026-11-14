# Sub-task 9.5 — The wrappers

The Python wrapper's hook table and floor at `a2ui-agent-sdk` 0.11.0; both wrappers' capture suites at the pin; the smoke check on the published agent SDKs. Sub-task 9.5 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 7, the Python wrapper's floor is `a2ui-agent-sdk` 0.11.0, and its decision 8, the upstream packages Spectra supports, and taking what sub-task 9.2's handover leaves to it.

The upstream check at this sub-task's start, on 2026-11-14, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, the documentation site's landing page (#4235), touching none of the areas Spectra uses; every copied file unchanged; no new release on npm or PyPI; `specification/versions.json` unchanged; the five watch-list items open; no commit on a held-by finding's paths: none of the three events of the Phase 9 spec's decision 2. The published latest, read on 2026-11-14: PyPI's `a2ui-agent-sdk` 0.11.0, `a2ui-core` 0.6.0, `a2ui-a2a` 0.3.0 and `a2ui-adk` 0.3.0, each of 2026-11-10; npm's `@a2ui/agent` 0.1.0 and `@a2ui/web_core` 0.15.0, each of 2026-11-02.

The wrappers at the pin, before the sub-task:

- Four of the Python wrapper's twenty hooked names do not resolve, the four `generate` hooks: `DirectJsonPromptGenerator`, `ExpressPromptGenerator`, `AtomPromptGenerator` and `ElementalPromptGenerator` are no longer exported from their format packages. Every parser, stream, renderer state and toolset name resolves. The wrapper leaves the agent SDK unpatched, naming `DirectJsonPromptGenerator.generate`.
- The four classes exist, each in its own module, such as `a2ui.inference_formats.direct_json.prompt_generator`. None defines `generate()`: it is one `@final` method on the base class `PromptGenerator`, which `a2ui.prompt` exports, and the formats override its three section methods.
- `a2ui.prompt.assemble_instructions`, exported and new, joins a generator's three section methods into the UI section. `generate()` returns it; `SkillGenerator.generate_skill` calls it without `generate()`. The skill generator passed through no hooked name at the previous pin either.
- The request processor's `prompt_snippet`, `a2ui-adk`'s `A2uiInstruction` and, through it, the Python restaurant finder reach `generate()`.
- No hooked name and no hooked signature differs between `a2ui-agent-sdk` 0.11.0 and the pin.
- No generator, parser or format carries a name, finding 36 of `_dev/a2ui-findings.md`, "No inference format names itself".
- The TypeScript wrapper's eleven hooked names resolve at the pin with the same shape. `DirectJsonPromptGenerator.generate` is now inherited from the base class, as `ExpressPromptGenerator.generate` was; `@a2ui/agent` exports both classes from its index.
- The record-writer's Python facts, read off the pin's SDK on Python 3.12 for the 37 cases that run in Python: every case text gives the messages its expected record holds, with the same error classes and the same opening of each error message; the six prompt sections differ. The TypeScript facts were not read; sub-task 9.2's handover has four TypeScript prompt cases failing.
- Of the capture suite's 38 case texts, 36 at v1.0 alone, none carries an envelope key on a component, in either form.
- The marks sub-task 9.2 left: pytest's `xfail` on 46 cases of the Python wrapper's suite; `expected_to_fail` in `conformance/wrapper_capture/capture_v0_1.yaml`, Python on its 37 cases and TypeScript on four.

## Scope

In scope:

- The Python wrapper's hook table, pinned-API check, floor and refusal line.
- The wrapper capture suite's expected records at the pin, in both languages.
- The marks sub-task 9.2 left under this sub-task.
- The smoke check on the published agent SDKs, and its place in the re-pin procedure.
- The live check on the Python restaurant finder.
- The documents of decision 14.

Out of scope:

- The TypeScript wrapper's code, under decision 4.
- SPEC.md's "The wrapper". Sub-task 9.7's.
- The live turns on the custom-components example and the Node restaurant finder. Sub-task 9.8's.
- The judging of the v1.0 component envelope keys. Sub-task 9.3's and sub-task 9.9's.
- A second SDK API shape in the wrappers. Backlog, as it is.

## Locked decisions

### 1. Where the Python wrapper hooks prompt generation

One hook, on `a2ui.prompt.PromptGenerator.generate`, the `prompt_generation` event. The event's inference format is read from the generator by its class, against the four format generator classes, which the wrapper imports from the modules that define them and does not patch. A generator of none of the four classes gives no event.

### 2. A prompt assembled without `generate()`

Not an event: `assemble_instructions` called on its own, and the skill generator. Only `generate()` is a `prompt_generation`. No backlog item is added.

### 3. The pinned-API check

`PromptGenerator.generate` is a core name. Direct JSON's and Express's generator classes are checked with the core names: one missing leaves the agent SDK unpatched, with the one WARNING line naming it. Atom's and Elemental's generator classes are checked each with its own group, skipped at DEBUG when missing. The floor is `a2ui-agent-sdk >= 0.11.0`; the refusal line names `a2ui-agent-sdk` 0.11.0 and `a2ui-adk` 0.3.0, upstream's release of 2026-11-10.

### 4. The TypeScript wrapper

Its code does not change: its hooked names stand as they are, under the Phase 9 spec's decision 7.

### 5. The expected records

The record-writer, `_dev/tools/write_wrapper_capture_records.py`, run again at the pin, writes the ten prompt records again: the six Python ones, on Python 3.12, and the four TypeScript ones. The case texts stay as they are. Each record written again names its upstream cause in the commit message and in the sub-task's close-out line.

### 6. The capture suite's cases

The suite gains no case carrying a v1.0 component envelope key.

### 7. The marks

Every mark whose reason starts `Sub-task 9.5, at the pin: ` is removed. A case that still fails for a bug in upstream gets a finding in `_dev/a2ui-findings.md` with its held-by line, as the re-pin procedure has it.

### 8. What the smoke check requires

For each language, on the published latest of its agent SDK with the wrapper built from the repo: the wrapper switches on and patches, with no refusal line and no hook fault line; for each inference format that SDK implements, one prompt generation and one parse of a valid recorded reply reach Spectra's receiver as a `prompt_generation` and a `parse` event, naming the format and the SDK's version, the parse with its messages and no error; in Python, one toolset tool call reaches it the same way. The jobs are the capture suite's own, run through its drivers. Nothing is compared against an expected record. The run prints the versions it resolved.

### 9. How the smoke check installs the published agent SDKs

A scratch environment outside the workspace for each language, as an adopter has it: the wrapper built from the repo, the agent SDK from PyPI or npm at its latest, `a2ui-adk` with it in Python. Spectra, built from the repo, receives. The root `pyproject.toml`, the root `package.json` and both lockfiles are unchanged.

### 10. Where the smoke check lives and when it runs

A script of its own under `_dev/tools/`, run by hand, exiting non-zero on failure, named under its own heading in `_dev/re-pin-procedure.md`. It runs at the upstream check when the third reading shows a new release of an agent SDK package, at this sub-task's close and at the acceptance run. CI does not run it.

### 11. The re-pin procedure

It gains the smoke check's heading and nothing else.

### 12. The live check

In the `a2ui-upstream` worktree's virtual environment, the wrapper switched on logs no refusal line for `a2ui-agent-sdk` or `a2ui-adk`. One live turn on the Python restaurant finder, under `a2ui-spectra run` on the Gemini key, with no browser: the turn record, read from Spectra's API, holds one `prompt_generation` and one `parse` event.

### 13. Left to the build

Which basic catalog file the smoke check's TypeScript jobs load; the smoke script's name.

Settled in the build:

- The smoke script is `_dev/tools/smoke_published_agent_sdks.mjs`. The TypeScript jobs load the driver's own copy of the pin's basic catalog, `conformance/wrapper_driver/typescript/catalogs/basic_v1_0.json`: neither npm's `@a2ui/agent` 0.1.0 nor `@a2ui/web_core` 0.15.0 carries a catalog definition file. The driver's build is copied into the scratch project, so that its imports resolve there. Spectra's receiver is taken from the tool's build, `tools/spectra/dist/`, in the script's own process, one turn opened around each driver's run as the wrapper capture harness opens it, the drivers carrying no trace context.
- The record-writer ran in the repository's environment, `.venv/bin/python`, Python 3.12.4, on `a2ui-agent-sdk` 0.11.1.dev45 at the pin, and on `@a2ui/agent` 0.1.0 built in the `a2ui-upstream` worktree at the pin. Each of the ten records differs from the one it replaces in its UI section alone, and in `generate_outside_turn` the model call's system instruction holding it, apart from the SDK's version the comparison skips. Their upstream causes:
  - `direct_json_generate`, Python and TypeScript: PR #3567 (`f7b795e45`), one prompt snippet layout, the opening `## Workflow Description:` heading gone and the catalog's schema in a block of its own; PR #3721 (`07fee11d3`), the Direct JSON part described as an array of A2UI messages; and in the schemas the section holds, PR #1605 (`0523d604a`), the A2UI acronym's expansion; PR #4025 (`ee0fe3559`), `@index`'s return type; PR #4044 (`24d1bf9c8`), the `@` envelope keys; PR #3868 (`80aaef07f`), the v1 basic catalog's TextField `value` required; PR #3820 (`419b9ec31`), the regex dialect in `regex.pattern`.
  - `express_generate`, `express_generate_two_catalogs` and `generate_outside_turn`, Python and TypeScript: PR #3867 (`087681ab1`), `Event`'s `userMessage=` in rule 8; PR #4025, the System Functions section with `@index`; PR #3868; PR #3820; and in Python, PR #3567, the opening `## Workflow Description:` heading gone.
  - `elemental_generate`, Python: PR #3567, the opening `## Workflow Description:` heading gone; PR #3868.
  - `atom_generate`, Python: PR #3567, the opening `## Instructions:` heading gone; PR #3868; PR #3820.
- The smoke check at this sub-task's close passed on PyPI's `a2ui-agent-sdk` 0.11.0, with `a2ui-core` 0.6.0 and `a2ui-adk` 0.3.0, on Python 3.14.3, and on npm's `@a2ui/agent` 0.1.0, with `@a2ui/web_core` 0.15.0, on Node 22.15.0.
- The live check: the Python restaurant finder under `a2ui-spectra run` and `opentelemetry-instrument`, from the worktree's virtual environment, the Click instrumentation off. "Top 3 Chinese restaurants in New York", trace `01b7d50e1789785b7e3cfac0bc3c9064`, waiting for input: its record holds three `prompt_generation` and three `parse` events, two streams and one `parse_response`, each Direct JSON on `a2ui-agent-sdk` 0.11.1.dev45, the first stream rejected with `Surface default already exists.`, finding 31's retry. No line of the wrapper's in the agent's output.
- The two facts scripts' headers and the record-writer's name the repository's environment on Python 3.12, in which the Python prompt sections are read, in place of the `a2ui-upstream` worktree's on Python 3.14.

### 14. The documents

- `python/a2ui_spectra_instrumentation/README.md`: the floor, the pinned API and the hook on the base class.
- `conformance/README.md`: which expected records were read off the pin; the two facts scripts' headers, which name `825beac28`.
- The sub-task 6.3 spec, amended in place: its decision 1, where the wrapper hooks, and its decision 4, the pinned-API check.
- `_dev/a2ui-findings.md`: finding 36's held-by line, the classes the wrapper reads a generator's format from being unexported.
- `_dev/re-pin-procedure.md`: the smoke check on the published agent SDKs, under its own heading.
- `_dev/TODO.md`: the 9.5 line names this spec.
- SPEC.md: no change.

### 15. Done when

All of these hold on `main`:

1. The Python wrapper's suite and the wrapper capture suite, in both languages, pass with no mark of this sub-task left.
2. The smoke check exists as decision 10 has it and passes on PyPI's and npm's latest.
3. The live check of decision 12 is made.
4. The documents of decision 14 are written.
5. CI is green on GitHub.

## Invariants

- The wrapper patches only names upstream exports.
- The case texts of the wrapper capture suite are unchanged.
- The TypeScript wrapper's code is unchanged.
- The smoke check leaves the repo's install and lockfiles as they are.
