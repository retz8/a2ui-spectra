/**
 * The OpenTelemetry variables `run` sets for the receiver and `attach`
 * prints: the exporters' endpoint, at the receiver's origin, to which they
 * append the signal paths themselves; the protocol, `http/protobuf`, which
 * also moves Python's auto-configuration off its gRPC default; and the GenAI
 * conventions' content capture switches, each unless Spectra's own
 * environment sets it: the pinned conventions' `SPAN_ONLY`, and the older
 * variable the instrumentations in use still read, `true`. An endpoint or protocol variable Spectra's
 * environment sets to another value, the generic one or a signal-specific
 * one, is replaced in the agent's; a signal-specific one it does not set
 * stays unset.
 */
import {removeFromUrl} from '../model_proxy/credentials.js';
import {pasteLine, type Shell} from '../paste.js';

export const ENDPOINT = 'OTEL_EXPORTER_OTLP_ENDPOINT';
export const PROTOCOL = 'OTEL_EXPORTER_OTLP_PROTOCOL';
/** The content capture switch the pinned GenAI conventions name. */
export const CONTENT_CAPTURE = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT';
/** The older content capture switch, which the instrumentations in use read. */
export const MESSAGE_CONTENT_CAPTURE = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT';

const HTTP_PROTOBUF = 'http/protobuf';

/** The signal-specific endpoint variables, each with the path its full URL ends in. */
const SIGNAL_ENDPOINTS: ReadonlyArray<[string, string]> = [
  ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', '/v1/traces'],
  ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', '/v1/logs'],
  ['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '/v1/metrics'],
];

const SIGNAL_PROTOCOLS = [
  'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
];

/** The note `attach` prints beside each of the four, and the API serves with them. */
const NOTE = "for Spectra's OpenTelemetry receiver";

export interface ReceiverVariables {
  /** The four variables, in the order they are printed, each with its note. */
  printed: Array<{name: string; value: string; note: string}>;
  /** Every variable `run` sets in the agent's environment: the four, and the signal-specific ones replaced. */
  environment: Record<string, string>;
  /** The variables Spectra's environment set to another value, with that value, in the order checked. */
  replaced: Array<{name: string; from: string}>;
}

function setIn(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/** The receiver's variables for the receiver at `origin`, from Spectra's own environment. */
export function receiverVariables(env: NodeJS.ProcessEnv, origin: string): ReceiverVariables {
  const printed = [
    {name: ENDPOINT, value: origin, note: NOTE},
    {name: PROTOCOL, value: HTTP_PROTOBUF, note: NOTE},
    {name: CONTENT_CAPTURE, value: setIn(env, CONTENT_CAPTURE) ?? 'SPAN_ONLY', note: NOTE},
    {
      name: MESSAGE_CONTENT_CAPTURE,
      value: setIn(env, MESSAGE_CONTENT_CAPTURE) ?? 'true',
      note: NOTE,
    },
  ];
  const environment: Record<string, string> = Object.fromEntries(
    printed.map(({name, value}) => [name, value]),
  );
  const replaced: Array<{name: string; from: string}> = [];
  const endpoint = setIn(env, ENDPOINT);
  if (endpoint !== undefined && !sameUrl(endpoint, origin)) {
    replaced.push({name: ENDPOINT, from: endpoint});
  }
  const protocol = setIn(env, PROTOCOL);
  if (protocol !== undefined && protocol !== HTTP_PROTOBUF) {
    replaced.push({name: PROTOCOL, from: protocol});
  }
  for (const [name, path] of SIGNAL_ENDPOINTS) {
    const value = setIn(env, name);
    if (value === undefined) continue;
    environment[name] = `${origin}${path}`;
    if (!sameUrl(value, `${origin}${path}`)) replaced.push({name, from: value});
  }
  for (const name of SIGNAL_PROTOCOLS) {
    const value = setIn(env, name);
    if (value === undefined) continue;
    environment[name] = HTTP_PROTOBUF;
    if (value !== HTTP_PROTOBUF) replaced.push({name, from: value});
  }
  return {printed, environment, replaced};
}

/** The line `run` prints once at start when it replaced variables Spectra's environment set; none when it replaced none. */
export function replacedLine(variables: ReceiverVariables): string | undefined {
  if (variables.replaced.length === 0) return undefined;
  const list = variables.replaced.map(
    ({name, from}) => `${name} from ${/^https?:\/\//i.test(from) ? removeFromUrl(from) : from}`,
  );
  const named =
    list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return (
    `In the agent's environment, Spectra replaced ${named}, so that its exports reach Spectra's OpenTelemetry receiver. ` +
    'They are not passed on.'
  );
}

/** The lines `attach` prints after the model and tool proxies' ones, for a shell. */
export function receiverExportLines(
  variables: ReceiverVariables,
  shell: Shell = 'posix',
): string[] {
  return variables.printed.map(({name, value, note}) => pasteLine(name, value, shell, note));
}
