/**
 * The tool proxy: one listener on loopback per configured tool server, each
 * standing for the original's origin, so a request to the listener's
 * `/<path>` is forwarded to the original's origin followed by the same path
 * and query. Each request is read for what it is, by its content: an MCP
 * message, a carrier stream whose messages attach to the events they answer,
 * MCP's session end, or an HTTP tool request recorded raw. Streams pass on
 * event by event as they arrive. Credentials are removed from what is
 * recorded, never from what is forwarded. Armed with a replay's pool, it is
 * the server: each request is answered from the record, or as the protocol
 * fixes, on the path a forwarded reply takes, and nothing is forwarded.
 */
import {randomBytes} from 'node:crypto';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {Duplex} from 'node:stream';

import {type SseEvent, SseParser} from '../a2a/sse.js';
import {removeFromUrl} from '../model_proxy/credentials.js';
import {
  chunkEvent,
  endToEndHeaders,
  requestAttributes,
  responseAttributes,
} from '../model_proxy/exchange.js';
import {
  bodyJson,
  decoderFor,
  isTokenRequest,
  nowUnixNano,
  readBody,
  tunnelUpgrade,
} from '../model_proxy/forwarding.js';
import type {CallListener} from '../model_proxy/proxy.js';
import type {CallToPlace, PlacedCall, Unplaced} from '../placement.js';
import type {CallEvent, SpanEvent, ToolCallEvent} from '../record/turn_record.js';
import {exchangeKey, type ReplayPool} from '../replay/pool.js';
import {
  answer502,
  brokeOff,
  missLine,
  recordedAnswer,
  recordedEvents,
  type ReplyMessage,
  type ServedReply,
  ServedUpstream,
  sseText,
  unreachedLine,
  type Upstream,
  wasStreamed,
} from '../replay/served.js';
import {LOOPBACK_ADDRESS, PortTakenError} from '../server.js';
import {NAME} from '../version.js';
import {
  asJsonRpc,
  cancelledRequestId,
  eventName,
  idKey,
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcMessage,
  messageAttributes,
  negotiatedVersion,
  progressTokenOf,
  readReply,
  reportedProgressToken,
  traceparentOf,
} from './mcp.js';
import type {ToolServer} from './servers.js';

export interface ToolProxyOptions {
  /** The tool servers, each with its own port. */
  servers: ToolServer[];
  /**
   * Places a call in its turn, or returns the line saying why it cannot be;
   * the proxy logs the line once the request has turned out to be a call.
   */
  place: (call: CallToPlace) => PlacedCall | Unplaced;
  onCall?: CallListener;
  /** Takes the proxy's one-line notes, such as a call that was not placed. */
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

export interface ToolProxy {
  /** Each listener's origin, in the servers' order. */
  readonly origins: string[];
  /** Serves from the pool until disarmed, as the server: every request answered from the record, or as the protocol fixes, or a miss. */
  arm(pool: ReplayPool): void;
  /** Drops the pool and closes the carriers held open: every request is forwarded again. */
  disarm(): void;
  close(): Promise<void>;
}

const DEFAULT_CLOSE_GRACE_MS = 5000;
const AGENT_CLOSED = 'The agent closed the connection before the response ended.';
const STOPPED = 'Spectra stopped before the response ended.';
const CARRIER_CLOSED = 'The stream its reply was to come on closed.';

interface Failure {
  type: string;
  message?: string;
}

interface Shared {
  options: ToolProxyOptions;
  now: () => bigint;
  newSpanId: () => string;
  closeGraceMs: number;
  /** Set when Spectra stops: a call cut off then ends as aborted. */
  closing: boolean;
  /** The replay's pool while armed. */
  pool: ReplayPool | undefined;
  /** The carriers the armed proxy holds open itself, closed when it is disarmed. */
  held: Set<ServerResponse>;
  inFlight: Set<Upstream>;
  sockets: Set<Duplex>;
  /** The calls not yet ended. */
  open: Set<ToolCapture>;
  /** Requests placed before they showed what they are, a `GET` until its reply says. */
  tentative: Set<PlacedCall>;
}

/** A request the client sent, waiting for its reply. */
interface Pending {
  method: string;
  /** Its event; none when it was not placed, whose reply is still matched so it is not taken for another. */
  capture: ToolCapture | undefined;
  progressToken?: string;
  /** When its reply arrived on a carrier, once it has. */
  repliedAt?: bigint;
  /** When its POST's exchange ended with the reply still to come on a carrier. */
  exchangeEndedAt?: bigint;
}

/** An MCP session as the proxy follows it, from everything it forwards whether or not it records it. */
interface Session {
  /** `sid:<Mcp-Session-Id>` under streamable HTTP, `endpoint:<path and query>` under HTTP+SSE, or `` for messages with neither. */
  key: string;
  /** `mcp.session.id`: the `Mcp-Session-Id`, or the HTTP+SSE endpoint's `session_id` or `sessionId`. */
  id?: string;
  /** The version the session's `initialize` result negotiated. */
  protocolVersion?: string;
  /** The client's requests waiting for their replies, by id. */
  pending: Map<string, Pending>;
  /** The server's requests on a carrier waiting for the client's response, by id; null when not placed. */
  serverRequests: Map<string, ToolCapture | null>;
  /** The carriers open on the session. */
  carriers: number;
  /** HTTP+SSE: the carrier's opening and its `endpoint` event, where the session's `initialize` starts. */
  opening?: {at: bigint; endpoint: {event: SseEvent; at: bigint}; posted: boolean};
  /** HTTP+SSE: the session's `GET` stream URL on the original server, credentials removed, `a2ui.mcp.stream.url`. */
  streamUrl?: string;
  /** Armed, under HTTP+SSE: the carrier the proxy holds open, where a served reply is written. */
  outlet?: ServerResponse;
}

/** One listener, for one tool server. */
interface Listener {
  shared: Shared;
  server: ToolServer;
  /** The original's origin, where every request is forwarded. */
  origin: string;
  sessions: Map<string, Session>;
  /** The session of messages that name none. */
  loose: Session;
  /** Whether the terminal was told the server announces an absolute endpoint. */
  absoluteTold: boolean;
}

/** Starts one listener per tool server. A port that is taken is an error, and the ones started close. */
export async function startToolProxy(options: ToolProxyOptions): Promise<ToolProxy> {
  const shared: Shared = {
    options,
    now: options.now ?? nowUnixNano,
    newSpanId: options.newSpanId ?? (() => randomBytes(8).toString('hex')),
    closeGraceMs: options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
    closing: false,
    pool: undefined,
    held: new Set(),
    inFlight: new Set(),
    sockets: new Set(),
    open: new Set(),
    tentative: new Set(),
  };
  const servers: Server[] = [];
  const close = async () => {
    shared.closing = true;
    for (const upstream of shared.inFlight) {
      upstream.destroy(new Error(STOPPED));
    }
    for (const socket of shared.sockets) {
      socket.destroy();
    }
    for (const carrier of shared.held) {
      carrier.destroy();
    }
    const at = shared.now();
    for (const capture of [...shared.open]) {
      capture.end(at, {type: 'aborted', message: STOPPED});
    }
    for (const placed of shared.tentative) {
      placed.release();
    }
    shared.tentative.clear();
    await Promise.all(
      servers.map(
        server =>
          new Promise<void>(done => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      ),
    );
  };
  try {
    for (const server of options.servers) {
      servers.push(await listen(shared, server));
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    origins: options.servers.map(server => server.proxyOrigin),
    arm: pool => {
      shared.pool = pool;
    },
    disarm: () => {
      shared.pool = undefined;
      for (const carrier of [...shared.held]) {
        carrier.end();
      }
    },
    close,
  };
}

function listen(shared: Shared, server: ToolServer): Promise<Server> {
  const loose: Session = {key: '', pending: new Map(), serverRequests: new Map(), carriers: 0};
  const listener: Listener = {
    shared,
    server,
    origin: server.original.origin,
    sessions: new Map(),
    loose,
    absoluteTold: false,
  };
  const http = createServer((request, response) => handle(listener, request, response));
  http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = targetOf(listener, request);
    if (shared.pool !== undefined) {
      const line = missLine('tool proxy', request.method ?? 'GET', target);
      shared.options.log?.(line);
      socket.end(
        `HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n${line}\n`,
      );
      return;
    }
    shared.options.log?.(
      `A WebSocket upgrade, ${removeFromUrl(target.origin + target.pathname)}, was passed on unrecorded.`,
    );
    tunnelUpgrade(request, socket, head, target, shared.sockets);
  });
  return new Promise((resolve, reject) => {
    http.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortTakenError(server.port) : error);
    });
    http.listen(server.port, LOOPBACK_ADDRESS, () => resolve(http));
  });
}

/** Where a request goes: the original's origin followed by the request's path and query. */
function targetOf(listener: Listener, request: IncomingMessage): URL {
  const path = request.url?.startsWith('/') ? request.url : '/';
  return new URL(`${listener.origin}${path}`);
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function handle(listener: Listener, request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.once('error', () => response.destroy());
  request.once('end', () => {
    void route(listener, request, Buffer.concat(chunks), response);
  });
}

/** Reads the request for what it is, then forwards it. */
async function route(
  listener: Listener,
  request: IncomingMessage,
  raw: Buffer,
  response: ServerResponse,
): Promise<void> {
  const {shared} = listener;
  const start = shared.now();
  const target = targetOf(listener, request);
  const method = request.method ?? 'GET';
  const text = await readBody(raw, request.headers['content-encoding']);
  const call: Call = {
    listener,
    request,
    raw,
    text,
    target,
    response,
    start,
    headers: forwardedHeaders(request, raw, target),
  };
  const pool = shared.pool;
  if (isTokenRequest(request.headers['content-type'], text)) {
    if (pool !== undefined) {
      // A token request is never recorded, so the record cannot answer it.
      const line = missLine('tool proxy', method, target);
      shared.options.log?.(line);
      answer502(response, line);
      return;
    }
    shared.options.log?.(
      `A token request, ${method} ${removeFromUrl(target.origin + target.pathname)}, was passed on unrecorded.`,
    );
    forward(call, {end: () => {}, fail: () => {}});
    return;
  }
  const message = text === undefined ? undefined : asJsonRpc(bodyJson(text));
  if (message !== undefined) {
    mcpMessage(call, message);
  } else if (method === 'DELETE' && header(request.headers, 'mcp-session-id') !== undefined) {
    sessionEnd(call);
  } else if (method === 'GET') {
    if (pool === undefined) getRequest(call);
    else armedGet(call, pool);
  } else {
    httpTool(
      call,
      logged(
        listener,
        placeOf(call, `a tool call to ${target.host}, ${method} ${target.pathname}`),
      ),
      pool === undefined ? undefined : {served: pool.httpTool(httpToolKey(call))},
    );
  }
}

/** One request as the proxy handles it. */
interface Call {
  listener: Listener;
  request: IncomingMessage;
  raw: Buffer;
  /** The body as text, its content encoding undone. */
  text: string | undefined;
  target: URL;
  response: ServerResponse;
  start: bigint;
  /** The headers as forwarded: end to end, with the target's `Host`. */
  headers: OutgoingHttpHeaders;
}

function forwardedHeaders(request: IncomingMessage, raw: Buffer, target: URL): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {...endToEndHeaders(request.headers), host: target.host};
  if (
    raw.length > 0 ||
    request.headers['content-length'] !== undefined ||
    request.headers['transfer-encoding'] !== undefined
  ) {
    headers['content-length'] = raw.length;
  }
  return headers;
}

function placeOf(call: Call, what: string, traceparent?: string): PlacedCall | Unplaced {
  return call.listener.shared.options.place({
    what,
    startTimeUnixNano: call.start.toString(),
    traceparent: header(call.request.headers, 'traceparent') ?? traceparent,
  });
}

/** The placed call, or nothing with the line saying why logged. */
function logged(listener: Listener, result: PlacedCall | Unplaced): PlacedCall | undefined {
  if ('line' in result) {
    listener.shared.options.log?.(result.line);
    return undefined;
  }
  return result;
}

/** What a tool call records, from its start to its end. */
class ToolCapture {
  readonly event: ToolCallEvent;
  readonly spanEvents: SpanEvent[] = [];
  readonly #shared: Shared;
  readonly #placed: PlacedCall;
  /** The MCP method of the request it is, for reading its reply. */
  readonly #method: string | undefined;
  #ended = false;
  /** Attributes learned after the start, such as the session a server assigned. */
  #late: Record<string, unknown> = {};
  #exchange: Record<string, unknown> | undefined;
  #status: number | undefined;
  #reply: JsonRpcMessage | undefined;
  #closedAt: bigint | undefined;
  #chunksAtClose = 0;
  #graceTimer: NodeJS.Timeout | undefined;

  constructor(
    shared: Shared,
    placed: PlacedCall,
    init: {
      start: bigint;
      kind: 3 | 4;
      name: string;
      attributes: Record<string, unknown>;
      method?: string;
    },
  ) {
    this.#shared = shared;
    this.#placed = placed;
    this.#method = init.method;
    this.event = {
      traceId: placed.traceId,
      spanId: shared.newSpanId(),
      parentSpanId: placed.parentSpanId,
      name: init.name,
      kind: init.kind,
      startTimeUnixNano: init.start.toString(),
      attributes: {'a2ui.event.kind': 'tool_call', ...init.attributes},
    };
    shared.open.add(this);
    shared.options.onCall?.({type: 'call_started', traceId: placed.traceId, event: this.event});
  }

  get ended(): boolean {
    return this.#ended;
  }

  chunk(event: SseEvent, at: bigint): void {
    if (this.#ended) return;
    const spanEvent = chunkEvent(at.toString(), event);
    this.spanEvents.push(spanEvent);
    this.#shared.options.onCall?.({
      type: 'call_chunk',
      traceId: this.#placed.traceId,
      spanId: this.event.spanId,
      chunk: spanEvent,
    });
  }

  set(attributes: Record<string, unknown>): void {
    Object.assign(this.#late, attributes);
  }

  /** The JSON-RPC response to the request it is. */
  reply(message: JsonRpcMessage): void {
    this.#reply ??= message;
  }

  /** The exchange's response: its status, its headers and, when it was not streamed, its body. */
  exchange(status: number, headers: IncomingHttpHeaders, body?: string): void {
    this.#status = status;
    this.#exchange = responseAttributes(status, headers, body);
  }

  /**
   * Notes that the agent closed its connection before the response ended.
   * The reply is read on for the grace: one that ends by then is complete;
   * one that has not ends the call as aborted at the close, with the chunks
   * before it, and `drop` drops the reply.
   */
  agentClosed(drop: () => void): void {
    if (this.#ended || this.#closedAt !== undefined) return;
    const at = this.#shared.now();
    this.#closedAt = at;
    this.#chunksAtClose = this.spanEvents.length;
    this.#graceTimer = setTimeout(() => {
      this.spanEvents.length = this.#chunksAtClose;
      this.#closedAt = undefined;
      this.end(at, {type: 'aborted', message: AGENT_CLOSED});
      drop();
    }, this.#shared.closeGraceMs);
  }

  /**
   * Ends the call at `at`: an HTTP status of 400 or above, a failure of the
   * exchange or a JSON-RPC error is a failed call; a tool's own error keeps
   * the status. Later calls do nothing.
   */
  end(at: bigint, failure?: Failure): void {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#graceTimer);
    this.#shared.open.delete(this);
    const attributes: Record<string, unknown> = {
      ...this.event.attributes,
      ...this.#late,
      ...this.#exchange,
    };
    let failed = failure;
    if (failed === undefined && this.#status !== undefined && this.#status >= 400) {
      failed = {type: String(this.#status)};
    }
    if (this.#reply !== undefined) {
      const reading = readReply(this.#method, this.#reply);
      Object.assign(attributes, reading.attributes);
      if (reading.error !== undefined) {
        failed =
          failed === undefined
            ? reading.error
            : {...failed, message: failed.message ?? reading.error.message};
      }
    }
    if (failed !== undefined) {
      attributes['error.type'] = failed.type;
    }
    const complete: ToolCallEvent = {
      ...this.event,
      endTimeUnixNano: at.toString(),
      attributes: attributes as ToolCallEvent['attributes'],
      ...(this.spanEvents.length > 0 && {events: this.spanEvents}),
      status:
        failed === undefined
          ? {code: 1}
          : {code: 2, ...(failed.message !== undefined && {message: failed.message})},
    };
    this.#placed.ended(complete);
    this.#shared.options.onCall?.({
      type: 'call_ended',
      traceId: this.#placed.traceId,
      event: complete,
    });
  }
}

/** What a forwarded request's reply hands out as it arrives. */
interface Relay {
  /** The reply's status and headers, and whether it is a stream of server-sent events. */
  head?(status: number, headers: IncomingHttpHeaders, streamed: boolean): void;
  /** One server-sent event of a streamed reply, at its arrival. */
  event?(event: SseEvent, at: bigint): void;
  /** The reply ended complete, with its body when it was not streamed and could be read. */
  end(at: bigint, body: string | undefined): void;
  /** The reply broke before it ended, `reached` true, or the server could not be reached. */
  fail(failure: Failure, at: bigint, reached: boolean): void;
  /** The agent closed its side before the reply ended; `drop` drops the reply. Without it, the reply is dropped at once. */
  agentClosed?(drop: () => void): void;
}

/**
 * Forwards the request as received, passes the reply back as received, and
 * hands a copy to the relay. With `served`, the served reply stands where the
 * forwarded one would, and nothing is forwarded.
 */
function forward(call: Call, relay: Relay, served?: ServedReply): void {
  const {listener, request, raw, target, response} = call;
  const {shared} = listener;
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream: Upstream =
    served === undefined
      ? send(target, {method: request.method ?? 'GET', headers: call.headers})
      : new ServedUpstream(served);
  shared.inFlight.add(upstream);
  upstream.once('close', () => shared.inFlight.delete(upstream));

  let settled = false;
  /** Set when the proxy itself ends the agent's side, as when the reply broke. */
  let ourClose = false;
  const settle = (done: () => void) => {
    if (settled) return;
    settled = true;
    done();
  };
  const stopped = (): Failure => ({type: 'aborted', message: STOPPED});

  response.once('close', () => {
    if (response.writableFinished || ourClose || settled) return;
    const drop = () => upstream.destroy(new Error(AGENT_CLOSED));
    if (relay.agentClosed !== undefined) relay.agentClosed(drop);
    else drop();
  });

  upstream.once('response', (reply: ReplyMessage) => {
    const status = reply.statusCode ?? 502;
    const streamed = /^text\/event-stream\b/i.test(String(reply.headers['content-type'] ?? ''));
    if (!response.destroyed) {
      response.writeHead(status, reply.statusMessage, endToEndHeaders(reply.headers));
      if (streamed) response.flushHeaders();
      reply.pipe(response);
      reply.once('close', () => {
        if (!reply.complete) {
          ourClose = true;
          response.destroy();
        }
      });
      // The pipe's end pauses the reply; the relay reads it on.
      response.once('close', () => {
        if (!reply.complete) reply.resume();
      });
    } else {
      reply.resume();
    }
    relay.head?.(status, reply.headers, streamed);
    const broke = (error?: Error) =>
      settle(() =>
        relay.fail(
          shared.closing
            ? stopped()
            : {
                type: (error as NodeJS.ErrnoException | undefined)?.code ?? 'ECONNRESET',
                message: error?.message ?? "The tool server's response broke before it ended.",
              },
          shared.now(),
          true,
        ),
      );
    const decoder = decoderFor(reply.headers['content-encoding']);
    if (decoder === undefined) {
      reply.once('end', () => settle(() => relay.end(shared.now(), undefined)));
      reply.once('error', error => broke(error));
      reply.once('aborted', () => broke());
      return;
    }
    const text = new TextDecoder();
    const sse = new SseParser();
    let body = '';
    reply.on('data', (chunk: Buffer) => decoder.write(chunk));
    reply.once('end', () => decoder.end());
    reply.once('error', error => {
      broke(error);
      decoder.destroy();
    });
    reply.once('aborted', () => {
      broke();
      decoder.destroy();
    });
    decoder.on('data', (chunk: Buffer) => {
      if (settled) return;
      const decoded = text.decode(chunk, {stream: true});
      if (streamed) {
        for (const event of sse.push(decoded)) {
          if (!settled) relay.event?.(event, shared.now());
        }
      } else {
        body += decoded;
      }
    });
    decoder.once('end', () => {
      if (!reply.complete) {
        broke();
        return;
      }
      if (!streamed) body += text.decode();
      settle(() => relay.end(shared.now(), streamed ? undefined : body));
    });
    decoder.once('error', error => broke(error));
  });

  upstream.once('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    if (response.destroyed) {
      // The agent is gone; nothing to answer.
    } else if (!response.headersSent) {
      response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      response.end(`${NAME}'s tool proxy could not reach ${target.host}: ${error.message}\n`);
      settle(() =>
        relay.fail(
          shared.closing ? stopped() : {type: code ?? 'error', message: error.message},
          shared.now(),
          false,
        ),
      );
      return;
    } else {
      ourClose = true;
      response.destroy(error);
    }
    settle(() =>
      relay.fail(
        shared.closing ? stopped() : {type: code ?? 'ECONNRESET', message: error.message},
        shared.now(),
        response.headersSent,
      ),
    );
  });

  upstream.end(raw);
}

/** The relay that records the exchange on a capture: chunks as they come, the response at the end. */
function recording(capture: ToolCapture | undefined): Relay {
  let status = 0;
  let headers: IncomingHttpHeaders = {};
  return {
    head(replyStatus, replyHeaders) {
      status = replyStatus;
      headers = replyHeaders;
    },
    event(event, at) {
      capture?.chunk(event, at);
    },
    end(at, body) {
      capture?.exchange(status, headers, body);
      capture?.end(at);
    },
    fail(failure, at, reached) {
      if (reached) capture?.exchange(status, headers);
      capture?.end(at, failure);
    },
    agentClosed(drop) {
      if (capture === undefined) drop();
      else capture.agentClosed(drop);
    },
  };
}

/** An HTTP tool request's key: its exchange's method, URL and body. */
function httpToolKey(call: Call) {
  return exchangeKey(
    requestAttributes(call.request.method ?? 'GET', call.target, call.headers, call.text),
  );
}

/**
 * An HTTP tool request, recorded raw: the exchange only, named by its method
 * and its path without the query. Armed, it is served the event the pool
 * matched, or missed when none.
 */
function httpTool(
  call: Call,
  placed: PlacedCall | undefined,
  armed?: {served: CallEvent | undefined},
): void {
  const method = call.request.method ?? 'GET';
  const served = armed?.served;
  const capture =
    placed === undefined
      ? undefined
      : new ToolCapture(call.listener.shared, placed, {
          start: call.start,
          kind: 3,
          name: `${method} ${call.target.pathname}`,
          attributes: {
            ...requestAttributes(method, call.target, call.headers, call.text),
            ...servedFrom(served),
          },
        });
  const relay = recording(capture);
  if (armed === undefined) forward(call, relay);
  else serve(call, relay, served);
}

/** The attribute naming the recorded event a call was served from. */
function servedFrom(event: CallEvent | undefined): Record<string, unknown> {
  return event === undefined ? {} : {'a2ui.replay.served_from': event.spanId};
}

/** Answers a request the record matched nothing for: the 502 line, the terminal's line, and the call failed with `replay_miss`. */
function miss(call: Call, relay: Relay): void {
  const {shared} = call.listener;
  const line = missLine('tool proxy', call.request.method ?? 'GET', call.target);
  shared.options.log?.(line);
  answer502(call.response, line);
  relay.fail({type: 'replay_miss', message: line}, shared.now(), false);
}

/**
 * Serves a recorded event, or misses when there is none: a call with no
 * response recorded is the 502 line with the recorded failure; any other is
 * its reply as recorded, its body and chunks passed through `rewrite`, the
 * chunks of a reply that came on a carrier written on the session's carrier
 * once the POST is answered.
 */
function serve(
  call: Call,
  relay: Relay,
  event: CallEvent | undefined,
  rewrite?: (body: unknown) => unknown,
  session?: () => Session,
): void {
  if (event === undefined) {
    miss(call, relay);
    return;
  }
  const {shared} = call.listener;
  const recorded = recordedAnswer(event, {broke: brokeOff(event), rewrite});
  if (recorded.type === 'unreached') {
    answer502(call.response, unreachedLine('tool proxy', call.target.host, recorded.failure));
    relay.fail(recorded.failure, shared.now(), false);
    return;
  }
  const carried =
    session === undefined || wasStreamed(event.attributes)
      ? []
      : recordedEvents(event, rewrite).filter(chunk => chunk.event !== 'endpoint');
  forward(call, onCarrier(call.listener, relay, carried, session), recorded.reply);
}

/** The relay that, once the POST's exchange ended, writes `events` on the session's carrier and reads them there as a forwarded carrier's are. */
function onCarrier(
  listener: Listener,
  relay: Relay,
  events: SseEvent[],
  session: (() => Session) | undefined,
): Relay {
  if (events.length === 0 || session === undefined) return relay;
  return {
    ...relay,
    end(at, body) {
      relay.end(at, body);
      const carrier = session();
      const outlet = carrier.outlet;
      // With no carrier open, nothing is written; the call ended as its carrier closed.
      if (outlet === undefined || outlet.destroyed || outlet.writableEnded) return;
      for (const event of events) {
        outlet.write(sseText(event));
        carrierMessage(listener, carrier, event, listener.shared.now());
      }
    },
  };
}

/** `202 Accepted` with no body: the protocol's answer to a notification and to a response the client posts. */
const ACCEPTED: ServedReply = {status: 202, headers: {'content-length': '0'}};

/** `204 No Content`: a session end the record has none of. */
const NO_CONTENT: ServedReply = {status: 204, headers: {}};

function sessionById(listener: Listener, id: string): Session {
  const key = `sid:${id}`;
  let session = listener.sessions.get(key);
  if (session === undefined) {
    session = {key, id, pending: new Map(), serverRequests: new Map(), carriers: 0};
    listener.sessions.set(key, session);
  }
  return session;
}

/** A request's session: by its `Mcp-Session-Id`, else by the HTTP+SSE endpoint it posts to. */
function sessionOf(listener: Listener, request: IncomingMessage, target: URL): Session {
  const id = header(request.headers, 'mcp-session-id');
  if (id !== undefined) return sessionById(listener, id);
  return listener.sessions.get(`endpoint:${target.pathname}${target.search}`) ?? listener.loose;
}

/** The session's attributes on an event: its id, its protocol version, else the request's header, and under HTTP+SSE its `GET` stream's URL. */
function sessionAttributes(session: Session, request?: IncomingMessage): Record<string, unknown> {
  const version =
    session.protocolVersion ??
    (request === undefined ? undefined : header(request.headers, 'mcp-protocol-version'));
  return {
    ...(session.id !== undefined && {'mcp.session.id': session.id}),
    ...(version !== undefined && {'mcp.protocol.version': version}),
    ...(session.streamUrl !== undefined && {'a2ui.mcp.stream.url': session.streamUrl}),
  };
}

function serverAttributes(listener: Listener): Record<string, unknown> {
  const original = listener.server.original;
  return {
    'server.address': original.hostname,
    'server.port': Number(original.port || (original.protocol === 'https:' ? 443 : 80)),
  };
}

/** A JSON-RPC message the client posted: a request, a notification, or its response to a server request. */
function mcpMessage(call: Call, message: JsonRpcMessage): void {
  const {listener, request, target} = call;
  const {shared} = listener;
  const method = request.method ?? 'POST';
  let session = sessionOf(listener, request, target);
  if (session.opening !== undefined) session.opening.posted = true;
  const exchangeRequest = requestAttributes(method, target, call.headers, call.text);
  const pool = shared.pool;
  // Armed, a response the client posts gets the protocol's 202.
  const accepted = pool === undefined ? undefined : ACCEPTED;

  if (isResponse(message)) {
    const id = idKey(message.id) ?? '';
    const asked = session.serverRequests.get(id);
    if (asked !== undefined) {
      // The response to a server request: the request's event ends at its arrival, with this exchange.
      session.serverRequests.delete(id);
      if (asked === null) {
        forward(call, {end: () => {}, fail: () => {}}, accepted);
        return;
      }
      asked.set(exchangeRequest);
      const relay = recording(asked);
      forward(
        call,
        {
          ...relay,
          event: undefined,
          end: (_at, body) => relay.end(call.start, body),
          fail: (failure, _at, reached) => relay.fail(failure, call.start, reached),
          agentClosed: drop => drop(),
        },
        accepted,
      );
      return;
    }
    // A response to a server request that is no event of its own, such as one inside a POST's own reply.
    const attributes = {
      'jsonrpc.request.id': id,
      ...sessionAttributes(session, request),
      ...exchangeRequest,
    };
    const placed = logged(
      listener,
      placeOf(call, `an MCP response to ${target.host}, for request ${id}`, traceparentOf(message)),
    );
    const capture =
      placed === undefined
        ? undefined
        : new ToolCapture(shared, placed, {
            start: call.start,
            kind: 3,
            name: 'response',
            attributes,
          });
    forward(call, recording(capture), accepted);
    return;
  }

  if (isNotification(message) && message.method === 'notifications/cancelled') {
    const id = cancelledRequestId(message);
    const cancelled = id === undefined ? undefined : session.pending.get(id);
    if (id !== undefined && cancelled !== undefined) {
      session.pending.delete(id);
      const reason = (message.params as {reason?: unknown} | undefined)?.reason;
      cancelled.capture?.end(call.start, {
        type: 'cancelled',
        ...(typeof reason === 'string' && {message: reason}),
      });
    }
  }

  const asking = isRequest(message);
  const id = idKey(message.id);
  const mcpMethod = typeof message.method === 'string' ? message.method : undefined;
  const attributes = {
    ...messageAttributes(message),
    ...sessionAttributes(session, request),
    ...exchangeRequest,
  };
  const name = mcpMethod === undefined ? method : eventName(attributes);
  // Under HTTP+SSE, the session's initialize starts when its carrier opened, its endpoint event inside it.
  const opening =
    mcpMethod === 'initialize' && session.opening !== undefined ? session.opening : undefined;
  if (opening !== undefined) session.opening = undefined;
  const start = opening?.at ?? call.start;
  // Armed, a request other than ping is served the event the pool matches, if any.
  const served =
    pool !== undefined && asking && mcpMethod !== undefined && mcpMethod !== 'ping'
      ? pool.mcpRequest(mcpMethod, message.params)
      : undefined;
  const placed = logged(
    listener,
    shared.options.place({
      what: `an MCP ${asking ? 'request' : 'message'} to ${target.host}, ${name}`,
      startTimeUnixNano: start.toString(),
      traceparent: header(request.headers, 'traceparent') ?? traceparentOf(message),
    }),
  );
  const capture =
    placed === undefined
      ? undefined
      : new ToolCapture(shared, placed, {
          start,
          kind: 3,
          name,
          attributes: {...attributes, ...servedFrom(served)},
          method: mcpMethod,
        });
  if (opening !== undefined) capture?.chunk(opening.endpoint.event, opening.endpoint.at);

  let pending: Pending | undefined;
  let home = session.pending;
  if (asking && id !== undefined && mcpMethod !== undefined) {
    pending = {
      method: mcpMethod,
      capture,
      ...(progressTokenOf(message) !== undefined && {progressToken: progressTokenOf(message)}),
    };
    home.set(id, pending);
  }
  const replied = (reply: JsonRpcMessage) => {
    if (pending === undefined) return;
    pending.repliedAt ??= shared.now();
    capture?.reply(reply);
    if (mcpMethod === 'initialize') {
      const version = negotiatedVersion(reply);
      if (version !== undefined) {
        session.protocolVersion = version;
        capture?.set({'mcp.protocol.version': version});
      }
    }
  };
  const isOurs = (value: unknown): value is JsonRpcMessage => {
    const reply = asJsonRpc(value);
    return reply !== undefined && isResponse(reply) && idKey(reply.id) === id;
  };
  const finish = (at: bigint, failure?: Failure) => {
    if (id !== undefined) home.delete(id);
    capture?.end(at, failure);
  };

  let status = 0;
  let headers: IncomingHttpHeaders = {};
  let streamed = false;
  let sawEventId = false;
  const relay: Relay = {
    head(replyStatus, replyHeaders, replyStreamed) {
      status = replyStatus;
      headers = replyHeaders;
      streamed = replyStreamed;
      const assigned = header(replyHeaders, 'mcp-session-id');
      if (assigned !== undefined && session.id === undefined && session.key === '') {
        // The server assigned the session in its reply to initialize.
        const assignedSession = sessionById(listener, assigned);
        if (pending !== undefined && id !== undefined) {
          home.delete(id);
          assignedSession.pending.set(id, pending);
          home = assignedSession.pending;
        }
        session = assignedSession;
        capture?.set({'mcp.session.id': assigned});
      }
    },
    event(event, at) {
      // The POST's own reply: every message in it is a chunk on this event.
      capture?.chunk(event, at);
      if (event.id !== undefined) sawEventId = true;
      const value = bodyJson(event.data);
      if (isOurs(value)) replied(value);
    },
    end(at, body) {
      capture?.exchange(status, headers, body);
      if (body !== undefined) {
        const value = bodyJson(body);
        const reply = Array.isArray(value) ? value.find(isOurs) : isOurs(value) ? value : undefined;
        if (reply !== undefined) replied(reply);
      }
      if (pending !== undefined && pending.repliedAt === undefined && status < 400 && !streamed) {
        // The reply is to come on a carrier: HTTP+SSE's 202.
        pending.exchangeEndedAt = at;
        if (session.key.startsWith('endpoint:') && session.carriers === 0) {
          finish(at, {type: 'aborted', message: CARRIER_CLOSED});
        }
        return;
      }
      finish(at);
    },
    fail(failure, at, reached) {
      if (reached) capture?.exchange(status, headers);
      if (
        pending !== undefined &&
        pending.repliedAt === undefined &&
        reached &&
        streamed &&
        sawEventId &&
        !shared.closing
      ) {
        // A reply stream that broke after an event id: the reply may come on a resumed stream.
        pending.exchangeEndedAt = at;
        return;
      }
      finish(at, failure);
    },
    agentClosed(drop) {
      if (capture === undefined) drop();
      else capture.agentClosed(drop);
    },
  };
  if (pool === undefined) {
    forward(call, relay);
  } else if (!asking) {
    forward(call, relay, ACCEPTED);
  } else if (mcpMethod === 'ping') {
    pong(call, relay, message, () => session);
  } else {
    const recordedId = served === undefined ? undefined : recordedRequestId(served);
    const token = liveProgressToken(message);
    serve(
      call,
      relay,
      served,
      body => rewriteIds(body, recordedId, message.id, token),
      () => session,
    );
  }
}

/** A `ping`'s empty result, the protocol's answer: in the POST's reply, or under HTTP+SSE on the carrier after a 202. */
function pong(call: Call, relay: Relay, message: JsonRpcMessage, session: () => Session): void {
  const body = JSON.stringify({jsonrpc: '2.0', id: message.id, result: {}});
  if (session().key.startsWith('endpoint:')) {
    forward(
      call,
      onCarrier(call.listener, relay, [{event: 'message', data: body}], session),
      ACCEPTED,
    );
    return;
  }
  forward(call, relay, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });
}

/** The JSON-RPC id of the request a recorded event is, as the key the proxy matches on. */
function recordedRequestId(event: CallEvent): string | undefined {
  const body = event.attributes['a2ui.http.request.body'];
  const id =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? idKey((body as Record<string, unknown>).id)
      : undefined;
  return id ?? idKey(event.attributes['jsonrpc.request.id']);
}

/** The progress token a live request asks its progress under, as it sent it. */
function liveProgressToken(message: JsonRpcMessage): string | number | undefined {
  const params = message.params as {_meta?: {progressToken?: unknown}} | undefined;
  const token = params?._meta?.progressToken;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}

/**
 * A served body or chunk with the live request's own identifiers: the
 * response to the recorded request takes the live `id`, and a
 * `notifications/progress` the live progress token, when the live request
 * asked for progress. Nothing else is touched.
 */
function rewriteIds(
  value: unknown,
  recordedId: string | undefined,
  liveId: unknown,
  liveToken: string | number | undefined,
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => rewriteIds(item, recordedId, liveId, liveToken));
  }
  const message = asJsonRpc(value);
  if (message === undefined) return value;
  if (isResponse(message) && recordedId !== undefined && idKey(message.id) === recordedId) {
    return {...message, id: liveId};
  }
  if (
    liveToken !== undefined &&
    isNotification(message) &&
    message.method === 'notifications/progress' &&
    typeof message.params === 'object' &&
    message.params !== null &&
    !Array.isArray(message.params)
  ) {
    return {...message, params: {...message.params, progressToken: liveToken}};
  }
  return value;
}

/** MCP's session end: a `DELETE` carrying `Mcp-Session-Id`, named `DELETE`, with the session and the exchange. */
function sessionEnd(call: Call): void {
  const {listener, request, target} = call;
  const session = sessionById(listener, header(request.headers, 'mcp-session-id') ?? '');
  const pool = listener.shared.pool;
  // Armed, the record's session end, else 204.
  const served = pool?.sessionEnd();
  const placed = logged(listener, placeOf(call, `an MCP session end to ${target.host}, DELETE`));
  const capture =
    placed === undefined
      ? undefined
      : new ToolCapture(listener.shared, placed, {
          start: call.start,
          kind: 3,
          name: 'DELETE',
          attributes: {
            ...sessionAttributes(session, request),
            ...requestAttributes('DELETE', target, call.headers, call.text),
            ...servedFrom(served),
          },
        });
  const recorded = recording(capture);
  const relay: Relay = {
    ...recorded,
    end: (at, body) => {
      recorded.end(at, body);
      // The session is over; a carrier still open keeps its own hold on it.
      listener.sessions.delete(session.key);
    },
  };
  if (pool === undefined) forward(call, relay);
  else if (served === undefined) forward(call, relay, NO_CONTENT);
  else serve(call, relay, served);
}

/**
 * A `GET`: a carrier when it is answered with `text/event-stream` and either
 * carries `Mcp-Session-Id` or its first event is `endpoint`; an HTTP tool
 * request otherwise. It is placed at its start, before it shows which.
 */
function getRequest(call: Call): void {
  const {listener, request, target} = call;
  const {shared} = listener;
  const tentative = placeOf(call, `a tool call to ${target.host}, GET ${target.pathname}`);
  if (!('line' in tentative)) shared.tentative.add(tentative);
  let state: 'undecided' | 'tool' | 'carrier' | 'gone' = 'undecided';
  let capture: ToolCapture | undefined;
  /** The carrier's session; none for a carrier whose endpoint is absolute, which is not read. */
  let carried: Session | undefined;
  const settleTentative = () => {
    if (!('line' in tentative)) shared.tentative.delete(tentative);
  };
  const becomeTool = () => {
    state = 'tool';
    settleTentative();
    if ('line' in tentative) {
      shared.options.log?.(tentative.line);
      return;
    }
    capture = new ToolCapture(shared, tentative, {
      start: call.start,
      kind: 3,
      name: `GET ${target.pathname}`,
      attributes: requestAttributes('GET', target, call.headers, call.text),
    });
  };
  const becomeCarrier = (session: Session | undefined) => {
    state = 'carrier';
    settleTentative();
    if (!('line' in tentative)) tentative.release();
    carried = session;
    if (session !== undefined) session.carriers++;
  };
  const endpoint = (event: SseEvent, at: bigint) => {
    const data = event.data.trim();
    let absolute: URL | undefined;
    try {
      absolute = new URL(data);
    } catch {
      absolute = undefined;
    }
    if (absolute !== undefined) {
      becomeCarrier(undefined);
      if (!listener.absoluteTold) {
        listener.absoluteTold = true;
        shared.options.log?.(
          `The tool server at ${listener.origin} announces an absolute endpoint, ${removeFromUrl(data)}; ` +
            'its calls will not pass through the tool proxy.',
        );
      }
      return;
    }
    becomeCarrier(openSseSession(listener, call, event, at));
  };

  let status = 0;
  let headers: IncomingHttpHeaders = {};
  forward(call, {
    head(replyStatus, replyHeaders, streamed) {
      status = replyStatus;
      headers = replyHeaders;
      if (!streamed) {
        becomeTool();
        return;
      }
      const id = header(request.headers, 'mcp-session-id');
      if (id !== undefined) becomeCarrier(sessionById(listener, id));
    },
    event(event, at) {
      if (state === 'undecided') {
        if (event.event === 'endpoint') {
          endpoint(event, at);
          return;
        }
        becomeTool();
      }
      if (state === 'tool') capture?.chunk(event, at);
      else if (state === 'carrier' && carried !== undefined)
        carrierMessage(listener, carried, event, at);
    },
    end(at, body) {
      if (state === 'undecided') becomeTool();
      if (state === 'tool') {
        capture?.exchange(status, headers, body);
        capture?.end(at);
      } else if (state === 'carrier') {
        carrierClosed(listener, carried, at);
      }
    },
    fail(failure, at, reached) {
      if (state === 'undecided') becomeTool();
      if (state === 'tool') {
        if (reached) capture?.exchange(status, headers);
        capture?.end(at, failure);
      } else if (state === 'carrier') {
        carrierClosed(listener, carried, at);
      }
    },
    agentClosed(drop) {
      if (state === 'tool' && capture !== undefined) {
        capture.agentClosed(drop);
        return;
      }
      if (state === 'undecided') {
        // It never showed what it is.
        state = 'gone';
        settleTentative();
        if (!('line' in tentative)) tentative.release();
      }
      drop();
    },
  });
}

/**
 * Registers the HTTP+SSE session a carrier's relative `endpoint` event
 * opens, keyed by the endpoint's path and query, its `initialize` to start
 * at the carrier's opening with the event as its first chunk.
 */
function openSseSession(listener: Listener, call: Call, event: SseEvent, at: bigint): Session {
  const url = new URL(event.data.trim(), listener.server.proxyOrigin);
  const key = `endpoint:${url.pathname}${url.search}`;
  const id = url.searchParams.get('session_id') ?? url.searchParams.get('sessionId') ?? undefined;
  const session: Session = {
    key,
    ...(id !== undefined && {id}),
    pending: new Map(),
    serverRequests: new Map(),
    carriers: 0,
    opening: {at: call.start, endpoint: {event, at}, posted: false},
    streamUrl: removeFromUrl(call.target.href),
  };
  listener.sessions.set(key, session);
  return session;
}

/**
 * An armed proxy's `GET`, with no server to ask: one whose key matches a
 * recorded HTTP tool call is served as one; one carrying `Mcp-Session-Id` is
 * a streamable HTTP carrier, held open with nothing written; one at the
 * stream path of a recorded HTTP+SSE `initialize` is that session's carrier,
 * its `endpoint` event written as recorded; anything else is a miss.
 */
function armedGet(call: Call, pool: ReplayPool): void {
  const {listener, request, target} = call;
  const placeTool = () =>
    logged(listener, placeOf(call, `a tool call to ${target.host}, GET ${target.pathname}`));
  const served = pool.httpTool(httpToolKey(call));
  if (served !== undefined) {
    httpTool(call, placeTool(), {served});
    return;
  }
  const id = header(request.headers, 'mcp-session-id');
  if (id !== undefined) {
    holdCarrier(listener, call, sessionById(listener, id));
    return;
  }
  const opening = pool.sseOpening(target.pathname);
  if (opening !== undefined) {
    const [endpoint] = recordedEvents({...opening.event, events: [opening.endpoint]});
    const session = openSseSession(listener, call, endpoint, listener.shared.now());
    holdCarrier(listener, call, session, endpoint);
    return;
  }
  httpTool(call, placeTool(), {served: undefined});
}

/** Answers a `GET` as a carrier the proxy holds open, `200` `text/event-stream`, writing `first` when given, until the client closes it or the proxy is disarmed. */
function holdCarrier(listener: Listener, call: Call, session: Session, first?: SseEvent): void {
  const {shared} = listener;
  const {response} = call;
  response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
  response.flushHeaders();
  if (first !== undefined) response.write(sseText(first));
  shared.held.add(response);
  session.carriers++;
  if (first !== undefined) session.outlet = response;
  response.once('close', () => {
    shared.held.delete(response);
    if (session.outlet === response) session.outlet = undefined;
    carrierClosed(listener, session, shared.now());
  });
}

/** A message the server sent on a carrier: attached to the event it answers, else an event of its own. */
function carrierMessage(listener: Listener, session: Session, event: SseEvent, at: bigint): void {
  const message = asJsonRpc(bodyJson(event.data));
  if (message === undefined) return;
  if (isResponse(message)) {
    const id = idKey(message.id) ?? '';
    const pending = session.pending.get(id);
    if (pending !== undefined) {
      pending.capture?.chunk(event, at);
      pending.capture?.reply(message);
      pending.repliedAt ??= at;
      if (pending.method === 'initialize') {
        const version = negotiatedVersion(message);
        if (version !== undefined) {
          session.protocolVersion = version;
          pending.capture?.set({'mcp.protocol.version': version});
        }
      }
      if (pending.exchangeEndedAt !== undefined) {
        session.pending.delete(id);
        pending.capture?.end(at);
      }
      return;
    }
    serverEvent(listener, session, event, at, message, {
      what: `an MCP response from ${listener.server.original.host}, for request ${id}`,
      name: 'response',
      attributes: {'jsonrpc.request.id': id},
      ends: true,
    });
    return;
  }
  if (isNotification(message)) {
    if (message.method === 'notifications/progress') {
      const token = reportedProgressToken(message);
      const progressed = [...session.pending.values()].find(
        pending => token !== undefined && pending.progressToken === token,
      );
      if (progressed !== undefined) {
        progressed.capture?.chunk(event, at);
        return;
      }
    }
    const attributes = messageAttributes(message);
    const name = eventName(attributes);
    serverEvent(listener, session, event, at, message, {
      what: `an MCP message from ${listener.server.original.host}, ${name}`,
      name,
      attributes,
      ends: true,
    });
    return;
  }
  if (isRequest(message)) {
    const attributes = messageAttributes(message);
    const name = eventName(attributes);
    const capture = serverEvent(listener, session, event, at, message, {
      what: `an MCP request from ${listener.server.original.host}, ${name}`,
      name,
      attributes,
      ends: false,
    });
    session.serverRequests.set(idKey(message.id) ?? '', capture ?? null);
  }
}

/**
 * An event the server initiated, placed by its message's `_meta` trace
 * context, else by the time window at its arrival: a notification starts and
 * ends at its arrival; a request ends when the client's response arrives.
 */
function serverEvent(
  listener: Listener,
  session: Session,
  event: SseEvent,
  at: bigint,
  message: JsonRpcMessage,
  {
    what,
    name,
    attributes,
    ends,
  }: {what: string; name: string; attributes: Record<string, unknown>; ends: boolean},
): ToolCapture | undefined {
  const {shared} = listener;
  const placed = logged(
    listener,
    shared.options.place({
      what,
      startTimeUnixNano: at.toString(),
      traceparent: traceparentOf(message),
    }),
  );
  if (placed === undefined) return undefined;
  const capture = new ToolCapture(shared, placed, {
    start: at,
    kind: 4,
    name,
    attributes: {...attributes, ...sessionAttributes(session), ...serverAttributes(listener)},
  });
  capture.chunk(event, at);
  if (ends) {
    if (isResponse(message)) capture.reply(message);
    capture.end(at);
  }
  return capture;
}

/**
 * A carrier closed: with no other carrier open on the session, each request
 * whose reply was to come on one ends as aborted. An HTTP+SSE carrier that
 * closes before any request was posted leaves one terminal line.
 */
function carrierClosed(listener: Listener, session: Session | undefined, at: bigint): void {
  if (session === undefined) return;
  const {shared} = listener;
  session.carriers--;
  if (session.opening !== undefined && !session.opening.posted) {
    session.opening = undefined;
    listener.sessions.delete(session.key);
    shared.options.log?.(
      `The tool server at ${listener.origin} closed an HTTP+SSE stream before any request was posted on it; ` +
        'nothing is recorded.',
    );
    return;
  }
  if (session.carriers > 0) return;
  for (const [id, pending] of session.pending) {
    if (pending.exchangeEndedAt === undefined) continue;
    session.pending.delete(id);
    pending.capture?.end(
      at,
      shared.closing
        ? {type: 'aborted', message: STOPPED}
        : {type: 'aborted', message: CARRIER_CLOSED},
    );
  }
  // An HTTP+SSE session lives as long as its one stream.
  if (session.key.startsWith('endpoint:')) listener.sessions.delete(session.key);
}
