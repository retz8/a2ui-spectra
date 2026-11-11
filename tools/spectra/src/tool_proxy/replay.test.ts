import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingHttpHeaders,
  request as httpRequest,
  type Server,
} from 'node:http';
import {after, describe, it} from 'node:test';

import {type SseEvent, SseParser} from '../a2a/sse.js';
import type {PlacedCall} from '../placement.js';
import type {SpanEvent, ToolCallEvent, TurnRecord} from '../record/turn_record.js';
import {type PoolMode, ReplayPool} from '../replay/pool.js';
import {startToolProxy, type ToolProxy} from './proxy.js';

const TRACE = 'f'.repeat(32);
const TURN_SPAN = '1'.repeat(16);
const SESSION = 'recorded-session';

const proxies: ToolProxy[] = [];
after(async () => {
  await Promise.all(proxies.map(proxy => proxy.close()));
});

async function freePort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise(resolve => server.close(resolve));
  return typeof address === 'object' && address !== null ? address.port : 0;
}

interface Setup {
  proxy: ToolProxy;
  origin: string;
  /** Where the original would be: nothing listens there. */
  original: string;
  ended: ToolCallEvent[];
  logs: string[];
}

async function setUp(path = '/mcp'): Promise<Setup> {
  const original = `http://127.0.0.1:${await freePort()}`;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const ended: ToolCallEvent[] = [];
  const logs: string[] = [];
  const proxy = await startToolProxy({
    servers: [
      {
        variable: 'TOOL_URL',
        port,
        proxyOrigin: origin,
        value: `${origin}${path}`,
        original: new URL(`${original}${path}`),
      },
    ],
    place: (): PlacedCall => ({
      traceId: TRACE,
      parentSpanId: TURN_SPAN,
      ended: event => ended.push(event as ToolCallEvent),
      release: () => {},
    }),
    log: line => logs.push(line),
  });
  proxies.push(proxy);
  return {proxy, origin, original, ended, logs};
}

function arm(setup: Setup, mode: PoolMode, ...calls: ToolCallEvent[]): void {
  const record: TurnRecord = {
    version: 'v0.1',
    turns: [
      {
        events: [
          {
            traceId: TRACE,
            spanId: TURN_SPAN,
            name: 'invoke_agent',
            kind: 3,
            startTimeUnixNano: '1',
            endTimeUnixNano: '9',
            attributes: {
              'a2ui.event.kind': 'turn',
              'gen_ai.operation.name': 'invoke_agent',
              'a2ui.turn.outcome': 'completed',
              'a2ui.turn.capture_paths': ['wire', 'tool_proxy'],
              'a2ui.turn.writer.name': 'a2ui-spectra',
              'a2ui.turn.writer.version': '0.0.0',
            },
            status: {code: 1},
          },
          ...calls,
        ],
      },
    ],
  };
  setup.proxy.arm(new ReplayPool(record, mode));
}

function chunk(body: unknown, event = 'message'): SpanEvent {
  return {
    timeUnixNano: '2',
    name: 'a2ui.http.response.chunk',
    attributes: {'a2ui.http.response.chunk.body': body, 'a2ui.http.response.chunk.event': event},
  };
}

/** A recorded MCP request's event: its message, its exchange's response, and its chunks. */
function recordedRequest(
  spanId: string,
  url: string,
  message: Record<string, unknown>,
  response: Record<string, unknown>,
  events?: SpanEvent[],
): ToolCallEvent {
  return {
    traceId: 'a'.repeat(32),
    spanId,
    parentSpanId: 'b'.repeat(16),
    name: String(message.method),
    kind: 3,
    startTimeUnixNano: '2',
    endTimeUnixNano: '3',
    attributes: {
      'a2ui.event.kind': 'tool_call',
      'mcp.method.name': String(message.method),
      'jsonrpc.request.id': String(message.id),
      'http.request.method': 'POST',
      'url.full': url,
      'a2ui.http.request.body': {jsonrpc: '2.0', ...message},
      ...response,
    },
    ...(events !== undefined && {events}),
    status: {code: 1},
  };
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
  }: {method?: string; path?: string; headers?: Record<string, string>; body?: unknown},
): Promise<Answer> {
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      url,
      {
        method,
        headers: {
          ...(body !== undefined && {'content-type': 'application/json'}),
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (piece: string) => (text += piece));
        response.once('end', () =>
          resolve({status: response.statusCode ?? 0, headers: response.headers, body: text}),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** A `GET` stream: its status, the events it gave so far, and when it closed. */
interface Stream {
  status: number;
  headers: IncomingHttpHeaders;
  events: SseEvent[];
  closed: Promise<void>;
  close(): void;
}

function openStream(
  origin: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      new URL(path, origin),
      {headers: {accept: 'text/event-stream', ...headers}},
      response => {
        const parser = new SseParser();
        const events: SseEvent[] = [];
        response.setEncoding('utf8');
        response.on('data', (piece: string) => events.push(...parser.push(piece)));
        const closed = new Promise<void>(done => response.once('close', () => done()));
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          events,
          closed,
          close: () => outgoing.destroy(),
        });
      },
    );
    outgoing.once('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    outgoing.end();
  });
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, what);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('the tool proxy in replay', () => {
  it("serves a recorded request with the response's id rewritten to the live request's, and nothing else touched", async () => {
    const setup = await setUp();
    const result = {content: [{type: 'text', text: 'hello'}], id: 7};
    arm(
      setup,
      'recorded',
      recordedRequest(
        '00000000000000a1',
        `${setup.original}/mcp`,
        {method: 'tools/call', id: 7, params: {name: 'echo', arguments: {text: 'hello'}}},
        {
          'http.response.status_code': 200,
          'http.response.header.content-type': ['application/json'],
          'http.response.header.mcp-session-id': [SESSION],
          'a2ui.http.response.body': {jsonrpc: '2.0', id: 7, result},
        },
      ),
    );
    const answer = await send(setup.origin, {
      body: {
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: {name: 'echo', arguments: {text: 'hello'}, _meta: {traceparent: '00-x-y-01'}},
      },
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers['mcp-session-id'], SESSION, 'the session as recorded');
    assert.deepEqual(JSON.parse(answer.body), {jsonrpc: '2.0', id: 0, result});
    await eventually(() => setup.ended.length === 1, 'the call ended');
    assert.equal(setup.ended[0].attributes['a2ui.replay.served_from'], '00000000000000a1');
    assert.deepEqual(setup.ended[0].attributes['gen_ai.tool.call.result'], result);
  });

  it("rewrites each progress notification's token to the live request's, and leaves it when none was asked", async () => {
    const setup = await setUp();
    const call = () =>
      recordedRequest(
        '00000000000000b1',
        `${setup.original}/mcp`,
        {
          method: 'tools/call',
          id: 7,
          params: {name: 'progress', arguments: {}, _meta: {progressToken: 7}},
        },
        {
          'http.response.status_code': 200,
          'http.response.header.content-type': ['text/event-stream'],
        },
        [
          chunk({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {progressToken: 7, progress: 1},
          }),
          chunk({
            jsonrpc: '2.0',
            method: 'notifications/message',
            params: {level: 'info', data: 'x'},
          }),
          chunk({jsonrpc: '2.0', id: 7, result: {content: []}}),
        ],
      );
    const read = (answer: Answer) =>
      new SseParser()
        .push(answer.body)
        .map(event => JSON.parse(event.data) as Record<string, unknown>);
    arm(setup, 'recorded', call(), call());
    const asked = read(
      await send(setup.origin, {
        body: {
          jsonrpc: '2.0',
          id: 'r-3',
          method: 'tools/call',
          params: {name: 'progress', arguments: {}, _meta: {progressToken: 'p-3'}},
        },
      }),
    );
    assert.deepEqual(asked[0].params, {progressToken: 'p-3', progress: 1});
    assert.deepEqual(asked[1].params, {level: 'info', data: 'x'}, 'another notification untouched');
    assert.equal(asked[2].id, 'r-3');
    const unasked = read(
      await send(setup.origin, {
        body: {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {name: 'progress', arguments: {}},
        },
      }),
    );
    assert.deepEqual(unasked[0].params, {progressToken: 7, progress: 1}, 'as recorded');
    assert.equal(unasked[2].id, 4);
  });

  it('answers what the protocol fixes with no record: a notification, a ping, a response the client posts', async () => {
    const setup = await setUp();
    arm(setup, 'recorded');
    const notified = await send(setup.origin, {
      body: {jsonrpc: '2.0', method: 'notifications/initialized'},
    });
    assert.deepEqual([notified.status, notified.body], [202, '']);
    const pinged = await send(setup.origin, {body: {jsonrpc: '2.0', id: 5, method: 'ping'}});
    assert.equal(pinged.status, 200);
    assert.deepEqual(JSON.parse(pinged.body), {jsonrpc: '2.0', id: 5, result: {}});
    const responded = await send(setup.origin, {body: {jsonrpc: '2.0', id: 0, result: {}}});
    assert.deepEqual([responded.status, responded.body], [202, '']);
    await eventually(() => setup.ended.length === 3, 'all three ended');
    for (const event of setup.ended) {
      assert.equal(
        event.attributes['a2ui.replay.served_from'],
        undefined,
        `${event.name} served by none`,
      );
      assert.equal(event.status?.code, 1);
    }
    assert.deepEqual(setup.logs, []);
  });

  it('misses housekeeping the record never saw, in either mode', async () => {
    const setup = await setUp();
    arm(setup, 'model_live');
    const answer = await send(setup.origin, {body: {jsonrpc: '2.0', id: 1, method: 'tools/list'}});
    const line =
      "a2ui-spectra's tool proxy is replaying, and POST /mcp matched nothing in the record.";
    assert.equal(answer.status, 502);
    assert.equal(answer.body, `${line}\n`);
    assert.deepEqual(setup.logs, [line]);
    await eventually(() => setup.ended.length === 1, 'the miss ended');
    assert.equal(setup.ended[0].attributes['error.type'], 'replay_miss');
    assert.equal(setup.ended[0].attributes['mcp.method.name'], 'tools/list');
  });

  it('answers a session end as recorded, or with 204 when the record has none', async () => {
    const setup = await setUp();
    arm(setup, 'recorded');
    const none = await send(setup.origin, {method: 'DELETE', headers: {'mcp-session-id': SESSION}});
    assert.equal(none.status, 204);
    const end: ToolCallEvent = {
      ...recordedRequest(
        '00000000000000c1',
        `${setup.original}/mcp`,
        {},
        {'http.response.status_code': 200},
      ),
      name: 'DELETE',
    };
    delete end.attributes['mcp.method.name'];
    delete end.attributes['jsonrpc.request.id'];
    end.attributes['http.request.method'] = 'DELETE';
    arm(setup, 'recorded', end);
    const recordedEnd = await send(setup.origin, {
      method: 'DELETE',
      headers: {'mcp-session-id': SESSION},
    });
    assert.equal(recordedEnd.status, 200);
    await eventually(() => setup.ended.length === 2, 'both ended');
    assert.equal(setup.ended[0].attributes['a2ui.replay.served_from'], undefined);
    assert.equal(setup.ended[1].attributes['a2ui.replay.served_from'], '00000000000000c1');
  });

  it('reads a GET: a recorded HTTP tool, a streamable HTTP carrier held open, else a miss', async () => {
    const setup = await setUp('/');
    const tool: ToolCallEvent = {
      ...recordedRequest(
        '00000000000000d1',
        `${setup.original}/api/json?q=1`,
        {},
        {
          'http.response.status_code': 200,
          'http.response.header.content-type': ['application/json'],
          'a2ui.http.response.body': {ok: true},
        },
      ),
      name: 'GET /api/json',
    };
    delete tool.attributes['mcp.method.name'];
    delete tool.attributes['jsonrpc.request.id'];
    delete tool.attributes['a2ui.http.request.body'];
    tool.attributes['http.request.method'] = 'GET';
    arm(setup, 'recorded', tool);
    const served = await send(setup.origin, {method: 'GET', path: '/api/json?q=1'});
    assert.deepEqual([served.status, JSON.parse(served.body)], [200, {ok: true}]);

    const carrier = await openStream(setup.origin, '/mcp', {'mcp-session-id': SESSION});
    assert.equal(carrier.status, 200);
    assert.equal(carrier.headers['content-type'], 'text/event-stream');

    const missed = await send(setup.origin, {method: 'GET', path: '/elsewhere'});
    assert.equal(missed.status, 502);
    assert.match(missed.body, /and GET \/elsewhere matched nothing in the record\.\n$/);

    setup.proxy.disarm();
    await carrier.closed;
    assert.deepEqual(carrier.events, [], 'nothing was written on the carrier');
    await eventually(() => setup.ended.length === 2, 'the tool call and the miss ended');
    assert.deepEqual(
      setup.ended.map(event => [event.name, event.attributes['error.type']]),
      [
        ['GET /api/json', undefined],
        ['GET /elsewhere', 'replay_miss'],
      ],
    );
  });

  it("opens an HTTP+SSE carrier with the recorded endpoint, writes a served reply on it with the live id, and a miss's JSON-RPC error", async () => {
    const setup = await setUp('/sse');
    const initialize = recordedRequest(
      '00000000000000e1',
      `${setup.original}/messages?sessionId=s1`,
      {method: 'initialize', id: 9, params: {protocolVersion: '2025-11-25'}},
      {'http.response.status_code': 202, 'a2ui.mcp.stream.url': `${setup.original}/sse`},
      [
        chunk('/messages?sessionId=s1', 'endpoint'),
        chunk({jsonrpc: '2.0', id: 9, result: {protocolVersion: '2025-11-25', capabilities: {}}}),
      ],
    );
    arm(setup, 'recorded', initialize);
    const carrier = await openStream(setup.origin, '/sse');
    await eventually(() => carrier.events.length === 1, 'the endpoint event');
    assert.deepEqual(carrier.events[0], {event: 'endpoint', data: '/messages?sessionId=s1'});

    const posted = await send(setup.origin, {
      path: '/messages?sessionId=s1',
      body: {jsonrpc: '2.0', id: 0, method: 'initialize', params: {protocolVersion: '2025-11-25'}},
    });
    assert.equal(posted.status, 202);
    await eventually(() => carrier.events.length === 2, 'the reply on the carrier');
    assert.equal(carrier.events[1].event, 'message');
    assert.equal((JSON.parse(carrier.events[1].data) as {id: unknown}).id, 0);

    const missed = await send(setup.origin, {
      path: '/messages?sessionId=s1',
      body: {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'echo', arguments: {}}},
    });
    assert.equal(missed.status, 502, 'the POST itself gets the 502');
    await eventually(() => setup.ended.length === 2, 'initialize and the miss ended');
    // The client waits for its reply on the carrier: the miss's JSON-RPC error goes there.
    await eventually(() => carrier.events.length === 3, "the miss's error on the carrier");
    assert.equal(carrier.events[2].event, 'message');
    assert.deepEqual(JSON.parse(carrier.events[2].data), {
      jsonrpc: '2.0',
      id: 1,
      error: {code: -32603, message: missed.body.trim()},
    });
    assert.equal(setup.ended[1].attributes['error.type'], 'replay_miss');
    assert.equal(setup.ended[1].events, undefined, 'the error on the carrier is not recorded');

    const [opened] = setup.ended;
    assert.equal(opened.name, 'initialize');
    assert.equal(opened.attributes['mcp.session.id'], 's1');
    assert.equal(opened.attributes['a2ui.replay.served_from'], '00000000000000e1');
    assert.deepEqual(
      opened.events?.map(event => event.attributes?.['a2ui.http.response.chunk.event']),
      ['endpoint', 'message'],
      'the endpoint event first, then the reply',
    );
    carrier.close();
  });
});
