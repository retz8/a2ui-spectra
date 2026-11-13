import {parseArgs} from 'node:util';

import {CONFIG_FILE, type SpectraConfig} from './config.js';

import {DEFAULT_MODEL_PROXY_PORT} from './model_proxy/redirection.js';
import {DEFAULT_RECEIVER_PORT} from './receiver/listener.js';
import type {ReplayMode} from './record/turn_record.js';

export const DEFAULT_VIEWER_PORT = 9820;
export const DEFAULT_PROXY_PORT = 9821;
export const DEFAULT_TOOL_PROXY_PORT = 9824;
export {DEFAULT_MODEL_PROXY_PORT, DEFAULT_RECEIVER_PORT};

export type CommandName = 'attach' | 'run' | 'replay' | 'test';

/** The agent's command, after `--`. */
export interface AgentCommand {
  command: string;
  args: string[];
}

/** What every command takes: the agent, the config file and the proxies' and the receiver's ports. */
export interface HeadlessOptions {
  /** The agent's base address, when the command line gives it; else the config file may. */
  agentUrl?: URL;
  /** The config file `--config` names; else the default file in the working directory. */
  config?: string;
  /** The headers `--header` gives, by name as written, the later of a repeated name; their values as written. */
  headers: Record<string, string>;
  /** The wire proxy's port. */
  proxyPort: number;
  /** The model proxy's port. */
  modelProxyPort: number;
  /** The first tool server's port on the tool proxy; each further one takes the next. */
  toolProxyPort: number;
  /** The OpenTelemetry receiver's port. */
  receiverPort: number;
}

/** What `attach` and `run` take besides the agent's command: the viewer's options too. */
export interface SessionOptions extends HeadlessOptions {
  /** The viewer's port. */
  port: number;
  /** Whether to open the browser. */
  open: boolean;
  /** Host names the server answers besides the loopback names. */
  allowedHosts: string[];
}

export type CommandLine =
  | {name: 'help'; topic?: CommandName}
  | {name: 'version'}
  | {name: 'attach'; options: SessionOptions}
  | {name: 'run'; options: SessionOptions; command: string; args: string[]}
  | {
      name: 'replay';
      options: HeadlessOptions;
      /** The record's file. */
      file: string;
      /** Everything recorded; under `--model-live`, tools recorded and the model live; under `--live`, every call live. */
      mode: ReplayMode;
      /** The agent's command, when the command launches it. */
      command?: AgentCommand;
    }
  | {
      name: 'test';
      options: HeadlessOptions;
      /** The fixtures folder, when given; else the config file's. */
      folder?: string;
      command?: AgentCommand;
    };

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

const headlessOptions = {
  config: {type: 'string'},
  header: {type: 'string', multiple: true, short: 'H'},
  'proxy-port': {type: 'string'},
  'model-proxy-port': {type: 'string'},
  'tool-proxy-port': {type: 'string'},
  'receiver-port': {type: 'string'},
  'agent-url': {type: 'string'},
  help: {type: 'boolean'},
} as const;

const replayOptions = {
  ...headlessOptions,
  'model-live': {type: 'boolean'},
  live: {type: 'boolean'},
} as const;

const sessionOptions = {
  config: {type: 'string'},
  header: {type: 'string', multiple: true, short: 'H'},
  port: {type: 'string'},
  'proxy-port': {type: 'string'},
  'model-proxy-port': {type: 'string'},
  'tool-proxy-port': {type: 'string'},
  'receiver-port': {type: 'string'},
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
  if (first === 'replay') {
    return parseReplay(rest);
  }
  if (first === 'test') {
    return parseTest(rest);
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
  const before = positionalsBefore(tokens);
  if (before.length > 0) {
    throw new UsageError(
      `Unexpected argument '${before[0]}'. The agent's command goes after '--'.`,
      'run',
    );
  }
  const command = agentCommandOf(argv, tokens, 'run');
  if (command === undefined) {
    throw new UsageError("run needs the agent's command after '--'.", 'run');
  }
  return {
    name: 'run',
    options: sessionOptionsFrom(values, values['agent-url'], 'run'),
    command: command.command,
    args: command.args,
  };
}

function parseReplay(argv: string[]): CommandLine {
  const {values, tokens} = parse(argv, replayOptions, 'replay');
  if (values.help) {
    return {name: 'help', topic: 'replay'};
  }
  const [file, ...more] = positionalsBefore(tokens);
  if (file === undefined) {
    throw new UsageError("replay needs the record's file.", 'replay');
  }
  if (more.length > 0) {
    throw new UsageError(`Unexpected argument '${more[0]}'.`, 'replay');
  }
  if (values.live && values['model-live']) {
    throw new UsageError('--live and --model-live cannot be given together.', 'replay');
  }
  const command = agentCommandOf(argv, tokens, 'replay');
  return {
    name: 'replay',
    options: headlessOptionsFrom(values, values['agent-url'], 'replay'),
    file,
    mode: values.live ? 'live' : values['model-live'] ? 'model_live' : 'recorded',
    ...(command !== undefined && {command}),
  };
}

function parseTest(argv: string[]): CommandLine {
  const {values, tokens} = parse(argv, headlessOptions, 'test');
  if (values.help) {
    return {name: 'help', topic: 'test'};
  }
  const [folder, ...more] = positionalsBefore(tokens);
  if (more.length > 0) {
    throw new UsageError(`Unexpected argument '${more[0]}'.`, 'test');
  }
  const command = agentCommandOf(argv, tokens, 'test');
  return {
    name: 'test',
    options: headlessOptionsFrom(values, values['agent-url'], 'test'),
    ...(folder !== undefined && {folder}),
    ...(command !== undefined && {command}),
  };
}

type Options =
  typeof sessionOptions | typeof runOptions | typeof headlessOptions | typeof replayOptions;

/** A parsed token: a positional, an option, or the `--` terminator, at its index in the arguments. */
interface Token {
  kind: 'positional' | 'option' | 'option-terminator';
  index: number;
  value?: string;
}

type Tokens = readonly Token[];

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

/** The positional arguments before `--`, in order. */
function positionalsBefore(tokens: Tokens): string[] {
  const terminator = tokens.find(token => token.kind === 'option-terminator');
  return tokens.flatMap(token =>
    token.kind === 'positional' &&
    token.value !== undefined &&
    (terminator === undefined || token.index < terminator.index)
      ? [token.value]
      : [],
  );
}

/** The agent's command after `--`, when there is a `--`; a `--` with nothing after it is a usage error. */
function agentCommandOf(
  argv: string[],
  tokens: Tokens,
  topic: CommandName,
): AgentCommand | undefined {
  const terminator = tokens.find(token => token.kind === 'option-terminator');
  if (terminator === undefined) {
    return undefined;
  }
  const command = argv.slice(terminator.index + 1);
  if (command.length === 0) {
    throw new UsageError(`${topic} needs the agent's command after '--'.`, topic);
  }
  return {command: command[0], args: command.slice(1)};
}

/**
 * The agent's URL: the command line's, else the config file's. Neither is a
 * usage error naming both ways.
 */
export function agentUrlOf(
  options: HeadlessOptions,
  config: SpectraConfig,
  topic: CommandName,
): URL {
  const url = options.agentUrl ?? config.agentUrl;
  if (url === undefined) {
    throw new UsageError(
      topic === 'attach'
        ? `attach needs the agent's URL: its <agent-url> argument, or agent.url in ${CONFIG_FILE}.`
        : `${topic} needs the agent's URL: --agent-url, or agent.url in ${CONFIG_FILE}.`,
      topic,
    );
  }
  return url;
}

interface PortValues {
  config?: string;
  header?: string[];
  'proxy-port'?: string;
  'model-proxy-port'?: string;
  'tool-proxy-port'?: string;
  'receiver-port'?: string;
}

/** The ports read from their options, with the defaults, each pair of them different. */
function portsFrom(
  values: PortValues & {port?: string},
  topic: CommandName,
  withViewer: boolean,
): Array<readonly [string, number]> {
  const ports: Array<readonly [string, number]> = [
    ...(withViewer
      ? [['--port', parsePort(values.port, DEFAULT_VIEWER_PORT, '--port', topic)] as const]
      : []),
    ['--proxy-port', parsePort(values['proxy-port'], DEFAULT_PROXY_PORT, '--proxy-port', topic)],
    [
      '--model-proxy-port',
      parsePort(values['model-proxy-port'], DEFAULT_MODEL_PROXY_PORT, '--model-proxy-port', topic),
    ],
    [
      '--receiver-port',
      parsePort(values['receiver-port'], DEFAULT_RECEIVER_PORT, '--receiver-port', topic),
    ],
    [
      '--tool-proxy-port',
      parsePort(values['tool-proxy-port'], DEFAULT_TOOL_PROXY_PORT, '--tool-proxy-port', topic),
    ],
  ];
  for (const [i, [option, port]] of ports.entries()) {
    const same = ports.slice(i + 1).find(([, other]) => other === port);
    if (same !== undefined) {
      throw new UsageError(
        `${option} and ${same[0]} are both ${port}; they need different ports.`,
        topic,
      );
    }
  }
  return ports;
}

function headlessOptionsFrom(
  values: PortValues,
  agentUrl: string | undefined,
  topic: CommandName,
): HeadlessOptions {
  const port = Object.fromEntries(portsFrom(values, topic, false));
  return {
    ...(agentUrl !== undefined && {agentUrl: parseAgentUrl(agentUrl, topic)}),
    ...(values.config !== undefined && {config: values.config}),
    headers: headersFrom(values.header, topic),
    proxyPort: port['--proxy-port'],
    modelProxyPort: port['--model-proxy-port'],
    receiverPort: port['--receiver-port'],
    toolProxyPort: port['--tool-proxy-port'],
  };
}

/** A header's name: an HTTP token. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * The headers `--header` gives, each written `Name: value` as curl takes
 * one, by name; a name given again, whatever its case, replaces the earlier.
 * A header's value is never repeated in an error, since it may be a
 * credential.
 */
function headersFrom(
  written: readonly string[] | undefined,
  topic: CommandName,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of written ?? []) {
    const colon = header.indexOf(':');
    const name = colon === -1 ? '' : header.slice(0, colon).trim();
    const value = colon === -1 ? '' : header.slice(colon + 1).trim();
    if (name === '' || value === '') {
      throw new UsageError("--header takes 'Name: value'.", topic);
    }
    if (!HEADER_NAME.test(name)) {
      throw new UsageError(`'${name}' is not a header name.`, topic);
    }
    for (const earlier of Object.keys(headers)) {
      if (earlier.toLowerCase() === name.toLowerCase()) delete headers[earlier];
    }
    headers[name] = value;
  }
  return headers;
}

function sessionOptionsFrom(
  values: PortValues & {
    port?: string;
    'no-open'?: boolean;
    'allow-host'?: string[];
  },
  agentUrl: string | undefined,
  topic: CommandName,
): SessionOptions {
  const port = Object.fromEntries(portsFrom(values, topic, true));
  return {
    ...(agentUrl !== undefined && {agentUrl: parseAgentUrl(agentUrl, topic)}),
    ...(values.config !== undefined && {config: values.config}),
    headers: headersFrom(values.header, topic),
    port: port['--port'],
    proxyPort: port['--proxy-port'],
    modelProxyPort: port['--model-proxy-port'],
    receiverPort: port['--receiver-port'],
    toolProxyPort: port['--tool-proxy-port'],
    open: !values['no-open'],
    allowedHosts: (values['allow-host'] ?? []).map(name => parseHostName(name, topic)),
  };
}

/**
 * The tool proxy's ports, one per configured tool server: `--tool-proxy-port`
 * for the first and the next port for each further one, in config order.
 * A port past 65535, or one another of Spectra's ports holds, is a usage
 * error.
 */
export function toolProxyPorts(
  options: HeadlessOptions & {port?: number},
  servers: number,
  topic: CommandName,
): number[] {
  const ports = Array.from({length: servers}, (_, index) => options.toolProxyPort + index);
  const last = ports[ports.length - 1];
  if (last !== undefined && last > 65535) {
    throw new UsageError(
      `The ${servers} tool servers in the config file need ports ${options.toolProxyPort} to ${last}, ` +
        'past 65535. Choose a lower --tool-proxy-port.',
      topic,
    );
  }
  const others: Array<readonly [string, number]> = [
    ...(options.port !== undefined ? [['--port', options.port] as const] : []),
    ['--proxy-port', options.proxyPort],
    ['--model-proxy-port', options.modelProxyPort],
    ['--receiver-port', options.receiverPort],
  ];
  for (const [option, port] of others) {
    if (ports.includes(port)) {
      throw new UsageError(
        `The tool proxy's ports, ${options.toolProxyPort} to ${last} for the ${servers} tool servers in the config file, ` +
          `include ${option}'s ${port}; they need different ports.`,
        topic,
      );
    }
  }
  return ports;
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
