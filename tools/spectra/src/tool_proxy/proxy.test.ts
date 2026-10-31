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

import {type SseEvent, SseParser} from '../a2a/sse.js';
import type {CallNotification} from '../model_proxy/proxy.js';
import type {CallToPlace, PlacedCall, Unplaced} from '../placement.js';
import type {CallEvent, ToolCallEvent} from '../record/turn_record.js';
import {startToolProxy, type ToolProxy} from './proxy.js';
import type {ToolServer} from './servers.js';

const TRACE = 'f'.repeat(32);
const TURN_SPAN = '1'.repeat(16);

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

const servers: Server[] = [];
const proxies: ToolProxy[] = [];
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

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

interface Setup {
  proxy: ToolProxy;
  /** The listener's origin, standing for the tool server's. */
  origin: string;
  serverPort: number;
  ended: ToolCallEvent[];
  notifications: CallNotification[];
  placements: CallToPlace[];
  released: number;
  logs: string[];
  /** Whether calls are placed: set false to leave them unplaced, as before any turn. */
  placing: {on: boolean};
}

/** A fake tool server behind the tool proxy, and a placement that puts every call in one turn while `placing.on`. */
async function setUp(
  handler: Handler,
  {
    path = '/mcp',
    closeGraceMs = undefined as number | undefined,
    port = undefined as number | undefined,
  } = {},
): Promise<Setup> {
  const fake = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => handler(request, body, response));
  });
  servers.push(fake);
  const serverPort = port ?? (await listen(fake));
  const proxyPort = await freePort();
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const server: ToolServer = {
    variable: 'TOOL_URL',
    port: proxyPort,
    proxyOrigin,
    value: `${proxyOrigin}${path}`,
    original: new URL(`http://127.0.0.1:${serverPort}${path}`),
  };
  const setup: Setup = {
    proxy: undefined as unknown as ToolProxy,
    origin: proxyOrigin,
    serverPort,
    ended: [],
    notifications: [],
    placements: [],
    released: 0,
    logs: [],
    placing: {on: true},
  };
  setup.proxy = await startToolProxy({
    servers: [server],
    ...(closeGraceMs !== undefined && {closeGraceMs}),
    place: (call): PlacedCall | Unplaced => {
      setup.placements.push(call);
      if (!setup.placing.on)
        return {line: `${call.what} was not placed in a turn: no turn is open.`};
      return {
        traceId: TRACE,
        parentSpanId: TURN_SPAN,
        ended: (event: CallEvent) => setup.ended.push(event as ToolCallEvent),
        release: () => setup.released++,
      };
    },
    onCall: notification => setup.notifications.push(notification),
    log: line => setup.logs.push(line),
  });
  proxies.push(setup.proxy);
  return setup;
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function send(
  origin: string,
  {
    method = 'POST',
    path = '/mcp',
    headers = {},
    body,
  }: {method?: string; path?: string; headers?: Record<string, string>; body?: string},
): Promise<Answer> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method,
        headers: {
          ...(body !== undefined && {'content-type': 'application/json'}),
          ...headers,
        },
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.once('end', () =>
          resolve({status: response.statusCode ?? 0, headers: response.headers, body: text}),
        );
        response.once('error', reject);
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

/** A JSON-RPC body. */
function rpc(message: Record<string, unknown>): string {
  return JSON.stringify({jsonrpc: '2.0', ...message});
}

/** A stream opened through the proxy, its events gathered as they come. */
interface Stream {
  events: SseEvent[];
  status: number;
  close(): void;
  closed: Promise<void>;
}

function openStream(
  origin: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, origin), {method: 'GET', headers}, response => {
      const parser = new SseParser();
      const stream: Stream = {
        events: [],
        status: response.statusCode ?? 0,
        close: () => request.destroy(),
        closed: new Promise(done => response.once('close', () => done())),
      };
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => stream.events.push(...parser.push(chunk)));
      response.once('error', () => {});
      resolve(stream);
    });
    request.once('error', reject);
    request.end();
  });
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function sse(response: ServerResponse, event: {event?: string; id?: string; data: string}): void {
  response.write(
    `${event.event === undefined ? '' : `event: ${event.event}\n`}${event.id === undefined ? '' : `id: ${event.id}\n`}data: ${event.data}\n\n`,
  );
}

function chunkBodies(event: ToolCallEvent): unknown[] {
  return (event.events ?? []).map(chunk => chunk.attributes?.['a2ui.http.response.chunk.body']);
}

/** A streamable HTTP server: initialize assigns a session, notifications get 202, and tools answer in JSON. */
function streamable(
  extra?: (message: Record<string, unknown>, response: ServerResponse) => boolean,
): Handler {
  return (request, body, response) => {
    if (request.method === 'DELETE') {
      response.writeHead(200).end();
      return;
    }
    const message = JSON.parse(body) as Record<string, unknown>;
    if (extra?.(message, response) === true) return;
    if (message.method === 'initialize') {
      response.writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'S1'});
      response.end(
        rpc({id: message.id, result: {protocolVersion: '2025-06-18', capabilities: {}}}),
      );
    } else if (!('id' in message)) {
      response.writeHead(202).end();
    } else {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(rpc({id: message.id, result: {content: [{type: 'text', text: 'ok'}]}}));
    }
  };
}

describe('the tool proxy over streamable HTTP', () => {
  it('records a tool call with its name, arguments and result, the session and the version from initialize', async () => {
    const setup = await setUp(streamable());
    const init = await send(setup.origin, {
      body: rpc({id: 0, method: 'initialize', params: {protocolVersion: '2025-06-18'}}),
    });
    assert.equal(init.headers['mcp-session-id'], 'S1');
    await send(setup.origin, {
      body: rpc({method: 'notifications/initialized'}),
      headers: {'mcp-session-id': 'S1', 'mcp-protocol-version': '2025-06-18'},
    });
    const answer = await send(setup.origin, {
      body: rpc({id: 1, method: 'tools/call', params: {name: 'echo', arguments: {text: 'hi'}}}),
      headers: {
        'mcp-session-id': 'S1',
        'mcp-protocol-version': '2025-06-18',
        authorization: 'Bearer secret-token',
      },
    });
    assert.equal(JSON.parse(answer.body).result.content[0].text, 'ok');
    await until(() => setup.ended.length === 3, 'three events');
    const [initialize, initialized, call] = setup.ended;

    assert.equal(initialize.name, 'initialize');
    assert.equal(initialize.kind, 3);
    assert.equal(initialize.parentSpanId, TURN_SPAN);
    assert.equal(initialize.attributes['mcp.method.name'], 'initialize');
    assert.equal(initialize.attributes['jsonrpc.request.id'], '0');
    assert.equal(initialize.attributes['mcp.session.id'], 'S1');
    assert.equal(initialize.attributes['mcp.protocol.version'], '2025-06-18');

    assert.equal(initialized.name, 'notifications/initialized');
    assert.equal(initialized.attributes['jsonrpc.request.id'], undefined);
    assert.equal(initialized.attributes['http.response.status_code'], 202);
    assert.deepEqual(initialized.status, {code: 1});

    assert.equal(call.name, 'tools/call echo');
    assert.equal(call.attributes['gen_ai.operation.name'], 'execute_tool');
    assert.equal(call.attributes['gen_ai.tool.name'], 'echo');
    assert.deepEqual(call.attributes['gen_ai.tool.call.arguments'], {text: 'hi'});
    assert.deepEqual(call.attributes['gen_ai.tool.call.result'], {
      content: [{type: 'text', text: 'ok'}],
    });
    assert.equal(call.attributes['mcp.session.id'], 'S1');
    assert.equal(call.attributes['mcp.protocol.version'], '2025-06-18');
    assert.deepEqual(call.attributes['http.request.header.authorization'], ['REMOVED']);
    assert.deepEqual(call.attributes['http.request.header.mcp-session-id'], ['S1']);
    assert.equal(call.attributes['server.port'], setup.serverPort);
    assert.equal(call.attributes['gen_ai.tool.type'], undefined);
    assert.equal(call.attributes['gen_ai.tool.call.id'], undefined);
    assert.deepEqual(call.status, {code: 1});
    assert.doesNotMatch(JSON.stringify(setup.ended), /secret-token/);
    assert.doesNotMatch(JSON.stringify(setup.notifications), /secret-token/);
  });

  it('names resources/read by its URI and prompts/get by its prompt', async () => {
    const setup = await setUp(streamable());
    await send(setup.origin, {
      body: rpc({id: 1, method: 'resources/read', params: {uri: 'ui://plan/map'}}),
    });
    await send(setup.origin, {body: rpc({id: 2, method: 'prompts/get', params: {name: 'greet'}})});
    await until(() => setup.ended.length === 2, 'two events');
    assert.equal(setup.ended[0].name, 'resources/read ui://plan/map');
    assert.equal(setup.ended[0].attributes['mcp.resource.uri'], 'ui://plan/map');
    assert.equal(setup.ended[1].name, 'prompts/get greet');
    assert.equal(setup.ended[1].attributes['gen_ai.prompt.name'], 'greet');
  });

  it('records a JSON-RPC error as a failed call and a tool error with its status kept', async () => {
    const setup = await setUp(
      streamable((message, response) => {
        const name = (message.params as {name?: string} | undefined)?.name;
        if (name === 'missing') {
          response.writeHead(200, {'content-type': 'application/json'});
          response.end(
            rpc({id: message.id, error: {code: -32602, message: 'Tool missing not found'}}),
          );
          return true;
        }
        if (name === 'fail') {
          response.writeHead(200, {'content-type': 'application/json'});
          response.end(rpc({id: message.id, result: {content: [], isError: true}}));
          return true;
        }
        return false;
      }),
    );
    await send(setup.origin, {body: rpc({id: 1, method: 'tools/call', params: {name: 'missing'}})});
    await send(setup.origin, {body: rpc({id: 2, method: 'tools/call', params: {name: 'fail'}})});
    await until(() => setup.ended.length === 2, 'two events');
    const [missing, fail] = setup.ended;
    assert.deepEqual(missing.status, {code: 2, message: 'Tool missing not found'});
    assert.equal(missing.attributes['error.type'], '-32602');
    assert.equal(missing.attributes['rpc.response.status_code'], '-32602');
    assert.deepEqual(fail.status, {code: 1});
    assert.equal(fail.attributes['error.type'], 'tool_error');
    assert.equal(fail.attributes['gen_ai.tool.call.result'], undefined);
  });

  it('records a POST answered with a stream as chunks, whatever their method, and the client response to a request in it as its own event', async () => {
    const setup = await setUp(
      streamable((message, response) => {
        if (message.method !== 'tools/call') return false;
        response.writeHead(200, {'content-type': 'text/event-stream'});
        sse(response, {
          data: rpc({method: 'notifications/progress', params: {progressToken: 1, progress: 1}}),
        });
        sse(response, {
          data: rpc({id: 0, method: 'sampling/createMessage', params: {messages: []}}),
        });
        sse(response, {data: rpc({id: message.id, result: {content: []}})});
        response.end();
        return true;
      }),
    );
    const answer = await send(setup.origin, {
      body: rpc({id: 1, method: 'tools/call', params: {name: 'ask', _meta: {progressToken: 1}}}),
    });
    assert.match(answer.body, /sampling\/createMessage/);
    await until(() => setup.ended.length === 1, 'the tool call');
    const [call] = setup.ended;
    assert.equal(call.name, 'tools/call ask');
    assert.equal(call.events?.length, 3);
    assert.equal(call.attributes['a2ui.http.response.body'], undefined);
    assert.deepEqual(call.attributes['gen_ai.tool.call.result'], {content: []});
    const chunks = setup.notifications.filter(n => n.type === 'call_chunk');
    assert.equal(chunks.length, 3);

    await send(setup.origin, {
      body: rpc({id: 0, result: {role: 'assistant', content: {type: 'text', text: 'y'}}}),
    });
    await until(() => setup.ended.length === 2, 'the response');
    const response = setup.ended[1];
    assert.equal(response.name, 'response');
    assert.equal(response.kind, 3);
    assert.equal(response.attributes['jsonrpc.request.id'], '0');
    assert.equal(response.attributes['mcp.method.name'], undefined);
  });

  it('treats a GET stream carrying Mcp-Session-Id as a carrier, and a server notification on it as its own event', async () => {
    let carrier: ServerResponse | undefined;
    const setup = await setUp((request, _body, response) => {
      if (request.method === 'GET') {
        response.writeHead(200, {'content-type': 'text/event-stream'});
        response.flushHeaders();
        carrier = response;
        return;
      }
      response.writeHead(202).end();
    });
    const stream = await openStream(setup.origin, '/mcp', {'mcp-session-id': 'S9'});
    assert.equal(stream.status, 200);
    await until(() => carrier !== undefined, 'the carrier');
    sse(carrier!, {
      data: rpc({method: 'notifications/message', params: {level: 'info', data: 'x'}}),
    });
    await until(() => setup.ended.length === 1, 'the notification');
    assert.equal(setup.released, 1, 'the GET was released as no call');
    const [message] = setup.ended;
    assert.equal(message.name, 'notifications/message');
    assert.equal(message.kind, 4);
    assert.equal(message.startTimeUnixNano, message.endTimeUnixNano);
    assert.equal(message.attributes['mcp.session.id'], 'S9');
    assert.equal(message.attributes['http.request.method'], undefined);
    assert.equal(message.attributes['server.port'], setup.serverPort);
    assert.deepEqual(chunkBodies(message), [
      {jsonrpc: '2.0', method: 'notifications/message', params: {level: 'info', data: 'x'}},
    ]);
    const kinds = setup.notifications.map(n => n.type);
    assert.deepEqual(kinds, ['call_started', 'call_chunk', 'call_ended']);
    stream.close();
  });

  it('records the session end as DELETE, with the session and no method', async () => {
    const setup = await setUp(streamable());
    const answer = await send(setup.origin, {method: 'DELETE', headers: {'mcp-session-id': 'S1'}});
    assert.equal(answer.status, 200);
    await until(() => setup.ended.length === 1, 'the DELETE');
    const [end] = setup.ended;
    assert.equal(end.name, 'DELETE');
    assert.equal(end.attributes['mcp.session.id'], 'S1');
    assert.equal(end.attributes['mcp.method.name'], undefined);
    assert.equal(end.attributes['http.request.method'], 'DELETE');
  });

  it('ends a request the client cancels at the notification, as cancelled', async () => {
    let held: ServerResponse | undefined;
    const setup = await setUp(
      streamable((message, response) => {
        if (message.method !== 'tools/call') return false;
        response.writeHead(200, {'content-type': 'text/event-stream'});
        response.flushHeaders();
        held = response;
        return true;
      }),
    );
    const call = send(setup.origin, {
      body: rpc({id: 7, method: 'tools/call', params: {name: 'slow'}}),
      headers: {'mcp-session-id': 'S1'},
    });
    await until(() => held !== undefined, 'the held call');
    await send(setup.origin, {
      body: rpc({
        method: 'notifications/cancelled',
        params: {requestId: 7, reason: 'User stopped'},
      }),
      headers: {'mcp-session-id': 'S1'},
    });
    await until(() => setup.ended.length === 2, 'the cancel and the notification');
    const cancelled = setup.ended.find(event => event.name === 'tools/call slow');
    assert.ok(cancelled !== undefined);
    assert.equal(cancelled.attributes['error.type'], 'cancelled');
    assert.deepEqual(cancelled.status, {code: 2, message: 'User stopped'});
    held!.end();
    await call;
  });

  it('places by the traceparent header, else by the trace context in params._meta', async () => {
    const setup = await setUp(streamable());
    const meta = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';
    const own = '00-' + 'c'.repeat(32) + '-' + 'd'.repeat(16) + '-01';
    await send(setup.origin, {
      body: rpc({id: 1, method: 'tools/call', params: {name: 'echo', _meta: {traceparent: meta}}}),
    });
    await send(setup.origin, {
      body: rpc({id: 2, method: 'tools/call', params: {name: 'echo', _meta: {traceparent: meta}}}),
      headers: {traceparent: own},
    });
    assert.equal(setup.placements[0].traceparent, meta);
    assert.equal(setup.placements[1].traceparent, own);
  });

  it('forwards housekeeping before any turn unrecorded, one line each, and remembers the session from it', async () => {
    const setup = await setUp(streamable());
    setup.placing.on = false;
    await send(setup.origin, {body: rpc({id: 0, method: 'initialize', params: {}})});
    assert.equal(setup.logs.length, 1);
    assert.match(setup.logs[0], /initialize/);
    setup.placing.on = true;
    await send(setup.origin, {
      body: rpc({id: 1, method: 'tools/list'}),
      headers: {'mcp-session-id': 'S1'},
    });
    await until(() => setup.ended.length === 1, 'the tools/list');
    assert.equal(setup.ended[0].attributes['mcp.protocol.version'], '2025-06-18');
    assert.equal(setup.ended[0].attributes['mcp.session.id'], 'S1');
  });

  it('reads a JSON-RPC batch as an HTTP tool request, raw', async () => {
    const setup = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('[]');
    });
    await send(setup.origin, {body: JSON.stringify([{jsonrpc: '2.0', id: 1, method: 'ping'}])});
    await until(() => setup.ended.length === 1, 'the request');
    assert.equal(setup.ended[0].name, 'POST /mcp');
    assert.equal(setup.ended[0].attributes['mcp.method.name'], undefined);
  });
});

/** An HTTP+SSE server: a GET opens the carrier with its relative endpoint, each POST gets 202 and its reply on the carrier. */
function httpSse(
  options: {
    endpoint?: string;
    onPost?: (message: Record<string, unknown>, carrier: ServerResponse) => boolean;
  } = {},
): {handler: Handler; carrier: () => ServerResponse | undefined} {
  let carrier: ServerResponse | undefined;
  return {
    carrier: () => carrier,
    handler: (request, body, response) => {
      if (request.method === 'GET' && request.url === '/sse') {
        response.writeHead(200, {'content-type': 'text/event-stream'});
        carrier = response;
        sse(response, {event: 'endpoint', data: options.endpoint ?? '/messages/?session_id=abc'});
        return;
      }
      const message = JSON.parse(body) as Record<string, unknown>;
      response.writeHead(202, {'content-type': 'text/plain; charset=utf-8'});
      response.end('Accepted');
      if (carrier === undefined || options.onPost?.(message, carrier) === true) return;
      if (message.method === 'initialize') {
        sse(carrier, {
          event: 'message',
          data: rpc({id: message.id, result: {protocolVersion: '2025-11-25', capabilities: {}}}),
        });
      } else if ('id' in message && 'method' in message) {
        sse(carrier, {event: 'message', data: rpc({id: message.id, result: {contents: []}})});
      }
    },
  };
}

describe('the tool proxy over HTTP+SSE', () => {
  it("starts initialize at the carrier's opening with the endpoint inside it, and puts each reply on its request", async () => {
    const server = httpSse();
    const setup = await setUp(server.handler, {path: '/sse'});
    const stream = await openStream(setup.origin, '/sse');
    await until(() => stream.events.length === 1, 'the endpoint');
    assert.deepEqual(stream.events[0], {event: 'endpoint', data: '/messages/?session_id=abc'});
    const path = '/messages/?session_id=abc';
    await send(setup.origin, {path, body: rpc({id: 0, method: 'initialize', params: {}})});
    await until(() => setup.ended.length === 1, 'initialize');
    await send(setup.origin, {path, body: rpc({method: 'notifications/initialized'})});
    await send(setup.origin, {
      path,
      body: rpc({id: 1, method: 'resources/read', params: {uri: 'ui://floor-plan-server/map'}}),
    });
    await until(() => setup.ended.length === 3, 'three events');
    assert.equal(setup.released, 1, 'the carrier was released as no call');
    const [initialize, initialized, read] = setup.ended;

    assert.equal(initialize.name, 'initialize');
    assert.equal(initialize.attributes['mcp.session.id'], 'abc');
    assert.equal(initialize.attributes['mcp.protocol.version'], '2025-11-25');
    assert.equal(initialize.attributes['http.response.status_code'], 202);
    assert.equal(initialize.attributes['a2ui.http.response.body'], 'Accepted');
    assert.match(String(initialize.attributes['url.full']), /\/messages\/\?session_id=abc$/);
    assert.deepEqual(
      (initialize.events ?? []).map(chunk => chunk.attributes?.['a2ui.http.response.chunk.event']),
      ['endpoint', 'message'],
    );
    assert.equal(chunkBodies(initialize)[0], '/messages/?session_id=abc');
    assert.ok(
      BigInt(initialize.startTimeUnixNano) <= BigInt(initialize.events![0].timeUnixNano),
      'initialize starts before its endpoint chunk',
    );
    assert.equal(initialize.endTimeUnixNano, initialize.events![1].timeUnixNano);

    assert.equal(initialized.name, 'notifications/initialized');
    assert.equal(initialized.events, undefined);
    assert.equal(initialized.attributes['mcp.protocol.version'], '2025-11-25');

    assert.equal(read.name, 'resources/read ui://floor-plan-server/map');
    assert.deepEqual(chunkBodies(read), [{jsonrpc: '2.0', id: 1, result: {contents: []}}]);
    assert.deepEqual(read.status, {code: 1});
    stream.close();
  });

  it('attaches progress to its request, and makes other server messages events of their own', async () => {
    let asked: ServerResponse | undefined;
    const server = httpSse({
      onPost: (message, carrier) => {
        if (message.method !== 'tools/call') return false;
        sse(carrier, {
          event: 'message',
          data: rpc({method: 'notifications/progress', params: {progressToken: 'p1', progress: 1}}),
        });
        sse(carrier, {
          event: 'message',
          data: rpc({method: 'notifications/message', params: {level: 'info', data: 'working'}}),
        });
        sse(carrier, {
          event: 'message',
          data: rpc({id: 5, method: 'sampling/createMessage', params: {}}),
        });
        asked = carrier;
        return true;
      },
    });
    const setup = await setUp(server.handler, {path: '/sse'});
    const stream = await openStream(setup.origin, '/sse');
    await until(() => stream.events.length === 1, 'the endpoint');
    const path = '/messages/?session_id=abc';
    await send(setup.origin, {
      path,
      body: rpc({
        id: 3,
        method: 'tools/call',
        params: {name: 'work', _meta: {progressToken: 'p1'}},
      }),
    });
    await until(() => setup.ended.length === 1, 'the notification');
    const [notification] = setup.ended;
    assert.equal(notification.name, 'notifications/message');
    assert.equal(notification.kind, 4);

    await until(() => asked !== undefined && stream.events.length === 4, 'the server request');
    await send(setup.origin, {
      path,
      body: rpc({id: 5, result: {role: 'assistant', content: {type: 'text', text: 'ok'}}}),
    });
    await until(() => setup.ended.length === 2, 'the server request');
    const request = setup.ended[1];
    assert.equal(request.name, 'sampling/createMessage');
    assert.equal(request.kind, 4);
    assert.equal(request.attributes['jsonrpc.request.id'], '5');
    assert.equal(request.attributes['http.request.method'], 'POST');
    assert.equal(request.attributes['http.response.status_code'], 202);
    assert.deepEqual(request.attributes['a2ui.http.request.body'], {
      jsonrpc: '2.0',
      id: 5,
      result: {role: 'assistant', content: {type: 'text', text: 'ok'}},
    });
    assert.equal(chunkBodies(request).length, 1);

    sse(asked!, {
      event: 'message',
      data: rpc({id: 3, result: {content: [{type: 'text', text: 'done'}]}}),
    });
    await until(() => setup.ended.length === 3, 'the tool call');
    const call = setup.ended[2];
    assert.equal(call.name, 'tools/call work');
    assert.equal(chunkBodies(call).length, 2, 'the progress and the reply');
    assert.deepEqual(call.attributes['gen_ai.tool.call.result'], {
      content: [{type: 'text', text: 'done'}],
    });
    stream.close();
  });

  it('ends a request whose carrier closes as aborted', async () => {
    const server = httpSse({onPost: message => message.method === 'tools/call'});
    const setup = await setUp(server.handler, {path: '/sse'});
    const stream = await openStream(setup.origin, '/sse');
    await until(() => stream.events.length === 1, 'the endpoint');
    await send(setup.origin, {
      path: '/messages/?session_id=abc',
      body: rpc({id: 1, method: 'tools/call', params: {name: 'never'}}),
    });
    server.carrier()!.end();
    await until(() => setup.ended.length === 1, 'the aborted call');
    assert.equal(setup.ended[0].attributes['error.type'], 'aborted');
    assert.equal(setup.ended[0].status?.code, 2);
    stream.close();
  });

  it('leaves no event for a carrier closed before any request, with one line', async () => {
    const server = httpSse();
    const setup = await setUp(server.handler, {path: '/sse'});
    const stream = await openStream(setup.origin, '/sse');
    await until(() => stream.events.length === 1, 'the endpoint');
    stream.close();
    await until(() => setup.logs.length === 1, 'the line');
    assert.match(setup.logs[0], /closed an HTTP\+SSE stream before any request was posted/);
    assert.deepEqual(setup.ended, []);
    assert.equal(setup.released, 1);
  });

  it('passes an absolute endpoint on unchanged and says so once', async () => {
    const server = httpSse({endpoint: 'http://127.0.0.1:1/messages/?session_id=x'});
    const setup = await setUp(server.handler, {path: '/sse'});
    const first = await openStream(setup.origin, '/sse');
    const second = await openStream(setup.origin, '/sse');
    await until(() => first.events.length === 1 && second.events.length === 1, 'the endpoints');
    assert.equal(first.events[0].data, 'http://127.0.0.1:1/messages/?session_id=x');
    assert.equal(setup.logs.length, 1);
    assert.match(
      setup.logs[0],
      /announces an absolute endpoint.*will not pass through the tool proxy/,
    );
    first.close();
    second.close();
  });
});

describe('the tool proxy for HTTP tools', () => {
  it('records each request raw, named by its method and path without the query', async () => {
    const setup = await setUp((request, _body, response) => {
      if (request.url?.startsWith('/api/json')) {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end('{"ok": true}');
      } else if (request.url === '/api/events') {
        response.writeHead(200, {'content-type': 'text/event-stream'});
        sse(response, {event: 'tick', data: '{"n": 1}'});
        sse(response, {data: 'two'});
        response.end();
      } else {
        response.writeHead(404, {'content-type': 'text/plain'});
        response.end('Not found');
      }
    });
    await send(setup.origin, {method: 'GET', path: '/api/json?api_key=secret&q=1'});
    await send(setup.origin, {path: '/api/json', body: '{"x": 1}'});
    await send(setup.origin, {method: 'GET', path: '/api/events'});
    await send(setup.origin, {method: 'GET', path: '/nowhere'});
    await until(() => setup.ended.length === 4, 'four requests');
    const [get, post, events, missing] = setup.ended;
    assert.equal(get.name, 'GET /api/json');
    assert.match(String(get.attributes['url.full']), /api_key=REMOVED&q=1$/);
    assert.deepEqual(get.attributes['a2ui.http.response.body'], {ok: true});
    assert.ok(!Object.keys(get.attributes).some(name => /^(gen_ai|mcp)\./.test(name)));
    assert.equal(post.name, 'POST /api/json');
    assert.deepEqual(post.attributes['a2ui.http.request.body'], {x: 1});
    assert.equal(events.name, 'GET /api/events');
    assert.deepEqual(chunkBodies(events), [{n: 1}, 'two']);
    assert.equal(missing.name, 'GET /nowhere');
    assert.deepEqual(missing.status, {code: 2});
    assert.equal(missing.attributes['error.type'], '404');
    assert.doesNotMatch(JSON.stringify(setup.ended), /secret/);
  });

  it('answers 502 naming the tool proxy when the server cannot be reached', async () => {
    const setup = await setUp(() => {}, {port: await freePort()});
    const answer = await send(setup.origin, {
      body: rpc({id: 1, method: 'tools/call', params: {name: 'echo'}}),
    });
    assert.equal(answer.status, 502);
    assert.match(answer.body, /tool proxy could not reach/);
    await until(() => setup.ended.length === 1, 'the failed call');
    assert.equal(setup.ended[0].attributes['error.type'], 'ECONNREFUSED');
    assert.equal(setup.ended[0].status?.code, 2);
  });

  it('passes a token request on unrecorded, with one line', async () => {
    const setup = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"access_token": "t"}');
    });
    const answer = await send(setup.origin, {
      path: '/oauth/token',
      body: 'grant_type=authorization_code&code=c',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
    });
    assert.equal(answer.body, '{"access_token": "t"}');
    assert.deepEqual(setup.placements, []);
    assert.deepEqual(setup.ended, []);
    assert.match(setup.logs[0], /token request.*passed on unrecorded/);
  });

  it('ends a call still open when Spectra stops as aborted', async () => {
    const setup = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.flushHeaders();
    });
    void send(setup.origin, {path: '/slow', body: '{}'}).catch(() => {});
    await until(() => setup.notifications.length === 1, 'the start');
    await setup.proxy.close();
    await until(() => setup.ended.length === 1, 'the aborted call');
    assert.equal(setup.ended[0].attributes['error.type'], 'aborted');
  });
});
