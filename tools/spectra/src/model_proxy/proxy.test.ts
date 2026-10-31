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

import type {CallToPlace, PlacedCall} from '../placement.js';
import type {ModelCallEvent} from '../record/turn_record.js';
import {type CallNotification, type ModelProxy, startModelProxy} from './proxy.js';
import {type Redirection, redirections} from './redirection.js';

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

const TRACE = 'f'.repeat(32);
const TURN_SPAN = '1'.repeat(16);

interface Setup {
  providerPort: number;
  proxy: ModelProxy;
  /** The headers and bodies of each request the provider received. */
  received: Array<{headers: IncomingHttpHeaders; body: string; url: string}>;
  notifications: CallNotification[];
  /** The complete events handed to the placement, in order. */
  ended: ModelCallEvent[];
  /** The calls the placement was asked for. */
  placements: CallToPlace[];
  logs: string[];
}

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

/**
 * A fake provider behind the proxy, the stand-in's origin so its paths are
 * read as the APIs, and a placement that puts every call in one turn, or
 * none when `place` is false.
 */
async function setUp(handler: Handler, {place = true, standIn = true} = {}): Promise<Setup> {
  const received: Setup['received'] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      received.push({headers: request.headers, body, url: request.url ?? ''});
      handler(request, body, response);
    });
  });
  servers.push(provider);
  const providerPort = await listen(provider);
  const origin = `http://127.0.0.1:${providerPort}`;
  const notifications: CallNotification[] = [];
  const ended: ModelCallEvent[] = [];
  const placements: CallToPlace[] = [];
  const logs: string[] = [];
  const proxyPort = await freePort();
  // Every prefix forwards to the fake provider.
  const list: Redirection[] = redirections({}, `http://127.0.0.1:${proxyPort}`).map(item => ({
    ...item,
    target: {kind: 'base', base: origin},
  }));
  const proxy = await startModelProxy({
    port: proxyPort,
    redirections: list,
    ...(standIn && {standInOrigin: origin}),
    place: call => {
      placements.push(call);
      if (!place) return undefined;
      const placed: PlacedCall = {
        traceId: TRACE,
        parentSpanId: TURN_SPAN,
        ended: event => ended.push(event),
      };
      return placed;
    },
    onCall: notification => notifications.push(notification),
    log: line => logs.push(line),
  });
  proxies.push(proxy);
  return {providerPort, proxy, received, notifications, ended, placements, logs};
}

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  brokenOff: boolean;
}

/** One request through the proxy, read raw. */
function send(
  proxy: ModelProxy,
  {
    method = 'POST',
    path,
    headers = {},
    body,
    onData,
  }: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    onData?: (chunk: Buffer) => void;
  },
): Promise<Answer> {
  const origin = new URL(proxy.origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {host: origin.hostname, port: origin.port, method, path, headers},
      response => {
        const chunks: Buffer[] = [];
        const answer = (brokenOff: boolean) =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
            brokenOff,
          });
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          onData?.(chunk);
        });
        response.once('end', () => answer(false));
        response.once('aborted', () => answer(true));
        response.once('error', () => answer(true));
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, what);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const anthropicRequest = {
  model: 'claude-sonnet-4-5',
  max_tokens: 100,
  messages: [{role: 'user', content: 'Hi'}],
};

const anthropicReply = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5-20250929',
  content: [{type: 'text', text: 'Hello.'}],
  stop_reason: 'end_turn',
  usage: {input_tokens: 8, output_tokens: 3},
};

describe('the model proxy', () => {
  it('forwards a call under a prefix to its target with the rest of the path, headers and body as sent', async () => {
    const {proxy, received} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify(anthropicReply));
    });
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages?beta=true',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-secret',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.toString(), JSON.stringify(anthropicReply));
    assert.equal(received[0].url, '/v1/messages?beta=true');
    assert.equal(received[0].headers['x-api-key'], 'sk-ant-secret', 'the credential is forwarded');
    assert.equal(received[0].headers['anthropic-version'], '2023-06-01');
    assert.match(String(received[0].headers.host), /^127\.0\.0\.1:\d+$/);
    assert.equal(received[0].body, JSON.stringify(anthropicRequest));
  });

  it('answers 404 under no prefix, naming the prefixes', async () => {
    const {proxy, placements} = await setUp((_request, _body, response) =>
      response.writeHead(200).end(),
    );
    const answer = await send(proxy, {path: '/v1/messages', body: '{}'});
    assert.equal(answer.status, 404);
    assert.match(answer.body.toString(), /GOOGLE_GEMINI_BASE_URL/);
    assert.deepEqual(placements, []);
  });

  it('records a call read in full: the exchange with credentials removed, the GenAI names, and the live notifications', async () => {
    const {proxy, ended, notifications, placements, providerPort} = await setUp(
      (_request, _body, response) => {
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 's=1',
          'request-id': 'req_1',
        });
        response.end(JSON.stringify(anthropicReply));
      },
    );
    await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-secret',
        authorization: 'Bearer t',
        'anthropic-version': '2023-06-01',
        traceparent: `00-${TRACE}-${'2'.repeat(16)}-01`,
      },
      body: JSON.stringify(anthropicRequest),
    });
    await eventually(() => ended.length === 1, 'the call ended');
    assert.deepEqual(placements[0], {
      what: `a model call to 127.0.0.1:${providerPort}, POST /v1/messages`,
      startTimeUnixNano: placements[0].startTimeUnixNano,
      traceparent: `00-${TRACE}-${'2'.repeat(16)}-01`,
    });
    const [event] = ended;
    assert.equal(event.traceId, TRACE);
    assert.equal(event.parentSpanId, TURN_SPAN);
    assert.equal(event.kind, 3);
    assert.equal(event.name, 'chat claude-sonnet-4-5');
    assert.ok(BigInt(event.endTimeUnixNano ?? '0') >= BigInt(event.startTimeUnixNano));
    assert.deepEqual(event.status, {code: 1});
    const a = event.attributes;
    assert.equal(a['http.request.method'], 'POST');
    assert.equal(a['url.full'], `http://127.0.0.1:${providerPort}/v1/messages`);
    assert.equal(a['server.address'], '127.0.0.1');
    assert.equal(a['server.port'], providerPort);
    assert.deepEqual(a['http.request.header.x-api-key'], ['REMOVED']);
    assert.deepEqual(a['http.request.header.authorization'], ['REMOVED']);
    assert.deepEqual(a['http.request.header.anthropic-version'], ['2023-06-01']);
    assert.deepEqual(a['http.request.header.host'], [`127.0.0.1:${providerPort}`]);
    assert.deepEqual(a['http.request.header.content-type'], ['application/json']);
    assert.deepEqual(a['a2ui.http.request.body'], anthropicRequest);
    assert.equal(a['http.response.status_code'], 200);
    assert.deepEqual(a['http.response.header.set-cookie'], ['REMOVED']);
    assert.deepEqual(a['http.response.header.request-id'], ['req_1']);
    assert.deepEqual(a['a2ui.http.response.body'], anthropicReply);
    assert.equal(a['gen_ai.provider.name'], 'anthropic');
    assert.equal(a['gen_ai.request.model'], 'claude-sonnet-4-5');
    assert.equal(a['gen_ai.request.stream'], false);
    assert.equal(a['gen_ai.response.id'], 'msg_1');
    assert.equal(a['gen_ai.usage.input_tokens'], 8);
    assert.deepEqual(a['gen_ai.response.finish_reasons'], ['stop']);
    assert.equal(event.events, undefined);
    assert.equal(JSON.stringify(event).includes('sk-ant-secret'), false);

    assert.deepEqual(
      notifications.map(n => n.type),
      ['call_started', 'call_ended'],
    );
    const started = notifications[0];
    assert.ok(started.type === 'call_started');
    assert.equal(started.event.spanId, event.spanId);
    assert.equal(started.event.attributes['gen_ai.request.model'], 'claude-sonnet-4-5');
    assert.equal(started.event.attributes['http.response.status_code'], undefined);
    assert.equal(started.event.endTimeUnixNano, undefined);
  });

  it('passes a stream on chunk by chunk, records each chunk as it arrives, and reads the stream at its end', async () => {
    let finish: () => void = () => {};
    const first =
      `event: message_start\ndata: ${JSON.stringify({type: 'message_start', message: {id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: {input_tokens: 8, output_tokens: 1}}})}\n\n` +
      `event: content_block_start\ndata: ${JSON.stringify({type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}})}\n\n`;
    const rest =
      `event: content_block_delta\ndata: ${JSON.stringify({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Hello.'}})}\n\n` +
      `event: content_block_stop\ndata: ${JSON.stringify({type: 'content_block_stop', index: 0})}\n\n` +
      `event: message_delta\ndata: ${JSON.stringify({type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 3}})}\n\n` +
      `event: message_stop\ndata: ${JSON.stringify({type: 'message_stop'})}\n\n`;
    const {proxy, ended, notifications} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write(first);
      finish = () => response.end(rest);
    });
    let sawFirstChunk = false;
    const answer = send(proxy, {
      path: '/ANTHROPIC_API_BASE/v1/messages',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({...anthropicRequest, stream: true}),
      onData: () => (sawFirstChunk = true),
    });
    await eventually(
      () => sawFirstChunk && notifications.filter(n => n.type === 'call_chunk').length === 2,
      'the first chunks arrived and were notified while the stream was open',
    );
    assert.equal(ended.length, 0);
    finish();
    assert.equal((await answer).body.toString(), first + rest);
    await eventually(() => ended.length === 1, 'the call ended');
    const [event] = ended;
    assert.equal(event.events?.length, 6);
    assert.deepEqual(event.events?.[0].attributes, {
      'a2ui.http.response.chunk.body': {
        type: 'message_start',
        message: {
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [],
          usage: {input_tokens: 8, output_tokens: 1},
        },
      },
      'a2ui.http.response.chunk.event': 'message_start',
    });
    assert.equal(event.attributes['a2ui.http.response.body'], undefined);
    assert.equal(typeof event.attributes['gen_ai.response.time_to_first_chunk'], 'number');
    assert.equal(event.attributes['gen_ai.request.stream'], true);
    assert.deepEqual(event.attributes['gen_ai.output.messages'], [
      {role: 'assistant', parts: [{type: 'text', content: 'Hello.'}], finish_reason: 'stop'},
    ]);
    assert.equal(event.attributes['gen_ai.usage.output_tokens'], 3);
    assert.deepEqual(event.status, {code: 1});
    const chunk = notifications.find(n => n.type === 'call_chunk');
    assert.ok(chunk?.type === 'call_chunk');
    assert.equal(chunk.spanId, event.spanId);
    assert.equal(chunk.traceId, TRACE);
  });

  it('records a call on another path raw, named by its method, with the exchange only', async () => {
    const {proxy, ended, providerPort} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"totalTokens": 12}');
    });
    await send(proxy, {
      path: '/GOOGLE_GEMINI_BASE_URL/v1beta/models/gemini-2.5-flash:countTokens?key=AIza-secret',
      headers: {'content-type': 'application/json'},
      body: '{"contents": []}',
    });
    await eventually(() => ended.length === 1, 'the call ended');
    const [event] = ended;
    assert.equal(event.name, 'POST');
    assert.equal(
      event.attributes['url.full'],
      `http://127.0.0.1:${providerPort}/v1beta/models/gemini-2.5-flash:countTokens?key=REMOVED`,
    );
    assert.deepEqual(event.attributes['a2ui.http.request.body'], {contents: []});
    assert.deepEqual(event.attributes['a2ui.http.response.body'], {totalTokens: 12});
    assert.equal(event.attributes['gen_ai.provider.name'], undefined);
    assert.equal(event.attributes['gen_ai.operation.name'], undefined);
  });

  it('records a call to a host that is not a provider raw, even on a provider path', async () => {
    const {proxy, ended} = await setUp(
      (_request, _body, response) => {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify(anthropicReply));
      },
      {standIn: false},
    );
    await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: JSON.stringify(anthropicRequest),
      headers: {'content-type': 'application/json'},
    });
    await eventually(() => ended.length === 1, 'the call ended');
    assert.equal(ended[0].name, 'POST');
    assert.equal(ended[0].attributes['gen_ai.request.model'], undefined);
  });

  it('leaves out a body that is neither JSON nor text, keeping its content type and length', async () => {
    const bytes = Buffer.from([0, 1, 2, 3]);
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': 4});
      response.end(bytes);
    });
    const answer = await send(proxy, {
      path: '/OPENAI_BASE_URL/v1/audio/speech',
      headers: {'content-type': 'application/octet-stream'},
      body: bytes,
    });
    assert.deepEqual(answer.body, bytes);
    await eventually(() => ended.length === 1, 'the call ended');
    const a = ended[0].attributes;
    assert.equal('a2ui.http.request.body' in a, false);
    assert.equal('a2ui.http.response.body' in a, false);
    assert.deepEqual(a['http.response.header.content-type'], ['application/octet-stream']);
    assert.deepEqual(a['http.response.header.content-length'], ['4']);
  });

  it('relays a compressed reply compressed, and records it decoded', async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json', 'content-encoding': 'gzip'});
      response.end(gzipSync(JSON.stringify(anthropicReply)));
    });
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: JSON.stringify(anthropicRequest),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(answer.headers['content-encoding'], 'gzip');
    await eventually(() => ended.length === 1, 'the call ended');
    assert.deepEqual(ended[0].attributes['a2ui.http.response.body'], anthropicReply);
    assert.equal(ended[0].attributes['gen_ai.response.id'], 'msg_1');
  });

  it("records the provider's error status as a failed call, with its message from the body", async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(429, {'content-type': 'application/json'});
      response.end(
        JSON.stringify({
          type: 'error',
          error: {type: 'rate_limit_error', message: 'Too many requests.'},
        }),
      );
    });
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: JSON.stringify(anthropicRequest),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(answer.status, 429);
    await eventually(() => ended.length === 1, 'the call ended');
    assert.deepEqual(ended[0].status, {code: 2, message: 'Too many requests.'});
    assert.equal(ended[0].attributes['error.type'], '429');
    assert.equal(ended[0].attributes['http.response.status_code'], 429);
    assert.equal(ended[0].attributes['gen_ai.response.id'], undefined);
  });

  it('records an error inside a 2xx stream as a failed call, with the chunks so far', async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.end(
        `event: message_start\ndata: ${JSON.stringify({type: 'message_start', message: {id: 'msg_3', model: 'c', content: [], usage: {input_tokens: 1, output_tokens: 1}}})}\n\n` +
          `event: error\ndata: ${JSON.stringify({type: 'error', error: {type: 'overloaded_error', message: 'Overloaded'}})}\n\n`,
      );
    });
    await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: JSON.stringify({...anthropicRequest, stream: true}),
      headers: {'content-type': 'application/json'},
    });
    await eventually(() => ended.length === 1, 'the call ended');
    assert.deepEqual(ended[0].status, {code: 2, message: 'Overloaded'});
    assert.equal(ended[0].attributes['error.type'], 'overloaded_error');
    assert.equal(ended[0].events?.length, 2);
  });

  it('answers 502 when the provider cannot be reached, and records the failure without a response', async () => {
    const {proxy, ended} = await setUp((_request, _body, response) =>
      response.writeHead(200).end(),
    );
    const closed = (await setUp((_request, _body, response) => response.writeHead(200).end()))
      .providerPort;
    await new Promise<void>(resolve => {
      const dead = servers.find(server => (server.address() as {port: number}).port === closed);
      dead?.close(() => resolve());
    });
    const redirected = await startModelProxy({
      port: await freePort(),
      redirections: redirections({}, 'http://127.0.0.1:1').map(item => ({
        ...item,
        target: {kind: 'base', base: `http://127.0.0.1:${closed}`},
      })),
      place: () => ({traceId: TRACE, parentSpanId: TURN_SPAN, ended: event => ended.push(event)}),
    });
    proxies.push(redirected);
    void proxy;
    const answer = await send(redirected, {
      path: '/OPENAI_BASE_URL/v1/responses',
      body: '{}',
      headers: {'content-type': 'application/json'},
    });
    assert.equal(answer.status, 502);
    assert.match(answer.body.toString(), /model proxy could not reach 127\.0\.0\.1/);
    await eventually(() => ended.length === 1, 'the call ended');
    assert.equal(ended[0].status?.code, 2);
    assert.equal(ended[0].attributes['error.type'], 'ECONNREFUSED');
    assert.equal(ended[0].attributes['http.response.status_code'], undefined);
  });

  it("records a stream that breaks partway with the break's code and the chunks so far, and passes the break on", async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write(
        `data: ${JSON.stringify({type: 'message_start', message: {id: 'm', content: []}})}\n\n`,
      );
      setTimeout(() => response.socket?.destroy(), 30);
    });
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: '{"stream": true}',
      headers: {'content-type': 'application/json'},
    });
    assert.ok(answer.brokenOff);
    await eventually(() => ended.length === 1, 'the call ended');
    assert.equal(ended[0].status?.code, 2);
    assert.equal(typeof ended[0].attributes['error.type'], 'string');
    assert.equal(ended[0].events?.length, 1);
    assert.equal(ended[0].attributes['http.response.status_code'], 200);
  });

  it('records a call the agent abandons as aborted, ended at the close', async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write('data: {"type": "ping"}\n\n');
    });
    const origin = new URL(proxy.origin);
    await new Promise<void>(resolve => {
      const request = httpRequest(
        {
          host: origin.hostname,
          port: origin.port,
          method: 'POST',
          path: '/ANTHROPIC_BASE_URL/v1/messages',
          headers: {'content-type': 'application/json'},
        },
        response => {
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.once('error', () => resolve());
      request.end('{"stream": true}');
    });
    await eventually(() => ended.length === 1, 'the call ended');
    assert.equal(ended[0].attributes['error.type'], 'aborted');
    assert.equal(ended[0].status?.code, 2);
  });

  it('ends a call cut off by the stop as aborted', async () => {
    const {proxy, ended} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'text/event-stream'});
      response.write('data: {"type": "ping"}\n\n');
    });
    const answer = send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: '{"stream": true}',
      headers: {'content-type': 'application/json'},
    });
    await eventually(() => ended.length === 0 && proxies.includes(proxy), 'started');
    await new Promise(resolve => setTimeout(resolve, 50));
    await proxy.close();
    await answer.catch(() => undefined);
    await eventually(() => ended.length === 1, 'the call ended');
    assert.equal(ended[0].attributes['error.type'], 'aborted');
    assert.match(ended[0].status?.message ?? '', /Spectra stopped/);
  });

  it('forwards a call that cannot be placed, and records nothing', async () => {
    const {proxy, ended, notifications, received} = await setUp(
      (_request, _body, response) => {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify(anthropicReply));
      },
      {place: false},
    );
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/messages',
      body: JSON.stringify(anthropicRequest),
      headers: {'content-type': 'application/json'},
    });
    assert.equal(answer.status, 200);
    assert.equal(received.length, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(ended, []);
    assert.deepEqual(notifications, []);
  });

  it('passes a token request on unrecorded, with one line', async () => {
    const {proxy, ended, placements, logs, received} = await setUp((_request, _body, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"access_token": "t"}');
    });
    const answer = await send(proxy, {
      path: '/ANTHROPIC_BASE_URL/v1/oauth/token',
      body: 'grant_type=x',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
    });
    assert.equal(answer.body.toString(), '{"access_token": "t"}');
    assert.equal(received.length, 1);
    assert.deepEqual(placements, []);
    assert.deepEqual(ended, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /token request.*passed on unrecorded/);
  });
});
