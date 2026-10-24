/**
 * A small fake A2A agent for the command-line test. It answers its card at
 * both well-known paths, a canned A2A 0.3 send and stream at any path, and
 * the request headers it received at /headers. Run as a script, it is the
 * agent's command under `run`; `startFakeAgent` runs it inside a test.
 *
 * Script options:
 *   --port <n>                   The port to listen on, on 127.0.0.1.
 *   --transports <list>          The transports the card lists, in preference
 *                                order, comma-separated. Default: JSONRPC.
 *   --exit-after-card <code>     Exit with <code> soon after answering the card.
 *   --ignore-sigterm             Ignore the stop signal.
 *   --grandchild-pid-file <path> Start a long-running child and write its pid.
 */
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export const FAKE_AGENT_NAME = 'Fake agent';

const surface = {
  version: 'v0.9',
  createSurface: {
    surfaceId: 'default',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
};

/** The reply to a send, byte for byte, spaced unusually so a re-encoding shows. */
export const SEND_REPLY = `{"jsonrpc": "2.0", "id": 1,
  "result": {"kind": "message", "messageId": "r-1", "role": "agent", "contextId": "ctx-1",
    "parts": [{"kind": "text", "text": "Hello"}]}}`;

/** The reply to a stream, byte for byte: two events, a comment and a CRLF between. */
export const STREAM_REPLY =
  `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't-1', contextId: 'ctx-1', status: {state: 'working', message: {kind: 'message', messageId: 'r-1', role: 'agent', parts: [{kind: 'data', data: surface, metadata: {mimeType: 'application/json+a2ui'}}]}}, final: false}})}\r\n\r\n` +
  ': keep-alive\n\n' +
  `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't-1', contextId: 'ctx-1', status: {state: 'input-required'}, final: false}})}\n\n`;

export interface FakeAgentOptions {
  onCardAnswered?: () => void;
  /**
   * The transports the card lists, in preference order; none is a card that
   * lists no interface. Default: JSON-RPC only.
   */
  transports?: string[];
}

/** Starts the fake agent on 127.0.0.1. */
export function startFakeAgent(
  port: number,
  {onCardAnswered, transports = ['JSONRPC']}: FakeAgentOptions = {},
): Promise<Server> {
  const url = `http://localhost:${port}/`;
  // No transports is a card that lists no interface at all, as an empty A2A 1.0 list.
  const card =
    transports.length === 0
      ? {name: FAKE_AGENT_NAME, supportedInterfaces: []}
      : {
          name: FAKE_AGENT_NAME,
          url,
          preferredTransport: transports[0],
          ...(transports.length > 1 && {
            additionalInterfaces: transports.slice(1).map(transport => ({url, transport})),
          }),
        };
  const server = createServer((request, response) => {
    if (
      request.method === 'GET' &&
      (request.url === '/.well-known/agent-card.json' || request.url === '/.well-known/agent.json')
    ) {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify(card));
      onCardAnswered?.();
      return;
    }
    if (request.method === 'GET' && request.url === '/headers') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify(request.headers));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(404);
      response.end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      let method: unknown;
      try {
        method = (JSON.parse(body) as {method?: unknown}).method;
      } catch {
        method = undefined;
      }
      if (method === 'message/send') {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(SEND_REPLY);
      } else if (method === 'message/stream') {
        response.writeHead(200, {'content-type': 'text/event-stream'});
        response.end(STREAM_REPLY);
      } else {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {code: -32601, message: 'Method not found'},
          }),
        );
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function runAsScript(): Promise<void> {
  const {values} = parseArgs({
    options: {
      port: {type: 'string'},
      transports: {type: 'string'},
      'exit-after-card': {type: 'string'},
      'ignore-sigterm': {type: 'boolean'},
      'grandchild-pid-file': {type: 'string'},
    },
  });
  if (values['ignore-sigterm']) {
    process.on('SIGTERM', () => {});
  }
  if (values['grandchild-pid-file'] !== undefined) {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    writeFileSync(values['grandchild-pid-file'], String(grandchild.pid));
  }
  const exitCode = values['exit-after-card'];
  await startFakeAgent(Number(values.port), {
    transports: values.transports?.split(','),
    onCardAnswered: () => {
      if (exitCode !== undefined) {
        setTimeout(() => process.exit(Number(exitCode)), 200);
      }
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runAsScript();
}
