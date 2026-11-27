/**
 * The model proxy: its own listener on loopback, one path prefix per
 * base-URL variable, each call forwarded to the prefix's target with the
 * rest of its path. The four APIs on the providers' own hosts are read in
 * full; every other call is recorded raw. Streams pass on chunk by chunk as
 * they arrive. Credentials are removed from what is recorded, never from
 * what is forwarded. Armed with a replay's pool, it serves each call the
 * pool matches from the record, on the path a forwarded reply takes.
 */
import {randomBytes} from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type {Duplex} from 'node:stream';

import type {CallToPlace, PlacedCall} from '../placement.js';
import {withContentFitted} from '../receiver/genai.js';
import type {CallEvent, ModelCallEvent, SpanEvent} from '../record/turn_record.js';
import {exchangeKey, type PoolAnswer, type ReplayPool} from '../replay/pool.js';
import {
  answer502,
  brokeOff,
  missLine,
  recordedAnswer,
  redirectLine,
  type ServedReply,
  unreachedLine,
  type Upstream,
  wasStreamed,
} from '../replay/served.js';
import {nowUnixNano} from '../clock.js';
import {proxyRefusal, refuseRequest, refuseUpgrade} from '../host_check.js';
import {listenError, LOOPBACK_ADDRESS} from '../server.js';
import {NAME} from '../version.js';
import {chunkEvent, requestAttributes, responseAttributes} from '../proxying/exchange.js';
import {bodyJson, isTokenRequest, readBody, tunnelUpgrade} from '../proxying/forwarding.js';
import type {CallListener} from '../proxying/calls.js';
import {
  AGENT_CLOSED,
  DEFAULT_CLOSE_GRACE_MS,
  type Forwarder,
  forward as forwardExchange,
  forwardedHeaders,
  missUpgrade,
  type Relay,
  STOPPED,
} from '../proxying/relay.js';
import {seconds} from './genai.js';
import {type ApiReader, readerFor, type StreamChunk} from './readers/index.js';
import {forwardTo, type Redirection, splitPrefix, VARIABLES} from './redirection.js';

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
  /** The names given with `--allow-host`, answered beside the loopback names. None unless set. */
  allowedHosts?: readonly string[];
  /**
   * How long a reply is waited for after the agent closes its connection,
   * in milliseconds; one that has not ended by then ends the call as aborted.
   * Five seconds unless set.
   */
  closeGraceMs?: number;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
  newSpanId?: () => string;
}

/** The least time between two of a call's progress notifications: at most ten a second. */
const PROGRESS_MS = 100;

export interface ModelProxy {
  readonly origin: string;
  /** Serves from the pool until disarmed: each call it matches, its misses answered with a 502, or in the live mode forwarded. */
  arm(pool: ReplayPool): void;
  /** Drops the pool: every call is forwarded again. */
  disarm(): void;
  close(): Promise<void>;
}

interface ProxyState {
  options: ModelProxyOptions;
  origin: string;
  /** The replay's pool while armed. */
  pool: ReplayPool | undefined;
  inFlight: Set<Upstream>;
  /** What forwarding takes from the proxy, made once. */
  forwarder?: Forwarder;
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
    pool: undefined,
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
      reject(listenError(error, options.port));
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        origin,
        arm: pool => {
          state.pool = pool;
        },
        disarm: () => {
          state.pool = undefined;
        },
        close: () =>
          new Promise(done => {
            state.closing = true;
            for (const upstream of state.inFlight) {
              upstream.destroy(new Error(STOPPED));
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
  const refusal = proxyRefusal(request.headers, state.options.allowedHosts ?? [], 'refused');
  if (refusal !== undefined) {
    refuseRequest(request, response, refusal);
    return;
  }
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
  private readonly state: ProxyState;
  private readonly placed: PlacedCall;
  private readonly reader: ApiReader | undefined;
  private ended = false;
  /** When the first chunk carrying output arrived, on a call read in full. */
  private firstChunkAt: bigint | undefined;
  /** When the agent closed its connection before the call ended, and the chunks it had by then. */
  private closedAt: bigint | undefined;
  private chunksAtClose = 0;
  private graceTimer: NodeJS.Timeout | undefined;
  private dropReply: (() => void) | undefined;
  /** When the last progress went out, on the monotonic clock, and how many chunks it read. */
  private progressAt: number | undefined;
  private progressChunks = 0;
  private progressTimer: NodeJS.Timeout | undefined;
  /** Runs `done` once what the reply delivered so far has been read; set by the relay. */
  private settle: (done: () => void) => void = done => process.nextTick(done);

  constructor(
    state: ProxyState,
    placed: PlacedCall,
    reader: ApiReader | undefined,
    start: bigint,
    attributes: Record<string, unknown>,
  ) {
    this.state = state;
    this.placed = placed;
    this.reader = reader;
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
    this.settle = settle;
  }

  /**
   * Notes that the agent closed its connection before the response ended.
   * The reply is read on for the grace: one that ends by then is complete,
   * read in full; one that has not ends the call as aborted at the close,
   * with the chunks before it, and `dropReply` drops the reply.
   */
  agentClosed(dropReply: () => void): void {
    if (this.ended || this.closedAt !== undefined) return;
    const at = this.state.now();
    this.settle(() => {
      if (this.ended || this.closedAt !== undefined) return;
      this.closedAt = at;
      this.chunksAtClose = this.spanEvents.length;
      this.dropReply = dropReply;
      this.graceTimer = setTimeout(() => this.abandon(), this.state.closeGraceMs);
    });
  }

  /** Ends the call as aborted at the agent's close, and drops the reply. */
  private abandon(): void {
    this.spanEvents.length = this.chunksAtClose;
    this.chunks.length = this.chunksAtClose;
    this.end({failure: {type: 'aborted', message: AGENT_CLOSED}}, this.closedAt);
    this.dropReply?.();
  }

  chunk(chunk: {event?: string; id?: string; data: string}): void {
    if (this.ended) return;
    const at = this.state.now();
    const spanEvent = chunkEvent(at.toString(), chunk);
    this.spanEvents.push(spanEvent);
    const read = streamChunkOf(spanEvent);
    this.chunks.push(read);
    // The first chunk is the first that carries output, on a call read in full.
    if (this.firstChunkAt === undefined && this.reader?.carriesOutput(read) === true) {
      this.firstChunkAt = at;
    }
    this.state.options.onCall?.({
      type: 'call_chunk',
      traceId: this.placed.traceId,
      spanId: this.event.spanId,
      chunk: spanEvent,
    });
    this.progress();
  }

  /**
   * Sends the response names read from the chunks so far, at most once per
   * `PROGRESS_MS`: at once when the last went out long enough ago, else when
   * that time has passed, reading every chunk come by then.
   */
  private progress(): void {
    if (this.reader === undefined || this.progressTimer !== undefined) return;
    const since = this.progressAt === undefined ? Infinity : performance.now() - this.progressAt;
    if (since >= PROGRESS_MS) {
      this.sendProgress();
      return;
    }
    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined;
      if (!this.ended) this.sendProgress();
    }, PROGRESS_MS - since);
  }

  private sendProgress(): void {
    if (this.reader === undefined) return;
    this.progressAt = performance.now();
    this.progressChunks = this.chunks.length;
    this.state.options.onCall?.({
      type: 'call_progress',
      traceId: this.placed.traceId,
      spanId: this.event.spanId,
      attributes: withContentFitted(this.reader.stream(this.chunks).attributes),
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
        headers: IncomingHttpHeaders;
        body?: string;
        streamed: boolean;
      };
      failure?: {type: string; message?: string};
    },
    at: bigint = this.state.now(),
  ): void {
    if (this.ended) return;
    clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
    // The last chunk's progress goes out before the call ends.
    if (this.chunks.length > 0 && this.chunks.length !== this.progressChunks) this.sendProgress();
    this.ended = true;
    clearTimeout(this.graceTimer);
    const attributes: Record<string, unknown> = {...this.event.attributes};
    let failure = outcome.failure;
    if (outcome.response !== undefined) {
      const {status, headers, body, streamed} = outcome.response;
      Object.assign(attributes, responseAttributes(status, headers, streamed ? undefined : body));
      if (streamed && this.firstChunkAt !== undefined) {
        attributes['gen_ai.response.time_to_first_chunk'] = seconds(
          this.firstChunkAt - BigInt(this.event.startTimeUnixNano),
        );
      }
      if (this.reader !== undefined) {
        if (status >= 400) {
          const message = body === undefined ? undefined : this.reader.errorMessage(bodyJson(body));
          failure ??= {type: String(status), ...(message !== undefined && {message})};
        } else if (streamed) {
          const read = this.reader.stream(this.chunks);
          Object.assign(attributes, withContentFitted(read.attributes));
          failure ??= read.error;
        } else if (body !== undefined) {
          Object.assign(attributes, withContentFitted(this.reader.response(bodyJson(body))));
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
    this.placed.ended(complete);
    this.state.options.onCall?.({
      type: 'call_ended',
      traceId: this.placed.traceId,
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
  const headers = forwardedHeaders(request, raw, target.host);

  let capture: Capture | undefined;
  const text = await readBody(raw, request.headers['content-encoding']);
  const exchange = requestAttributes(method, target, headers, text);
  const token = isTokenRequest(request.headers['content-type'], text);
  const pool = state.pool;
  // Armed, the pool answers every call: a token request, which is never recorded, goes live only in the live mode.
  const answer: PoolAnswer | undefined =
    pool === undefined
      ? undefined
      : token
        ? pool.mode === 'model_live'
          ? {type: 'live'}
          : {type: 'miss'}
        : pool.model(exchangeKey(exchange));
  const standIn =
    state.options.standInOrigin !== undefined && target.origin === state.options.standInOrigin;
  const reader = token
    ? undefined
    : readerFor(method, target.host, target.pathname, target.searchParams, standIn);
  if (token) {
    if (answer?.type !== 'miss') {
      state.options.log?.(
        `A token request, ${method} ${target.origin}${target.pathname}, was passed on unrecorded.`,
      );
    }
  } else {
    const placed = state.options.place({
      what: `a model call to ${target.host}, ${method} ${target.pathname}`,
      startTimeUnixNano: start.toString(),
      traceparent: request.headers.traceparent,
    });
    if (placed !== undefined) {
      const bodyJsonValue = text === undefined ? undefined : bodyJson(text);
      capture = new Capture(state, placed, reader, start, {
        ...withContentFitted(
          reader?.request({
            pathname: target.pathname,
            search: target.searchParams,
            body: bodyJsonValue,
          }) ?? {},
        ),
        ...exchange,
        ...(answer?.type === 'served' && {'a2ui.replay.served_from': answer.event.spanId}),
      });
    }
  }

  if (answer?.type === 'miss') {
    const line = missLine('model proxy', method, target);
    state.options.log?.(line);
    answer502(response, line);
    capture?.end({failure: {type: 'replay_miss', message: line}});
    return;
  }

  let served: ServedReply | undefined;
  if (answer?.type === 'served') {
    const recorded = recordedAnswer(answer.event, {
      broke: brokeOff(answer.event, statedError(answer.event, reader)),
    });
    if (recorded.type === 'unreached') {
      answer502(response, unreachedLine('model proxy', target.host, recorded.failure));
      capture?.end({failure: recorded.failure});
      return;
    }
    if (recorded.type === 'redirect') {
      const line = redirectLine('model proxy', method, target, recorded.status, recorded.location);
      state.options.log?.(line);
      answer502(response, line);
      capture?.end({failure: {type: 'replay_miss', message: line}});
      return;
    }
    served = recorded.reply;
  }
  forwardExchange(
    {request, raw, target, response, headers},
    forwarderOf(state),
    capture === undefined ? {end: () => {}, fail: () => {}} : capturing(capture),
    served,
  );
}

/**
 * The error a reader finds in a recorded stream's chunks: what the response
 * states, so a call that failed with it did not break off.
 */
function statedError(event: CallEvent, reader: ApiReader | undefined): string | undefined {
  if (reader === undefined || !wasStreamed(event.attributes)) return undefined;
  const chunks = (event.events ?? [])
    .filter(chunk => chunk.name === 'a2ui.http.response.chunk')
    .map(streamChunkOf);
  return reader.stream(chunks).error?.type;
}

/** A recorded chunk as a reader reads it: its server-sent event's name, if one, and its body. */
function streamChunkOf(spanEvent: SpanEvent): StreamChunk {
  const name = spanEvent.attributes?.['a2ui.http.response.chunk.event'];
  return {
    ...(typeof name === 'string' && {event: name}),
    data: spanEvent.attributes?.['a2ui.http.response.chunk.body'],
  };
}

/** The relay that records a model call's exchange on its capture: its chunks as they come, its response at the end. */
function capturing(capture: Capture): Relay {
  let status = 0;
  let headers: IncomingHttpHeaders = {};
  let streamed = false;
  /** Whether the reply's content encoding can be read; one that cannot is recorded unread. */
  let decodable = false;
  return {
    head(replyStatus, replyHeaders, replyStreamed) {
      status = replyStatus;
      headers = replyHeaders;
      streamed = replyStreamed;
    },
    decoding(flush) {
      decodable = true;
      // The agent's close counts once the decoder has given out what arrived before it.
      capture.settleWith(flush);
    },
    event(event) {
      capture.chunk(event);
    },
    end(_at, body) {
      capture.end({
        response: {
          status,
          headers,
          streamed: decodable && streamed,
          ...(decodable && {body: body ?? ''}),
        },
      });
    },
    fail(failure, _at, reached) {
      capture.end({...(reached && {response: {status, headers, streamed}}), failure});
    },
    agentClosed(drop) {
      capture.agentClosed(drop);
    },
  };
}

/** What forwarding takes from the model proxy. */
function forwarderOf(state: ProxyState): Forwarder {
  return (state.forwarder ??= {
    inFlight: state.inFlight,
    closing: () => state.closing,
    now: state.now,
    proxy: 'model proxy',
    brokeOff: "The provider's response broke before it ended.",
    flushes: 'served stream',
  });
}

/** Passes a WebSocket upgrade on to the target as a tunnel, unrecorded; armed, only in the live mode. */
function upgrade(state: ProxyState, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const refusal = proxyRefusal(request.headers, state.options.allowedHosts ?? [], 'refused');
  if (refusal !== undefined) {
    refuseUpgrade(socket, refusal);
    return;
  }
  const target = targetOf(state, request.url ?? '/');
  if (target === undefined) {
    socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n');
    return;
  }
  if (state.pool !== undefined && state.pool.mode !== 'model_live') {
    const line = missLine('model proxy', request.method ?? 'GET', target);
    state.options.log?.(line);
    missUpgrade(socket, line);
    return;
  }
  state.options.log?.(
    `A WebSocket upgrade, ${target.origin}${target.pathname}, was passed on unrecorded.`,
  );
  tunnelUpgrade(request, socket, head, target, state.sockets);
}
