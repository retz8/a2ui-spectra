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
import {PassThrough, type Transform} from 'node:stream';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';

import {LOOPBACK_ADDRESS, PortTakenError} from '../server.js';
import {NAME, VERSION} from '../version.js';
import {EXTENDED_CARD_METHODS, isCardPath, rewriteCard} from './card.js';
import {isRecord, readTurnRequest} from './protocol.js';
import {SseParser} from './sse.js';
import {formatTraceparent, parseTraceparent} from './trace_context.js';
import {TurnCapture, type TurnListener} from './turn.js';

export interface WireProxyOptions {
  /** The proxy's port, on loopback. */
  port: number;
  /** The agent's base address. */
  agentUrl: URL;
  /** The agent's name, from its card. */
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
}

export interface WireProxy {
  /** The proxy's origin, which the card's JSON-RPC endpoints are rewritten to. */
  readonly origin: string;
  /** The address to point a host at: the proxy's origin with the agent's base path. */
  readonly address: string;
  close(): Promise<void>;
}

/**
 * Headers that belong to one connection, which a proxy does not pass on
 * (RFC 9110, section 7.6.1), with any the Connection header names.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function endToEndHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase()),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name) && !named.has(name)),
  );
}

/** What the proxy keeps across requests. */
interface ProxyState {
  origin: string;
  inFlight: Set<ClientRequest>;
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
  const state: ProxyState = {origin, inFlight, warnedReuse: false};
  const server = createServer((request, response) => forward(options, state, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortTakenError(options.port) : error);
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        origin,
        address: origin + options.agentUrl.pathname,
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
  const bodyChunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
  request.once('error', () => response.destroy());
  request.once('end', () => {
    void forwardRead(options, state, request, Buffer.concat(bodyChunks), response);
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
  const target = new URL(request.url ?? '/', options.agentUrl);
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
  upstream.once('close', () => state.inFlight.delete(upstream));

  response.once('close', () => {
    if (!response.writableFinished) {
      upstream.destroy(new Error('The host closed the connection.'));
    }
  });

  upstream.once('response', reply => {
    if (isCardGet || found.name === 'extended_card') {
      relayCard(reply, response, state.origin, isCardGet);
    } else {
      relay(reply, response, found.name === 'turn' ? found.capture : undefined);
    }
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
  const body = parseJson(text);
  const turnRequest = readTurnRequest(body);
  if (turnRequest !== undefined) {
    const own = parseTraceparent(headers.traceparent);
    let adopted: string | undefined;
    if (own !== undefined) {
      if (await (options.traceIdTaken?.(own.traceId) ?? false)) {
        if (!state.warnedReuse) {
          state.warnedReuse = true;
          options.warn?.(
            "The host reuses trace ids: a turn request's traceparent named a trace id another turn already has, " +
              "so the wire proxy replaced it with Spectra's own.",
          );
        }
      } else {
        adopted = own.traceId;
      }
    }
    return {
      name: 'turn',
      capture: TurnCapture.open(turnRequest, {
        agentName: options.agentName,
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

/** Passes the reply on as received, and reads a copy into the turn, if there is one. */
function relay(reply: IncomingMessage, response: ServerResponse, capture?: TurnCapture): void {
  response.writeHead(reply.statusCode ?? 502, reply.statusMessage, endToEndHeaders(reply.headers));
  reply.pipe(response);
  // A reply that breaks off breaks off for the host too.
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
  if (status < 200 || status > 299) {
    capture.fail(`HTTP ${status}${reply.statusMessage ? ` ${reply.statusMessage}` : ''}`);
  }
  capture.replyExtensions(
    header(reply.headers['x-a2a-extensions'] ?? reply.headers['a2a-extensions']),
  );

  const decoder = decoderFor(reply.headers['content-encoding']);
  if (decoder === undefined) {
    capture.fail(
      `The reply's content encoding, ${reply.headers['content-encoding']}, cannot be read.`,
    );
    reply.once('end', () => capture.close());
    reply.once('error', () => capture.close());
    return;
  }
  reply.on('data', (chunk: Buffer) => decoder.write(chunk));
  reply.once('end', () => decoder.end());
  reply.once('error', error => {
    capture.fail(error.message);
    decoder.destroy();
  });
  reply.once('aborted', () => {
    capture.fail('The connection to the agent broke before the reply ended.');
    decoder.destroy();
  });

  const text = new TextDecoder();
  const isStream = /^text\/event-stream\b/i.test(String(reply.headers['content-type'] ?? ''));
  const sse = new SseParser();
  let body = '';
  decoder.on('data', (chunk: Buffer) => {
    const decoded = text.decode(chunk, {stream: true});
    if (isStream) {
      for (const event of sse.push(decoded)) {
        capture.delivery(parseJson(event.data) ?? event.data);
      }
    } else {
      body += decoded;
    }
  });
  decoder.once('end', () => {
    if (!isStream) {
      body += text.decode();
      capture.delivery(parseJson(body) ?? body);
    }
    if (!reply.complete) {
      capture.fail('The connection to the agent broke before the reply ended.');
    }
    capture.close();
  });
  decoder.once('error', error => {
    capture.fail(error.message);
    capture.close();
  });
  decoder.once('close', () => capture.close());
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
      const body = parseJson(text);
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

/** A stream that undoes the content encoding, or nothing for an encoding it cannot read. */
function decoderFor(encoding: string | string[] | undefined): Transform | undefined {
  switch (header(encoding)?.trim().toLowerCase() ?? 'identity') {
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

function parseJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
