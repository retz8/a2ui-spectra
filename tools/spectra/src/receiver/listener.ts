/**
 * The OTLP/HTTP receiver's listener, on its own port on loopback:
 * `POST /v1/traces` and `POST /v1/logs` read, in protobuf or OTLP/JSON,
 * gzip included; `POST /v1/metrics` answered and dropped. A request that was
 * read is answered `200` with an empty export response in its own encoding;
 * a body that does not decode, `400`. No header of an export request is
 * recorded.
 */
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {gunzip} from 'node:zlib';

import {LOOPBACK_ADDRESS, PortTakenError} from '../server.js';
import {NAME} from '../version.js';
import {
  DecodeError,
  decodeLogs,
  decodeTraces,
  type Encoding,
  type ReceivedLog,
  type ReceivedSpan,
  receivedLogs,
  receivedSpans,
} from './otlp.js';

export const DEFAULT_RECEIVER_PORT = 9823;

export interface ReceiverListenerOptions {
  /** The receiver's port, on loopback. */
  port: number;
  /** Takes the spans of each trace export request. */
  onSpans: (spans: ReceivedSpan[]) => void;
  /** Takes the log records of each log export request. */
  onLogs: (logs: ReceivedLog[]) => void;
}

export interface ReceiverListener {
  /** The listener's origin, which `OTEL_EXPORTER_OTLP_ENDPOINT` names. */
  readonly origin: string;
  close(): Promise<void>;
}

const SIGNALS = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

/** Starts the receiver's listener on its port. A port that is taken is an error. */
export function startReceiverListener(options: ReceiverListenerOptions): Promise<ReceiverListener> {
  const origin = `http://${LOOPBACK_ADDRESS}:${options.port}`;
  const server = createServer((request, response) => handle(options, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortTakenError(options.port) : error);
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        origin,
        // An export in flight is answered; a connection held open past a second is cut.
        close: () =>
          new Promise(done => {
            const cut = setTimeout(() => server.closeAllConnections?.(), 1000);
            server.close(() => {
              clearTimeout(cut);
              done();
            });
            server.closeIdleConnections?.();
          }),
      });
    });
  });
}

/** The encoding a `content-type` names: protobuf or OTLP/JSON; nothing for another. */
function encodingOf(contentType: string | undefined): Encoding | undefined {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (type === 'application/x-protobuf' || type === 'application/protobuf') return 'protobuf';
  if (type === 'application/json') return 'json';
  return undefined;
}

function answer(
  response: ServerResponse,
  status: number,
  encoding: Encoding | undefined,
  text?: string,
): void {
  if (status === 200) {
    // The empty export response: no bytes in protobuf, `{}` in OTLP/JSON.
    const body = encoding === 'json' ? '{}' : '';
    response.writeHead(200, {
      'content-type': encoding === 'json' ? 'application/json' : 'application/x-protobuf',
      'content-length': Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  const body = `${text ?? ''}\n`;
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function handle(
  options: ReceiverListenerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const {pathname} = new URL(request.url ?? '/', 'http://localhost');
  if (!SIGNALS.has(pathname)) {
    request.resume();
    answer(
      response,
      404,
      undefined,
      `${NAME}'s OpenTelemetry receiver takes POST /v1/traces, /v1/logs and /v1/metrics.`,
    );
    return;
  }
  if (request.method !== 'POST') {
    request.resume();
    answer(response, 405, undefined, `${request.method ?? 'This method'} is not allowed here.`);
    return;
  }
  const encoding = encodingOf(request.headers['content-type']);
  if (encoding === undefined) {
    request.resume();
    answer(response, 415, undefined, 'Send application/x-protobuf or application/json.');
    return;
  }
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.once('error', () => response.destroy());
  request.once('end', () => {
    const raw = Buffer.concat(chunks);
    const gzipped = /\bgzip\b/i.test(String(request.headers['content-encoding'] ?? ''));
    const read = (body: Buffer) => {
      try {
        if (pathname === '/v1/traces') {
          const spans = receivedSpans(decodeTraces(body, encoding));
          answer(response, 200, encoding);
          options.onSpans(spans);
        } else if (pathname === '/v1/logs') {
          const logs = receivedLogs(decodeLogs(body, encoding));
          answer(response, 200, encoding);
          options.onLogs(logs);
        } else {
          answer(response, 200, encoding);
        }
      } catch (error) {
        if (error instanceof DecodeError) {
          answer(response, 400, encoding, error.message);
        } else {
          throw error;
        }
      }
    };
    if (!gzipped) {
      read(raw);
      return;
    }
    gunzip(raw, (error, body) => {
      if (error !== null) {
        answer(response, 400, encoding, `The body is not gzip: ${error.message}`);
      } else {
        read(body);
      }
    });
  });
}
