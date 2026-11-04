# Task 6.6 — The acceptance run

Spec for sub-task 6.6 of Phase 6 — The A2UI step (`_dev/docs/spec/phase-6-the-a2ui-step.md`), carrying out its decision 18, the acceptance run: the real viewer, through the tunnel, taken through every board Phase 6 added to the design canvas "Spectra viewer UI", in light and dark, under `run` and `attach`, on Gemini, across the four targets with each wrapper switched on both ways; what the run finds is fixed within the sub-task.

## Scope

- Where the targets run from.
- The sessions: which target runs under which entry point, with which switch-on route, and what else is instrumented beside the wrapper.
- The store the run starts with, the tunnel's port, the preview and the catalogs configured.
- The boards the run covers, and where the states no session produces come from.
- The walk of the earlier flows, the keyboard, dark and the window sizes.
- What counts as a finding, and where each finding goes.
- The two retries at the pin.
- The model and the turns sent.
- The other documents, the worktree after the run, and the done line.

## Locked decisions

### 1. Where the targets run from

The `a2ui-upstream` worktree moves to `9e8a9bac5`, the pin, and every target runs from it: the Python restaurant finder, the custom-components example and the community rizzcharts sample from its uv workspace, whose packages build at that commit as `a2ui-agent-sdk` 0.10.0, `a2ui-core` 0.5.0, `a2ui-adk` 0.2.0 and `a2ui-a2a` 0.2.0, the four tags pointing at it; the Node restaurant finder from its Yarn workspace, `@a2ui/agent` built as 0.1.0. The SDKs are the same code and the same versions as the releases the wrappers are pinned to; 6.5's live run already proved the released wheels once. The wrappers are installed beside the samples from this repo.

### 2. The sessions

Five sessions, in order. A one-line route means one line added to the sample's own source in the worktree, reverted after the run.

| # | Target | Entry point | Wrapper route | What it is for |
| --- | --- | --- | --- | --- |
| 1 | The Node finder, Direct JSON | `attach`, two legs: restarted with the printed model and receiver variables set and no wrapper, then restarted with the wrapper on | `--import` | the hint with its `attach` sentence under the first leg's model calls; then the parse rows of a streamed Direct JSON reply |
| 2 | The Node finder, Express | `run` | one line, `instrument()` | the board of a parse with a node and its range linked, and the board of the UI section in the request, both drawn from the Node finder in Express |
| 3 | The Python restaurant finder | `run`, two legs: without the wrapper, then with it | `opentelemetry-instrument` | the hint without the `attach` sentence; Flow 6 on finding 31; the Screens pair; the small window; "Read by the parse" |
| 4 | The custom-components example | `run` | one line, `instrument()` | Flow 6 on finding 32; the boards of the failed parse and the retry |
| 5 | Rizzcharts | `run` | `opentelemetry-instrument` | the toolset board |

One target under `attach`, every other under `run`; each wrapper route used once; both forms of the hint seen live. Session 1 has no nothing-set leg: a wire-only turn holds no model call and so no hint, and the first screen's variables block was 5.7's check. The custom-components example reaches its floor plan server only inside the floor-plan tool, on a press, so session 4 runs without that server and configures no tool server.

### 3. The store, the port, the preview and the catalogs

The run starts from an empty store in a folder of its own, outside this repo and the worktree; every Spectra start is launched from that folder with the session's config passed by `--config`, so the store builds up across the sessions, each later session showing the earlier sessions' turns. One borrowed port, 5173, for the viewer. No preview page: the two restaurant finders answer in the basic catalog, which the built-in preview draws; the custom-components example and rizzcharts show "No preview for catalog …" with Structure beside it. Rizzcharts's session config names the sample's v0.9 catalog definition as a configured catalog, so the message box offers it, the catalog check reads it, and the agent's processor holds both its catalogs; rizzcharts serves v0.8 and v0.9, so its turns are v0.9. The other sessions configure no catalog, which is what makes finding 32's retry happen on the custom-components example.

### 4. The boards

Every board Phase 6 added, as the 6.1 design spec's decision 1 places them: the "The A2UI step" row's eight boards on "Turn view details"; Flow 6's four boards on the Flows page; the "Components and states" additions — the parse row plain, streamed, toolset and with a problem, the failed prompt generation's row, the retry tag, the UI section's label line folded and open, the two forms of a parse error's problem block, the "Read from" and "Read by" lines, the three ranges sentences and the hint; the parse's and the prompt generation's icons; the Screens pair "Turn with the A2UI step"; the three dark twins; the small-window board at 1,200 × 760. Each is checked live where a session produces it.

### 5. The states no session produces

- A failed prompt generation, the eighth board and its row: the conformance record `prompt_generation_failed.json` is placed in the run's store before the sessions start, as 6.5 placed its record, and checked in light and dark.
- The read-past problem form, "The stream rejected this block and read on"; the three ranges sentences, on a parse that names no format or that a reader cannot finish; and Elemental and Atom: no target and no full record produces them. They stay pinned by the viewer's tests on hand-written records and by the readers' proof on the suite, and the done commit names them as not checked live.

### 6. The earlier flows

Flows 1 to 5 are walked once each on the Node finder's session, Flow 4 on the built-in preview, Flow 5 on a conversation of two turns without the prompt change, each judged for whether the flow still works and not board by board.

### 7. The keyboard

Flow 6 is done once by the keyboard alone, in light at full width, on the Python restaurant finder's session after its pass with the mouse: the turn reached in the list, the failed parse landed on, "Show text" reached by Tab and followed by Enter, the retry reached by the arrows, its parse link by Tab and Enter, and the tree node last. A step that cannot be done without the mouse is a finding. If the tree's rows take no key, that finding is fixed in the run by making a node's row focusable and selectable with Enter, with no new key in the list of keys.

### 8. Dark

3.7's rule: in dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light. The three dark twins — the Screens pair's dark half, the parse with a node and its range linked, and the UI section in the request — are checked board by board against their drawings. Every session is seen in both themes.

### 9. The window sizes

The Python restaurant finder's retry turn at 1,200 × 760 against the small-window board, by a real window resize if the browser takes one, else a frame of that size laid over the page, as 6.5 did; then the timeline narrowed by the divider to 380 px and to 340 px, where the retry tag and the problem mark keep their width while the muted targets give way. The same turn's parse detail with Maximize pressed on a window as tall as the screen allows, the raw text's long reply and "Show text" scrolling checked there.

### 10. What counts as a finding

5.7's rules, unchanged where they apply: any difference of design between the viewer and a board — the layout, an element missing or extra, the wording, a state, spacing, colour, behaviour — is a finding, fixed in the viewer or, where the board is wrong, amended on the design canvas; a difference of content between a real agent's turn and a board's is not a finding, nor is a feature of a later phase; a route of the run that does not work is a finding; a fault in a sample or in upstream's SDK goes to `_dev/a2ui-findings.md` and is not fixed here; a fault in an OpenTelemetry producer goes to `_dev/otel-findings.md`. A2UIVerse's destinations do not apply, none of its agents being in the run.

Three destinations join them:

- A wrapper that reports a parse, a prompt generation or an error wrongly, or changes what the SDK does, is fixed in the wrapper, and the text that showed it becomes a wrapper capture suite case through the recorder and the record-writer under `_dev/tools/`, in both languages where the format exists in both.
- A reader whose ranges miss or misplace a component of a live reply is fixed in the reader, and the reply becomes a wrapper capture suite case too, the suite being the readers' oracle.
- The viewer's computed rules — the retry, the model call a parse read, the parse a component came from and the UI section's placement — wrong on a live record are fixed in the viewer, with the record's shape pinned by a hand-written test, as 6.5's tie fix was.

### 11. The two retries at the pin

Each retry is walked as Flow 6 on its live turn: the header's problem count, the turn opening on the failed parse with its block marked, the retry with its cause, the final tree's component selecting the retry's parse. The Python restaurant finder's on "Top 3 Chinese restaurants in New York" over the message box's stream, finding 31's reproduction; the custom-components example's on "Who is Alex Jordan?", finding 32's.

Each finding gains one paragraph on what the wrapper showed at the pin where it adds something: finding 32 the rejected block's error and class as the parse reports them, the retry's own parse failing the same way, the example giving up, and the trace id; finding 31, whose paragraph 6.5 wrote, the trace id of the run's turn alone.

Finding 32 depends on the model answering with the org chart in `inline_catalog`. If a turn does not retry, the question is sent again in a new conversation, up to three turns; past that the run records it as not reproduced at the pin and Flow 6 is walked on the Python restaurant finder's retry alone.

### 12. The model

Every target on `gemini-3.6-flash`. Three samples default to it: the Python finder through ADK's Gemini class, the custom-components example through LiteLLM as `gemini/gemini-3.6-flash`, the Node finder through `@google/genai`. Rizzcharts defaults to `gemini/gemini-2.5-flash` and is moved by its own switch, `LITELLM_MODEL=gemini/gemini-3.6-flash`, so one model serves the run and no sample's code changes for it.

### 13. The turns sent

Each question is the sample's own or a finding's reproduction; none is invented for the run.

- The Python finder: "Top 3 Chinese restaurants in New York", one turn without the wrapper and one with it.
- The custom-components example: "Who is Alex Jordan?".
- The Node finder in Direct JSON: one turn on the first leg with no wrapper; then, with the wrapper on, a conversation of two turns for Flows 1 to 5 — the card's own example, "Find me the top 10 chinese restaurants in the US", then a Book button pressed in the preview for Flow 4, its action the second turn and Flow 5's prefix-break pair.
- The Node finder in Express: the same first question, once.
- Rizzcharts: its card's example, "show my sales breakdown by product category for q3", a chart through the toolset.

### 14. What else is instrumented

- Under `opentelemetry-instrument`, sessions 3 and 5: 5.4's recipe as 5.7 kept it — the distro, the OTLP HTTP exporter and the bootstrap set for the agent's environment, the Click instrumentation off. The turn shows ADK's span tree with the wrapper's parse and prompt generation spans among it, and on rizzcharts the toolset's ADK tool span joining its parse's row.
- With the one line, sessions 2 and 4: nothing else. The process has no provider, so the wrapper starts its own with the OTLP/HTTP exporter from the variables `run` sets, and the turn shows the proxies' calls and the wrapper's spans alone, no framework tree — the provider-start rule of the Phase 6 spec's decision 4 seen live.
- Through `--import`, session 1: nothing else either, the Node finder having no framework instrumentation; the wrapper's provider reads the printed variables set in the agent's shell.

### 15. Other documents

- The Phase 6 spec: decision 18 stands as written; this spec carries which target goes with which entry point and route. No amendment unless the run departs from it.
- `_dev/TODO.md`: the 6.6 line names this spec, and gains its done line at the tick.
- `_dev/a2ui-findings.md` and `_dev/otel-findings.md`: as decisions 10 and 11 have it.
- `conformance/README.md`: gains a case only if decision 10 adds one to the wrapper capture suite; otherwise unchanged. SPEC.md, the turn record and the two wrappers' READMEs are unchanged unless a fix touches what they describe.
- This spec gains, after the run, what the run fixed, the design canvas's amendments and the findings recorded, as 5.7's did.

### 16. The worktree after the run

`a2ui-upstream` is left at `9e8a9bac5`, Spectra's pin and where the next re-pin starts from, with the one-line edits reverted and the wrappers' installs left in place. The workspace-level CLAUDE.md one folder up, which describes the worktree as detached at `upstream/main`, gets its line corrected to the pin.

### 17. Done when

- Every session of decision 2 has been through its part; every board of decision 4 is seen in light and dark, apart from the forms decision 5 names as not checked live; Flows 1 to 5 are walked once, and Flow 6 live on both retries and once by the keyboard.
- Every finding has gone where decisions 10 and 11 send it.
- The unit tests, the turn record validator, the five capture suites, the three end-to-end tests and the Python wrapper's checks pass after the fixes, under Node and against the binary, locally and in CI.
- This spec carries decision 15's last item.
- The done commit names the forms not checked live, the tall window's height, the worktree's ref `9e8a9bac5` with the installed versions of the four Python SDK packages, `@a2ui/agent`, google-adk, LiteLLM, the OpenTelemetry distro and Node, and the model.

### 18. What the run fixed

- The hint on a model call of a turn with no A2UI step events sits first under the call's Response label, as the Components page and the board of no A2UI step events draw it, where it had followed the response's blocks; its fold line is a block label, "How to switch it on", in the labels' small capitals; the two languages stand side by side with no card of their own; and under `attach` each launch line's caption adds "with the variables on the first screen set in the agent’s shell" and its launch drops `a2ui-spectra run --`, where the sentence above had taken the addition and the launch had kept `run`. Seen on the Node finder's first leg under `attach` and the Python restaurant finder's first leg under `run`.
- "Read by the parse" lines sit first under the Response label too, before the output, as the retry's board draws them.
- A retry's sentence is a plain grey line under the title line, as the retry's board and Flow 6's third board draw it; it had carried a "Retry" label of its own.
- "Retried by the call at +X" stands on its own line under "Read from", as the Components page draws it; it had followed the "Read from" link after a dot.
- With a parse selected, the result pane's note reads "After the parse’s last message, +X", the boards' wording, where it had read "After the delivery at +X".
- The prompt's UI section is one region on the faint neutral tint holding its label line, its text under the label and its closing line inset to the label, as the Components page draws it; the label had sat outside the tint, the text unindented.
- The parse's and the prompt generation's icons are the Icon component's, lines of raw text beside two linked boxes, and lines with a pen; the viewer had drawn angle brackets around a box, and a page.
- A block's Copy draws its icon before the word, as every board of the A2UI step draws it; an address's copy button keeps its icon after the address.
- A parse or a failed prompt generation that states no end is an instant, a dot at its start with no duration, as the failed prompt generation's row is drawn; the conformance record `prompt_generation_failed.json`'s had been drawn as a bar to the turn's end, "1.4 s".
- Show text, and a selected node's range, scroll a range taller than the pane from its start; on the Python restaurant finder's retry, whose rejected block is the whole second copy of the reply, Show text had landed in the block's middle.
- A link in a step's detail that selects another step, "Read from", "Retried by", "Read by the parse", a retry's "failed to parse" and a prefix break's link in the same turn, gives the timeline focus, so the keys go on from it; focus had fallen to the page. Found walking Flow 6 by the keyboard.
- "Read from" names the call's tool call, "The tool call of gemini-3.6-flash at +3.1 s", when the parse's input sits in one of its tool calls' arguments and in none of its text, as the Components page and the toolset's board have it; it had always said "The reply of". Seen on rizzcharts.
- The header's tool call count leaves out the toolset's tool call, shown as its parse, as the toolset's board counts; rizzcharts' turn had read "2 tool calls".
- A parse's detail lists "Raw text", then the toolset's "Returned to the model", its `validated_a2ui_json` folded, then "Messages", folded on its label line with its count, as the 6.1 spec's decision 8 and the toolset's board have them; "Messages" had come first, open with its array folded inside.
- A toolset parse's spans section shows the parse's own span first, its scope's source line and its translated names, then the tool call's chain, "Above this tool call", `execute_tool` marked "this tool call", as the toolset's board draws it; the viewer had drawn one chain "Above this parse", marking `execute_tool` "this parse".

### 19. The design canvas

A selected component's tint is its own range: the board of a parse with a node linked, its dark twin and Flow 6's fourth board tint the Card's statement and the Button's object alone, and the Components page's state reads "its own range in the teal-soft tint, its statement in Express or its object in Direct JSON". A rejected block is red whole, between its tags: the Python restaurant finder's failed parse, on Flow 6's boards, the "Turn with the A2UI step" pair and the small window, and the custom-components example's failed parse; Flow 6's second board is titled "2 · Show text: the rejected block is the reply’s second copy, from its createSurface default on". The basic catalog reads "basic, v1.0" and "basic, v0.9" in the headers, the UI sections' labels and the Components page. The hint's captions and lines are the two packages' READMEs', on the board of no A2UI step events and the Components page. The toolset's parse and the failed prompt generation leave `a2ui.event.kind` out of their translated names. Published as version `1793792570-b753`.

### 20. A2UI findings

Findings 31 and 32 gain what the wrapper showed at the pin. Finding 31 names the run's turn, trace `e6cc470d890bdbfbaddff4a9a6687ac3`. Finding 32 gains the first attempt's stream stopping on the reply's first block with `Catalog not found: inline_catalog`, an `A2uiValidationError`, after that block's `createSurface` was sent; the retry's stream failing too, on an `OrgChart` the model moved into the basic catalog, `Unrecognized component type 'OrgChart'`, after the messages before it were sent; the example giving up; and the trace, `c7d120f29b28029ec96c08b5709c590a`. Finding 23 gains the community rizzcharts sample, on the same ADK executor, sending the toolset's three messages twice, in a status update and again in the artifact, its second `createSurface` rejected, trace `cbc0a67c10e4c37223447661094369c6`.

### 21. OpenTelemetry findings

None.

### 22. The sessions

All from the `a2ui-upstream` worktree at `9e8a9bac5`, on `gemini-3.6-flash`, through the tunnel on 5173, from one store in a folder of its own that held `prompt_generation_failed.json` from the start.

1. The Node finder in Direct JSON under `attach`. The first start, with nothing set, stayed up when the restart stopped its shell and not its process, and served one wire-only turn, trace `fecf604c14e3d0945466ce434613d811`, before the first leg's agent took the port. The first leg, the printed model and receiver variables set and no wrapper: trace `3b2de5c23604c1771f2be59295f672a5`, four model calls, the hint with its `attach` sentence. The second leg, through `--import`: the card's example, trace `6b541a9a…`, its stream's parse row "Direct JSON · streamed" opened before the first model call and tied to the fifth, then Book pressed in the preview, trace `86424a2b…`; Flows 1, 3, 4 and 5 walked on the two, Flow 5's link landing on the first turn's call. The Node finder's turns had no problems, so Flow 2 was walked on the failed prompt generation's record in the same session.
2. The Node finder in Express under `run`, with the one line in `src/index.ts`: trace `e5fcf7e26b6bd2d6e95419ef8cd2c46e`, its parse "Express · streamed", a Card selected in the tree and the raw text clicked back, the UI section open in the second call's request; no framework spans, the wrapper's provider started on the variables `run` set.
3. The Python restaurant finder under `run` and `opentelemetry-instrument`: the first leg with the wrapper's entry point, `a2ui`, in `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS` beside `click`, trace `7cb85147bab51e0efcb0f241284362c9`, the hint without the `attach` sentence; the second leg with the wrapper, trace `e6cc470d890bdbfbaddff4a9a6687ac3`, finding 31's retry, Flow 6 walked by the mouse and by the keyboard, "Read by the parse" on the retry, the small window as a 1,200 × 760 frame laid over the page, the window taking no resize, the timeline narrowed to 380 px and 340 px, and Maximize on the window as tall as the screen allows, 1,040 px, its page 897 px.
4. The custom-components example under `run`, with the one line in `__main__.py`, no catalog and no tool server configured: "Who is Alex Jordan?", trace `c7d120f29b28029ec96c08b5709c590a`, finding 32's retry on the first turn, Flow 6 walked by the mouse. Under the one line ADK's own spans arrived too, 204 framework spans: ADK traces through the global tracer provider, and the wrapper's provider became the process's.
5. Rizzcharts under `run` and `opentelemetry-instrument`, `LITELLM_MODEL=gemini/gemini-3.6-flash`, its v0.9 catalog configured: the card's example, trace `cbc0a67c10e4c37223447661094369c6`, the toolset's tool call as its parse's row, "Parse · send_a2ui_json_to_client · Direct JSON".

Every session was seen in light and dark; the three dark twins were checked board by board after the fixes. Not checked live: the read-past problem form, "The stream rejected this block and read on"; the three ranges sentences; Elemental and Atom; a configured catalog named in the header, rizzcharts' turns using the basic catalog.

### 23. Content, not findings

- A rejected block of a stream fed its reply twice is the whole second copy between its tags, as the record states a block; the canvas marked the failing message alone and is amended to the whole block, and the failing message marked within its block is a backlog line.
- A component written as its own Express statement tints that statement alone when selected, as a child's object does in Direct JSON; the canvas tinted its descendants' statements too and is amended.
- Rizzcharts takes the first of the catalogs it negotiates (`agent_executor.py:127`), and the message box lists the basic catalogs before the configured ones, so its turns are in the basic catalog.
- A muted target squeezed below an ellipsis's width shows a sliver of it.
- The boards' "System prompt 2,310 tokens", tokens split by where they went, is a feature after v1.
