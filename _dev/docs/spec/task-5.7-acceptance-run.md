# Task 5.7 — The acceptance run

Spec for sub-task 5.7 of Phase 5 — Inside the turn (`_dev/docs/spec/phase-5-inside-the-turn.md`), carrying out its decision 19, the acceptance run: the real viewer, through the tunnel, taken through every board Phase 5 added to the design canvas "Spectra viewer UI", in light and dark, under `run` and `attach`, across the agent stacks the targets cover; what the run finds is fixed within the sub-task.

## Scope

- The targets, the entry point each runs under, and the order of their sessions.
- The store the run starts with, the tunnel's port and the preview.
- The boards the run covers, the walk of the earlier flows, and where the states no target produces come from.
- The custom-components example's four API legs, and the sessions that run with the agent's spans.
- The live A2UIVerse agents' turns.
- The keyboard, dark and the window sizes.
- What counts as a finding, and where each finding goes.
- The two retry checks.
- The HTTP+SSE exchange's folded line and the record change behind it.
- The other documents and the done line.

## Locked decisions

### 1. The targets

- Upstream's Node restaurant finder, on Gemini through `@google/genai`.
- Upstream's custom-components example, across the four APIs through LiteLLM, with its floor plan server over HTTP+SSE, and under OpenInference and OpenLLMetry.
- A2UIVerse's Linear agent in its live mode, on Gemini, with Linear's hosted MCP server over streamable HTTP.
- A2UIVerse's CircleCI agent in its live mode, on Claude, `anthropic/claude-haiku-5-5` through ADK's Anthropic class with the kit's default effort, with CircleCI's MCP server over streamable HTTP.

The rule behind the list is coverage of agent stacks. The Python restaurant finder is not a target; it appears only as the subject of decision 14's first check. Decision 19 of the Phase 5 spec is amended in place to this list and this rule.

### 2. `run` and `attach`

Every target runs under `a2ui-spectra run`. Two also run under `a2ui-spectra attach`: the Node restaurant finder, with nothing set in its shell and then with the five model variables set; the custom-components example, with the receiver's exports alone and then with every printed variable set.

### 3. The store and the sessions

The run starts from an empty store, in a folder of its own. Every Spectra start is launched from that folder with the session's config passed by `--config`, so the store builds up across the sessions, each later session showing the earlier sessions' turns. The sessions, in order:

1. The Node restaurant finder under `attach`: nothing set — the first screen with the variables block, and one wire-only turn; restarted with the five model variables set — its Gemini calls read in full.
2. The custom-components example under `attach`, with the agent's spans as decision 8 has it: the receiver's exports alone — span-only model and tool rows; restarted with every printed variable set — the full picture, and Flow 5's conversation: two turns, a line of the example's prompt changed, the agent restarted, a third turn.
3. The custom-components example under `run`: on Gemini with its floor plan server; on Anthropic; on Chat Completions and on Responses against the stand-in; under OpenInference and under OpenLLMetry on Gemini.
4. The Linear agent live on Gemini under `run`.
5. The CircleCI agent live on Claude under `run`.

### 4. The tunnel and the preview

One borrowed port, 5173, for the viewer. No preview page: the Node finder answers in the basic catalog, which the built-in preview draws; the custom-components example's inline catalog and the Linear and CircleCI catalogs show "No preview for catalog …" in the result pane, Structure beside it.

### 5. The boards

Every board Phase 5 added, as the 5.1 spec's decision 1 places them: Flow 5's four boards; on "Turn view details" the rows "Model calls" — a call read in full, the prefix break, a call recorded raw, a call read from spans only — "Tool calls" — MCP over HTTP+SSE with its housekeeping rows, `tools/call` over streamable HTTP, an HTTP tool — and "The agent's spans" — a linked pair's span section, a failed call as a problem; on the States row the live turn with calls and the first screen under `attach`; the additions to "Components and states" — the call rows, the lane's bars and dots, an in-flight row, Maximize, the header's second line plain, unpriced and recorded raw — to "Icons" and to the list of keys; the small-window board at 1,200 × 760; and the two dark twins.

Flows 1 to 4 are walked once each on the Node finder's session, Flow 4 on the built-in preview, from the first board to the last, judged for whether the flow still works and not board by board.

### 6. The states no target produces

- A call recorded raw: one more turn of the custom-components example on Chat Completions with `SPECTRA_PROVIDER_STAND_IN` unset, so the stand-in is another host.
- An HTTP tool: Spectra's own tool server from `conformance/`, named in the session's config as a tool server, and one request sent by hand to its tool proxy port while a turn of the Node finder is open, `GET /api/json`.
- A failed call as a problem: a second request sent the same way, to a path the tool server answers `404`.

### 7. The example's four legs

Under `run`, one conversation per leg, the recorded one, "Who is Alex Jordan?":

- Gemini — `gemini/gemini-3.6-flash`; this leg alone adds the floor plan press.
- Anthropic — `anthropic/claude-haiku-5-5`, with `GEMINI_API_KEY` set too, which the example checks for at startup.
- Chat Completions — `openai/gpt-4.1-mini`, with a dummy `OPENAI_API_KEY`; Spectra's own environment points `OPENAI_BASE_URL` at the stand-in and `SPECTRA_PROVIDER_STAND_IN` names it; the stand-in plays `openai_chat/custom_components_conversation.har`. Decision 6's recorded-raw turn follows.
- Responses — `openai/responses/gpt-4.1-mini` through LiteLLM's Responses bridge; the stand-in plays `openai_responses/custom_components_conversation.har`.

### 8. The agent's spans

The sessions launched under `opentelemetry-instrument` follow 5.4's recipe — the distro, the OTLP HTTP exporter, the bootstrap set for the agent's environment, the Click instrumentation disabled for the ADK samples:

- the custom-components example's `attach` session and its Gemini `run` leg, with ADK's own dialect; the full `attach` restart with `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`, so the `gen_ai.client.inference.operation.details` log record is seen as a span event;
- the OpenInference and OpenLLMetry legs on Gemini, with the instrumentations at 5.4's versions, `openinference-instrumentation-litellm` 0.1.52 and `opentelemetry-instrumentation-litellm` 0.62.4;
- the Linear and CircleCI agents, with the bootstrap set for their own environments.

The Node finder and the Anthropic, Chat Completions and Responses legs run with no instrumentation; their rows come from the proxies alone.

### 9. The live agents' turns

Two typed, read-only turns in one conversation each: the Linear agent "Show my open issues", then an issue opened by its key; the CircleCI agent "Show me the recent runs", then the latest run opened. Each agent is signed in through a scratch copy of its sign-in store; the live store and the vault are only read.

### 10. The keyboard

Flow 5 is done once by the keyboard alone, in light at full width, in the custom-components example's `attach` session, after its pass with the mouse: the turn reached in the list, the second model call reached by the arrows in the timeline, the prefix break's link reached by Tab and followed by Enter, and `m` pressed on the call's detail and again to restore. Flows 1 to 4 are walked by mouse. A flow that cannot be finished without the mouse is a finding.

### 11. Dark

3.7's rule: in dark, a screen drawn only in light passes when its colours come from the dark palette of the Foundations board and nothing is unreadable or left light. The two dark twins, the timeline with calls and a model call read in full, are checked board by board.

### 12. Window sizes

At 1,200 × 760: the Node finder's timeline against the small-window board; the timeline narrowed by the divider to 380px and to 340px; the detail's times giving way on the narrow pane; Maximize pressed there and on a tall window, as tall as the browser's screen allows.

### 13. What counts as a finding

4.7's rules, unchanged: any difference of design between the viewer and a board — the layout, an element missing or extra, the wording, a state, spacing, colour, behaviour — is a finding, fixed in the viewer or, where the board is wrong, amended on the design canvas; a difference of content between a real agent's turns and a board's is not a finding, nor is a feature of a later phase; a route of the run that does not work is a finding; a fault in an agent or in upstream's SDK is recorded in `_dev/a2ui-findings.md` and not fixed here; inside A2UIVerse, a fault in an app's agent or catalog is fixed from this sub-task in A2UIVerse's repo, a fault in the kit goes to A2UIVerse's backlog, a fault that is upstream's to the findings file.

Two destinations join them: a fault in an OpenTelemetry producer or in the GenAI conventions goes to `_dev/otel-findings.md`, checked against the pinned conventions first; traffic of one of the four APIs that the model proxy or the receiver misreads is fixed in the reader, with the traffic recorded into the capture suite so the fix has a test.

### 14. The retry checks

- The restaurant finder's: the upstream A2UI SDK's retry on "Surface default already exists" in a new conversation, which builds the finder's surface twice — checked against the SDK's and the sample's code at the fork's ref, with one reproduction under `run` in a scratch folder outside the run's store, its record the evidence.
- The custom-components example's: its validation retry on "Catalog not found: inline_catalog" costing an extra model call per turn — checked on the run's Gemini-leg records and the SDK's code.

Each is written to `_dev/a2ui-findings.md`, as findings 31 and 32, if it holds.

### 15. The `GET` stream's name

One attribute, `a2ui.mcp.stream.url`: the HTTP+SSE session's `GET` stream URL, credentials removed, on every event of the session. The tool call's folded exchange line names the stream by the URL's path, "reply on GET /sse", in place of "reply on the SSE stream". The record prose's HTTP+SSE paragraph and the schema's tool-call attribute list gain the attribute; `full_record_custom_components.json` and the tool capture suite's HTTP+SSE expected records are written again; the tool's and the viewer's READMEs, the 5.1 spec's decision 16 and the canvas's HTTP+SSE board carry the new line.

### 16. Other documents

- The Phase 5 spec: decision 19, as decision 1 has it.
- `_dev/TODO.md`: the 5.7 line names this spec.
- `_dev/a2ui-findings.md` and `_dev/otel-findings.md`: as decisions 13 and 14 have it.
- A2UIVerse: the Linear agent's MCP URL read from `LINEAR_MCP_URL` with the hosted server as its default, as 5.3's decision 15 did for the CircleCI agent, so the tool proxy sees Linear's traffic too, one bare commit on a2uiverse-apps `main`; otherwise nothing, unless decision 13 sends a fix there.
- SPEC.md and `conformance/README.md` are otherwise unchanged.
- This spec gains, after the run, what the run fixed, the design canvas's amendments and the findings recorded, as 3.7's and 4.7's did.

### 17. Done when

- Every session of decision 3 has been through its part, every board of decision 5 seen in light and dark, and Flows 1 to 4 walked once.
- Every finding has gone where decision 13 sends it.
- The unit tests, the three capture suites with the rewritten HTTP+SSE records, and both end-to-end tests pass after the fixes, under Node and against the binary, locally and in CI.
- This spec carries decision 16's last item.
- The done commit names the boards not checked, the tall window's height, the fork's ref `825beac28` with google-adk 2.3.0, LiteLLM 1.90.1 and the two instrumentations' versions, the a2uiverse-apps commit the live sessions ran against, and the Claude model.

### 18. What the run fixed

- An open turn's header duration runs to the present while a call is in flight, and to a finished call's end past the newest step, as the lanes do; it stood at the newest step while a call ran. The turn list's open row counts the same way at its last update.
- An offset or a duration of a minute or more reads `1m 27s` in the timeline's columns and in the spans section's events, where `1 min 27 s` wrapped the row; the spans section's event times sit in a wider column that does not wrap.
- The timeline takes focus once the earlier call a prefix break's link names is selected in another turn, so the keys go on from it; focus fell to the page before.
- `a2ui.mcp.stream.url` and the folded exchange line `reply on GET /sse`, decision 15, seen live on the floor plan turn.
- Stale trace context from an MCP client. Under instrumentation, the MCP Python SDK's streamable HTTP client sends every request from one writer task spawned when the session opens, so the httpx instrumentation stamps each with the span current then, the opening turn's `invoke_agent`: the first turn's `tools/call` named a span with no tool call span above it and stayed unlinked, two rows and "2 tool calls" for one call, and every later turn's MCP requests carried the first turn's trace id and were dropped as calls of a turn already written. Now a call whose trace id names a written turn is placed by the time window, an exchange whose `traceparent` names a span with no call span of its kind at or above it links by time, and tool call spans run side by side are told apart by the exchange's tool name; the Phase 5 spec's decision 4 and the 5.4 spec's decision 11 carry the rules, the receiver capture suite the case `adk_mcp_stale_context` recorded from the Linear session, and `_dev/otel-findings.md` the producer as finding 24.
- ADK's `execute_tool (merged)`, its wrapper around tool calls run side by side with `(merged tools)` as its tool name, is a framework span, not a tool call counted in the header.
- Every labelled block of a step's detail folds on its label line with the chevron the sections use, and a block folded stays folded by its label on every step for the session, so a long system prompt folded once stays out of the way on every call; asked for by Jioh during the run, on the Linear session's model calls.
- A message part with nothing in it, text or reasoning that is empty, has no block in a model call's messages and response, nor empty text in a tool result; each drew an empty grey box under the part before it. Gemini sends empty text after a tool call and to carry a thought signature, and Claude empty reasoning; the record keeps them. A message of such parts alone is its label line with "empty text" or "empty reasoning". Seen by Jioh on the Linear session's "Open A2U-5", message 4; seen fixed through the tunnel under `attach` on the run's store, there and on the Restaurant Agent's "Top 3 Chinese restaurants in New York", whose message 3 is empty text alone.
- The turn list shows the connected agent's turns, and an agent picker in its header, shown when the store holds turns of other agents, offers each agent with turns and every agent together; the Phase 3 spec's decision 4 carries it. All the run's sessions wrote to one store, and the list showed every agent's turns, Linear's three among them; seen by Jioh on the Linear session. Seen fixed through the tunnel under `attach` to A2UIVerse's Linear agent on the run's store, light and dark: Linear's six turns by default, CircleCI picked, the browser's Back and a turn's address each bringing their agent's turns, and every agent's thirty turns together.
- A section's fold chevron and a block's are one 16px button with a 12px icon, each label line inset by 2px, so the Exchange line lines up with Arguments, Result and MCP; the section's had stood 2px wider. Seen by Jioh on the Linear session's `get_issue`.
- Every size, space, radius, line height and letter spacing in the viewer and on the canvas is a step of Tailwind's scale, the arbitrary values gone, and a recurring value with no step a theme token; the Phase 3 spec's decision 20 carries it. Asked for by Jioh.
- The turn list's swing holds the turn view's content at the width it lands at, so it lays out once, not on every frame; and the turn list and the strip scroll the selected turn into view within their own column, so the hidden list under the strip no longer pushes the collapsed panel sideways. Seen by Jioh as a swing that was not smooth.

### 19. The design canvas

The block templates of the step's detail, a text, a JSON block, keys and values, a list, a mono line and the marked prompt, gained the fold chevron on their label line, and the model call board draws its tool definitions folded. The HTTP+SSE board already read "reply on GET /sse". The turn list's header gained the agent picker, "All agents" on every board whose list holds more than one agent's turns, and two boards, light and dark, draw it open on the connected agent's turns. The section rows' and the block templates' chevrons are one 16px button with a 12px icon, and every size in the canvas's main, components, foundations and icon gallery files is a step of Tailwind's scale, matching the viewer.

### 20. A2UI findings

Findings 31 and 32 are recorded: the Python restaurant finder's retry on "Surface default already exists", ADK's aggregated event meeting the SDK's stream, reproduced in two conversations in a scratch store; and the custom-components example prompting with examples in a catalog the host did not negotiate, seen in every message-box turn of the run on each API. The example reading an action from v0.8's `userAction` alone, which keeps the message box's press from reaching its floor plan server, is finding 23's; the floor plan turn is sent from the recorded conversation through the wire proxy as a second host.

### 21. OpenTelemetry findings

Finding 24: the MCP Python SDK's writer task carrying the session's opening span into every request, met through the httpx instrumentation under google-adk 2.9.1, as section 18 has it.

### 22. The A2UIVerse sessions

Both ran from a2uiverse-apps `main`, the Linear agent on `gemini-3.7-flash`, its `.env`'s model, and the CircleCI agent on `anthropic/claude-haiku-5-5` at the kit's default effort, each in live mode with its hosted MCP server behind the tool proxy, signed in through a scratch copy of its sign-in store with a token minted into the copy for the message box, the live stores and the vault untouched, under `opentelemetry-instrument` with the bootstrap set for their environment and the Click instrumentation off. Two typed turns each: "Show my open issues" and "Open A2U-5"; "Show me the recent runs" and "Open the latest run". Seen on them: `tools/call` over streamable HTTP as the board draws it, Arguments, Result, the exchange folded as `POST mcp.linear.app/mcp · 200 · 1 chunk` and the MCP names, neither server assigning a session id; the bearer token as "Removed by Spectra", no token, key or refresh token in a record, the store or a log; a Claude call read as "Anthropic Messages · Model proxy · ADK spans · GenAI spans", the third source the Anthropic SDK's own spans, `com.anthropic.sdk.python` 2.3.0 read by the GenAI dialect, its chain of three marked "this call" with the `gen_ai.system.message`, `gen_ai.user.message` and `gen_ai.choice` log records among its events; the cache share on Claude, Cache read 0 and Hit ratio 0% on every call, as the kit's README has it; a failed call as a problem live, the CircleCI agent's `get_run` with a placeholder id answered `isError`, "The agent's span ended in error · MCP_TOOL_ERROR" with the error's text as its Result; the agent's local `list_projects` as a span-only row, "in the agent".

Two faults went to A2UIVerse's repo under decision 13: the Linear catalog's components lacked the protocol's `ComponentCommon`, the fault 4.7 fixed in the CircleCI catalog, so every component's `id` failed the v0.9 schema, 13 and 41 catalog problems on the two turns, fixed as 15c71d2 was, the catalog at 0.2.1 (`17bfb68`); and decision 16's `LINEAR_MCP_URL` (`7f883b2`). One fault of the kit goes to A2UIVerse's backlog, not written there from this session: CircleCI's `list_runs` answers with the runs in `structuredContent` and only "Found 5 run(s)" as its `content`, and the model is handed the `content` alone, so the CircleCI agent could not show a run on either turn.

### 23. Content, not findings

The Node finder's live Gemini output puts an empty object where the v0.9 catalog wants a string in a Button's `action.event.context`, and leaves a Button's child unsent; the floor plan server reports its resource as `text/plain` where the board drew `text/html`; a2a-sdk's `EventQueue` spans arrive every half second through a turn, so an open turn's duration, which runs to its newest event, advances with them; the kit streams its prose as many short Text parts, 95 steps on a CircleCI turn; Linear's token at Linear expires within hours and the kit refreshes it from the scratch copy only within five minutes of expiry, so the Linear session ran inside that window and no refresh touched the live sign-in.
