import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request as httpRequest,
  type Server,
  type ServerResponse,
} from 'node:http';
import {after, describe, it} from 'node:test';
import {gzipSync} from 'node:zlib';

import type {TurnEvent, TurnRecordEvent, WireOutputEvent} from '../record/turn_record.js';
import {startWireProxy, type WireProxy} from './proxy.js';
import type {TurnNotification} from './turn.js';

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

interface Setup {
  agentPort: number;
  proxy: WireProxy;
  notifications: TurnNotification[];
  /** The headers of each request the agent received. */
  received: IncomingHttpHeaders[];
}

const servers: Server[] = [];
const proxies: WireProxy[] = [];
after(async () => {
  await Promise.all(proxies.map(proxy => proxy.close()));
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function setUp(handler: Handler, agentPath = ''): Promise<Setup> {
  const received: IncomingHttpHeaders[] = [];
  const agent = createServer((request, response) => {
    received.push(request.headers);
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => handler(request, body, response));
  });
  servers.push(agent);
  const agentPort = await listen(agent);
  const notifications: TurnNotification[] = [];
  const proxy = await startWireProxy({
    port: await freePort(),
    agentUrl: new URL(`http://127.0.0.1:${agentPort}${agentPath}`),
    agentName: 'Test Agent',
    onTurn: notification => notifications.push(notification),
  });
  proxies.push(proxy);
  return {agentPort, proxy, notifications, received};
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** One request through the proxy, read raw: no decompression. */
function send(
  proxy: WireProxy,
  {
    method = 'GET',
    path = '/',
    headers = {},
    body,
    onData,
  }: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
    onData?: (chunk: Buffer) => void;
  },
): Promise<Answer> {
  const origin = new URL(proxy.origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {host: origin.hostname, port: origin.port, method, path, headers},
      response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          onData?.(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

function jsonRpc(method: string, params: unknown = {}) {
  return JSON.stringify({jsonrpc: '2.0', id: 1, method, params});
}

const userMessage = {
  kind: 'message',
  messageId: 'm-1',
  role: 'user',
  parts: [{kind: 'text', text: 'Hi'}],
};
const surface = {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'basic'}};

/** Waits until the notifications include a closed turn, and returns its wire outputs. */
async function closedTurn(notifications: TurnNotification[]) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const closed = notifications.find(n => n.type === 'turn_closed');
    if (closed?.type === 'turn_closed') {
      const [turnEvent, ...wireEvents] = closed.turn.events as [TurnEvent, ...TurnRecordEvent[]];
      return {
        turnEvent,
        outputs: wireEvents.filter(
          (event): event is WireOutputEvent =>
            event.attributes['a2ui.event.kind'] === 'wire_output',
        ),
      };
    }
    if (Date.now() > deadline) {
      throw new Error(`No closed turn in ${JSON.stringify(notifications.map(n => n.type))}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('the wire proxy', () => {
  it("rewrites the card's JSON-RPC endpoints at both well-known paths, under the agent's base path", async () => {
    const {agentPort, proxy, notifications} = await setUp((request, _body, response) => {
      const card = {
        name: 'Test Agent',
        url: `http://localhost:${agentPort}/agents/a`,
        additionalInterfaces: [
          {url: `http://localhost:${agentPort}/agents/a`, transport: 'JSONRPC'},
          {url: `localhost:50051`, transport: 'GRPC'},
        ],
      };
      if (request.url?.endsWith('/agent-card.json') || request.url?.endsWith('/agent.json')) {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify(card, null, 2));
      } else {
        response.writeHead(404).end();
      }
    }, '/agents/a');
    const proxyPort = new URL(proxy.origin).port;
    assert.equal(proxy.address, `http://127.0.0.1:${proxyPort}/agents/a`);
    for (const path of [
      '/agents/a/.well-known/agent-card.json',
      '/agents/a/.well-known/agent.json',
    ]) {
      const answer = await send(proxy, {path});
      assert.equal(answer.status, 200);
      assert.equal(Number(answer.headers['content-length']), answer.body.length);
      assert.deepEqual(JSON.parse(answer.body.toString()), {
        name: 'Test Agent',
        url: `http://127.0.0.1:${proxyPort}/agents/a`,
        additionalInterfaces: [
          {url: `http://127.0.0.1:${proxyPort}/agents/a`, transport: 'JSONRPC'},
          {url: 'localhost:50051', transport: 'GRPC'},
        ],
      });
    }
    assert.deepEqual(notifications, []);
  });

  it('rewrites the extended card of both A2A versions', async () => {
    const {agentPort, proxy} = await setUp((_request, body, response) => {
      const {method} = JSON.parse(body) as {method: string};
      const card =
        method === 'GetExtendedAgentCard'
          ? {
              supportedInterfaces: [
                {
                  url: `http://localhost:${agentPort}/a2a`,
                  protocolBinding: 'JSONRPC',
                  protocolVersion: '1.0',
                },
              ],
            }
          : {url: `http://localhost:${agentPort}/`};
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({jsonrpc: '2.0', id: 1, result: card}));
    });
    const proxyPort = new URL(proxy.origin).port;
    const v03 = await send(proxy, {
      method: 'POST',
      body: jsonRpc('agent/getAuthenticatedExtendedCard'),
    });
    assert.deepEqual(JSON.parse(v03.body.toString()).result, {
      url: `http://127.0.0.1:${proxyPort}/`,
    });
    const v10 = await send(proxy, {method: 'POST', body: jsonRpc('GetExtendedAgentCard')});
    assert.equal(
      JSON.parse(v10.body.toString()).result.supportedInterfaces[0].url,
      `http://127.0.0.1:${proxyPort}/a2a`,
    );
  });

  it('relays a send byte for byte and captures it as one turn', async () => {
    const reply =
      '{ "jsonrpc": "2.0",\n  "id": 1,\n  "result": {"kind": "message", "messageId": "r", "role": "agent", "contextId": "ctx", "parts": [{"kind": "text", "text": "Hey"}]} }';
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'x-a2a-extensions': 'https://a2ui.org/a2a-extension/a2ui/v0.9',
      });
      response.end(reply);
    });
    const answer = await send(proxy, {
      method: 'POST',
      path: '/',
      headers: {'content-type': 'application/json'},
      body: jsonRpc('message/send', {message: userMessage}),
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.toString(), reply);
    assert.equal(answer.headers['x-a2a-extensions'], 'https://a2ui.org/a2a-extension/a2ui/v0.9');
    const {turnEvent, outputs} = await closedTurn(notifications);
    assert.equal(turnEvent.name, 'invoke_agent Test Agent');
    assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'completed');
    assert.equal(turnEvent.attributes['a2ui.turn.protocol_version'], 'v0.9');
    assert.deepEqual(
      outputs.map(output => output.attributes['a2ui.wire.message'].parts),
      [[{type: 'text', content: 'Hey'}]],
    );
  });

  it('relays a stream byte for byte, and notifies each wire event as it arrives', async () => {
    let finish: () => void = () => {};
    const first = `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't', contextId: 'c', status: {state: 'working', message: {kind: 'message', messageId: 'r', role: 'agent', parts: [{kind: 'data', data: surface, metadata: {mimeType: 'application/json+a2ui'}}]}}, final: false}})}\r\n\r\n`;
    const rest = `: keep-alive\n\nevent: message\ndata: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't', contextId: 'c', status: {state: 'input-required'}, final: false}})}\n\n`;
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write(first);
      finish = () => response.end(rest);
    });
    let sawFirstChunk = false;
    const answer = send(proxy, {
      method: 'POST',
      path: '/',
      body: jsonRpc('message/stream', {message: userMessage}),
      onData: () => (sawFirstChunk = true),
    });
    // The relayed bytes and the notification take separate paths, so under load either may land first.
    const deadline = Date.now() + 5000;
    while (
      !sawFirstChunk ||
      !notifications.some(n => n.type === 'wire_event' && n.event.name === 'wire_output')
    ) {
      assert.ok(
        Date.now() < deadline,
        'The first chunk and its wire output never arrived while the stream was open.',
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(
      notifications.some(n => n.type === 'turn_closed'),
      false,
    );
    finish();
    assert.equal((await answer).body.toString(), first + rest);
    const {turnEvent, outputs} = await closedTurn(notifications);
    assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'waiting_for_input');
    assert.deepEqual(
      outputs.map(output => output.attributes['a2ui.wire.message'].parts),
      [[{type: 'a2ui', content: surface}], []],
    );
  });

  it('opens a turn for a send at any path, in either A2A version', async () => {
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'a2a-extensions': 'https://a2ui.org/a2a-extension/a2ui/v0.9.1',
      });
      response.end(
        `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {statusUpdate: {taskId: 't', contextId: 'c', status: {state: 'TASK_STATE_COMPLETED'}}}})}\n\n`,
      );
    });
    await send(proxy, {
      method: 'POST',
      path: '/a2a/assistants/one',
      body: jsonRpc('SendStreamingMessage', {
        message: {messageId: 'm', role: 'ROLE_USER', parts: [{text: 'Hi'}]},
      }),
    });
    const {turnEvent} = await closedTurn(notifications);
    assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'completed');
    assert.equal(turnEvent.attributes['a2ui.turn.protocol_version'], 'v0.9.1');
  });

  it('passes other methods and other bodies through without a turn', async () => {
    const {proxy, notifications} = await setUp((_request, body, response) => {
      response.writeHead(200, {'content-type': 'text/plain'});
      response.end(`echo:${body}`);
    });
    for (const body of [jsonRpc('tasks/get', {id: 't'}), 'not json', '[1,2]']) {
      const answer = await send(proxy, {method: 'POST', path: '/', body});
      assert.equal(answer.body.toString(), `echo:${body}`);
    }
    const get = await send(proxy, {path: '/static/image.png?x=1'});
    assert.equal(get.body.toString(), 'echo:');
    assert.deepEqual(notifications, []);
  });

  it("sets Host to the agent's, and forwards the other headers as sent", async () => {
    const {agentPort, proxy, received} = await setUp((_request, _body, response) => {
      response.writeHead(200).end();
    });
    await send(proxy, {
      path: '/',
      headers: {
        host: 'localhost:9821',
        'x-a2a-extensions': 'https://a2ui.org/a2a-extension/a2ui/v0.9',
        authorization: 'Bearer t',
      },
    });
    const headers = received[0];
    assert.equal(headers.host, `127.0.0.1:${agentPort}`);
    assert.equal(headers['x-a2a-extensions'], 'https://a2ui.org/a2a-extension/a2ui/v0.9');
    assert.equal(headers.authorization, 'Bearer t');
    assert.equal(
      Object.keys(headers).some(name => name.startsWith('x-forwarded')),
      false,
    );
  });

  it('relays a compressed reply compressed, and captures it decoded', async () => {
    const reply = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        kind: 'message',
        messageId: 'r',
        role: 'agent',
        parts: [{kind: 'text', text: 'Zipped'}],
      },
    });
    const zipped = gzipSync(reply);
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json', 'content-encoding': 'gzip'});
      response.end(zipped);
    });
    const answer = await send(proxy, {
      method: 'POST',
      body: jsonRpc('message/send', {message: userMessage}),
    });
    assert.equal(answer.headers['content-encoding'], 'gzip');
    assert.deepEqual(answer.body, zipped);
    const {outputs} = await closedTurn(notifications);
    assert.deepEqual(outputs[0].attributes['a2ui.wire.message'].parts, [
      {type: 'text', content: 'Zipped'},
    ]);
  });

  it('answers 502 when the agent cannot be reached, and fails the turn', async () => {
    const notifications: TurnNotification[] = [];
    const proxy = await startWireProxy({
      port: await freePort(),
      agentUrl: new URL(`http://127.0.0.1:${await freePort()}`),
      onTurn: notification => notifications.push(notification),
    });
    proxies.push(proxy);
    const answer = await send(proxy, {
      method: 'POST',
      body: jsonRpc('message/send', {message: userMessage}),
    });
    assert.equal(answer.status, 502);
    const {turnEvent} = await closedTurn(notifications);
    assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'failed');
    assert.equal(turnEvent.status?.code, 2);
    assert.ok(turnEvent.status?.message);
  });

  it('fails the turn when the stream breaks before it ends', async () => {
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write(
        `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't', contextId: 'c', status: {state: 'completed'}, final: true}})}\n\n`,
      );
      setTimeout(() => response.socket?.destroy(), 50);
    });
    await send(proxy, {
      method: 'POST',
      body: jsonRpc('message/stream', {message: userMessage}),
    }).catch(() => undefined);
    const {turnEvent, outputs} = await closedTurn(notifications);
    assert.equal(outputs.length, 1);
    assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'failed');
    assert.ok(turnEvent.status?.message);
  });

  it('fails the turn for a reply that is not 2xx', async () => {
    const {proxy, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(503, {'content-type': 'text/plain'});
      response.end('Unavailable');
    });
    const answer = await send(proxy, {
      method: 'POST',
      body: jsonRpc('message/send', {message: userMessage}),
    });
    assert.equal(answer.status, 503);
    assert.equal(answer.body.toString(), 'Unavailable');
    const {turnEvent} = await closedTurn(notifications);
    assert.deepEqual(turnEvent.status, {code: 2, message: 'HTTP 503 Service Unavailable'});
  });
});
