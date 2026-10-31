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
import type {Duplex} from 'node:stream';

import {SseParser} from '../a2a/sse.js';
import type {CallToPlace, PlacedCall} from '../placement.js';
import type {CallEvent, ModelCallEvent, SpanEvent} from '../record/turn_record.js';
import {LOOPBACK_ADDRESS, PortTakenError} from '../server.js';
import {NAME} from '../version.js';
import {chunkEvent, endToEndHeaders, requestAttributes, responseAttributes} from './exchange.js';
import {
  bodyJson,
  decoderFor,
  isTokenRequest,
  nowUnixNano,
  readBody,
  tunnelUpgrade,
} from './forwarding.js';
import {seconds} from './genai.js';
import {type ApiReader, readerFor, type StreamChunk} from './readers/index.js';
import {forwardTo, type Redirection, splitPrefix, VARIABLES} from './redirection.js';

/** What the model proxy and the tool proxy hand out as a call is captured. */
export type CallNotification =
  /** The call's event so far: its start, its request and the names read from it. */
  | {type: 'call_started'; traceId: string; event: CallEvent}
  /** One response chunk, as it arrives. */
  | {type: 'call_chunk'; traceId: string; spanId: string; chunk: SpanEvent}
  /** The complete event, as the record holds it. */
  | {type: 'call_ended'; traceId: string; event: CallEvent};

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
  /**
   * How long a reply is waited for after the agent closes its connection,
   * in milliseconds; one that neither ends nor delivers by then ends the call
   * as aborted. Five seconds unless set.
   */
  closeGraceMs?: number;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
  newSpanId?: () => string;
}

const DEFAULT_CLOSE_GRACE_MS = 5000;
const AGENT_CLOSED = 'The agent closed the connection before the response ended.';

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
  closeGraceMs: number;
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
    closeGraceMs: options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
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
  /** When the agent closed its connection before the call ended, and the chunks it had by then. */
  #closedAt: bigint | undefined;
  #chunksAtClose = 0;
  #graceTimer: NodeJS.Timeout | undefined;
  #dropReply: (() => void) | undefined;
  /** Runs `done` once what the reply delivered so far has been read; set by the relay. */
  #settle: (done: () => void) => void = done => process.nextTick(done);

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

  settleWith(settle: (done: () => void) => void): void {
    this.#settle = settle;
  }

  /**
   * Notes that the agent closed its connection before the response ended.
   * The reply is read on for the grace: one that ends by then is complete,
   * read in full; one that has not ends the call as aborted at the close,
   * with the chunks before it, and `dropReply` drops the reply.
   */
  agentClosed(dropReply: () => void): void {
    if (this.#ended || this.#closedAt !== undefined) return;
    const at = this.#state.now();
    this.#settle(() => {
      if (this.#ended || this.#closedAt !== undefined) return;
      this.#closedAt = at;
      this.#chunksAtClose = this.spanEvents.length;
      this.#dropReply = dropReply;
      this.#graceTimer = setTimeout(() => this.#abandon(), this.#state.closeGraceMs);
    });
  }

  /** Ends the call as aborted at the agent's close, and drops the reply. */
  #abandon(): void {
    this.spanEvents.length = this.#chunksAtClose;
    this.chunks.length = this.#chunksAtClose;
    this.end({failure: {type: 'aborted', message: AGENT_CLOSED}}, this.#closedAt);
    this.#dropReply?.();
  }

  chunk(chunk: {event?: string; id?: string; data: string}): void {
    if (this.#ended) return;
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
   * Ends the call, at `at` or now: with the response read in full when it
   * ended well, and with the failure's type and message when it did not.
   * Later calls do nothing.
   */
  end(
    outcome: {
      response?: {
        status: number;
        headers: IncomingMessage['headers'];
        body?: string;
        streamed: boolean;
      };
      failure?: {type: string; message?: string};
    },
    at: bigint = this.#state.now(),
  ): void {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#graceTimer);
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
      endTimeUnixNano: at.toString(),
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
  const text = await readBody(raw, request.headers['content-encoding']);
  if (isTokenRequest(request.headers['content-type'], text)) {
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
    if (response.writableFinished) return;
    if (capture === undefined) {
      upstream.destroy(new Error(AGENT_CLOSED));
      return;
    }
    // The reply is read on, for the agent that leaves once it has the content,
    // before the stream's last event.
    capture.agentClosed(() => upstream.destroy(new Error(AGENT_CLOSED)));
  });

  upstream.once('response', reply => relay(state, reply, response, capture));

  upstream.once('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    if (response.destroyed) {
      // The agent is gone; nothing to answer.
    } else if (!response.headersSent) {
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
  if (!response.destroyed) {
    response.writeHead(
      reply.statusCode ?? 502,
      reply.statusMessage,
      endToEndHeaders(reply.headers),
    );
    reply.pipe(response);
    reply.once('close', () => {
      if (!reply.complete) {
        response.destroy();
      }
    });
    response.once('close', () => {
      // The pipe's end pauses the reply; the capture reads it on.
      if (capture !== undefined && !reply.complete) reply.resume();
    });
  }
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
  if (decoder !== undefined) {
    // The agent's close counts once the decoder has given out what arrived before it.
    capture.settleWith(done =>
      decoder.flush === undefined ? process.nextTick(done) : decoder.flush(done),
    );
  }
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
  tunnelUpgrade(request, socket, head, target, state.sockets);
}
