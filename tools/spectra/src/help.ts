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

const toolHelp = `${NAME} ${VERSION}: DevTools for A2UI agents.

Usage:
  ${NAME} attach [<agent-url>] [options]
  ${NAME} run [--agent-url <url>] [options] -- <command> [args...]
  ${NAME} <command> --help
  ${NAME} --help
  ${NAME} --version

Commands:
  attach  Attach to an agent that is already running.
  run     Start the agent's command, then attach to it.

The agent's URL is its base address: its card is read from
<agent-url>/.well-known/agent-card.json. It may come from the config file
instead, as agent.url; the command line takes precedence over the file.

Options:
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

Start the agent's command, wait until the agent's card answers at
<url>/.well-known/agent-card.json, then attach to it as attach does. The URL
may come from the config file instead, as agent.url.

The command after '--' starts without a shell, with Spectra's environment and
working directory, and writes to Spectra's terminal. Spectra adds the model
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

When the command exits, Spectra exits with its exit code. When Spectra stops,
it stops the command and everything it started; a second Ctrl-C forces it.

Options:
  --agent-url <url>    The agent's base address. Takes precedence over the
                       config file's agent.url; one of them is required.
${sharedOptions}
`;

/** The help text for the tool, or for one command. */
export function helpText(topic?: CommandName): string {
  switch (topic) {
    case 'attach':
      return attachHelp;
    case 'run':
      return runHelp;
    default:
      return toolHelp;
  }
}
