# Sub-task 9.8 — The acceptance run

The acceptance run of Phase 9: the binary, through the tunnel, at the pin `0888f88b2`. Sub-task 9.8 of the Phase 9 spec, `_dev/docs/spec/phase-9-upstream-v1.0-and-supported-versions.md`, carrying out its decision 14, the acceptance run, and taking what three sub-task specs leave to it: from the sub-task 9.3 spec, the checks at v1.0, a v1.0 turn in each form through the tunnel; from the sub-task 9.5 spec, the wrappers, the live turns on the custom-components example and the Node restaurant finder; from the sub-task 9.9 spec's decision 15, the wiring, the check by eye on an Express record and an Atom record.

The upstream check at this sub-task's start, on 2026-11-14, read `upstream/main` at `3ed960186` (2026-11-13), one commit after the pin `0888f88b2`, touching none of the areas Spectra uses; every copied file unchanged; no new release on npm or PyPI; `specification/versions.json` unchanged; the five watch-list items open; no commit on a held-by finding's paths: none of the three events of the Phase 9 spec's decision 2.

Before the run, as read at the pin:

- The search for expected-to-fail marks finds nothing. The `a2ui-upstream` worktree is at `0888f88b2` with a clean working tree; the Python restaurant finder's folder holds the store of sub-task 9.5's live check, one turn.
- The Python restaurant finder and the custom-components example serve v0.8 and v0.9, and a host offering every version gets v0.9. The Node restaurant finder serves v0.9 and v1.0, and such a host gets v1.0. No sample serves v0.9.1. Each sample's default model is `gemini-3.6-flash`, and each answers in Direct JSON by default.
- No component in the three samples' example files, canned replies or prompt sources carries an envelope key, in either form: 483 components in 34 files.
- Phase 8's acceptance run had the A2UI step on the Python restaurant finder alone, under `opentelemetry-instrument`. Phase 6's had it on the custom-components example and on the Node restaurant finder under `run` through the one line `instrument()`. The custom-components example has not been launched with the wrapper under `opentelemetry-instrument`.
- The stub agent's v1.0 booking form is chosen by the message's text: "Book a table at Han Il Kwan" gives the `@` form, "…, bare" the bare form, "…, both" the both-forms form. The hand pass of sub-task 9.4 had the three forms through the tunnel on the binary.
- Every envelope key Spectra has met in Phase 9 was written by hand, in the stub agent's forms and the test cases.
- Each wrapper capture case's expected record is a whole turn record, and one placed by hand in the store lists in the viewer. `express_inline_numbering` is the one case of the suite with an `_inline_N` id, `_inline_1` in Python's record and `_inline_2` in TypeScript's, finding 51, `_inline_N`'s numbering. Three Atom cases hold `node_N` ids: `atom_bare_string_compiled_ids`, `atom_bare_string_placements` and `atom_bare_symbol_child`. No earlier run put an Atom record on screen.
- Phase 8's run folder was a Claude session's scratchpad folder; no document records its path.

## Scope

In scope:

- The gates: the upstream check, the build, the suites, the search for expected-to-fail marks and the two smoke checks.
- The sessions: which target runs under which entry point, and what each is for.
- The turns sent, the prompt edits, the re-run, and what a sample's session is judged on.
- The wrapper on the three samples.
- The replays.
- The envelope-key turns: the stub agent's three forms and one real attempt.
- The Express and Atom records opened from the store.
- The preview page, the tunnel's port and dark.
- What counts as a finding, and where each finding goes.
- The run's folder, the store and what is left behind.
- The documents and the done line.

Out of scope:

- The crashes and the restart's edges.
- The preview reload, and the sample pages through the tunnel.
- The catalog definition change.
- The keyboard pass and the window sizes.
- The terminal's streams and the headless `test`.
- The boards held board by board.
- A v0.9.1 turn.
- The earlier flows walked as flows.

## Locked decisions

### 1. The gates

Before the first session, on one commit, `main`'s head when the run starts:

- The upstream check, run again on the run's day. One of the three events of the Phase 9 spec's decision 2 holds the run until the sub-task that handles it is done, under that spec's decision 3.
- A clean build, as the re-pin procedure builds for its suites, and the binary.
- Everything CI runs is green.
- The search for expected-to-fail marks is empty.
- Both smoke checks pass, on the published renderers and on the published agent SDKs.

When the run fixes something, the binary is built again and what the fix touched is seen again on it. The suites and both smoke checks run once more on the final commit.

### 2. The sessions

Every upstream target runs from the `a2ui-upstream` worktree at `0888f88b2`, each sample launched from its own folder. Four sessions, in order:

| # | Target | Entry point | What it is for |
| --- | --- | --- | --- |
| 1 | The Python restaurant finder, answering in v0.9 | `run` | the two turns; the loop once; the A2UI step; the replay |
| 2 | The Node restaurant finder, answering in v1.0 | `run` | the two turns; the loop once; the A2UI step; the replay; the real attempt at an envelope key |
| 3 | The custom-components example with its floor plan server, answering in v0.9 | `run` | the two turns; the loop once; the A2UI step |
| 4 | The stub agent's v1.0 booking form | `attach` | the three forms; the legacy form's marking; the Express and Atom records |

Of Phase 8's acceptance run, the sub-task 8.7 spec's, sessions 1 to 3 repeat the sample's two turns, the question and then the press, with the checks and the preview, and the loop once: the prompt edit, the save, the restart and Re-run live.

### 3. What a sample's session is judged on

On each of sessions 1 to 3, all of these hold:

1. Each turn is captured whole: the model call read in full, with its request, its response and its tokens. On the custom-components example, the floor plan's calls go through the tool proxy.
2. The checks show no problem, apart from one already written for that sample in `_dev/a2ui-findings.md`.
3. The preview draws the surface, and the press comes back as the action and goes out as the next turn.
4. The edited line is in the re-run turn's model request, and its first model call's prefix break lands on that line.
5. The turn carries the A2UI step: its prompt generation and parse rows, and raw text selecting its component.

A difference of content between this run's turns and Phase 8's is not counted.

### 4. The turns and the prompt edits

Phase 8's, as the sub-task 8.7 spec records them:

| Sample | The two turns | The edit | The turn re-run |
| --- | --- | --- | --- |
| The Python restaurant finder | "Top 3 Chinese restaurants in New York", then Book pressed in the preview | `prompt_builder.py`, the booking line of `UI_DESCRIPTION`: the form titled "Reserve a table at <restaurant name>" | the booking turn |
| The Node restaurant finder | "Find me the top 10 chinese restaurants in the US", then Book pressed | `src/prompt.ts`, the booking line of `UI_DESCRIPTION_DIRECT_JSON`, the same clause | the booking turn |
| The custom-components example | "Who is Alex Jordan?", then the `view_location` press on Alex Jordan as a second host, the hand-made A2A request | `prompt_builder.py`, a line added under "For finding contacts": the contact's name written in upper case | the press turn |

Where the pin's source no longer holds the line an edit was made to, the edit is chosen at the run for the same visible effect and recorded in this spec.

### 5. The wrapper

On for all three samples, from each session's start, with no source edit:

- Both Python samples under `opentelemetry-instrument`, with the recipe Phase 8's run used on the Python restaurant finder: the OpenTelemetry distro, the OTLP HTTP exporter and the bootstrap's instrumentations, the Click instrumentation off.
- The Node restaurant finder through Node's `--import a2ui-spectra-instrumentation/register`.

Where a sample does not start that way or the wrapper does not switch on, the session falls back to the one line `instrument()` in the sample's entry file, reverted after, and what failed is judged under decision 12.

The Phase 9 spec's decision 14 is amended in place: the A2UI step on the three samples.

### 6. The replays

On session 1, in v0.9, and on session 2, in v1.0: the two-turn conversation is saved as a fixture and replayed with everything recorded. A replay passes when every call is served from the record and the A2UI messages equal the recorded ones.

No v0.9.1 turn is in the run. The browser end-to-end tests on the three sample pages and the smoke check on the published renderers hold v0.9.1.

### 7. The envelope-key turns

The stub agent's v1.0 booking form, in its three forms, is the gate:

- The `@` form passes the checks and is drawn in the preview.
- The bare form passes, marked as the legacy form.
- The both-forms form shows its two problems and an empty preview.

One real attempt, on session 2 after its loop: a second prompt edit asks for a check on one field of the booking form, and the booking turn is re-run. The form of the key the model writes is recorded: an `@` key is a real `@` turn, a bare key a real legacy-form turn, and no key is recorded as none. The form is not a gate. What Spectra then shows is judged under decision 12. The edit's wording is chosen at the run and recorded in this spec.

### 8. The Express and Atom records

Three records of the wrapper capture suite, placed by hand in the run's store before Spectra starts and opened in session 4: `express_inline_numbering` in Python's record and in TypeScript's, and `atom_bare_string_compiled_ids`.

In each, the component with the generated id and its text in the raw text select each other, in both directions: `_inline_1` under Python's record, `_inline_2` under TypeScript's, a `node_N` under Atom's.

### 9. The preview page and the tunnel's port

The built-in page alone draws the run's surfaces. One borrowed port, 5173, carries Spectra's viewer in every session, borrowed at the start of each sitting once Jioh says A2UIVerse's client is idle on it. Spectra is stopped at the end of each sitting.

### 10. The boards and dark

The boards of the canvas's row "The legacy form" are not held against the viewer again. The legacy form's marking is seen once, on the stub agent's bare form, at its five places: the header's tooltip, the timeline row, the step's detail, the message's line and Structure's node.

Every session is seen in light and dark, under sub-task 3.7's rule: in dark, a screen passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light.

### 11. The model and the key

`gemini-3.6-flash`, each sample's default at the pin, the Gemini key from the Linear agent's `.env` passed to the agent's process and never printed or written. The Node restaurant finder answers in Direct JSON, its default.

### 12. What counts as a finding

The sub-task 8.7 spec's rules, unchanged where they apply: a difference of design between the viewer and a board is fixed in the viewer or, where the board is wrong, amended on the design canvas; a difference of content is not a finding; a route of the run that does not work is fixed within the sub-task; a fault in a sample or in upstream's SDK goes to `_dev/a2ui-findings.md` and is not fixed here; a fault in an OpenTelemetry producer goes to `_dev/otel-findings.md`.

Three cases join them:

- Spectra's own code failing on the pin's packages, a check, a reader, the preview or a wrapper, is fixed within the sub-task, with a failing test first.
- A fault in upstream at the pin that Spectra works around for the run to pass is a finding with its held-by line and a `heldBy` entry in the pin file.
- A smoke check failing on a published latest: a fault on Spectra's side, an adapter or a wrapper not working on the published package, is fixed within the sub-task; a fault of the published package itself is a finding, and is brought to Jioh before the run goes on.

### 13. The run's folder, the store and what is left behind

- The run's folder is new, in the scratchpad of the Claude session that makes the run. The store starts empty and is moved by hand from one session's folder to the next, so each later session shows the earlier ones' turns. The store of sub-task 9.5's live check is moved out of the Python restaurant finder's folder before session 1.
- Sessions 1 and 2 have no config file. Session 3 has the `a2ui-spectra.json` Phase 8's run gave the example, naming `./inline_catalog_0.9.json` and the floor plan server as a tool server.
- `a2ui-upstream` is left at `0888f88b2` with every edit reverted; its untracked store, fixtures folders and config file are moved to the run's folder; the wrappers' installs stay in place.
- The run's folder holds the store for as long as the system keeps the scratchpad. This spec's text is the lasting record.

### 14. The documents

- This spec gains, after the run: what the run fixed, the findings recorded, the sessions with their trace ids, the wording of the prompt edits, the versions each smoke check resolved, and what was content and not a finding.
- The Phase 9 spec, amended in place: its decision 14, the acceptance run, names the A2UI step on the three samples.
- The backlog gains the rename of child references and actions to `@child`, `@action` and `@functionCall` as an item, when the upstream check before the run still reads its two pull requests, #4170 and #4171, as open, under the Phase 9 spec's decision 6.
- `_dev/TODO.md`: the 9.8 line names this spec and gains its done line at the tick.
- SPEC.md, the READMEs, the canvas, `_dev/a2ui-findings.md` and `_dev/otel-findings.md` change only where a fix or a finding touches them.

### 15. Done when

- The gates of decision 1 pass on the final commit, locally and in CI on GitHub.
- Every session of decision 2 has been through its part.
- Every finding has gone where decision 12 sends it.
- This spec carries decision 14's first item, and the other documents of decision 14 are written.

## Invariants

- No sample's code changes for the run beyond the edits this spec lists, each reverted after it.
- No credential is printed, or written into a record, a fixture, a config or a commit.
