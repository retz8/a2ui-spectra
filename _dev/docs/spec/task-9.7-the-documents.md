# Sub-task 9.7 — The documents

SPEC.md's statements about upstream at the pin; what Spectra is, in one sentence wherever it is stated; the basic root README; the packages' READMEs; the backlog's text; the documents' step in the re-pin procedure. Sub-task 9.7 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 10, SPEC.md's upstream facts, its decision 11, the basic root README, and its decision 12, the backlog, and taking what the earlier sub-tasks left to it: SPEC.md's "Upstream reference" line from sub-task 9.2, SPEC.md from sub-task 9.3, which published renderer release reads which form of the envelope keys from sub-task 9.4, and SPEC.md's "The wrapper" from sub-task 9.5.

The upstream check at this sub-task's start, on 2026-11-14, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, the documentation site's landing page (#4235), touching none of the areas Spectra uses; every copied file unchanged; no new release on npm or PyPI; `specification/versions.json` unchanged; the five watch-list items open; no commit on a held-by finding's paths: none of the three events of the Phase 9 spec's decision 2.

Upstream at the pin, as read for this sub-task against SPEC.md's statements:

- `docs/public/` is deleted (`58379ad4c`, 2026-11-12, #4213). The documentation is under `docs/site/src/content/docs/`, and every `docs/public/` path SPEC.md cites is gone.
- The roadmap is `docs/site/src/content/docs/roadmap.mdx`, written again on 2026-11-07 (#4050) as five stages in a loop, build components, configure agents, evaluate, distribute and monitor, "the A2UI CLI … at the center because we plan for it to cover every stage". "Developer tooling for A2UI at build time" and the long-term vision are gone from the tree. The page and its loop diagram carry no debugging or observation wording beyond a planned "clearer error handling and diagnostics in the skill generator". Under "Get involved": "share feedback, propose features, or pick up work on GitHub and in GitHub Discussions".
- The root `README.md`'s roadmap list ends on "**CLI**: Schema validation, codegen, local preview, and integration with coding agents." The roadmap page's table of what the CLI will help with: "scaffold, generate, preview, and publish components and catalogs", "generate skills and connect catalogs to agents", "validate output and run evaluation suites", "package agents for native apps, assistants, and MCP Apps hosts", "pull usage and feedback data back into your project".
- The `a2ui` CLI is `dart/a2ui_cli`, the Dart package `a2ui_cli` 0.3.0, with two commands, `codegen` and `lint`, both on catalog files. It is not marked private and ships as pre-built binaries on GitHub releases with a curl install script.
- `tools/` holds `build_catalog`, `composer` and `internal`. `tools/inspector` and `tools/editor` are deleted (`b4f33c880`, 2026-11-11, #4125). The one workspace under `tools/*` is the Composer, named `widget-builder`, private, built with `wireit`; none is named `@a2ui/<tool>`.
- The evaluate stage: `eval/`, an evaluation framework on Inspect AI that scores model output against the project's own datasets; planned, tooling to evaluate your own agents, "deterministic rules that check payloads against your catalog", an LLM judge, and "tool usage as a judge, which looks at the agent's tool calls and context". The monitor stage, planned: "guidance on which logs to collect from gen-UI experiences, such as rendered surfaces, user actions, errors, and abandoned flows".
- The framework adapter blueprint calls the Gallery App "a comprehensive development, demonstration, and debugging tool that serves as the reference environment for an A2UI renderer". The words SPEC.md quotes from it on envelope `metadata`, "unless forwarding it to developer tooling", are gone. The guide `guides/mcp-apps-in-a2ui.mdx` names a "Protocol Debug Inspector" drawer on its sample's page, showing "the live A2UI messages, `postMessage` frames, and MCP tool calls behind each action".
- `specification/versions.json` gives v1.0 `current`, v0.9.1 and v0.9 `previous`, v0.8 `deprecated`. v1.0's protocol document carries "Transport decoupling" with "the Agent and the Renderer" where v0.9.1's has "the server (Agent) and the client (Renderer)". Its A2A paragraph points to the A2A extension; both extension specs give the data part's `data` as an array of A2UI messages. It names an AG-UI binding and an MCP binding under headings of their own, and `specification/v1_0/extensions/` holds `a2a` only.
- The Python packages' changelogs head with the releases of 2026-11-10, `a2ui-agent-sdk` 0.11.0, `a2ui-core` 0.6.0, `a2ui-a2a` 0.3.0 and `a2ui-adk` 0.3.0. `SkillGenerator` stands beside `PromptGenerator` in both agent SDKs.
- Jetpack Compose is listed as an official renderer, in AndroidX. AG2 is named in no file. `samples/community/mcp/` holds five samples.
- Not established: "ten agent entries" under `samples/community/agent/adk/`, which holds seven directories; the Composer's errors tab.
- The published packages and the envelope keys, from sub-task 9.4's spec: `@a2ui/web_core` 0.15.0 draws a v1.0 component whose envelope keys are bare and refuses the whole `updateComponents` when a component carries an `@` key; PyPI's `a2ui-agent-sdk` 0.11.0 emits the bare keys.
- A2UIVerse's agents pin `a2ui-agent-sdk==0.9.0`. The React, Lit and Angular renderers put no component id on the DOM.

## Scope

In scope:

- Every statement about `a2ui-project/a2ui` in SPEC.md, read at the pin.
- What Spectra is, in one sentence, in every place it is stated.
- SPEC.md's "The gap" as "Existing tools", and the entry under "Open".
- The basic root README.
- Every statement about upstream in the packages' READMEs and in `CLAUDE.md`'s "Neighbours", read at the pin.
- The support statement: its home, and each package's own line.
- The backlog's text.
- The documents' step in the re-pin procedure.
- The Phase 9 spec's decision 10 and its out-of-scope line, amended in place.

Out of scope:

- The install steps in the root README. Phase 10's.
- The demo, and how Spectra is pitched in the proposal. Phase 11's.
- The documents of the viewer's raw-text readers. Sub-task 9.9's.
- The READMEs read against Spectra's own code. The doc sweep before release.
- Facts about repositories other than `a2ui-project/a2ui`.
- The `@child`, `@action` and `@functionCall` backlog item, written at the phase's close under the Phase 9 spec's decision 6.

## Locked decisions

### 1. This sub-task and sub-task 9.9

This sub-task does not wait for sub-task 9.9, the raw-text readers at the pin. Sub-task 9.9 carries the documents of its own area.

### 2. SPEC.md's statements about upstream

Every statement about `a2ui-project/a2ui` in SPEC.md is read at the pin and written again where it has moved, wherever it sits: the places the Phase 9 spec's decision 10 names, and "Framing", "Preview", "Adopter path" and "Governance". Facts about other repositories keep the dates they carry: the table of outside tools as of 2026-10-17, the AG-UI and CopilotKit facts of 2026-10-17, the OpenTelemetry conventions at v1.42.0, ADK at 2.3.0.

### 3. A statement that cannot be established

A statement about upstream that cannot be established at the pin is removed, or cut back to what can be shown. Three are known: the count of agent entries under `samples/community/agent/adk/`, the Composer's errors tab, and AG2 as an agent framework upstream names.

### 4. The pin in SPEC.md

The pin's commit and date are written once in SPEC.md, at the head of "Upstream landscape". The other sections refer to it.

### 5. What Spectra is

"A debugging and observation tool for the developer of an A2UI agent: attach to the running agent, see every turn, check and preview it, record and replay it." The sentence, or its first clause where the place holds less, stands in every place Spectra states what it is: the root README's opening, SPEC.md's header and "What Spectra is", `CLAUDE.md`, the tool package's `description`, and the first line of `a2ui-spectra --help`, with any test that asserts the help text.

### 6. "Existing tools" in place of "The gap"

The section is retitled "Existing tools". It opens with Spectra's claim on its own terms: what Spectra is for any A2UI agent, in any language and on any framework, seeing inside the turn and replaying it without paying for the model, behind one turn record format and one viewer. What exists follows as a survey: upstream's tools and roadmap at the pin, then the outside tools with their date. No sentence argues from what upstream lacks.

### 7. The nearest items, named

The survey gives the roadmap's five stages and the CLI's place in them, and names the items nearest to Spectra with their paths: first the root README's CLI line and the roadmap page's CLI table; the evaluate stage's framework and its planned tooling, "tool usage as a judge" included; the monitor stage's planned guidance on logs; the Gallery App; the "Protocol Debug Inspector" drawer; the Composer; Flutter's tools in the "Dev tools" table. The CLI is listed among upstream's tools with what it does and what upstream plans for it.

### 8. The entry under "Open"

The entry asks where a debugging and observation tool sits in upstream's roadmap, whose five-stage loop has no stage for it. The CLI appears in it as a fact: upstream plans the CLI to cover every stage. The Phase 9 spec's decision 10, which puts Spectra's relation to the `a2ui` CLI under "Open", and its out-of-scope line giving that relation to Phase 11 are amended in place to say this.

### 9. The "Framing" quote

"Transport decoupling" is quoted from the v1.0 protocol document, the current version.

### 10. "The wrapper"

"The wrapper" names the supported agent SDKs under the Phase 9 spec's decision 7, the Python wrapper's floor at `a2ui-agent-sdk` 0.11.0, and decision 8, the pin's main and the published latest. It states that a skill written by upstream's `SkillGenerator` is not reported, as sub-task 9.5's decision 2 has it.

### 11. The support statement's home

The root README is the one home of the support statement with its version numbers: the protocol versions under the Phase 9 spec's decision 4, each upstream package's published latest under decision 8, which form of the envelope keys that release reads or emits, and the bare keys' handling under decision 5. Each package's README states its own package's line and links to the root README: an adapter's names its renderer's peer range and the form that renderer reads; a wrapper's names its SDK floor. SPEC.md states the rule and the floors, and gives the published-latest numbers only in "Upstream landscape", as dated facts.

### 12. The basic root README

It holds what the Phase 9 spec's decision 11 lists: what Spectra is and does, in the present tense; the support statement; the packages in the repo, each linked to its own README. It is written for a reader new to Spectra and interested in generative UI, and shows Spectra on a live turn of upstream's Python restaurant finder: a GIF of the turn arriving and a screenshot of the closed turn, in light and dark, under `docs/images/`. What Spectra does follows SPEC.md's five v1 feature groups, one line each: seeing the turn, checking it, using the drawn surface, not paying for every run, the dev loop. A short status line says Spectra is not released yet and runs from source, linked to `tools/spectra/README.md`; Phase 10's install steps replace it.

### 13. The packages' READMEs and `CLAUDE.md`

Every statement about `a2ui-project/a2ui` in the packages' READMEs is read at the pin and written again where it has moved, under decision 2's rule. `CLAUDE.md`'s "Neighbours" line on reading upstream is brought to the pin and the `a2ui-upstream` worktree.

### 14. The backlog

The two items the Phase 9 spec's decision 12 names keep their place with their text at the pin: the A2UI step for A2UIVerse's agents, its floor 0.11.0, the agents on 0.9.0; the hover link, the renderers still putting no component id on the DOM at `0888f88b2`. Every other backlog line's statement about upstream is read under decision 2's rule.

### 15. The documents' step in the re-pin procedure

The re-pin procedure gains a step for the documents, in the roster step's shape: the move judges, and the writing is outside the move, in the sub-task the judgement adds under the Phase 9 spec's decision 3. At a move, every statement about upstream in SPEC.md, the root README, the packages' READMEs and `CLAUDE.md` is read again at the new pin and judged as standing or to be written again. When a local patch gives way to a published release without a move, the support statement alone is judged: the root README's and the adapters' lines.

### 16. The read at this sub-task's close

The full read of decision 15 runs once at this sub-task's close, on the finished documents, by a reader who did not write them.

## Invariants

- Every statement about upstream this sub-task writes rests on a path at the pin.
- SPEC.md's design text is unchanged outside its statements about upstream, the sentence of decision 5 and the section of decision 6.
- The root README carries no install step and no demo.
