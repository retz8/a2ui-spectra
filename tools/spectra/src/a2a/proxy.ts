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

/**
 * Starts the wire proxy: a transparent reverse proxy to the agent's origin
 * that captures each send and stream as a turn. Bodies, replies and streams
 * pass through as received, `Host` set to the agent's; the one edit is the
 * card, whose JSON-RPC endpoints point at the proxy.
 */
export function startWireProxy(options: WireProxyOptions): Promise<WireProxy> {
  const origin = `http://${LOOPBACK_ADDRESS}:${options.port}`;
  const inFlight = new Set<ClientRequest>();
  const server = createServer((request, response) =>
    forward(options, origin, inFlight, request, response),
  );
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
type Kind = {name: 'turn'; capture: TurnCapture} | {name: 'extended_card'} | {name: 'other'};

function forward(
  options: WireProxyOptions,
  origin: string,
  inFlight: Set<ClientRequest>,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const target = new URL(request.url ?? '/', options.agentUrl);
  const isCardGet = request.method === 'GET' && isCardPath(target.pathname);
  const send = options.agentUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = send(target, {
    method: request.method,
    headers: {...endToEndHeaders(request.headers), host: options.agentUrl.host},
  });
  inFlight.add(upstream);
  upstream.once('close', () => inFlight.delete(upstream));

  const bodyChunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
  const kind = new Promise<Kind>(resolve => {
    request.once('end', () => {
      void readBody(Buffer.concat(bodyChunks), request.headers['content-encoding']).then(text =>
        resolve(classify(options, text)),
      );
    });
    request.once('error', () => resolve({name: 'other'}));
  });
  request.pipe(upstream);

  response.once('close', () => {
    if (!response.writableFinished) {
      upstream.destroy(new Error('The host closed the connection.'));
    }
  });

  upstream.once('response', reply => {
    void kind.then(found => {
      if (isCardGet || found.name === 'extended_card') {
        relayCard(reply, response, origin, isCardGet);
      } else {
        relay(reply, response, found.name === 'turn' ? found.capture : undefined);
      }
    });
  });

  upstream.once('error', error => {
    if (!response.headersSent) {
      response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      response.end(`${NAME}'s wire proxy could not reach the agent: ${error.message}\n`);
    } else {
      response.destroy(error);
    }
    void kind.then(found => {
      if (found.name === 'turn') {
        found.capture.fail(error.message);
        found.capture.close();
      }
    });
  });
}

function classify(options: WireProxyOptions, text: string | undefined): Kind {
  const body = parseJson(text);
  const turnRequest = readTurnRequest(body);
  if (turnRequest !== undefined) {
    return {
      name: 'turn',
      capture: TurnCapture.open(turnRequest, {
        agentName: options.agentName,
        writer: {name: NAME, version: VERSION},
        listener: options.onTurn ?? (() => {}),
      }),
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
