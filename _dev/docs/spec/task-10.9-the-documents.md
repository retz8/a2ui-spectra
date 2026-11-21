# Sub-task 10.9 — The documents

Spectra's documents in their released form: the design docs in `docs/design/`, every README in the repo, the viewer's hint for switching on a wrapper, and a stable public address for the config file's schema and the turn record's. Sub-task 10.9 of the Phase 10 spec, `_dev/docs/spec/phase-10-shipping.md`, carrying out its decision 16, the documents are written in their released form, and the part of its decision 17, no paid signing, that the README states. Nothing is published.

The upstream check at this sub-task's start, on 2026-11-21, read `upstream/main` at `5ff1b05f0` (2026-11-20), 50 commits after the pin `0888f88b2`, the commit the 10.8 spec opens with, and found no event: npm and PyPI carry no new release of an upstream package; the three v1.0 schemas and the v1.0 basic catalog are unchanged, `specification/versions.json` is unchanged and the five watch-list items are open; no commit has landed on a held-by finding's paths since the 10.8 spec's reading; no OpenTelemetry release inside a stated range is newer than the lockfiles resolve; and upstream's two install scripts and their test are unchanged since the pin.

## Scope

In scope:

- The twelve design docs in `docs/design/`, with their diagrams, excerpts and screenshots.
- Every README in the repo, each rewritten for its own reader.
- A packed README's links and images, and the checks on them.
- The root README's install section, and what its text on a binary downloaded by hand rests on.
- The viewer's hint for switching on a wrapper, on the "Spectra viewer UI" canvas and in the build.
- The public address of the config file's schema and of the turn record's schema.
- The checks and audits the documents are held by.
- The lines this sub-task adds to `_dev/TODO.md`'s backlog and to its Phase 11.

Out of scope: publishing anything; deleting the root README's status line, Phase 11's; the trial of the hand-download steps on a binary downloaded through a browser from the release page, Phase 11's; the demo in the root README, Phase 12's; the skill for a coding agent, sub-task 10.11; the `AGENTS.md` file, sub-task 10.12; a listing in SchemaStore, the backlog's; a hosted site for the documents or the schemas.

## Locked decisions

### 1. A design doc's reader

A design doc is written for the developer of an A2UI agent who uses Spectra and wants to know how a part of it works. They know their own agent, its framework and A2UI. They are not assumed to know OpenTelemetry's GenAI conventions, A2A's wire details, MCP's transports or how the binary is built. Contributor-only material stays out of the design docs.

### 2. A design doc's fixed core and free middle

A design doc keeps the sense of a design doc without one format across all of them. Every design doc holds three elements:

- an opening that says what the doc covers and how it is laid out;
- the design decisions, each with what it buys and what it costs;
- where the code is.

Between them, its breakdown and its sections follow its subject. A running example, a table of what goes wrong, known limits, a glossary and diagrams appear where the subject calls for them.

### 3. A design doc's tone

A design doc is explanatory and descriptive, and is treated as a DX product. A2UIVerse's design docs, `../a2uiverse/docs/design/`, are the references for the tone.

### 4. Two layers, and one home for each statement

The documents are two layers. A README holds what an adopter looks up while using Spectra, in short form. A design doc is the full truth of its part, exact rules and edge cases included, kept findable in tables and lists. A doc whose subject is a surface has a reference-shaped middle. Each statement has one home, and a README's short form links to it.

### 5. The twelve design docs

| Subject | What it explains |
| --- | --- |
| A turn, end to end | The entry doc: one turn from the message box to the viewer, passing each part once, with links into the others |
| The wire | The wire proxy and the message box: where A2UI sits in an A2A message, how a turn opens and closes, the trace context added to each request |
| Model and tool calls | Redirection, the model proxy and the tool proxy: how a call is placed in its turn, credentials stripped, tokens, the estimated cost and the price table |
| OpenTelemetry | The receiver: each producer's dialect, how a span joins a turn, late spans |
| The A2UI step | The two wrappers: what they patch, what their spans carry, the pinned API, raw text linked to components, retries |
| The checks | The four checks, the catalog registry, a changed catalog file, the legacy form of the v1.0 envelope keys |
| The preview | The preview protocol, the core and the three adapters, the built-in page, a press, the version mismatch |
| Replay and fixtures | The request key, the served order, the two modes, the verdict, `replay` and `test`, the store and the fixtures folder |
| The agent's process | Under `run`: start, restart, restart on save, the agent's output, the stop, and the process tree on Windows |
| The viewer | The page: what each area shows and what it is derived from |
| The API | The routes under `/api/` and the live stream, for a script or a coding agent |
| Distribution | The binary, its packages, the install scripts, what a release verifies and how an adopter verifies it |

### 6. What has no design doc

The turn record's specification, `specification/turn_record/v0_1/docs/turn_record.md`, stays the contract where it is, and the design docs link to it. The config file has no design doc: each setting's exact rules are in its part's doc.

### 7. The command's README is the home of the commands, the options and the config file's general rules

The command forms, the options table and the config file's general rules, where the file is found, that it is read strictly and that the command line takes precedence over it, have their one home in the command's README. What `run` and `attach` do in order at start is in the agent's process doc and the wire doc.

### 8. Excerpts, the default example and screenshots

- Every excerpt is cut, not typed: a terminal line, a piece of a turn record, a model request or a span comes from a real run or a committed file, and the doc says which.
- Upstream's Python restaurant finder is the default example, the agent in the root README's GIF and screenshots. A doc uses another agent only for what that one does not exercise.
- Screenshots appear in the viewer doc and the entry doc alone, as light and dark pairs taken from a fresh run.

### 9. Diagrams

- The product's one picture, the agent, the four taps and the viewer, is a drawn diagram shared by the root README, the command's README and the entry doc.
- Each design doc's lead diagram, the picture that carries its main idea, is a drawn diagram.
- Every other diagram inside a design doc is Mermaid.
- A README carries no Mermaid.

A drawn diagram is committed as SVG, a light and a dark file.

### 10. The drawn diagrams' tool and look

The drawn diagrams are made with the `diagram-design` skill, `cathrynlavery/diagram-design`, which Jioh installs before the first set's diagram. Its style guide is written once from the viewer's tokens: the viewer's colours in light and dark, the brand colour as the one accent, and a system font stack led by Inter. Each diagram's source is committed beside its two exported SVGs.

Whether its export keeps text as text and honours the system font stack is established on the first diagram. Where it does not, the export step is SVG written by hand.

### 11. Contributor material

Each README closes with a short "Development" section holding its prerequisites and its build, lint and test commands, as upstream's `@a2ui/react` README has it. The tool README's source-file listing is not kept as a listing: each design doc's "where the code is" carries its part. How the binary is built, packaged and released is the distribution doc's subject.

### 12. Two product READMEs

- The root `README.md` is the landing page: the case for Spectra, the screenshots, the install section, how it works, what it supports, and the map to the documents.
- `tools/spectra/README.md` is the command's README, the one every npm package, wheel and archive of the binary carries and the registries show. It opens with what Spectra is and one screenshot, then holds the install commands, the first run, the commands and the options table, the config file's settings a line each, the going-deeper steps, and links to the design docs.

The install commands appear in both, and the install check reads them in both.

### 13. A library's README

The READMEs of the five libraries an adopter installs, the React, Lit and Angular preview adapters and the TypeScript and Python wrappers, hold one adopter path in one order:

1. what it gives, in a line or two, with what it looks like in the viewer;
2. install;
3. the smallest working setup, as code to copy;
4. what it supports: the upstream package, its floor and the tested latest;
5. when nothing shows up: the most likely causes and the line Spectra prints for each;
6. a link to its design doc;
7. the "Development" section.

The three adapters' READMEs read alike except for the framework's own code, and the two wrappers' likewise. The preview core's README says first that an adopter wants an adapter, then serves the author of an adapter with a short description and a link to the preview doc.

### 14. The READMEs no package carries

Every README in the repo is rewritten, each for its own reader.

- `tools/spectra_viewer/README.md` and `tools/spectra_basic_preview/README.md`: their detail is in the viewer doc and the preview doc. Each holds what the workspace is and where it ends up, a link to its design doc, and the "Development" section.
- The three sample READMEs under `samples/preview/` are adopter-facing: how to run the sample and what to copy from it, in one order across the three. The adapters' READMEs point to them as the full example behind the smallest working setup.
- The turn record's index, `specification/turn_record/v0_1/README.md`, the two notes on copied upstream files, `tools/spectra/src/check/schemas/README.md` and `conformance/test_data/catalogs/README.md`, and `conformance/README.md` keep their developer reader and their content, and are rewritten as documents with a structure.

### 15. A packed README's links and images

A README in the repo links by relative path. The packing commands write each relative link and each image of a packed README as an absolute GitHub URL at the tag of the version being packed. The package checks refuse a packed README that holds a relative link, or a link whose target is not in the repo. The design docs are not packed and link by relative path.

### 16. The root README's install section

The section holds:

1. the four commands, as the install check reads them, each under one line saying what it needs and what it does;
2. one line naming the five platforms, and that Windows arm64 and Linux on musl are not supported;
3. one line that the binary makes no request of its own;
4. a collapsed block, "Downloading the binary by hand": verifying the checksum and the build provenance attestation, clearing the download mark on macOS and on Windows, and what is and is not established, Smart App Control named.

The distribution doc carries the full account. The command's README repeats the commands and the platforms line, and links to the root README's block.

### 17. What the hand-download text rests on

Each step of the block, and each statement about Gatekeeper, SmartScreen and Smart App Control, is taken from Apple's and Microsoft's own documentation, and the distribution doc cites the pages. The clearing steps are tried as the README words them on a binary that carries the mark: on Jioh's Mac, with `com.apple.quarantine` written onto the built macOS binary, and on a Windows runner, with the `Zone.Identifier` stream written onto the Windows binary; each is launched, cleared as the README says, and launched again.

### 18. The npm launcher's stop

That under the npm launcher the SIGTERM or SIGHUP that began a stop, arriving again, does not force the agent's process to stop, and a second Ctrl-C still does, is stated in the agent's process doc. The command's README says that Ctrl-C stops Spectra and the agent.

### 19. The status line and the pre-release install lines

The root README alone carries the status line. The pre-release install lines, the Python wrapper from a git URL and the TypeScript wrapper from a tarball path, leave the READMEs and the viewer's hint.

### 20. The switch-on hint

- The hint's install lines are the registry installs, as the two wrappers' READMEs give them.
- A test holds each line of the hint equal to the line in its wrapper's README.
- Each of the hint's two columns gains one link to that wrapper's README at this Spectra's version tag.
- The link is drawn on the "Spectra viewer UI" canvas first, and the build follows it.

### 21. The schemas' public addresses

The config file's schema is served from this repo's `main` on raw GitHub, at the file's present path. The schema carries that URL as its `$id`, and every example config in the documents carries it as `$schema`. The running tool keeps serving its own copy. The turn record schema's `$id`, already of that form, is its stable public address. A test holds each of the two schemas' `$id` to the raw URL of the path its file sits at.

### 22. The documents describe `main` as it stands

The documents describe Spectra as it is on `main`, the amendments to turn record `v0.1` that sub-task 10.8 landed included.

### 23. One TODO line, in this order

Sub-task 10.9 stays one line in `_dev/TODO.md`, worked in this order:

1. the link check and the packing commands' link rewriting;
2. the first set: the A2UI step design doc, the Python wrapper's README, the A2UI step doc's lead diagram and the style guide it needs;
3. the remaining design docs, READMEs and diagrams, with the hint's round on the canvas, the two `$id` tests and the install check's second README;
4. the two audits;
5. Jioh's review of the documents; what it settles about tone, depth, layout and the diagrams' look is written into this spec as an amendment, and the documents are brought in line with it.

### 24. What the documents are held by

- The package checks on a packed README's links, decision 15.
- The test on the hint's lines, decision 20.
- The test on the two schemas' `$id`, decision 21.
- The install check reading the install commands in both READMEs, decision 12.
- The trial of the clearing steps, decision 17.
- A check in CI that every relative link and every heading anchor in every tracked Markdown file resolves.
- The carry-over audit: each section of the READMEs as they stood at this sub-task's start is read against the new documents, and every statement has a home or is dropped on purpose, as a duplicate or as part of the source-file listing.
- The reading against the code: each design doc is read against the code and the tests by a reader that did not write it, a fresh agent per doc, finding the statements the code does not bear out.

### 25. The TODO's other lines

- The backlog gains a listing of the config file's schema in SchemaStore, so that an editor recognises `a2ui-spectra.json` by its name.
- Phase 11 gains the trial of the root README's hand-download steps on a binary downloaded through a browser from the release page.

## Invariants

- Each statement has one home.
- Every excerpt is cut from a real run or a committed file.
- Where a document and the code disagree, the code is the authority.
- The four install commands stay as the install check reads them.
- A change to the viewer's UI is drawn on the "Spectra viewer UI" canvas first.
- Nothing is published.
