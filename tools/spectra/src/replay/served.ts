/**
 * A recorded call turned back into the reply a proxy serves: its status, its
 * response headers with the removed ones left out, and its body or its
 * stream of server-sent events, each recorded failure reproduced. A served
 * reply stands where a forwarded request's reply would, so the proxies read
 * and record it on the path every reply takes.
 */
import {EventEmitter} from 'node:events';
import {type IncomingHttpHeaders, type ServerResponse, STATUS_CODES} from 'node:http';
import {Readable} from 'node:stream';

import type {SseEvent} from '../a2a/sse.js';
import {REMOVED, removeFromUrl} from '../model_proxy/credentials.js';
import type {CallEvent} from '../record/turn_record.js';
import {NAME} from '../version.js';

/** A reply a proxy serves in place of a forwarded one. */
export interface ServedReply {
  status: number;
  headers: IncomingHttpHeaders;
  /** A body written whole. */
  body?: string;
  /** A stream: one server-sent event per chunk, written as fast as the agent reads. */
  events?: SseEvent[];
  /** Destroys the connection after the chunks, as a recorded break did. */
  broken?: boolean;
}

/** What a recorded call is served as: a reply, or, with no response recorded, the proxy's 502 line. */
export type RecordedAnswer =
  | {type: 'reply'; reply: ServedReply}
  | {type: 'unreached'; failure: {type: string; message?: string}};

const HEADER = 'http.response.header.';

/** The recorded response headers, less a removed credential, `content-encoding` and `content-length`. */
export function servedHeaders(attributes: Record<string, unknown>): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!name.startsWith(HEADER)) continue;
    const header = name.slice(HEADER.length);
    if (header === 'content-encoding' || header === 'content-length') continue;
    const values = (Array.isArray(value) ? value : [value]).map(String);
    if (values.includes(REMOVED)) continue;
    if (header === 'set-cookie') headers['set-cookie'] = values;
    else headers[header] = values.join(', ');
  }
  return headers;
}

/** A recorded body or chunk as text: a JSON value serialised, a text as itself. */
export function bodyText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** A call's recorded chunks as server-sent events, each body passed through `rewrite`. */
export function recordedEvents(
  event: CallEvent,
  rewrite: (body: unknown) => unknown = body => body,
): SseEvent[] {
  return (event.events ?? [])
    .filter(chunk => chunk.name === 'a2ui.http.response.chunk')
    .map(chunk => {
      const attributes = chunk.attributes ?? {};
      const name = attributes['a2ui.http.response.chunk.event'];
      const id = attributes['a2ui.http.response.chunk.id'];
      return {
        ...(typeof name === 'string' && {event: name}),
        ...(typeof id === 'string' && {id}),
        data: bodyText(rewrite(attributes['a2ui.http.response.chunk.body'])),
      };
    });
}

/** One server-sent event's text: `event:` and `id:` when it has them, a `data:` line per line of its data. */
export function sseText(event: SseEvent): string {
  let text = '';
  if (event.event !== undefined) text += `event: ${event.event}\n`;
  if (event.id !== undefined) text += `id: ${event.id}\n`;
  for (const line of event.data.split(/\r\n|\r|\n/)) text += `data: ${line}\n`;
  return `${text}\n`;
}

/** Whether a recorded response was a stream of server-sent events, by its recorded `content-type`. */
export function wasStreamed(attributes: Record<string, unknown>): boolean {
  const type = attributes[`${HEADER}content-type`];
  return /^text\/event-stream\b/i.test(String(Array.isArray(type) ? type[0] : (type ?? '')));
}

/**
 * Whether a recorded call broke off after its response began: a failed call
 * with a response whose `error.type` is none the response states — its
 * status, a JSON-RPC code, `stated`, the error a reader finds in its chunks —
 * nor `aborted` or `cancelled`.
 */
export function brokeOff(event: CallEvent, stated?: string): boolean {
  const attributes = event.attributes;
  const type = attributes['error.type'];
  const status = attributes['http.response.status_code'];
  if (event.status?.code !== 2 || typeof type !== 'string' || typeof status !== 'number') {
    return false;
  }
  return (
    type !== String(status) &&
    type !== 'aborted' &&
    type !== 'cancelled' &&
    type !== attributes['rpc.response.status_code'] &&
    type !== stated
  );
}

/**
 * What a recorded call is served as. A call with no response recorded,
 * unreached or a miss, is the proxy's 502 line with the recorded failure. A
 * status is served as recorded, body and all; a stream as its chunks, then
 * the connection destroyed when it broke and a clean end otherwise.
 */
export function recordedAnswer(
  event: CallEvent,
  {
    broke,
    rewrite,
  }: {
    broke: boolean;
    rewrite?: (body: unknown) => unknown;
  },
): RecordedAnswer {
  const attributes = event.attributes;
  const status = attributes['http.response.status_code'];
  if (typeof status !== 'number') {
    const type = attributes['error.type'];
    return {
      type: 'unreached',
      failure: {
        type: typeof type === 'string' ? type : 'error',
        ...(event.status?.message !== undefined && {message: event.status.message}),
      },
    };
  }
  const headers = servedHeaders(attributes);
  if (wasStreamed(attributes)) {
    return {
      type: 'reply',
      reply: {
        status,
        headers,
        events: recordedEvents(event, rewrite),
        ...(broke && {broken: true}),
      },
    };
  }
  const recorded = attributes['a2ui.http.response.body'];
  const body =
    recorded === undefined ? '' : bodyText(rewrite === undefined ? recorded : rewrite(recorded));
  return {
    type: 'reply',
    reply: {
      status,
      headers: {...headers, 'content-length': String(Buffer.byteLength(body))},
      body,
      ...(broke && {broken: true}),
    },
  };
}

/** A forwarded request, or the served reply standing in its place. */
export interface Upstream {
  once(event: 'response', listener: (reply: ReplyMessage) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: () => void): unknown;
  destroy(error?: Error): unknown;
  end(body?: Buffer): unknown;
}

/** A reply as the relay reads it: a forwarded reply's `IncomingMessage`, or a served one. */
export type ReplyMessage = Readable & {
  readonly statusCode?: number;
  readonly statusMessage?: string;
  readonly headers: IncomingHttpHeaders;
  readonly complete: boolean;
};

/** How long a reply that breaks off waits for what it gave to be read, between looks. */
const DRAIN_MS = 5;

/**
 * A served reply read as the proxies read a forwarded reply's
 * `IncomingMessage`: its status, its headers, `complete` once it ended whole,
 * and `aborted` before it is destroyed when it breaks off. Each piece is
 * given when the reader asks for more.
 */
export class ServedMessage extends Readable {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: IncomingHttpHeaders;
  complete = false;
  readonly #pieces: Buffer[];
  readonly #broken: boolean;
  #ending = false;

  constructor(reply: ServedReply) {
    super();
    this.statusCode = reply.status;
    this.statusMessage = STATUS_CODES[reply.status] ?? '';
    this.headers = reply.headers;
    this.#broken = reply.broken === true;
    this.#pieces =
      reply.events !== undefined
        ? reply.events.map(event => Buffer.from(sseText(event)))
        : reply.body !== undefined && reply.body !== ''
          ? [Buffer.from(reply.body)]
          : [];
  }

  override _read(): void {
    const piece = this.#pieces.shift();
    if (piece !== undefined) {
      this.push(piece);
      return;
    }
    if (this.#ending) return;
    this.#ending = true;
    if (!this.#broken) {
      this.complete = true;
      this.push(null);
      return;
    }
    // Breaks off once what it gave has been read, as a connection that drops after its last byte.
    const breakOff = () => {
      if (this.destroyed) return;
      if (this.readableLength > 0) {
        setTimeout(breakOff, DRAIN_MS);
        return;
      }
      this.emit('aborted');
      this.destroy();
    };
    breakOff();
  }
}

/**
 * Stands where a forwarded request would: once it is ended, it answers with
 * the served reply, and it closes when the reply ends or is destroyed.
 */
export class ServedUpstream extends EventEmitter {
  readonly #reply: ServedReply;
  #message: ServedMessage | undefined;
  #destroyed = false;

  constructor(reply: ServedReply) {
    super();
    this.#reply = reply;
  }

  end(): this {
    setImmediate(() => {
      if (this.#destroyed) return;
      const message = new ServedMessage(this.#reply);
      this.#message = message;
      message.once('close', () => this.emit('close'));
      this.emit('response', message);
    });
    return this;
  }

  /** Drops the reply: one not yet given never comes, and one under way is aborted, as a dropped connection's is. */
  destroy(): this {
    if (this.#destroyed) return this;
    this.#destroyed = true;
    const message = this.#message;
    if (message === undefined) {
      setImmediate(() => this.emit('close'));
    } else if (!message.destroyed && !message.complete) {
      message.emit('aborted');
      message.destroy();
    }
    return this;
  }
}

/**
 * The line a proxy answers a miss with, prints, and records as the failed
 * call's status message: the proxy, that it is replaying, and the method and
 * target path with credentials removed.
 */
export function missLine(proxy: string, method: string, target: URL): string {
  const url = new URL(removeFromUrl(target.href));
  return `${NAME}'s ${proxy} is replaying, and ${method} ${url.pathname}${url.search} matched nothing in the record.`;
}

/** The 502 line a recorded call with no response is served as: a recorded miss's own line, else the proxy's line for a target it could not reach. */
export function unreachedLine(
  proxy: string,
  host: string,
  failure: {type: string; message?: string},
): string {
  if (failure.type === 'replay_miss' && failure.message !== undefined) return failure.message;
  return `${NAME}'s ${proxy} could not reach ${host}: ${failure.message ?? failure.type}`;
}

/** Answers the agent with a proxy's 502 and its one line. */
export function answer502(response: ServerResponse, line: string): void {
  if (response.destroyed || response.headersSent) return;
  response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
  response.end(`${line}\n`);
}
