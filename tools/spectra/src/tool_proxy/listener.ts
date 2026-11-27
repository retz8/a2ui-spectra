/**
 * What the tool proxy's parts share: the state of the proxy as a whole, one
 * listener for one tool server, and one request as it is handled.
 */
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import type {Duplex} from 'node:stream';

import type {Forwarder} from '../proxying/relay.js';
import type {PlacedCall} from '../placement.js';
import type {ReplayPool} from '../replay/pool.js';
import type {Upstream} from '../replay/served.js';
import type {Session, ToolCapture, ToolProxyOptions} from './proxy.js';
import type {ToolServer} from './servers.js';

export interface Shared {
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
  /** What forwarding takes from the proxy, made once. */
  forwarder?: Forwarder;
  sockets: Set<Duplex>;
  /** The calls not yet ended. */
  open: Set<ToolCapture>;
  /** Requests placed before they showed what they are, a `GET` until its reply says. */
  tentative: Set<PlacedCall>;
}

/** One listener, for one tool server. */
export interface Listener {
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

export function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** One request as the proxy handles it. */
export interface Call {
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

/** What forwarding takes from the tool proxy. */
export function forwarderOf(shared: Shared): Forwarder {
  return (shared.forwarder ??= {
    inFlight: shared.inFlight,
    closing: () => shared.closing,
    now: shared.now,
    proxy: 'tool proxy',
    brokeOff: "The tool server's response broke before it ended.",
    flushes: 'every stream',
  });
}
