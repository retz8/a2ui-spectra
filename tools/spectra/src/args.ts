import {parseArgs} from 'node:util';

import {CONFIG_FILE, type SpectraConfig} from './config.js';

export const DEFAULT_VIEWER_PORT = 9820;
export const DEFAULT_PROXY_PORT = 9821;

export type CommandName = 'attach' | 'run';

/** What both commands take besides the agent's command. */
export interface SessionOptions {
  /** The agent's base address, when the command line gives it; else the config file may. */
  agentUrl?: URL;
  /** The config file `--config` names; else the default file in the working directory. */
  config?: string;
  /** The viewer's port. */
  port: number;
  /** The wire proxy's port. */
  proxyPort: number;
  /** Whether to open the browser. */
  open: boolean;
  /** Host names the server answers besides the loopback names. */
  allowedHosts: string[];
}

export type CommandLine =
  | {name: 'help'; topic?: CommandName}
  | {name: 'version'}
  | {name: 'attach'; options: SessionOptions}
  | {name: 'run'; options: SessionOptions; command: string; args: string[]};

/** A command line that cannot be run as written. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly topic?: CommandName,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

const sessionOptions = {
  config: {type: 'string'},
  port: {type: 'string'},
  'proxy-port': {type: 'string'},
  'no-open': {type: 'boolean'},
  'allow-host': {type: 'string', multiple: true},
  help: {type: 'boolean'},
} as const;

const runOptions = {
  ...sessionOptions,
  'agent-url': {type: 'string'},
} as const;

/** Parses the arguments after the program name. */
export function parseCommandLine(argv: readonly string[]): CommandLine {
  const [first, ...rest] = argv;
  if (first === undefined) {
    throw new UsageError('No command given.');
  }
  if (first === '--help') {
    if (rest.length > 0) {
      throw new UsageError(`Unexpected argument '${rest[0]}'.`);
    }
    return {name: 'help'};
  }
  if (first === '--version') {
    if (rest.length > 0) {
      throw new UsageError(`Unexpected argument '${rest[0]}'.`);
    }
    return {name: 'version'};
  }
  if (first === 'attach') {
    return parseAttach(rest);
  }
  if (first === 'run') {
    return parseRun(rest);
  }
  if (first.startsWith('-')) {
    throw new UsageError(`Unknown option '${first}'.`);
  }
  throw new UsageError(`Unknown command '${first}'.`);
}

function parseAttach(argv: string[]): CommandLine {
  const {values, positionals, tokens} = parse(argv, sessionOptions, 'attach');
  if (values.help) {
    return {name: 'help', topic: 'attach'};
  }
  if (tokens.some(token => token.kind === 'option-terminator')) {
    throw new UsageError("attach takes no command after '--'.", 'attach');
  }
  if (positionals.length > 1) {
    throw new UsageError(`Unexpected argument '${positionals[1]}'.`, 'attach');
  }
  return {
    name: 'attach',
    options: sessionOptionsFrom(values, positionals[0], 'attach'),
  };
}

function parseRun(argv: string[]): CommandLine {
  const {values, tokens} = parse(argv, runOptions, 'run');
  if (values.help) {
    return {name: 'help', topic: 'run'};
  }
  const terminator = tokens.find(token => token.kind === 'option-terminator');
  const before = tokens.filter(
    token =>
      token.kind === 'positional' && (terminator === undefined || token.index < terminator.index),
  );
  if (before.length > 0 && before[0].kind === 'positional') {
    throw new UsageError(
      `Unexpected argument '${before[0].value}'. The agent's command goes after '--'.`,
      'run',
    );
  }
  if (terminator === undefined) {
    throw new UsageError("run needs the agent's command after '--'.", 'run');
  }
  const command = argv.slice(terminator.index + 1);
  if (command.length === 0) {
    throw new UsageError("run needs the agent's command after '--'.", 'run');
  }
  return {
    name: 'run',
    options: sessionOptionsFrom(values, values['agent-url'], 'run'),
    command: command[0],
    args: command.slice(1),
  };
}

type Options = typeof sessionOptions | typeof runOptions;

function parse<T extends Options>(argv: string[], options: T, topic: CommandName) {
  try {
    return parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error), topic);
  }
}

/**
 * The agent's URL: the command line's, else the config file's. Neither is a
 * usage error naming both ways.
 */
export function agentUrlOf(
  options: SessionOptions,
  config: SpectraConfig,
  topic: CommandName,
): URL {
  const url = options.agentUrl ?? config.agentUrl;
  if (url === undefined) {
    throw new UsageError(
      topic === 'attach'
        ? `attach needs the agent's URL: its <agent-url> argument, or agent.url in ${CONFIG_FILE}.`
        : `run needs the agent's URL: --agent-url, or agent.url in ${CONFIG_FILE}.`,
      topic,
    );
  }
  return url;
}

function sessionOptionsFrom(
  values: {
    config?: string;
    port?: string;
    'proxy-port'?: string;
    'no-open'?: boolean;
    'allow-host'?: string[];
  },
  agentUrl: string | undefined,
  topic: CommandName,
): SessionOptions {
  const port = parsePort(values.port, DEFAULT_VIEWER_PORT, '--port', topic);
  const proxyPort = parsePort(values['proxy-port'], DEFAULT_PROXY_PORT, '--proxy-port', topic);
  if (port === proxyPort) {
    throw new UsageError(
      `--port and --proxy-port are both ${port}; they need different ports.`,
      topic,
    );
  }
  return {
    ...(agentUrl !== undefined && {agentUrl: parseAgentUrl(agentUrl, topic)}),
    ...(values.config !== undefined && {config: values.config}),
    port,
    proxyPort,
    open: !values['no-open'],
    allowedHosts: (values['allow-host'] ?? []).map(name => parseHostName(name, topic)),
  };
}

function parseAgentUrl(value: string, topic: CommandName): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`'${value}' is not a URL.`, topic);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(
      `The agent's URL must start with http:// or https://, not '${url.protocol}//'.`,
      topic,
    );
  }
  return url;
}

function parsePort(
  value: string | undefined,
  fallback: number,
  option: string,
  topic: CommandName,
): number {
  if (value === undefined) {
    return fallback;
  }
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`${option} must be a port from 1 to 65535, not '${value}'.`, topic);
  }
  return port;
}

function parseHostName(value: string, topic: CommandName): string {
  const name = value.trim().toLowerCase();
  if (name === '' || /[\s/:@]/.test(name.replace(/^\[.*\]$/, ''))) {
    throw new UsageError(
      `--allow-host takes a host name without a scheme or port, not '${value}'.`,
      topic,
    );
  }
  return name;
}
