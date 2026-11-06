# Sub-task 7.4 — `a2ui-spectra replay` and `a2ui-spectra test`

The two headless commands, the stub agent's model-calling mode and the end-to-end test under Node and the binary. Sub-task 7.4 of the Phase 7 spec, `_dev/docs/spec/phase-7-fixtures-and-replay.md`, carrying out its decision 10, the two commands; decision 14's clause on `test` and a record with nothing to serve; and decision 17's stub agent mode and end-to-end test; on the box's in-process replay entry, the stream's replay events and the fixtures listing sub-task 7.3 left.

## Scope

- `a2ui-spectra replay` and `a2ui-spectra test`: headless, the agent launched or already running, their options, their two output streams, their lines and their exit codes.
- The stub agent's model-calling mode, against the stand-in provider and the conformance tool server, with its prompt option.
- The end-to-end test on the commands in both agent forms, under Node and the binary; the command-line test.
- The documents.

Out of scope: the viewer's fixture side and the miss's prefix break shown on the replayed turn, sub-task 7.5; a JUnit or other report format for `test`, backlog.

## Locked decisions

### 1. The commands and their options

`a2ui-spectra replay <file>` and `a2ui-spectra test [<folder>]` run headless, no viewer and no browser, under the config file as `run` is. The agent comes either way: `-- <command>` after the positional launches it with the redirection variables set; `--agent-url <url>`, else the config file's `agent.url`, names one already running whose shell the adopter set the variables in. Both commands take `--config` and the four port options, `--proxy-port`, `--model-proxy-port`, `--tool-proxy-port` and `--receiver-port`, with `run`'s defaults. The viewer's `--port`, `--no-open` and `--allow-host` are refused as unknown options.

### 2. `test`'s folder

The folder is optional: the config file's fixtures folder when left out, the command line's folder when given. A folder that does not exist is a usage error naming it.

### 3. The live mode's flag

`replay` runs in everything-recorded mode by default and with the model live under `--model-live`. `test` refuses the option.

### 4. The two streams

Under the two commands every status line goes to stderr with the `a2ui-spectra:` prefix: the start-up lines, the card wait, the proxies' lines, the box's one line per replayed turn, a miss's line, and the launched agent's own output. Stdout carries the result lines alone, unprefixed.

### 5. The result lines

`replay` prints one line per recorded turn, its number of the total, its verdict and the reasons it failed, how many of its recorded calls were not asked for, or that it was not sent with the reason; then a closing line for the record with its verdict and the conversation folder its turns landed in. `test` prints one line per fixture with its verdict and, when any, how many of its recorded calls were not asked for; under a failed fixture, its failing turns' reasons, a turn not sent with its reason, a file that is not a turn record with its reason, a record with nothing to serve with that reason, and the conversation folder its turns landed in; then a summary line with the counts.

### 6. Calls that never reached the proxies

When a record's turns asked for none of their recorded calls and the proxies saw no call at all, one warning line on stderr names the two causes: a shell without the variables, and an endpoint hardcoded in the agent. The verdict is the Phase 7 spec's decision 9's, unchanged.

### 7. The exit codes

0 when the record passes, or every fixture does; 1 otherwise. 2 for what is wrong before the agent is reached, said before the agent is launched or its card waited for: a `replay` file that is missing or does not read as a turn record, a `test` folder that is missing or holds no `.json`. 1 when the box cannot send, the configured headers' variables unset or the card speaking no A2A version the box does, said before anything is sent. 1 when the agent's process ends mid-run: the remaining turns are reported as not sent and the remaining fixtures as not run, the agent's exit said on stderr and not returned. A record with nothing to serve, under `replay` without `--model-live`, exits 1 before the agent is reached, the line naming the flag.

### 8. The card wait

No time limit, as `run` and `attach` wait, the waiting lines on stderr. An agent that exits before its card answers ends the wait with exit 1.

### 9. `test` tries every fixture

Each fixture in its own conversation against the one agent process, in path order. A fixture whose turn could not be sent fails with that reason, and the next is tried.

### 10. The stub agent's model-calling mode

The stub gains a mode that plays the model capture suite's Gemini restaurant finder recording through the stand-in provider, as a small loop on the stub's own fetch: a message sends a Gemini request through `GOOGLE_GEMINI_BASE_URL`, gets the recorded `get_restaurants` function call, answers it by calling the conformance tool server's `echo` tool over MCP, the server's URL read from a variable and the client connected inside the turn, sends the function response and gets the recorded text and `<a2ui-json>` block, split into a text part and the A2UI messages; a second message in the conversation gets the recording's third exchange, the repaint. An option changes the system instruction the stub sends. No new recording, and no SDK added to the conformance workspace.

### 11. The tests

The end-to-end test, under Node and the binary: a conversation recorded against the stand-in through a viewer session with the stub in its model-calling mode, saved as a fixture through the API; `replay` on it with the stand-in stopped, passing; the stub launched with its prompt changed and `replay` failing with `REPLAY_MISS` naming the Gemini method and path, the failed model call carrying `error.type` `replay_miss` and the request as received, whose system instruction differs from the recorded one at the changed text; `test` on the folder; both commands in both agent forms, launched and already running. The command-line test covers the refused options and the exits before the agent is reached. Done when all of it is green in CI.

### 12. Other documents

- The tool's README: the usage block and the commands' options, the two streams, the result lines, the warning line and the exit codes; the help text for the tool and for each of the two commands.
- `conformance/README.md`: the stub's model-calling mode, its options and the variable it reads the tool server's URL from.
- SPEC.md: the adopter path's step 4 names the commands as they are.
- `_dev/TODO.md`: the 7.4 line names this spec. No finding is expected for `_dev/a2ui-findings.md` or `_dev/otel-findings.md`.

## Invariants

- The commands call the box's replay entry in process; what they print comes from the hub's events, the box's refusals and the listing, and nothing the viewer computes is computed on the terminal.
- Under the two commands, stdout carries result lines only.
- Everything-recorded means free on the terminal as in the viewer: no call leaves the machine, and a miss is an error.
