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
 *   --model-call                 Call the model at ANTHROPIC_BASE_URL during
 *                                each turn, before answering, as a redirected
 *                                agent does.
 *   --tool-call                  Call a tool over MCP at FAKE_TOOL_URL during
 *                                each turn, before answering, with a bearer
 *                                token, as an agent reading its tool server's
 *                                URL from a variable does.
 */
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

import {FAKE_PROVIDER_KEY} from './fake_provider.js';

export const FAKE_AGENT_NAME = 'Fake agent';

/** The bearer token the fake agent sends its tool server, which no record may hold. */
export const FAKE_TOOL_TOKEN = 'fake-tool-token-0f3c9a';

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
  /** Whether each turn calls the model at ANTHROPIC_BASE_URL before answering. */
  modelCall?: boolean;
  /** Whether each turn calls a tool over MCP at FAKE_TOOL_URL before answering. */
  toolCall?: boolean;
}

/** One MCP tools/call at FAKE_TOOL_URL, with the fake token, resolving when it has been answered. */
function callTool(): Promise<void> {
  const url = process.env.FAKE_TOOL_URL;
  if (url === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${FAKE_TOOL_TOKEN}`,
          'mcp-protocol-version': '2025-06-18',
        },
      },
      response => {
        response.resume();
        response.once('end', () => resolve());
        response.once('error', () => resolve());
      },
    );
    request.once('error', () => resolve());
    request.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {name: 'lookup', arguments: {q: 'floor plan'}},
      }),
    );
  });
}

/** One call to Anthropic's Messages API at ANTHROPIC_BASE_URL, with the fake key, resolving when it has been answered. */
function callModel(): Promise<void> {
  const base = process.env.ANTHROPIC_BASE_URL;
  if (base === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const request = httpRequest(
      `${base}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': FAKE_PROVIDER_KEY,
          'anthropic-version': '2023-06-01',
        },
      },
      response => {
        response.resume();
        response.once('end', () => resolve());
        response.once('error', () => resolve());
      },
    );
    request.once('error', () => resolve());
    request.end(
      JSON.stringify({
        model: 'claude-fake-1',
        max_tokens: 64,
        system: 'You are a fake agent.',
        messages: [{role: 'user', content: 'Hi'}],
      }),
    );
  });
}

/** Starts the fake agent on 127.0.0.1. */
export function startFakeAgent(
  port: number,
  {
    onCardAnswered,
    transports = ['JSONRPC'],
    modelCall = false,
    toolCall = false,
  }: FakeAgentOptions = {},
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
      const answer = () => {
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
      };
      if ((modelCall || toolCall) && (method === 'message/send' || method === 'message/stream')) {
        void (modelCall ? callModel() : Promise.resolve())
          .then(() => (toolCall ? callTool() : undefined))
          .then(answer);
      } else {
        answer();
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
      'model-call': {type: 'boolean'},
      'tool-call': {type: 'boolean'},
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
    modelCall: values['model-call'] === true,
    toolCall: values['tool-call'] === true,
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
