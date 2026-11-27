import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';

import {type Api, handleApi} from './api.js';
import {HOST_REFUSED, isAllowedHost} from './host_check.js';
import {sendText, serveViewerFile} from './viewer_files.js';

/** The address both listeners bind: loopback only. */
export const LOOPBACK_ADDRESS = '127.0.0.1';

/**
 * A port Spectra cannot have: one another process already holds, or one the
 * system refuses with an access error, as Windows does for a port another
 * program holds with exclusive access or that the system has set aside.
 */
export class PortTakenError extends Error {
  constructor(
    readonly port: number,
    /** Whether the system refused the port, rather than another process holding it. */
    readonly refused = false,
  ) {
    super(refused ? `The system would not give port ${port}.` : `Port ${port} is taken.`);
    this.name = 'PortTakenError';
  }
}

/** A listener's error as Spectra reports it: a port it cannot have, or the error itself. */
export function listenError(error: NodeJS.ErrnoException, port: number): Error {
  if (error.code === 'EADDRINUSE') return new PortTakenError(port);
  if (error.code === 'EACCES') return new PortTakenError(port, true);
  return error;
}

export interface ViewerServerOptions {
  port: number;
  /** The directory holding the viewer's built files. */
  viewerDir: string;
  /** Host names answered besides the loopback names. */
  allowedHosts: readonly string[];
  /** What the API under `/api/` serves from; without it, there are no API routes. */
  api?: Api;
}

export interface ViewerServer {
  /** The viewer's address, as printed and opened. */
  readonly url: string;
  close(): Promise<void>;
}

/** Starts the local server that serves the viewer and its API. */
export function startViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
  const server = createServer((request, response) => handle(options, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(listenError(error, options.port));
    });
    server.listen(options.port, LOOPBACK_ADDRESS, () => {
      resolve({
        url: `http://localhost:${options.port}/`,
        close: () =>
          new Promise(done => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

function handle(
  options: ViewerServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!isAllowedHost(request.headers.host, options.allowedHosts)) {
    sendText(response, 403, HOST_REFUSED);
    return;
  }
  const changes = request.method !== 'GET' && request.method !== 'HEAD';
  if (changes && !isJson(request.headers['content-type'])) {
    sendText(response, 415, 'Only JSON is accepted.\n');
    return;
  }
  if (options.api !== undefined && handleApi(options.api, request, response)) {
    return;
  }
  if (!changes) {
    serveViewerFile(options.viewerDir, request, response);
    return;
  }
  sendText(response, 404, 'Not found.\n');
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}
