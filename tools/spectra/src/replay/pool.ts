/**
 * The pool a replay serves from: every recorded model call and tool call of a
 * turn record, in turn order and then start order. The model proxy and the
 * tool proxy, armed with the one pool, ask it what each request gets: the
 * recorded event to serve, a miss, or, for a model call in the live mode,
 * that the request goes live. The pool is the one place that holds what has
 * been consumed.
 */
import {isDeepStrictEqual} from 'node:util';

import {
  type CallEvent,
  isEventOfKind,
  type ReplayMode,
  type SpanEvent,
  type TurnRecord,
} from '../record/turn_record.js';

/** The modes that arm the proxies with a pool; a `live` replay arms none. */
export type PoolMode = Exclude<ReplayMode, 'live'>;

/** What keys a model call and an HTTP tool: three of the exchange's attributes, compared by deep JSON equality. */
export interface ExchangeKey {
  method: unknown;
  url: unknown;
  /** Absent when the exchange leaves the body out. */
  body: unknown;
}

/** The key of an exchange, from its attributes as the proxies record them. */
export function exchangeKey(attributes: Record<string, unknown>): ExchangeKey {
  return {
    method: attributes['http.request.method'],
    url: attributes['url.full'],
    body: attributes['a2ui.http.request.body'],
  };
}

/**
 * MCP's housekeeping requests: matched by method alone and not consumed, the
 * record's latest exchange of the method served as often as asked.
 */
export const HOUSEKEEPING: ReadonlySet<string> = new Set([
  'initialize',
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
  'logging/setLevel',
]);

/** What the pool answers a request. */
export type PoolAnswer =
  | {type: 'served'; event: CallEvent}
  | {type: 'miss'}
  /** A model call in the live mode that matched nothing: forwarded as today. */
  | {type: 'live'};

/** The JSON-RPC message an MCP event's request body holds. */
function requestMessage(event: CallEvent): Record<string, unknown> | undefined {
  const body = event.attributes['a2ui.http.request.body'];
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

/**
 * The params of an MCP request as its key holds them: `_meta` left out, and
 * params with nothing else the same as none.
 */
export function paramsKey(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return params;
  const rest = Object.fromEntries(
    Object.entries(params as Record<string, unknown>).filter(([name]) => name !== '_meta'),
  );
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** A recorded call's place in the pool. */
interface Entry {
  event: CallEvent;
  /** Served once and done with: a request outside housekeeping. */
  consumed: boolean;
  /** Served at least once, housekeeping included. */
  served: boolean;
}

/** Takes the first entry not yet consumed that matches. */
function take(entries: Entry[], matches: (event: CallEvent) => boolean): CallEvent | undefined {
  const entry = entries.find(item => !item.consumed && matches(item.event));
  if (entry === undefined) return undefined;
  entry.consumed = true;
  entry.served = true;
  return entry.event;
}

function startOf(event: CallEvent): bigint {
  try {
    return BigInt(event.startTimeUnixNano);
  } catch {
    return 0n;
  }
}

export class ReplayPool {
  readonly mode: PoolMode;
  readonly #model: Entry[] = [];
  readonly #httpTools: Entry[] = [];
  /** MCP requests: a client's request with its id, by its method and params. */
  readonly #mcp: Entry[] = [];
  /** Every entry, in pool order. */
  readonly #all: Entry[] = [];
  /** MCP's session ends, `DELETE`s carrying `Mcp-Session-Id`. */
  readonly #sessionEnds: CallEvent[] = [];

  constructor(record: TurnRecord, mode: PoolMode) {
    this.mode = mode;
    for (const turn of record.turns) {
      const calls = turn.events
        .filter(
          (event): event is CallEvent =>
            isEventOfKind(event, 'model_call') || isEventOfKind(event, 'tool_call'),
        )
        .map((event, index) => ({event, index}))
        .sort((a, b) => {
          const order = startOf(a.event) - startOf(b.event);
          return order === 0n ? a.index - b.index : order < 0n ? -1 : 1;
        });
      for (const {event} of calls) this.#add(event);
    }
  }

  #add(event: CallEvent): void {
    const attributes = event.attributes;
    const entry: Entry = {event, consumed: false, served: false};
    // A call read from the agent's spans carries no exchange: nothing to serve.
    if (attributes['http.request.method'] === undefined) return;
    if (attributes['a2ui.event.kind'] === 'model_call') {
      this.#model.push(entry);
      this.#all.push(entry);
      return;
    }
    // An operation the server initiated is never re-sent.
    if (event.kind === 4) return;
    if (typeof attributes['mcp.method.name'] === 'string') {
      // A client's notification is answered as the protocol fixes; a request is served.
      if (attributes['jsonrpc.request.id'] !== undefined) {
        this.#mcp.push(entry);
        this.#all.push(entry);
      }
      return;
    }
    // A client's response to a server request is answered as the protocol fixes.
    if (event.name === 'response') return;
    if (event.name === 'DELETE') {
      this.#sessionEnds.push(event);
      return;
    }
    if (attributes['http.request.method'] !== undefined) {
      this.#httpTools.push(entry);
      this.#all.push(entry);
    }
  }

  /** The recorded calls never served, in pool order: a consumed exchange and housekeeping that was asked for count as served. */
  unserved(): CallEvent[] {
    return this.#all.filter(entry => !entry.served).map(entry => entry.event);
  }

  /** A model request: the first exchange with its key not yet served; else live in the live mode, a miss otherwise. */
  model(key: ExchangeKey): PoolAnswer {
    const event = take(this.#model, recorded =>
      isDeepStrictEqual(exchangeKey(recorded.attributes), key),
    );
    if (event !== undefined) return {type: 'served', event};
    return this.mode === 'model_live' ? {type: 'live'} : {type: 'miss'};
  }

  /** An HTTP tool request: the first exchange with its key not yet served, else nothing. */
  httpTool(key: ExchangeKey): CallEvent | undefined {
    return take(this.#httpTools, recorded =>
      isDeepStrictEqual(exchangeKey(recorded.attributes), key),
    );
  }

  /**
   * An MCP request by its method and params, its id and `params._meta` left
   * out: housekeeping is the latest exchange of its method, as often as
   * asked; any other request the first exchange with its key not yet served.
   */
  mcpRequest(method: string, params: unknown): CallEvent | undefined {
    if (HOUSEKEEPING.has(method)) {
      const entry = this.#mcp.findLast(item => item.event.attributes['mcp.method.name'] === method);
      if (entry !== undefined) entry.served = true;
      return entry?.event;
    }
    const key = paramsKey(params);
    return take(this.#mcp, recorded => {
      const message = requestMessage(recorded);
      return (
        recorded.attributes['mcp.method.name'] === method &&
        isDeepStrictEqual(paramsKey(message?.params), key)
      );
    });
  }

  /** The record's latest session end, served as often as asked. */
  sessionEnd(): CallEvent | undefined {
    return this.#sessionEnds.at(-1);
  }

  /**
   * The recorded `initialize` an HTTP+SSE carrier opened at this path stands
   * for: the latest whose `a2ui.mcp.stream.url` has the path and whose first
   * chunk is an `endpoint` event, with that event.
   */
  sseOpening(pathname: string): {event: CallEvent; endpoint: SpanEvent} | undefined {
    for (const entry of [...this.#mcp].reverse()) {
      const {event} = entry;
      if (event.attributes['mcp.method.name'] !== 'initialize') continue;
      const first = event.events?.[0];
      if (first?.attributes?.['a2ui.http.response.chunk.event'] !== 'endpoint') continue;
      const streamUrl = event.attributes['a2ui.mcp.stream.url'];
      if (typeof streamUrl !== 'string') continue;
      try {
        if (new URL(streamUrl).pathname === pathname) {
          entry.served = true;
          return {event, endpoint: first};
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

/** Whether a record holds nothing the proxies could serve: no model call and no tool call to answer with. */
export function hasNothingToServe(record: TurnRecord): boolean {
  return new ReplayPool(record, 'recorded').unserved().length === 0;
}
