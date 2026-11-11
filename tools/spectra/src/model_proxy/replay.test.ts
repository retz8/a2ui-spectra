import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingHttpHeaders,
  request as httpRequest,
  type Server,
} from 'node:http';
import {after, describe, it} from 'node:test';

import type {PlacedCall} from '../placement.js';
import type {ModelCallEvent, TurnRecord} from '../record/turn_record.js';
import {ReplayPool, type PoolMode} from '../replay/pool.js';
import {type ModelProxy, startModelProxy} from './proxy.js';
import {type Redirection, redirections} from './redirection.js';

const TRACE = 'f'.repeat(32);
const TURN_SPAN = '1'.repeat(16);

const servers: Server[] = [];
const proxies: ModelProxy[] = [];
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
  proxy: ModelProxy;
  origin: string;
  /** The bodies the provider received. */
  received: string[];
  ended: ModelCallEvent[];
  logs: string[];
}

const request = {
  model: 'claude-sonnet-4-5',
  max_tokens: 100,
  messages: [{role: 'user', content: 'Hi'}],
};
const reply = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{type: 'text', text: 'Hello.'}],
  stop_reason: 'end_turn',
  usage: {input_tokens: 8, output_tokens: 3},
};

/** A provider that answers every request live, and the proxy in front of it, read as Anthropic's host. */
async function setUp(): Promise<Setup> {
  const received: string[] = [];
  const provider = createServer((incoming, response) => {
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk: string) => (body += chunk));
    incoming.on('end', () => {
      received.push(body);
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({...reply, id: 'msg_live'}));
    });
  });
  servers.push(provider);
  const origin = `http://127.0.0.1:${await listen(provider)}`;
  const ended: ModelCallEvent[] = [];
  const logs: string[] = [];
  const port = await freePort();
  const list: Redirection[] = redirections({}, `http://127.0.0.1:${port}`).map(item => ({
    ...item,
    target: {kind: 'base', base: origin},
  }));
  const proxy = await startModelProxy({
    port,
    redirections: list,
    standInOrigin: origin,
    place: (): PlacedCall => ({
      traceId: TRACE,
      parentSpanId: TURN_SPAN,
      ended: event => ended.push(event as ModelCallEvent),
      release: () => {},
    }),
    log: line => logs.push(line),
  });
  proxies.push(proxy);
  return {proxy, origin, received, ended, logs};
}

/** A record of one turn holding these calls. */
function recordOf(...calls: ModelCallEvent[]): TurnRecord {
  return {
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
              'a2ui.turn.capture_paths': ['wire', 'model_proxy'],
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
}

/** A recorded call to the Messages API at `origin`, its request `request` unless given. */
function recorded(
  origin: string,
  spanId: string,
  response: Record<string, unknown>,
  extra: Partial<ModelCallEvent> = {},
  body: unknown = request,
): ModelCallEvent {
  return {
    traceId: 'a'.repeat(32),
    spanId,
    parentSpanId: 'b'.repeat(16),
    name: 'chat claude-sonnet-4-5',
    kind: 3,
    startTimeUnixNano: '2',
    endTimeUnixNano: '3',
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'url.full': `${origin}/v1/messages`,
      'http.request.header.x-api-key': ['REMOVED'],
      'a2ui.http.request.body': body,
      ...response,
    },
    status: {code: 1},
    ...extra,
  };
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  brokenOff: boolean;
}

function post(
  proxy: ModelProxy,
  body: unknown,
  path = '/ANTHROPIC_BASE_URL/v1/messages',
): Promise<Answer> {
  const origin = new URL(proxy.origin);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: origin.hostname,
        port: origin.port,
        method: 'POST',
        path,
        headers: {'content-type': 'application/json', 'x-api-key': 'sk-live-secret'},
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        const answer = (brokenOff: boolean) =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text,
            brokenOff,
          });
        response.on('data', (chunk: string) => (text += chunk));
        response.once('end', () => answer(false));
        response.once('aborted', () => answer(true));
        response.once('error', () => answer(true));
      },
    );
    outgoing.once('error', reject);
    outgoing.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, what);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function arm(setup: Setup, mode: PoolMode, ...calls: ModelCallEvent[]): void {
  setup.proxy.arm(new ReplayPool(recordOf(...calls), mode));
}

describe('the model proxy in replay', () => {
  it('serves a matching call from the record, its headers less the removed ones, and forwards nothing', async () => {
    const setup = await setUp();
    arm(
      setup,
      'recorded',
      recorded(setup.origin, '00000000000000aa', {
        'http.response.status_code': 200,
        'http.response.header.content-type': ['application/json'],
        'http.response.header.content-encoding': ['gzip'],
        'http.response.header.content-length': ['5'],
        'http.response.header.set-cookie': ['REMOVED'],
        'http.response.header.request-id': ['req_1'],
        'a2ui.http.response.body': reply,
      }),
    );
    const answer = await post(setup.proxy, request);
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), reply);
    assert.equal(answer.headers['request-id'], 'req_1');
    assert.equal(answer.headers['set-cookie'], undefined);
    assert.equal(answer.headers['content-encoding'], undefined);
    assert.equal(answer.headers['content-length'], String(Buffer.byteLength(answer.body)));
    assert.deepEqual(setup.received, [], 'the provider received nothing');
    await eventually(() => setup.ended.length === 1, 'the call ended');
    const [event] = setup.ended;
    assert.equal(event.attributes['a2ui.replay.served_from'], '00000000000000aa');
    assert.equal(
      event.attributes['gen_ai.usage.input_tokens'],
      8,
      'its recorded usage, read again',
    );
    assert.deepEqual(event.attributes['http.request.header.x-api-key'], ['REMOVED']);
    assert.deepEqual(setup.logs, []);
  });

  it('serves a stream as its chunks, and one that broke as its chunks then a broken connection', async () => {
    const setup = await setUp();
    const stream = (spanId: string, failure?: string) =>
      recorded(
        setup.origin,
        spanId,
        {
          'http.response.status_code': 200,
          'http.response.header.content-type': ['text/event-stream'],
          ...(failure !== undefined && {'error.type': failure}),
        },
        {
          events: [
            {
              timeUnixNano: '2',
              name: 'a2ui.http.response.chunk',
              attributes: {
                'a2ui.http.response.chunk.body': {
                  type: 'message_start',
                  message: {...reply, content: []},
                },
                'a2ui.http.response.chunk.event': 'message_start',
              },
            },
          ],
          ...(failure !== undefined && {status: {code: 2, message: 'socket hang up'}}),
        },
      );
    arm(setup, 'recorded', stream('00000000000000a1'), stream('00000000000000a2', 'ECONNRESET'));
    const whole = await post(setup.proxy, request);
    assert.equal(whole.headers['content-type'], 'text/event-stream');
    assert.match(whole.body, /^event: message_start\ndata: \{"type":"message_start"/);
    assert.ok(!whole.brokenOff);
    const broken = await post(setup.proxy, request);
    assert.ok(broken.brokenOff, 'the reply breaks off for the agent');
    assert.match(broken.body, /^event: message_start\n/, 'after its chunks');
    await eventually(() => setup.ended.length === 2, 'both calls ended');
    assert.equal(setup.ended[0].status?.code, 1);
    assert.equal(setup.ended[1].status?.code, 2);
    assert.equal(setup.ended[1].attributes['a2ui.replay.served_from'], '00000000000000a2');
  });

  it("serves a call with no response recorded as the proxy's 502 line, with the recorded failure", async () => {
    const setup = await setUp();
    arm(
      setup,
      'recorded',
      recorded(
        setup.origin,
        '00000000000000b1',
        {'error.type': 'ECONNREFUSED'},
        {status: {code: 2, message: 'connect ECONNREFUSED'}},
      ),
    );
    const answer = await post(setup.proxy, request);
    assert.equal(answer.status, 502);
    assert.match(
      answer.body,
      /model proxy could not reach 127\.0\.0\.1:\d+: connect ECONNREFUSED\n$/,
    );
    await eventually(() => setup.ended.length === 1, 'the call ended');
    assert.equal(setup.ended[0].attributes['error.type'], 'ECONNREFUSED');
    assert.equal(setup.ended[0].attributes['a2ui.replay.served_from'], '00000000000000b1');
  });

  it('answers a miss with a 502 and one line, and records the request with replay_miss and no response', async () => {
    const setup = await setUp();
    arm(
      setup,
      'recorded',
      recorded(setup.origin, '00000000000000c1', {'http.response.status_code': 200}),
    );
    const changed = {...request, messages: [{role: 'user', content: 'Hi there'}]};
    const answer = await post(setup.proxy, changed);
    const line =
      "a2ui-spectra's model proxy is replaying, and POST /v1/messages matched nothing in the record.";
    assert.equal(answer.status, 502);
    assert.equal(answer.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(answer.body, `${line}\n`);
    assert.deepEqual(setup.logs, [line]);
    assert.deepEqual(setup.received, [], 'nothing leaves the machine');
    await eventually(() => setup.ended.length === 1, 'the miss ended');
    const [miss] = setup.ended;
    assert.deepEqual(miss.status, {code: 2, message: line});
    assert.equal(miss.attributes['error.type'], 'replay_miss');
    assert.deepEqual(miss.attributes['a2ui.http.request.body'], changed);
    assert.equal(
      miss.attributes['gen_ai.request.model'],
      'claude-sonnet-4-5',
      'read as any request',
    );
    assert.deepEqual(
      Object.keys(miss.attributes).filter(name => name.startsWith('http.response.')),
      [],
    );
  });

  it('in the live mode sends a miss to the provider, recorded without served_from, and still serves what matches', async () => {
    const setup = await setUp();
    arm(
      setup,
      'model_live',
      recorded(setup.origin, '00000000000000d1', {
        'http.response.status_code': 200,
        'http.response.header.content-type': ['application/json'],
        'a2ui.http.response.body': reply,
      }),
    );
    const changed = {...request, max_tokens: 50};
    const live = await post(setup.proxy, changed);
    assert.equal(JSON.parse(live.body).id, 'msg_live');
    assert.deepEqual(
      setup.received.map(body => JSON.parse(body)),
      [changed],
    );
    const served = await post(setup.proxy, request);
    assert.equal(JSON.parse(served.body).id, 'msg_1');
    assert.equal(setup.received.length, 1, 'the match did not reach the provider');
    await eventually(() => setup.ended.length === 2, 'both calls ended');
    assert.equal(setup.ended[0].attributes['a2ui.replay.served_from'], undefined);
    assert.equal(setup.ended[1].attributes['a2ui.replay.served_from'], '00000000000000d1');
    assert.deepEqual(setup.logs, []);
  });

  it('forwards every call again once disarmed', async () => {
    const setup = await setUp();
    arm(setup, 'recorded');
    assert.equal((await post(setup.proxy, request)).status, 502);
    setup.proxy.disarm();
    const answer = await post(setup.proxy, request);
    assert.equal(JSON.parse(answer.body).id, 'msg_live');
  });

  it('answers a token request with the miss in everything-recorded mode, recording nothing', async () => {
    const setup = await setUp();
    arm(setup, 'recorded');
    const answer = await post(
      setup.proxy,
      {grant_type: 'client_credentials'},
      '/ANTHROPIC_BASE_URL/v1/oauth/token',
    );
    assert.equal(answer.status, 502);
    assert.deepEqual(setup.received, []);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(setup.ended, [], 'a token request is never recorded');
    assert.equal(setup.logs.length, 1);
  });
});
