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
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {Duplex} from 'node:stream';

import type {SseEvent} from '../proxying/sse.js';
import {removeFromUrl} from '../proxying/credentials.js';
import {requestAttributes} from '../proxying/exchange.js';
import {bodyJson, isTokenRequest, readBody, tunnelUpgrade} from '../proxying/forwarding.js';
import type {CallListener} from '../proxying/calls.js';
import {
  DEFAULT_CLOSE_GRACE_MS,
  forward,
  forwardedHeaders,
  missUpgrade,
  type Relay,
  STOPPED,
} from '../proxying/relay.js';
import type {CallToPlace, PlacedCall, Unplaced} from '../placement.js';
import type {CallEvent} from '../record/turn_record.js';
import {exchangeKey, type ReplayPool, requestMessage} from '../replay/pool.js';
import {
  answer502,
  brokeOff,
  missLine,
  recordedAnswer,
  redirectLine,
  recordedEvents,
  type ServedReply,
  sseText,
  unreachedLine,
  wasStreamed,
} from '../replay/served.js';
import {nowUnixNano} from '../clock.js';
import {proxyRefusal, refuseRequest, refuseUpgrade} from '../host_check.js';
import {listenError, LOOPBACK_ADDRESS} from '../server.js';
import {asJsonRpc, idKey, isNotification, isResponse, type JsonRpcMessage} from './mcp.js';
import {captured, placementOf, recording} from './capture.js';
import {type Call, forwarderOf, header, type Listener, type Shared} from './listener.js';
import type {ToolServer} from './servers.js';
import {
  carrierClosed,
  carrierMessage,
  endpointUrl,
  getRequest,
  mcpMessage,
  openSseSession,
  type Session,
  sessionById,
  sessionEnd,
} from './sessions.js';

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

export interface ToolProxy {
  /** Serves from the pool until disarmed, as the server: every request answered from the record, or as the protocol fixes, or a miss. */
  arm(pool: ReplayPool): void;
  /** Drops the pool and closes the carriers held open: every request is forwarded again. */
  disarm(): void;
  close(): Promise<void>;
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
  const loose: Session = {
    key: '',
    transport: 'none',
    pending: new Map(),
    serverRequests: new Map(),
    carriers: 0,
  };
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
    const refusal = proxyRefusal(request.headers, shared.options.allowedHosts ?? [], 'refused');
    if (refusal !== undefined) {
      refuseUpgrade(socket, refusal);
      return;
    }
    const target = targetOf(listener, request);
    if (shared.pool !== undefined) {
      const line = missLine('tool proxy', request.method ?? 'GET', target);
      shared.options.log?.(line);
      missUpgrade(socket, line);
      return;
    }
    shared.options.log?.(
      `A WebSocket upgrade, ${removeFromUrl(target.origin + target.pathname)}, was passed on unrecorded.`,
    );
    tunnelUpgrade(request, socket, head, target, shared.sockets);
  });
  return new Promise((resolve, reject) => {
    http.once('error', (error: NodeJS.ErrnoException) => {
      reject(listenError(error, server.port));
    });
    http.listen(server.port, LOOPBACK_ADDRESS, () => resolve(http));
  });
}

/** Where a request goes: the original's origin followed by the request's path and query. */
function targetOf(listener: Listener, request: IncomingMessage): URL {
  const path = request.url?.startsWith('/') ? request.url : '/';
  return new URL(`${listener.origin}${path}`);
}

function handle(listener: Listener, request: IncomingMessage, response: ServerResponse): void {
  const refusal = proxyRefusal(
    request.headers,
    listener.shared.options.allowedHosts ?? [],
    'refused',
  );
  if (refusal !== undefined) {
    refuseRequest(request, response, refusal);
    return;
  }
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
    headers: forwardedHeaders(request, raw, target.host),
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
    forward(call, forwarderOf(call.listener.shared), {end: () => {}, fail: () => {}});
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
    httpTool(call, pool === undefined ? undefined : {served: pool.httpTool(httpToolKey(call))});
  }
}

/** An HTTP tool request's key: its exchange's method, URL and body. */
export function httpToolKey(call: Call) {
  return exchangeKey(
    requestAttributes(call.request.method ?? 'GET', call.target, call.headers, call.text),
  );
}

/**
 * An HTTP tool request, recorded raw: the exchange only, named by its method
 * and its path without the query. Armed, it is served the event the pool
 * matched, or missed when none.
 */
export function httpTool(call: Call, armed?: {served: CallEvent | undefined}): void {
  const method = call.request.method ?? 'GET';
  const served = armed?.served;
  const capture = captured(
    call.listener,
    placementOf(call, `a tool call to ${call.target.host}, ${method} ${call.target.pathname}`),
    {
      kind: 3,
      name: `${method} ${call.target.pathname}`,
      attributes: {
        ...requestAttributes(method, call.target, call.headers, call.text),
        ...servedFrom(served),
      },
    },
  );
  const relay = recording(capture);
  if (armed === undefined) forward(call, forwarderOf(call.listener.shared), relay);
  else serve(call, relay, served);
}

/**
 * The origin a listener's recorded MCP calls are matched on in a replay:
 * its original's, when the config names more than one tool server; none,
 * and every recorded call its own, with one.
 */
export function ownServer(listener: Listener): string | undefined {
  return listener.shared.options.servers.length > 1 ? listener.origin : undefined;
}

/** The attribute naming the recorded event a call was served from. */
export function servedFrom(event: CallEvent | undefined): Record<string, unknown> {
  return event === undefined ? {} : {'a2ui.replay.served_from': event.spanId};
}

/** Answers a request the record matched nothing for: the 502 line, the terminal's line, and the call failed with `replay_miss`. */
export function miss(call: Call, relay: Relay): void {
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
export function serve(
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
  if (recorded.type === 'redirect') {
    const line = redirectLine(
      'tool proxy',
      call.request.method ?? 'GET',
      call.target,
      recorded.status,
      recorded.location,
    );
    shared.options.log?.(line);
    answer502(call.response, line);
    relay.fail({type: 'replay_miss', message: line}, shared.now(), false);
    return;
  }
  const carried =
    session === undefined || wasStreamed(event.attributes)
      ? []
      : recordedEvents(event, rewrite).filter(chunk => chunk.event !== 'endpoint');
  forward(
    call,
    forwarderOf(call.listener.shared),
    onCarrier(call.listener, relay, carried, session),
    recorded.reply,
  );
}

/** The relay that, once the POST's exchange ended, writes `events` on the session's carrier and reads them there as a forwarded carrier's are. */
export function onCarrier(
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
export const ACCEPTED: ServedReply = {status: 202, headers: {'content-length': '0'}};

/** `204 No Content`: a session end the record has none of. */
export const NO_CONTENT: ServedReply = {status: 204, headers: {}};

/**
 * A miss under HTTP+SSE: the 502 line on the POST, as for any miss, and the
 * request's JSON-RPC error on the session's carrier, where its client waits
 * for the reply, so the failed call reaches the agent's code as an MCP
 * error. The error is not recorded: the call is the failed `replay_miss`.
 */
export function missOnCarrier(
  call: Call,
  relay: Relay,
  message: JsonRpcMessage,
  session: Session,
): void {
  const line = missLine('tool proxy', call.request.method ?? 'GET', call.target);
  miss(call, relay);
  const outlet = session.outlet;
  if (outlet === undefined || outlet.destroyed || outlet.writableEnded) return;
  const error = {jsonrpc: '2.0', id: message.id, error: {code: -32603, message: line}};
  outlet.write(sseText({event: 'message', data: JSON.stringify(error)}));
}

/** A `ping`'s empty result, the protocol's answer: in the POST's reply, or under HTTP+SSE on the carrier after a 202. */
export function pong(
  call: Call,
  relay: Relay,
  message: JsonRpcMessage,
  session: () => Session,
): void {
  const body = JSON.stringify({jsonrpc: '2.0', id: message.id, result: {}});
  if (session().transport === 'HTTP+SSE') {
    forward(
      call,
      forwarderOf(call.listener.shared),
      onCarrier(call.listener, relay, [{event: 'message', data: body}], session),
      ACCEPTED,
    );
    return;
  }
  forward(call, forwarderOf(call.listener.shared), relay, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });
}

/** The JSON-RPC id of the request a recorded event is, as the key the proxy matches on. */
export function recordedRequestId(event: CallEvent): string | undefined {
  return idKey(requestMessage(event)?.id) ?? idKey(event.attributes['jsonrpc.request.id']);
}

/**
 * A served body or chunk with the live request's own identifiers: the
 * response to the recorded request takes the live `id`, and a
 * `notifications/progress` the live progress token, when the live request
 * asked for progress. Nothing else is touched.
 */
export function rewriteIds(
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

/**
 * An armed proxy's `GET`, with no server to ask: one whose key matches a
 * recorded HTTP tool call is served as one; one carrying `Mcp-Session-Id` is
 * a streamable HTTP carrier, held open with nothing written; one at the
 * stream path of a recorded HTTP+SSE `initialize` is that session's carrier,
 * its `endpoint` event written as recorded; anything else is a miss.
 */
export function armedGet(call: Call, pool: ReplayPool): void {
  const {listener, request, target} = call;
  const served = pool.httpTool(httpToolKey(call));
  if (served !== undefined) {
    httpTool(call, {served});
    return;
  }
  const id = header(request.headers, 'mcp-session-id');
  if (id !== undefined) {
    holdCarrier(listener, call, sessionById(listener, id));
    return;
  }
  const opening = pool.sseOpening(target.pathname, ownServer(listener));
  if (opening !== undefined) {
    const [endpoint] = recordedEvents({...opening.event, events: [opening.endpoint]});
    const url = endpointUrl(call, endpoint.data.trim());
    if (url !== undefined) {
      const session = openSseSession(listener, call, url, endpoint, listener.shared.now());
      holdCarrier(listener, call, session, endpoint);
      return;
    }
  }
  httpTool(call, {served: undefined});
}

/** Answers a `GET` as a carrier the proxy holds open, `200` `text/event-stream`, writing `first` when given, until the client closes it or the proxy is disarmed. */
export function holdCarrier(
  listener: Listener,
  call: Call,
  session: Session,
  first?: SseEvent,
): void {
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
