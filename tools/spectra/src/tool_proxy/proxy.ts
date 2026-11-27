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

import {removeFromUrl} from '../proxying/credentials.js';
import {bodyJson, isTokenRequest, readBody, tunnelUpgrade} from '../proxying/forwarding.js';
import type {CallListener} from '../proxying/calls.js';
import {
  DEFAULT_CLOSE_GRACE_MS,
  forward,
  forwardedHeaders,
  missUpgrade,
  STOPPED,
} from '../proxying/relay.js';
import type {CallToPlace, PlacedCall, Unplaced} from '../placement.js';
import type {ReplayPool} from '../replay/pool.js';
import {answer502, missLine} from '../replay/served.js';
import {nowUnixNano} from '../clock.js';
import {proxyRefusal, refuseRequest, refuseUpgrade} from '../host_check.js';
import {listenError, LOOPBACK_ADDRESS} from '../server.js';
import {asJsonRpc} from './mcp.js';
import {type Call, forwarderOf, header, type Listener, type Shared} from './listener.js';
import type {ToolServer} from './servers.js';
import {armedGet, httpTool, httpToolKey} from './serving.js';
import {getRequest, mcpMessage, type Session, sessionEnd} from './sessions.js';

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
