/**
 * The tool calls of a turn: what a tool row says, whether it is a full row
 * or a housekeeping one, its arguments and result, and how a failed one
 * reads as a problem.
 */
import {type CallFailure, statusLine} from './model_calls.ts';
import {type CallRow, isMcpEvent, readingOf} from './call_rows.ts';
import type {OtherEvent} from './record.ts';

/** The MCP requests that are full rows: a tool called, a resource read, a prompt got. */
const FULL_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The MCP method an event names, when it names one. */
export function methodOf(event: OtherEvent): string | undefined {
  return text(event.attributes['mcp.method.name']);
}

/** The request's URL, as recorded. */
function urlOf(event: OtherEvent): URL | undefined {
  const url = text(event.attributes['url.full']);
  if (url === undefined) return undefined;
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** The tool server's host: from the request's URL, else the server address recorded. */
export function toolHostOf(event: OtherEvent): string {
  const host = urlOf(event)?.host;
  if (host !== undefined && host !== '') return host;
  const address = text(event.attributes['server.address']);
  const port = event.attributes['server.port'];
  if (address === undefined) return '';
  return typeof port === 'number' ? `${address}:${port}` : address;
}

/** The path of the request's URL, without the query; from the event's name when the URL does not parse. */
function pathOf(event: OtherEvent): string | undefined {
  const url = urlOf(event);
  if (url !== undefined) return url.pathname;
  const recorded = text(event.attributes['url.full']);
  const match =
    recorded === undefined ? null : /^[^/]*?(\/[^?#]*)/.exec(recorded.replace(/^<[^>]*>/, ''));
  return match?.[1];
}

/**
 * Whether a tool row is full: a tool called, a resource read or a prompt got
 * over MCP, an HTTP tool, or a tool call read from spans only. Every other
 * MCP request, response and message is housekeeping.
 */
export function isFullToolRow(row: CallRow): boolean {
  if (row.proxy === undefined) return true;
  if (!isMcpEvent(row.proxy)) return true;
  const method = methodOf(row.proxy);
  return method !== undefined && FULL_METHODS.has(method);
}

/**
 * What a tool row says: the tool's name for `tools/call`, the method for any
 * other MCP request, the event's name for one with no method, such as a
 * `DELETE` or a standalone `response`, with "MCP" and the server's host; the
 * method and the path with "HTTP" and the host for an HTTP tool; the tool's
 * name and "in the agent" for a call read from spans only.
 */
export function toolRowTextOf(row: CallRow): {label: string; target: string} {
  const {proxy} = row;
  if (proxy === undefined) {
    const {event} = readingOf(row);
    return {
      label: text(event.attributes['gen_ai.tool.name']) ?? event.name,
      target: 'in the agent',
    };
  }
  const host = toolHostOf(proxy);
  if (isMcpEvent(proxy)) {
    const method = methodOf(proxy);
    const label =
      method === 'tools/call'
        ? (text(proxy.attributes['gen_ai.tool.name']) ?? method)
        : (method ?? proxy.name);
    return {label, target: host === '' ? 'MCP' : `MCP · ${host}`};
  }
  const method = text(proxy.attributes['http.request.method']);
  const path = pathOf(proxy);
  const label = method !== undefined && path !== undefined ? `${method} ${path}` : proxy.name;
  return {label, target: host === '' ? 'HTTP' : `HTTP · ${host}`};
}

/** The JSON-RPC messages a tool call's exchange carried in its response: its chunks' bodies, else its body. */
function repliesOf(event: OtherEvent): unknown[] {
  const chunks = (event.events ?? [])
    .filter(chunk => chunk.name === 'a2ui.http.response.chunk')
    .map(chunk => chunk.attributes?.['a2ui.http.response.chunk.body']);
  const body = event.attributes['a2ui.http.response.body'];
  return [...chunks, ...(body === undefined ? [] : Array.isArray(body) ? body : [body])];
}

/** The reply to the request: the JSON-RPC response carrying its id, else the first response. */
function replyOf(event: OtherEvent): Record<string, unknown> | undefined {
  const id = event.attributes['jsonrpc.request.id'];
  const responses = repliesOf(event).filter(
    (message): message is Record<string, unknown> =>
      isRecord(message) && ('result' in message || 'error' in message) && !('method' in message),
  );
  return responses.find(message => message.id === id) ?? responses[0];
}

/** Whether the server sent this message itself: a request or notification it initiated. */
export function isServerInitiated(event: OtherEvent): boolean {
  return event.kind === 4;
}

/** The message a server initiated: its request or notification, the first chunk carrying a method. */
function serverMessageOf(event: OtherEvent): Record<string, unknown> | undefined {
  return repliesOf(event).find(
    (message): message is Record<string, unknown> => isRecord(message) && 'method' in message,
  );
}

/**
 * A tool call's arguments: the tool's arguments for `tools/call`, the params
 * of any other MCP request, of a server's request or notification too, and
 * the arguments read from a span; none for an HTTP tool or a request that
 * sent none.
 */
export function argumentsOf(row: CallRow): unknown {
  const {event} = readingOf(row);
  const named = event.attributes['gen_ai.tool.call.arguments'];
  if (named !== undefined) return named;
  if (row.proxy === undefined || !isMcpEvent(row.proxy)) return undefined;
  if (isServerInitiated(row.proxy)) return serverMessageOf(row.proxy)?.params;
  const body = row.proxy.attributes['a2ui.http.request.body'];
  return isRecord(body) ? body.params : undefined;
}

/** A tool call's result, and whether it is an error: the tool's own `isError`, or a JSON-RPC error. */
export interface ToolResult {
  value: unknown;
  error: boolean;
  /** The JSON-RPC error's code, for a JSON-RPC error. */
  code?: number;
}

/**
 * A tool call's result: the tool's result for `tools/call`, the reply's
 * result of any other MCP request, the result the agent answered a server's
 * request with, the error a JSON-RPC error carried, and the result read from
 * a span.
 */
export function resultOf(row: CallRow): ToolResult | undefined {
  const {event} = readingOf(row);
  const proxy = row.proxy;
  if (proxy !== undefined && isMcpEvent(proxy)) {
    if (isServerInitiated(proxy)) {
      const body = proxy.attributes['a2ui.http.request.body'];
      if (!isRecord(body)) return undefined;
      if (isRecord(body.error)) return {value: body.error, error: true, ...codeOf(body.error)};
      return 'result' in body ? {value: body.result, error: false} : undefined;
    }
    const reply = replyOf(proxy);
    if (reply !== undefined && isRecord(reply.error)) {
      return {value: reply.error, error: true, ...codeOf(reply.error)};
    }
    const named = proxy.attributes['gen_ai.tool.call.result'];
    if (named !== undefined)
      return {value: named, error: isRecord(named) && named.isError === true};
    if (reply !== undefined && 'result' in reply) {
      return {value: reply.result, error: isRecord(reply.result) && reply.result.isError === true};
    }
    return undefined;
  }
  const named = event.attributes['gen_ai.tool.call.result'];
  if (named === undefined) return undefined;
  return {value: named, error: isRecord(named) && named.isError === true};
}

function codeOf(error: Record<string, unknown>): {code?: number} {
  return typeof error.code === 'number' ? {code: error.code} : {};
}

/** A result's content blocks, when it holds MCP's content: a text block as text, every other block as JSON. */
export function contentBlocksOf(value: unknown): unknown[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
  return value.content;
}

/**
 * How a failed tool call reads, from the tool proxy's event: a JSON-RPC
 * error, an HTTP error status, a tool server that could not be reached, an
 * error inside a stream, a request the agent cancelled, a connection closed
 * before the answer. Nothing for a call that did not fail.
 */
export function toolFailureOf(proxy: OtherEvent): CallFailure | undefined {
  if (proxy.status?.code !== 2) return undefined;
  const type = text(proxy.attributes['error.type']) ?? 'error';
  const protocol = isMcpEvent(proxy) ? 'MCP' : 'HTTP';
  let sentence: string;
  let code: string;
  if (/^-?\d+$/.test(type) && !/^\d{3}$/.test(type)) {
    sentence = 'The tool server answered a JSON-RPC error.';
    code = `JSON-RPC ${type} · ${protocol}`;
  } else if (/^\d{3}$/.test(type)) {
    sentence = `The tool server answered ${statusLine(Number(type))}.`;
    code = `HTTP ${type} · ${protocol}`;
  } else if (type === 'cancelled') {
    sentence = 'The agent cancelled the request before it was answered.';
    code = `cancelled · ${protocol}`;
  } else if (type === 'aborted') {
    sentence = 'The connection closed before the request was answered.';
    code = `aborted · ${protocol}`;
  } else if (/^E[A-Z_]+$/.test(type)) {
    sentence = `The tool server could not be reached: ${type}.`;
    code = `${type} · ${protocol}`;
  } else {
    sentence = `The stream carried an error: ${type}.`;
    code = `${type} · ${protocol}`;
  }
  const note = proxy.status.message;
  return {sentence, code, ...(note !== undefined && note !== '' && {note})};
}
