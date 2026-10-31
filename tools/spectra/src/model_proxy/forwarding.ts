/**
 * What the model proxy and the tool proxy share in passing traffic on: the
 * clock, reading a body through its content encoding, the test for an OAuth
 * token request, which both pass on unrecorded, and the tunnel a WebSocket
 * upgrade passes through, unrecorded.
 */
import type {IncomingMessage} from 'node:http';
import {connect as netConnect, type Socket} from 'node:net';
import {type Duplex, PassThrough, type Transform} from 'node:stream';
import {connect as tlsConnect} from 'node:tls';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';

/** Nanoseconds since the Unix epoch. */
export function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}

/** A content-encoding's decoder; zlib's streams flush, a pass-through has nothing to. */
export type Decoder = Transform & {flush?(callback: () => void): void};

/** A stream that undoes the content encoding, or nothing for an encoding it cannot read. */
export function decoderFor(encoding: string | string[] | undefined): Decoder | undefined {
  const value = Array.isArray(encoding) ? encoding.join(', ') : encoding;
  switch (value?.trim().toLowerCase() ?? 'identity') {
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
export function readBody(
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

/** A body's JSON value, or nothing when it is not JSON. */
export function bodyJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Whether a request is an OAuth token request, which carries credentials in
 * its body and gets them in its reply: a form-encoded body carrying
 * `grant_type`, as OAuth 2.0 has the token request, or a JSON object carrying
 * it, as Anthropic's token endpoint takes it.
 */
export function isTokenRequest(contentType: string | undefined, body: string | undefined): boolean {
  if (body === undefined) return false;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    return new URLSearchParams(body).has('grant_type');
  }
  const json = bodyJson(body);
  return (
    typeof json === 'object' &&
    json !== null &&
    !Array.isArray(json) &&
    typeof (json as Record<string, unknown>).grant_type === 'string'
  );
}

/**
 * Passes a WebSocket upgrade on to the target as a tunnel, unrecorded. The
 * sockets are added to `sockets` while the tunnel is open, for the proxy to
 * close when Spectra stops.
 */
export function tunnelUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: URL,
  sockets: Set<Duplex>,
): void {
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const upstream: Socket =
    target.protocol === 'https:'
      ? tlsConnect({host: target.hostname, port, servername: target.hostname})
      : netConnect({host: target.hostname, port});
  sockets.add(socket);
  sockets.add(upstream);
  const forget = () => {
    sockets.delete(socket);
    sockets.delete(upstream);
  };
  upstream.once('connect', () => {
    const lines = [`${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1`];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i];
      lines.push(
        `${name}: ${name.toLowerCase() === 'host' ? target.host : request.rawHeaders[i + 1]}`,
      );
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once('secureConnect', () => upstream.emit('connect'));
  upstream.once('error', () => {
    socket.destroy();
    forget();
  });
  socket.once('error', () => {
    upstream.destroy();
    forget();
  });
  socket.once('close', () => {
    upstream.destroy();
    forget();
  });
  upstream.once('close', () => {
    socket.destroy();
    forget();
  });
}
