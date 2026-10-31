/**
 * The model calls of a turn as the model proxy recorded them: what a call's
 * row and title say, its tokens and hit ratio, and how a failed one reads as
 * a problem. A span the receiver placed has no row of its own yet.
 */
import {isModelCall, type ModelCallEvent, type TurnRecordEvent} from './record.ts';

/** A model call the model proxy recorded: not a span the receiver placed. */
export function isProxyModelCall(event: TurnRecordEvent): event is ModelCallEvent {
  return isModelCall(event) && !('a2ui.received.attributes' in event.attributes);
}

/** A call read in full carries the provider the reader read it as; a call recorded raw does not. */
export function isReadInFull(call: ModelCallEvent): boolean {
  return typeof call.attributes['gen_ai.provider.name'] === 'string';
}

/** The record's provider names, as a row names the provider. */
const PROVIDERS: Record<string, string> = {
  'gcp.gemini': 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** The provider a call read in full went to: Gemini, OpenAI or Anthropic. */
export function providerOf(call: ModelCallEvent): string | undefined {
  const name = call.attributes['gen_ai.provider.name'];
  return typeof name === 'string' ? (PROVIDERS[name] ?? name) : undefined;
}

/** The API a call read in full used, such as "Anthropic Messages". */
export function apiOf(call: ModelCallEvent): string | undefined {
  switch (call.attributes['gen_ai.provider.name']) {
    case 'gcp.gemini':
      return 'Gemini API';
    case 'anthropic':
      return 'Anthropic Messages';
    case 'openai':
      return call.attributes['openai.api.type'] === 'responses'
        ? 'OpenAI Responses'
        : 'OpenAI Chat Completions';
    default:
      return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The model id as requested, else as the response named it. */
export function modelOf(call: ModelCallEvent): string | undefined {
  return (
    text(call.attributes['gen_ai.request.model']) ?? text(call.attributes['gen_ai.response.model'])
  );
}

/** The request's URL, as recorded with credentials removed. */
export function urlOf(call: ModelCallEvent): URL | undefined {
  const url = text(call.attributes['url.full']);
  if (url === undefined) return undefined;
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** The HTTP method and the path, without the query. */
export function methodAndPath(call: ModelCallEvent): string {
  const method = text(call.attributes['http.request.method']) ?? call.name;
  const path = urlOf(call)?.pathname;
  return path === undefined ? method : `${method} ${path}`;
}

/** The host a call went to. */
export function hostOf(call: ModelCallEvent): string {
  return urlOf(call)?.host ?? text(call.attributes['server.address']) ?? call.name;
}

/**
 * What a call's row says: the model id as requested and the provider for a
 * call read in full; the host and the method and path for one recorded raw.
 */
export function rowTextOf(call: ModelCallEvent): {label: string; target: string} {
  if (!isReadInFull(call)) return {label: hostOf(call), target: methodAndPath(call)};
  return {label: modelOf(call) ?? call.name, target: providerOf(call) ?? ''};
}

/** The token counts a call's record holds. */
export interface Usage {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function usageOf(call: ModelCallEvent): Usage {
  const {attributes} = call;
  const usage: Usage = {
    input: count(attributes['gen_ai.usage.input_tokens']),
    output: count(attributes['gen_ai.usage.output_tokens']),
    reasoning: count(attributes['gen_ai.usage.reasoning.output_tokens']),
    cacheRead: count(attributes['gen_ai.usage.cache_read.input_tokens']),
    cacheWrite: count(attributes['gen_ai.usage.cache_write.input_tokens']),
  };
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}

/**
 * A call's share of input tokens read from the cache: its cache read tokens
 * over its input tokens as recorded, cached tokens included; none without
 * input tokens.
 */
export function hitRatioOf(usage: Usage): number | undefined {
  if (usage.input === undefined || usage.input === 0) return undefined;
  return (usage.cacheRead ?? 0) / usage.input;
}

/** The figures of a call's usage, in order: every API has these, and Anthropic has Cache write too. */
export function figuresOf(call: ModelCallEvent): Array<{name: string; value: number}> {
  const usage = usageOf(call);
  const figures = [
    {name: 'Input', value: usage.input ?? 0},
    {name: 'Output', value: usage.output ?? 0},
    {name: 'Reasoning', value: usage.reasoning ?? 0},
    {name: 'Cache read', value: usage.cacheRead ?? 0},
  ];
  if (call.attributes['gen_ai.provider.name'] === 'anthropic') {
    figures.push({name: 'Cache write', value: usage.cacheWrite ?? 0});
  }
  return figures;
}

/** A call's start and end in milliseconds since the Unix epoch; no end while it is in flight. */
export function timesOf(call: ModelCallEvent): {startMs: number; endMs?: number} {
  const startMs = Number(BigInt(call.startTimeUnixNano) / 1_000_000n);
  return call.endTimeUnixNano === undefined
    ? {startMs}
    : {startMs, endMs: Number(BigInt(call.endTimeUnixNano) / 1_000_000n)};
}

/** When a call's first chunk came, in milliseconds since the Unix epoch, if it streamed. */
export function firstChunkMs(call: ModelCallEvent): number | undefined {
  const first = call.events?.find(event => event.name === 'a2ui.http.response.chunk');
  return first === undefined ? undefined : Number(BigInt(first.timeUnixNano) / 1_000_000n);
}

/** The reason phrases of the statuses a provider answers with. */
const REASONS: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  529: 'Overloaded',
};

/** A status with its reason phrase, such as "429 Too Many Requests". */
export function statusLine(status: number): string {
  const reason = REASONS[status];
  return reason === undefined ? String(status) : `${status} ${reason}`;
}

/** The provider's own status in an error body: Gemini's `status`, else the error's `code` or `type`. */
function providerStatus(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as {error?: unknown}).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const {status, code, type} = error as {status?: unknown; code?: unknown; type?: unknown};
  return text(status) ?? text(code) ?? text(type);
}

/** A failed call as its problem block reads: the plain sentence, the code line, and the proxy's message. */
export interface CallFailure {
  sentence: string;
  code: string;
  note?: string;
}

/**
 * How a failed call reads, by the error's kind: a status the model API
 * answered, an error inside a stream, a provider that could not be reached,
 * or a connection closed before the response ended. Nothing for a call that
 * did not fail.
 */
export function failureOf(call: ModelCallEvent): CallFailure | undefined {
  if (call.status?.code !== 2) return undefined;
  const type = text(call.attributes['error.type']) ?? 'error';
  const status = count(call.attributes['http.response.status_code']);
  const api = apiOf(call);
  let sentence: string;
  if (/^\d{3}$/.test(type)) {
    sentence = `The model API answered ${statusLine(Number(type))}.`;
  } else if (type === 'aborted') {
    sentence = 'The connection closed before the response ended.';
  } else if (/^E[A-Z_]+$/.test(type)) {
    sentence = `The provider could not be reached: ${type}.`;
  } else {
    sentence = `The stream carried an error: ${type}.`;
  }
  // The code: the HTTP status the API answered, else the error's own type.
  const answered = /^\d{3}$/.test(type) && status !== undefined;
  const own = answered ? providerStatus(call.attributes['a2ui.http.response.body']) : undefined;
  const code = [
    answered ? `HTTP ${status}` : type,
    ...(own !== undefined ? [own] : []),
    api ?? hostOf(call),
  ].join(' · ');
  const note = call.status.message;
  return {sentence, code, ...(note !== undefined && note !== '' && {note})};
}
