import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';

import {isAllowedHost} from './host_check.js';
import {sendText, serveViewerFile} from './viewer_files.js';

/** The address both listeners bind: loopback only. */
export const LOOPBACK_ADDRESS = '127.0.0.1';

/** A port that another process already holds. */
export class PortTakenError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is taken.`);
    this.name = 'PortTakenError';
  }
}

export interface ViewerServerOptions {
  port: number;
  /** The directory holding the viewer's built files. */
  viewerDir: string;
  /** Host names answered besides the loopback names. */
  allowedHosts: readonly string[];
}

export interface ViewerServer {
  /** The viewer's address, as printed and opened. */
  readonly url: string;
  close(): Promise<void>;
}

/** Starts the local server that serves the viewer. */
export function startViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
  const server = createServer((request, response) => handle(options, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortTakenError(options.port) : error);
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
    sendText(
      response,
      403,
      'Blocked request: this host is not allowed. To allow it, start Spectra with --allow-host <name>.\n',
    );
    return;
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    serveViewerFile(options.viewerDir, request, response);
    return;
  }
  if (!isJson(request.headers['content-type'])) {
    sendText(response, 415, 'Only JSON is accepted.\n');
    return;
  }
  sendText(response, 404, 'Not found.\n');
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}
