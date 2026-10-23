/**
 * A card-only A2A agent for the command-line test. It answers its agent card
 * at /.well-known/agent-card.json and nothing else. Run as a script, it is the
 * agent's command under `run`; `startCardServer` runs it inside a test.
 *
 * Script options:
 *   --port <n>                   The port to listen on, on 127.0.0.1.
 *   --exit-after-card <code>     Exit with <code> soon after answering the card.
 *   --ignore-sigterm             Ignore the stop signal.
 *   --grandchild-pid-file <path> Start a long-running child and write its pid.
 */
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export const CARD_NAME = 'Card server';

/** Starts a card-only server on 127.0.0.1. */
export function startCardServer(port: number, onCardAnswered?: () => void): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url === '/.well-known/agent-card.json') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(
        JSON.stringify({
          name: CARD_NAME,
          url: `http://localhost:${port}/`,
          preferredTransport: 'JSONRPC',
        }),
      );
      onCardAnswered?.();
      return;
    }
    response.writeHead(404);
    response.end();
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
  await startCardServer(Number(values.port), () => {
    if (exitCode !== undefined) {
      setTimeout(() => process.exit(Number(exitCode)), 200);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runAsScript();
}
