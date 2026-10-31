/**
 * The model proxy: its own listener on loopback, one path prefix per
 * base-URL variable, each call forwarded to the prefix's target with the
 * rest of its path. The four APIs on the providers' own hosts are read in
 * full; every other call is recorded raw. Streams pass on chunk by chunk as
 * they arrive. Credentials are removed from what is recorded, never from
 * what is forwarded.
 */
import {randomBytes} from 'node:crypto';
import {
  type ClientRequest,
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as httpRequest,
  type ServerResponse,
} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {connect as netConnect, type Socket} from 'node:net';
import {type Duplex, PassThrough, type Transform} from 'node:stream';
import {connect as tlsConnect} from 'node:tls';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';

import {SseParser} from '../a2a/sse.js';
import type {CallToPlace, PlacedCall} from '../placement.js';
import type {ModelCallEvent, SpanEvent} from '../record/turn_record.js';
import {LOOPBACK_ADDRESS, PortTakenError} from '../server.js';
import {NAME} from '../version.js';
import {chunkEvent, endToEndHeaders, requestAttributes, responseAttributes} from './exchange.js';
import {seconds} from './genai.js';
import {type ApiReader, readerFor, type StreamChunk} from './readers/index.js';
import {forwardTo, type Redirection, splitPrefix, VARIABLES} from './redirection.js';

/** What the model proxy hands out as a call is captured. */
export type CallNotification =
  /** The call's event so far: its start, its request and the GenAI names read from it. */
  | {type: 'call_started'; traceId: string; event: ModelCallEvent}
  /** One response chunk, as it arrives. */
  | {type: 'call_chunk'; traceId: string; spanId: string; chunk: SpanEvent}
  /** The complete event, as the record holds it. */
  | {type: 'call_ended'; traceId: string; event: ModelCallEvent};

export type CallListener = (notification: CallNotification) => void;

export interface ModelProxyOptions {
  /** The proxy's port, on loopback. */
  port: number;
  /** The variables with their prefixes and targets. */
  redirections: Redirection[];
  /** The stand-in provider's origin, read as the own host of the API a call's path names. Tests only. */
  standInOrigin?: string;
  /** Places each call in its turn; a call that cannot be placed is forwarded but not recorded. */
  place: (call: CallToPlace) => PlacedCall | undefined;
  onCall?: CallListener;
  /** Takes the proxy's one-line notes, such as a token request passed on unrecorded. */
  log?: (line: string) => void;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
  newSpanId?: () => string;
}

export interface ModelProxy {
  readonly origin: string;
  close(): Promise<void>;
}

interface ProxyState {
  options: ModelProxyOptions;
  origin: string;
  inFlight: Set<ClientRequest>;
  sockets: Set<Duplex>;
  /** Set when Spectra stops: a call cut off then ends as aborted. */
  closing: boolean;
  now: () => bigint;
  newSpanId: () => string;
}

/** Starts the model proxy on its port. A port that is taken is an error. */
export function startModelProxy(options: ModelProxyOptions): Promise<ModelProxy> {
  const origin = `http://${LOOPBACK_ADDRESS}:${options.port}`;
  const state: ProxyState = {
    options,
    origin,
    inFlight: new Set(),
    sockets: new Set(),
    closing: false,
    now: options.now ?? nowUnixNano,
    newSpanId: options.newSpanId ?? (() => randomBytes(8).toString('hex')),
  };
  const server = createServer((request, response) => handle(state, request, response));
  server.on('upgrade', (request, socket, head) => upgrade(state, request, socket, head));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortTakenError(options.port) : error);
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        origin,
        close: () =>
          new Promise(done => {
            state.closing = true;
            for (const upstream of state.inFlight) {
              upstream.destroy(new Error('Spectra stopped before the response ended.'));
            }
            for (const socket of state.sockets) {
              socket.destroy();
            }
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/** The target of a request's path, or nothing for a path under no prefix. */
function targetOf(state: ProxyState, url: string): URL | undefined {
  const split = splitPrefix(url);
  if (split === undefined) {
    return undefined;
  }
  const redirection = state.options.redirections.find(item => item.name === split.name);
  if (redirection === undefined) {
    return undefined;
  }
  try {
    return new URL(forwardTo(redirection.target, split.rest));
  } catch {
    return undefined;
  }
}

function noSuchPrefix(state: ProxyState, response: ServerResponse): void {
  response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
  response.end(
    `${NAME}'s model proxy forwards calls under one of its prefixes: ${VARIABLES.map(name => `${state.origin}/${name}`).join(', ')}.\n`,
  );
}

function handle(state: ProxyState, request: IncomingMessage, response: ServerResponse): void {
  const target = targetOf(state, request.url ?? '/');
  if (target === undefined) {
    request.resume();
    noSuchPrefix(state, response);
    return;
  }
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.once('error', () => response.destroy());
  request.once('end', () => {
    void forward(state, request, Buffer.concat(chunks), target, response);
  });
}

/** What a call records, from its start to its end. */
class Capture {
  readonly event: ModelCallEvent;
  readonly chunks: StreamChunk[] = [];
  readonly spanEvents: SpanEvent[] = [];
  readonly #state: ProxyState;
  readonly #placed: PlacedCall;
  readonly #reader: ApiReader | undefined;
  #ended = false;
  #firstChunkAt: bigint | undefined;

  constructor(
    state: ProxyState,
    placed: PlacedCall,
    reader: ApiReader | undefined,
    start: bigint,
    attributes: Record<string, unknown>,
  ) {
    this.#state = state;
    this.#placed = placed;
    this.#reader = reader;
    const operation = attributes['gen_ai.operation.name'];
    const model = attributes['gen_ai.request.model'];
    this.event = {
      traceId: placed.traceId,
      spanId: state.newSpanId(),
      parentSpanId: placed.parentSpanId,
      name:
        typeof operation === 'string'
          ? `${operation}${typeof model === 'string' ? ` ${model}` : ''}`
          : String(attributes['http.request.method']),
      kind: 3,
      startTimeUnixNano: start.toString(),
      attributes: {'a2ui.event.kind': 'model_call', ...attributes},
    };
    state.options.onCall?.({type: 'call_started', traceId: placed.traceId, event: this.event});
  }

  chunk(chunk: {event?: string; id?: string; data: string}): void {
    const at = this.#state.now();
    this.#firstChunkAt ??= at;
    const spanEvent = chunkEvent(at.toString(), chunk);
    this.spanEvents.push(spanEvent);
    const body = spanEvent.attributes?.['a2ui.http.response.chunk.body'];
    this.chunks.push({...(chunk.event !== undefined && {event: chunk.event}), data: body});
    this.#state.options.onCall?.({
      type: 'call_chunk',
      traceId: this.#placed.traceId,
      spanId: this.event.spanId,
      chunk: spanEvent,
    });
  }

  /**
   * Ends the call: with the response read in full when it ended well, and
   * with the failure's type and message when it did not. Later calls do nothing.
   */
  end(outcome: {
    response?: {
      status: number;
      headers: IncomingMessage['headers'];
      body?: string;
      streamed: boolean;
    };
    failure?: {type: string; message?: string};
  }): void {
    if (this.#ended) return;
    this.#ended = true;
    const attributes: Record<string, unknown> = {...this.event.attributes};
    let failure = outcome.failure;
    if (outcome.response !== undefined) {
      const {status, headers, body, streamed} = outcome.response;
      Object.assign(attributes, responseAttributes(status, headers, streamed ? undefined : body));
      if (streamed && this.#firstChunkAt !== undefined) {
        attributes['gen_ai.response.time_to_first_chunk'] = seconds(
          this.#firstChunkAt - BigInt(this.event.startTimeUnixNano),
        );
      }
      if (this.#reader !== undefined) {
        if (status >= 400) {
          const message =
            body === undefined ? undefined : this.#reader.errorMessage(bodyJson(body));
          failure ??= {type: String(status), ...(message !== undefined && {message})};
        } else if (streamed) {
          const read = this.#reader.stream(this.chunks);
          Object.assign(attributes, read.attributes);
          failure ??= read.error;
        } else if (body !== undefined) {
          Object.assign(attributes, this.#reader.response(bodyJson(body)));
        }
      } else if (status >= 400) {
        failure ??= {type: String(status)};
      }
    }
    if (failure !== undefined) {
      attributes['error.type'] = failure.type;
    }
    const complete: ModelCallEvent = {
      ...this.event,
      endTimeUnixNano: this.#state.now().toString(),
      attributes: attributes as ModelCallEvent['attributes'],
      ...(this.spanEvents.length > 0 && {events: this.spanEvents}),
      status:
        failure === undefined
          ? {code: 1}
          : {code: 2, ...(failure.message !== undefined && {message: failure.message})},
    };
    this.#placed.ended(complete);
    this.#state.options.onCall?.({
      type: 'call_ended',
      traceId: this.#placed.traceId,
      event: complete,
    });
  }
}

async function forward(
  state: ProxyState,
  request: IncomingMessage,
  raw: Buffer,
  target: URL,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET';
  const start = state.now();
  const headers: OutgoingHttpHeaders = {...endToEndHeaders(request.headers), host: target.host};
  if (
    raw.length > 0 ||
    request.headers['content-length'] !== undefined ||
    request.headers['transfer-encoding'] !== undefined
  ) {
    headers['content-length'] = raw.length;
  }

  let capture: Capture | undefined;
  if (target.pathname.endsWith('/v1/oauth/token')) {
    state.options.log?.(
      `A token request, ${method} ${target.origin}${target.pathname}, was passed on unrecorded.`,
    );
  } else {
    const placed = state.options.place({
      what: `a model call to ${target.host}, ${method} ${target.pathname}`,
      startTimeUnixNano: start.toString(),
      traceparent: request.headers.traceparent,
    });
    if (placed !== undefined) {
      const standIn =
        state.options.standInOrigin !== undefined && target.origin === state.options.standInOrigin;
      const reader = readerFor(method, target.host, target.pathname, target.searchParams, standIn);
      const text = await readBody(raw, request.headers['content-encoding']);
      const bodyJsonValue = text === undefined ? undefined : bodyJson(text);
      capture = new Capture(state, placed, reader, start, {
        ...reader?.request({
          pathname: target.pathname,
          search: target.searchParams,
          body: bodyJsonValue,
        }),
        ...requestAttributes(method, target, headers, text),
      });
    }
  }

  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = send(target, {method, headers});
  state.inFlight.add(upstream);
  upstream.once('close', () => state.inFlight.delete(upstream));

  response.once('close', () => {
    if (!response.writableFinished) {
      upstream.destroy(new Error('The agent closed the connection before the response ended.'));
      capture?.end({
        failure: {
          type: 'aborted',
          message: 'The agent closed the connection before the response ended.',
        },
      });
    }
  });

  upstream.once('response', reply => relay(state, reply, response, capture));

  upstream.once('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    if (!response.headersSent) {
      response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      response.end(`${NAME}'s model proxy could not reach ${target.host}: ${error.message}\n`);
    } else {
      response.destroy(error);
    }
    capture?.end({
      failure: state.closing
        ? {type: 'aborted', message: 'Spectra stopped before the response ended.'}
        : {type: code ?? 'error', message: error.message},
    });
  });

  upstream.end(raw);
}

/** Passes the reply on as received, and reads a copy into the capture, if there is one. */
function relay(
  state: ProxyState,
  reply: IncomingMessage,
  response: ServerResponse,
  capture: Capture | undefined,
): void {
  response.writeHead(reply.statusCode ?? 502, reply.statusMessage, endToEndHeaders(reply.headers));
  reply.pipe(response);
  reply.once('close', () => {
    if (!reply.complete) {
      response.destroy();
    }
  });
  if (capture === undefined) {
    reply.resume();
    return;
  }
  const status = reply.statusCode ?? 0;
  const streamed = /^text\/event-stream\b/i.test(String(reply.headers['content-type'] ?? ''));
  const decoder = decoderFor(reply.headers['content-encoding']);
  const text = new TextDecoder();
  const sse = new SseParser();
  let body = '';
  const breakOff = (error?: Error) => {
    capture.end({
      response: {status, headers: reply.headers, streamed},
      failure: state.closing
        ? {type: 'aborted', message: 'Spectra stopped before the response ended.'}
        : {
            type: (error as NodeJS.ErrnoException | undefined)?.code ?? 'ECONNRESET',
            message: error?.message ?? "The provider's response broke before it ended.",
          },
    });
  };
  if (decoder === undefined) {
    reply.once('end', () =>
      capture.end({response: {status, headers: reply.headers, streamed: false}}),
    );
    reply.once('error', error => breakOff(error));
    return;
  }
  reply.on('data', (chunk: Buffer) => decoder.write(chunk));
  reply.once('end', () => decoder.end());
  reply.once('error', error => {
    breakOff(error);
    decoder.destroy();
  });
  reply.once('aborted', () => {
    breakOff();
    decoder.destroy();
  });
  decoder.on('data', (chunk: Buffer) => {
    const decoded = text.decode(chunk, {stream: true});
    if (streamed) {
      for (const event of sse.push(decoded)) {
        capture.chunk(event);
      }
    } else {
      body += decoded;
    }
  });
  decoder.once('end', () => {
    if (!streamed) {
      body += text.decode();
    }
    if (!reply.complete) {
      breakOff();
      return;
    }
    capture.end({response: {status, headers: reply.headers, body, streamed}});
  });
  decoder.once('error', error => breakOff(error));
}

/** Passes a WebSocket upgrade on to the target as a tunnel, unrecorded. */
function upgrade(state: ProxyState, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const target = targetOf(state, request.url ?? '/');
  if (target === undefined) {
    socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n');
    return;
  }
  state.options.log?.(
    `A WebSocket upgrade, ${target.origin}${target.pathname}, was passed on unrecorded.`,
  );
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const upstream: Socket =
    target.protocol === 'https:'
      ? tlsConnect({host: target.hostname, port, servername: target.hostname})
      : netConnect({host: target.hostname, port});
  state.sockets.add(socket);
  state.sockets.add(upstream);
  const forget = () => {
    state.sockets.delete(socket);
    state.sockets.delete(upstream);
  };
  upstream.once('connect', () => {
    const lines = [`${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i];
      lines.push(
        `${name}: ${name.toLowerCase() === 'host' ? target.host : request.rawHeaders[i + 1]}`,
      );
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once('secureConnect', () => upstream.emit('connect'));
  upstream.once('error', () => {
    socket.destroy();
    forget();
  });
  socket.once('error', () => {
    upstream.destroy();
    forget();
  });
  socket.once('close', () => {
    upstream.destroy();
    forget();
  });
  upstream.once('close', () => {
    socket.destroy();
    forget();
  });
}

/** A stream that undoes the content encoding, or nothing for an encoding it cannot read. */
function decoderFor(encoding: string | string[] | undefined): Transform | undefined {
  const value = Array.isArray(encoding) ? encoding.join(', ') : encoding;
  switch (value?.trim().toLowerCase() ?? 'identity') {
    case 'identity':
    case '':
      return new PassThrough();
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return undefined;
  }
}

/** A whole body as text, its content encoding undone; nothing when it cannot be read. */
function readBody(
  raw: Buffer,
  encoding: string | string[] | undefined,
): Promise<string | undefined> {
  const decoder = decoderFor(encoding);
  if (decoder === undefined) {
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    decoder.on('data', (chunk: Buffer) => chunks.push(chunk));
    decoder.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    decoder.once('error', () => resolve(undefined));
    decoder.end(raw);
  });
}

/** A body's JSON value, or nothing when it is not JSON. */
function bodyJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}
