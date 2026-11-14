import {
  type CommandName,
  DEFAULT_MODEL_PROXY_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_RECEIVER_PORT,
  DEFAULT_TOOL_PROXY_PORT,
  DEFAULT_VIEWER_PORT,
} from './args.js';
import {NAME, VERSION} from './version.js';

const sharedOptions = `  --config <path>      The config file. Default: a2ui-spectra.json in the
                       working directory, when there is one.
  -H, --header <header>
                       A header for every request the message box makes to
                       the agent, written 'Name: value', the card fetch
                       included. Can be repeated. Takes precedence over the
                       config file's header of the same name.
  --port <n>           The viewer's port. Default: ${DEFAULT_VIEWER_PORT}.
  --proxy-port <n>     The wire proxy's port. Default: ${DEFAULT_PROXY_PORT}.
  --model-proxy-port <n>
                       The model proxy's port. Default: ${DEFAULT_MODEL_PROXY_PORT}.
  --receiver-port <n>  The OpenTelemetry receiver's port. Default: ${DEFAULT_RECEIVER_PORT}.
  --tool-proxy-port <n>
                       The tool proxy's port for the config file's first tool
                       server; each further one takes the next port.
                       Default: ${DEFAULT_TOOL_PROXY_PORT}.
  --no-open            Do not open the browser.
  --allow-host <name>  Also answer requests addressed to <name>, a host name
                       without a port, such as a tunnel's. Can be repeated.
  --help               Show this help.`;

const headlessOptions = `  --agent-url <url>    The agent's base address, when it is already running.
                       Takes precedence over the config file's agent.url.
  --config <path>      The config file. Default: a2ui-spectra.json in the
                       working directory, when there is one.
  -H, --header <header>
                       A header for every request the message box makes to
                       the agent, written 'Name: value', the card fetch
                       included. Can be repeated. Takes precedence over the
                       config file's header of the same name.
  --proxy-port <n>     The wire proxy's port. Default: ${DEFAULT_PROXY_PORT}.
  --model-proxy-port <n>
                       The model proxy's port. Default: ${DEFAULT_MODEL_PROXY_PORT}.
  --receiver-port <n>  The OpenTelemetry receiver's port. Default: ${DEFAULT_RECEIVER_PORT}.
  --tool-proxy-port <n>
                       The tool proxy's port for the config file's first tool
                       server; each further one takes the next port.
                       Default: ${DEFAULT_TOOL_PROXY_PORT}.
  --help               Show this help.`;

const headlessAgent = `The agent comes either way run and attach take it: a command after '--'
is started with the redirection variables set, as run starts it; --agent-url,
or agent.url in the config file, names an agent already running, whose shell
the variables attach prints were set in. No viewer and no browser: the
status lines go to stderr, and stdout carries the result lines alone.`;

const toolHelp = `${NAME} ${VERSION}: a debugging and observation tool for the developer of an A2UI agent.

Usage:
  ${NAME} attach [<agent-url>] [options]
  ${NAME} run [--agent-url <url>] [options] -- <command> [args...]
  ${NAME} replay <file> [--model-live | --live] [--agent-url <url>] [options] [-- <command> [args...]]
  ${NAME} test [<folder>] [--agent-url <url>] [options] [-- <command> [args...]]
  ${NAME} <command> --help
  ${NAME} --help
  ${NAME} --version

Commands:
  attach  Attach to an agent that is already running.
  run     Start the agent's command, then attach to it.
  replay  Replay one turn record against the agent, headless.
  test    Replay every fixture under a folder with everything recorded, for CI.

The agent's URL is its base address: its card is read from
<agent-url>/.well-known/agent-card.json. It may come from the config file
instead, as agent.url; the command line takes precedence over the file.

Options of attach and run:
${sharedOptions}
`;

const attachHelp = `Usage: ${NAME} attach [<agent-url>] [options]

Attach to an agent that is already running at <agent-url>, its base address,
or at agent.url in the config file when the argument is left out. Spectra
waits until the agent's card answers at <agent-url>/.well-known/agent-card.json,
then starts the wire proxy, the model proxy, the tool proxy, the OpenTelemetry
receiver and the viewer. Point a host at the wire proxy's address in place of
the agent's URL. To see the agent's model and tool calls and its spans, set the
variables Spectra prints at start in the agent's shell and restart the agent.

Options:
${sharedOptions}
`;

const runHelp = `Usage: ${NAME} run [--agent-url <url>] [options] -- <command> [args...]

Start the wire proxy, the model proxy, the tool proxy, the OpenTelemetry
receiver and the viewer, then the agent's command, and open the browser at
once. The agent's card is read at <url>/.well-known/agent-card.json each time
the command starts; until it answers, the viewer shows the agent as starting
and the message box does not send. The URL may come from the config file
instead, as agent.url.

The command after '--' starts without a shell, with Spectra's environment and
working directory, and writes to Spectra's terminal, which echoes its output
as written and keeps it for the viewer's logs. A save in the working
directory restarts the agent; the config file's watch setting lists what is
watched instead, or is false for an agent that reloads itself. Spectra sets
PYTHONUNBUFFERED=1 for the command unless it is set. Spectra adds the model
providers' base-URL variables, GOOGLE_GEMINI_BASE_URL, OPENAI_BASE_URL,
ANTHROPIC_BASE_URL, ANTHROPIC_API_BASE and GEMINI_API_BASE, pointing at its
model proxy, which forwards each call to the address the variable had before,
or to the provider; the variable of each tool server in the config file's
tools, pointing at the tool proxy, which forwards to the server's URL; and
OTEL_EXPORTER_OTLP_ENDPOINT, pointing at its OpenTelemetry receiver, with
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf and, unless it is set,
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true. Other environment
variables go before ${NAME}:

  ${NAME} run --agent-url http://localhost:10002 -- uv run .
  LITELLM_MODEL=gemini/gemini-2.5-flash \\
    ${NAME} run --agent-url http://localhost:10004 -- uv run .

When the command exits, Spectra keeps running: the viewer shows the agent
down with its exit line, and Restart starts the command again. Only Ctrl-C or
a stop signal ends Spectra, with its own exit code. It then stops the command
and everything it started; a second Ctrl-C forces it.

Options:
  --agent-url <url>    The agent's base address. Takes precedence over the
                       config file's agent.url; one of them is required.
${sharedOptions}
`;

const replayHelp = `Usage: ${NAME} replay <file> [--model-live | --live] [--agent-url <url>] [options] [-- <command> [args...]]

Replay a turn record, a fixture or a store turn's file, against the agent:
each recorded turn's wire input is re-sent through the wire proxy in order,
the earlier turns first, while the model proxy and the tool proxy answer from
the record. With everything recorded, the default, no call leaves the
machine and a request the record does not match is a miss. With --model-live
a model request the record does not match goes to the provider, so an
unchanged agent replays for free and a changed prompt pays from the request
that changed on; a tool request that matches nothing is a miss either way.
With --live nothing is served from the record: every model and tool call the
agent makes goes out, and no verdict is taken.

${headlessAgent}

One line per recorded turn, with its verdict, the reasons it failed and how
many of its recorded calls were not asked for, then a line for the record
with the conversation folder the replayed turns landed in. Exit 0 when the
record passes, 1 when it fails or the box cannot send, 2 when the file is
missing or is not a turn record. Under --live a turn's line carries its
outcome where the verdict sits, the record's line how many of its turns were
sent, and the exit is 0 when every turn was sent.

Options:
  --model-live         Tools recorded, the model live.
  --live               Every model and tool call live, and no verdict. Not
                       with --model-live.
${headlessOptions}
`;

const testHelp = `Usage: ${NAME} test [<folder>] [--agent-url <url>] [options] [-- <command> [args...]]

Replay every fixture under the folder, each with everything recorded in its
own conversation against the one agent, in path order: every .json file,
recursively, as the viewer lists them. The folder is the config file's
fixtures folder when left out, a2ui-spectra-fixtures by default.

${headlessAgent}

One line per fixture with its verdict; under a failed one, its failing turns'
reasons, a file that is not a turn record with its reason, and the
conversation folder the replayed turns landed in; then a summary line. Exit 0
when every fixture passes, 1 otherwise, 2 when the folder is missing or
holds no .json file.

Options:
${headlessOptions}
`;

/** The help text for the tool, or for one command. */
export function helpText(topic?: CommandName): string {
  switch (topic) {
    case 'attach':
      return attachHelp;
    case 'run':
      return runHelp;
    case 'replay':
      return replayHelp;
    case 'test':
      return testHelp;
    default:
      return toolHelp;
  }
}
