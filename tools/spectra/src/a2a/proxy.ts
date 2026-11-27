import {
  type ClientRequest,
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as httpRequest,
  type ServerResponse,
} from 'node:http';
import {request as httpsRequest} from 'node:https';

import {nowUnixNano} from '../clock.js';
import {proxyRefusal, refuseRequest} from '../host_check.js';
import {listenError, LOOPBACK_ADDRESS} from '../server.js';
import {NAME, VERSION} from '../version.js';
import {EXTENDED_CARD_METHODS, isCardPath, rewriteCard} from './card.js';
import {isRecord, readTurnRequest} from './protocol.js';
import {endToEndHeaders} from '../proxying/exchange.js';
import {bodyJson, readBody} from '../proxying/forwarding.js';
import {type Forwarder, type Relay, relayReply} from '../proxying/relay.js';
import {formatTraceparent, parseTraceparent} from '../proxying/trace_context.js';
import {TurnCapture, type TurnListener} from './turn.js';

export interface WireProxyOptions {
  /** The proxy's port, on loopback. */
  port: number;
  /** The agent's base address. */
  agentUrl: URL;
  /** The agent's name, from its card, until `setAgentName` replaces it. */
  agentName?: string;
  /** Called as each turn is captured. */
  onTurn?: TurnListener;
  /**
   * Whether a trace id already names a turn, open or in the store, so a
   * host's trace id is not adopted twice. Without it, none does.
   */
  traceIdTaken?: (traceId: string) => Promise<boolean> | boolean;
  /** Takes the proxy's one-line warnings, such as that the host reuses trace ids. */
  warn?: (line: string) => void;
  /** The names given with `--allow-host`, answered beside the loopback names. None unless set. */
  allowedHosts?: readonly string[];
}

export interface WireProxy {
  /** The proxy's origin, which the card's JSON-RPC endpoints are rewritten to. */
  readonly origin: string;
  /** The address to point a host at: the proxy's origin with the agent's base path. */
  readonly address: string;
  /** Names the agent on the turns captured from now on, from its latest card; none when the card has no name. */
  setAgentName(name: string | undefined): void;
  /** Ends the open turns' connections to the agent, as a restart of its process does first. */
  cut(): void;
  close(): Promise<void>;
}

/** What the proxy keeps across requests. */
interface ProxyState {
  origin: string;
  /** The agent's name on the turns captured from now on. */
  agentName: string | undefined;
  inFlight: Set<ClientRequest>;
  /** The requests in flight that opened a turn. */
  turnsInFlight: Set<ClientRequest>;
  /** Whether the host has been told once that it reuses trace ids. */
  warnedReuse: boolean;
}

/**
 * Starts the wire proxy: a transparent reverse proxy to the agent's origin
 * that captures each send and stream as a turn. Each request is held until
 * its body has been read, then forwarded as received, `Host` set to the
 * agent's. Replies and streams pass through as received. The edits: a turn
 * request gains a `traceparent` naming the turn, and the card's JSON-RPC
 * endpoints point at the proxy.
 */
export function startWireProxy(options: WireProxyOptions): Promise<WireProxy> {
  const origin = `http://${LOOPBACK_ADDRESS}:${options.port}`;
  const inFlight = new Set<ClientRequest>();
  const turnsInFlight = new Set<ClientRequest>();
  const state: ProxyState = {
    origin,
    agentName: options.agentName,
    inFlight,
    turnsInFlight,
    warnedReuse: false,
  };
  const server = createServer((request, response) => forward(options, state, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(listenError(error, options.port));
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        origin,
        address: origin + options.agentUrl.pathname,
        setAgentName: name => {
          state.agentName = name;
        },
        cut: () => {
          for (const upstream of turnsInFlight) {
            upstream.destroy();
          }
        },
        close: () =>
          new Promise(done => {
            for (const upstream of inFlight) {
              upstream.destroy();
            }
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/** What the request turned out to be, once its body has been read. */
type Kind =
  | {
      name: 'turn';
      capture: TurnCapture;
      /** Whether the host's own trace context is kept on the request, the turn having adopted its trace id. */
      hostTraceContext: boolean;
    }
  | {name: 'extended_card'}
  | {name: 'other'};

function forward(
  options: WireProxyOptions,
  state: ProxyState,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const refusal = proxyRefusal(request.headers, options.allowedHosts ?? [], 'allowed hosts');
  if (refusal !== undefined) {
    refuseRequest(request, response, refusal);
    return;
  }
  const bodyChunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
  request.once('error', () => response.destroy());
  request.once('end', () => {
    // A request that fails in the proxy ends its own connection, not Spectra.
    forwardRead(options, state, request, Buffer.concat(bodyChunks), response).catch(() =>
      response.destroy(),
    );
  });
}

/** Forwards a request whose body has been read in full. */
async function forwardRead(
  options: WireProxyOptions,
  state: ProxyState,
  request: IncomingMessage,
  raw: Buffer,
  response: ServerResponse,
): Promise<void> {
  const target = agentTarget(request.url ?? '/', options.agentUrl);
  const isCardGet = request.method === 'GET' && isCardPath(target.pathname);
  const text = await readBody(raw, request.headers['content-encoding']);
  const found = await classify(options, state, text, request.headers);

  const headers: OutgoingHttpHeaders = {
    ...endToEndHeaders(request.headers),
    host: options.agentUrl.host,
  };
  if (
    raw.length > 0 ||
    request.headers['content-length'] !== undefined ||
    request.headers['transfer-encoding'] !== undefined
  ) {
    headers['content-length'] = raw.length;
  }
  if (found.name === 'turn' && !found.hostTraceContext) {
    headers.traceparent = formatTraceparent(found.capture.traceId, found.capture.spanId);
    delete headers.tracestate;
  }

  const send = options.agentUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = send(target, {method: request.method, headers});
  state.inFlight.add(upstream);
  if (found.name === 'turn') state.turnsInFlight.add(upstream);
  upstream.once('close', () => {
    state.inFlight.delete(upstream);
    state.turnsInFlight.delete(upstream);
  });

  response.once('close', () => {
    if (!response.writableFinished) {
      upstream.destroy(new Error('The host closed the connection.'));
    }
  });

  upstream.once('response', reply => {
    if (isCardGet || found.name === 'extended_card') {
      relayCard(reply, response, state.origin, isCardGet);
      return;
    }
    let settled = false;
    relayReply(
      reply,
      response,
      WIRE,
      found.name === 'turn' ? turnRelay(found.capture) : {end: () => {}, fail: () => {}},
      {
        served: false,
        settle: done => {
          if (settled) return;
          settled = true;
          done();
        },
        settled: () => settled,
        ourClose: () => {},
      },
    );
  });

  upstream.once('error', error => {
    if (!response.headersSent) {
      response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      response.end(`${NAME}'s wire proxy could not reach the agent: ${error.message}\n`);
    } else {
      response.destroy(error);
    }
    if (found.name === 'turn') {
      found.capture.fail(error.message);
      found.capture.close();
    }
  });

  upstream.end(raw);
}

/**
 * Where a request goes: the agent's origin, with the request's path and
 * query. A path starting with `//` stays a path, and of a full URL in the
 * request line only its path and query are kept, so no request leaves the
 * agent's origin.
 */
function agentTarget(requestUrl: string, agentUrl: URL): URL {
  let pathAndQuery = requestUrl;
  if (!requestUrl.startsWith('/')) {
    const full = URL.parse(requestUrl);
    pathAndQuery = full?.pathname.startsWith('/') ? full.pathname + full.search : '/';
  }
  return new URL(agentUrl.origin + pathAndQuery);
}

/**
 * Reads what the request is. A turn request opens a turn: on the host's own
 * trace id when its `traceparent` parses and no turn has that id yet, else
 * on a new one, the host told once per run when its trace id was taken.
 */
async function classify(
  options: WireProxyOptions,
  state: ProxyState,
  text: string | undefined,
  headers: IncomingHttpHeaders,
): Promise<Kind> {
  const body = text === undefined ? undefined : bodyJson(text);
  const turnRequest = readTurnRequest(body);
  if (turnRequest !== undefined) {
    const own = parseTraceparent(headers.traceparent);
    let adopted: string | undefined;
    if (own !== undefined) {
      let taken: boolean | undefined;
      try {
        taken = await (options.traceIdTaken?.(own.traceId) ?? false);
      } catch {
        // Whether it is taken cannot be told, as when the store cannot be listed: the turn takes Spectra's own.
        taken = undefined;
      }
      if (taken === true) {
        if (!state.warnedReuse) {
          state.warnedReuse = true;
          options.warn?.(
            "The host reuses trace ids: a turn request's traceparent named a trace id another turn already has, " +
              "so the wire proxy replaced it with Spectra's own.",
          );
        }
      } else if (taken === false) {
        adopted = own.traceId;
      }
    }
    return {
      name: 'turn',
      capture: TurnCapture.open(turnRequest, {
        agentName: state.agentName,
        writer: {name: NAME, version: VERSION},
        listener: options.onTurn ?? (() => {}),
        ...(adopted !== undefined && {traceId: adopted}),
      }),
      hostTraceContext: adopted !== undefined,
    };
  }
  if (isRecord(body) && typeof body.method === 'string' && EXTENDED_CARD_METHODS.has(body.method)) {
    return {name: 'extended_card'};
  }
  return {name: 'other'};
}

/** What reading a reply takes from the wire proxy: its words, and no stop of its own. */
const WIRE: Forwarder = {
  inFlight: new Set(),
  closing: () => false,
  now: nowUnixNano,
  proxy: 'wire proxy',
  brokeOff: 'The connection to the agent broke before the reply ended.',
  flushes: 'served stream',
};

/**
 * The relay that reads a turn's reply into its capture: the failure a status
 * other than 2xx states, the A2UI versions the reply names, each delivery,
 * and once the reply's end or its break, on which the turn closes.
 */
function turnRelay(capture: TurnCapture): Relay {
  let encoding: string | string[] | undefined;
  /** Whether the reply's content encoding can be read; one that cannot fails the turn. */
  let decodable = false;
  const unreadable = () => `The reply's content encoding, ${header(encoding)}, cannot be read.`;
  return {
    head(status, headers, _streamed, statusMessage) {
      if (status < 200 || status > 299) {
        capture.fail(`HTTP ${status}${statusMessage ? ` ${statusMessage}` : ''}`);
      }
      capture.replyExtensions(header(headers['x-a2a-extensions'] ?? headers['a2a-extensions']));
      encoding = headers['content-encoding'];
    },
    decoding() {
      decodable = true;
    },
    event(event) {
      capture.delivery(bodyJson(event.data) ?? event.data);
    },
    end(_at, body) {
      if (!decodable) capture.fail(unreadable());
      else if (body !== undefined) capture.delivery(bodyJson(body) ?? body);
      capture.close();
    },
    fail(failure) {
      capture.fail(decodable ? (failure.message ?? failure.type) : unreadable());
      capture.close();
    },
  };
}

/**
 * Passes a card on with its JSON-RPC endpoints pointed at the proxy: the
 * body of a card fetch, or the result of an extended card call. A reply that
 * is not a successful JSON object passes on as received.
 */
function relayCard(
  reply: IncomingMessage,
  response: ServerResponse,
  origin: string,
  isCardGet: boolean,
): void {
  const chunks: Buffer[] = [];
  reply.on('data', (chunk: Buffer) => chunks.push(chunk));
  reply.once('error', error => response.destroy(error));
  reply.once('end', () => {
    const raw = Buffer.concat(chunks);
    void readBody(raw, reply.headers['content-encoding']).then(text => {
      const status = reply.statusCode ?? 502;
      const body = text === undefined ? undefined : bodyJson(text);
      let rewritten: unknown;
      if (status >= 200 && status <= 299 && isRecord(body)) {
        if (isCardGet) {
          rewritten = rewriteCard(body, origin);
        } else if (isRecord(body.result)) {
          rewritten = {...body, result: rewriteCard(body.result, origin)};
        }
      }
      const headers = endToEndHeaders(reply.headers);
      if (rewritten === undefined) {
        response.writeHead(status, reply.statusMessage, headers);
        response.end(raw);
        return;
      }
      const out = Buffer.from(JSON.stringify(rewritten));
      delete headers['content-encoding'];
      response.writeHead(status, reply.statusMessage, {...headers, 'content-length': out.length});
      response.end(out);
    });
  });
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
