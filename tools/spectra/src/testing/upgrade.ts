/**
 * A WebSocket upgrade as the proxies' tests send and answer it, on raw
 * sockets: a server that switches protocols and echoes what follows, and a
 * client that sends the upgrade and reads the answer's head.
 */
import {createServer, type Server} from 'node:http';
import {connect, type Socket} from 'node:net';

/** A server that answers every upgrade `101`, naming the `Host` it received in `x-received-host`, then echoes the socket. */
export function echoUpgradeServer(): Server {
  const server = createServer((_request, response) => response.writeHead(404).end());
  server.on('upgrade', (request, socket, head: Buffer) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n' +
        `x-received-host: ${request.headers.host ?? ''}\r\n\r\n`,
    );
    if (head.length > 0) socket.write(head);
    socket.pipe(socket);
  });
  return server;
}

/** One upgrade sent on a raw socket. */
export interface Upgrade {
  /** The answer's status line and headers. */
  head: string;
  socket: Socket;
  /** What arrived after the head so far. */
  after(): string;
  /** Settles when the socket closes. */
  closed: Promise<void>;
}

/**
 * Sends a WebSocket upgrade for `path` to the listener on `port`, `Host`
 * naming the listener unless `headers` names another, and resolves once the
 * answer's head arrived.
 */
export function sendUpgrade(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<Upgrade> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const closed = new Promise<void>(done => socket.once('close', () => done()));
    let received = '';
    let head: string | undefined;
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (head !== undefined) return;
      const end = received.indexOf('\r\n\r\n');
      if (end === -1) return;
      head = received.slice(0, end);
      received = received.slice(end + 4);
      resolve({head, socket, after: () => received, closed});
    });
    const sent: Record<string, string> = {
      host: `127.0.0.1:${port}`,
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      ...headers,
    };
    const lines = Object.entries(sent).map(([name, value]) => `${name}: ${value}\r\n`);
    socket.write(`GET ${path} HTTP/1.1\r\n${lines.join('')}\r\n`);
  });
}
