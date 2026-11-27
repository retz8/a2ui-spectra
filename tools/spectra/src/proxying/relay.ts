/**
 * Forwarding one request as received and passing its reply back as received,
 * while a relay reads a copy: the part the model proxy and the tool proxy
 * share.
 */
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {Duplex} from 'node:stream';

import {
  type ReplyMessage,
  type ServedReply,
  ServedUpstream,
  type Upstream,
} from '../replay/served.js';
import {NAME} from '../version.js';
import {endToEndHeaders} from './exchange.js';
import {decoderFor} from './forwarding.js';
import {type SseEvent, SseParser} from './sse.js';

/** How long a reply is read on after the agent closes its connection, unless set. */
export const DEFAULT_CLOSE_GRACE_MS = 5000;
export const AGENT_CLOSED = 'The agent closed the connection before the response ended.';
export const STOPPED = 'Spectra stopped before the response ended.';

/** How a call or its exchange failed: its `error.type`, and the status message. */
export interface Failure {
  type: string;
  message?: string;
}

/** One request as a proxy forwards it. */
export interface Exchange {
  request: IncomingMessage;
  raw: Buffer;
  target: URL;
  response: ServerResponse;
  /** The headers as forwarded. */
  headers: OutgoingHttpHeaders;
}

/** What forwarding takes from the proxy: its upstreams in flight, its stop, its clock and its words. */
export interface Forwarder {
  inFlight: Set<Upstream>;
  /** Whether Spectra is stopping: a reply cut off then fails as aborted. */
  closing(): boolean;
  now(): bigint;
  /** The proxy's name in its lines, such as `tool proxy`. */
  proxy: string;
  /** The status message of a reply that broke off with no error of its own. */
  brokeOff: string;
  /** Which streamed replies have their headers sent before their first event: every one, or a served one alone. */
  flushes: 'every stream' | 'served stream';
}

/**
 * The headers a request is forwarded with: its end-to-end headers, `Host`
 * set to the target's, and `Content-Length` set to the body read whenever
 * the request has a body or names a length.
 */
export function forwardedHeaders(
  request: IncomingMessage,
  raw: Buffer,
  host: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {...endToEndHeaders(request.headers), host};
  if (
    raw.length > 0 ||
    request.headers['content-length'] !== undefined ||
    request.headers['transfer-encoding'] !== undefined
  ) {
    headers['content-length'] = raw.length;
  }
  return headers;
}

/** Answers a WebSocket upgrade a replay misses, 502 with the miss's line, and closes the socket. */
export function missUpgrade(socket: Duplex, line: string): void {
  socket.end(
    `HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n${line}\n`,
  );
}

/** What the proxy reads of the reply, through a copy of it. */
export interface Relay {
  /** The reply's status and headers, whether it is a stream of server-sent events, and its status message. */
  head?(
    status: number,
    headers: IncomingHttpHeaders,
    streamed: boolean,
    statusMessage?: string,
  ): void;
  /** One server-sent event of a streamed reply, at its arrival. */
  event?(event: SseEvent, at: bigint): void;
  /** The reply ended complete, with its body when it was not streamed and could be read. */
  end(at: bigint, body: string | undefined): void;
  /** The reply broke before it ended, `reached` true, or the server could not be reached. */
  fail(failure: Failure, at: bigint, reached: boolean): void;
  /** The agent closed its side before the reply ended; `drop` drops the reply. Without it, the reply is dropped at once. */
  agentClosed?(drop: () => void): void;
  /**
   * The reply's content encoding can be read; `flush` calls back once the
   * decoder has given out what arrived so far. Not called for an encoding
   * that cannot be read.
   */
  decoding?(flush: (done: () => void) => void): void;
}

/**
 * Forwards the request as received, passes the reply back as received, and
 * hands a copy to the relay. With `served`, the served reply stands where the
 * forwarded one would, and nothing is forwarded.
 */
export function forward(
  exchange: Exchange,
  forwarder: Forwarder,
  relay: Relay,
  served?: ServedReply,
): void {
  const {request, raw, target, response} = exchange;
  const shared = forwarder;
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream: Upstream =
    served === undefined
      ? send(target, {method: request.method ?? 'GET', headers: exchange.headers})
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

  upstream.once('response', (reply: ReplyMessage) =>
    relayReply(reply, response, forwarder, relay, {
      served: served !== undefined,
      settle,
      settled: () => settled,
      ourClose: () => {
        ourClose = true;
      },
    }),
  );

  upstream.once('error', error => {
    const code = (error as NodeJS.ErrnoException).code;
    if (response.destroyed) {
      // The agent is gone; nothing to answer.
    } else if (!response.headersSent) {
      response.writeHead(502, {'content-type': 'text/plain; charset=utf-8'});
      response.end(
        `${NAME}'s ${forwarder.proxy} could not reach ${target.host}: ${error.message}\n`,
      );
      settle(() =>
        relay.fail(
          shared.closing() ? stopped() : {type: code ?? 'error', message: error.message},
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
        shared.closing() ? stopped() : {type: code ?? 'ECONNRESET', message: error.message},
        shared.now(),
        response.headersSent,
      ),
    );
  });

  upstream.end(raw);
}

/** How a reply is read beside the rest of its exchange: whether it is served, the one settle, and how the proxy marks its own close of the agent's side. */
export interface Reading {
  served: boolean;
  /** Runs `done` unless the exchange has settled already. */
  settle(done: () => void): void;
  settled(): boolean;
  ourClose(): void;
}

/**
 * Passes the reply on as received and hands a decoded copy to the relay: its
 * head, each server-sent event of a stream, and once its end or its break.
 */
export function relayReply(
  reply: ReplyMessage,
  response: ServerResponse,
  forwarder: Forwarder,
  relay: Relay,
  reading: Reading,
): void {
  const shared = forwarder;
  const {settle} = reading;
  const stopped = (): Failure => ({type: 'aborted', message: STOPPED});
  const status = reply.statusCode ?? 502;
  const streamed = /^text\/event-stream\b/i.test(String(reply.headers['content-type'] ?? ''));
  if (!response.destroyed) {
    response.writeHead(status, reply.statusMessage, endToEndHeaders(reply.headers));
    if (streamed && (forwarder.flushes === 'every stream' || reading.served)) {
      response.flushHeaders();
    }
    reply.pipe(response);
    reply.once('close', () => {
      if (!reply.complete) {
        reading.ourClose();
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
  relay.head?.(status, reply.headers, streamed, reply.statusMessage);
  const broke = (error?: Error) =>
    settle(() =>
      relay.fail(
        shared.closing()
          ? stopped()
          : {
              type: (error as NodeJS.ErrnoException | undefined)?.code ?? 'ECONNRESET',
              message: error?.message ?? forwarder.brokeOff,
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
  relay.decoding?.(done =>
    decoder.flush === undefined ? process.nextTick(done) : decoder.flush(done),
  );
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
    if (reading.settled()) return;
    const decoded = text.decode(chunk, {stream: true});
    if (streamed) {
      for (const event of sse.push(decoded)) {
        if (!reading.settled()) relay.event?.(event, shared.now());
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
}
