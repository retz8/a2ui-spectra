import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {
  CallEvent,
  ModelCallEvent,
  ToolCallEvent,
  Turn,
  TurnEvent,
  TurnRecord,
} from '../record/turn_record.js';
import {exchangeKey, hasNothingToServe, paramsKey, ReplayPool} from './pool.js';

const TRACE = 'a'.repeat(32);
const TURN = 'b'.repeat(16);

function turnEvent(): TurnEvent {
  return {
    traceId: TRACE,
    spanId: TURN,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1000',
    endTimeUnixNano: '9000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.0',
    },
    status: {code: 1},
  };
}

function modelCall(
  spanId: string,
  start: number,
  attributes: Record<string, unknown> = {},
): ModelCallEvent {
  return {
    traceId: TRACE,
    spanId,
    parentSpanId: TURN,
    name: 'chat',
    kind: 3,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 1),
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'url.full': 'https://api.anthropic.com/v1/messages',
      'a2ui.http.request.body': {model: 'claude', messages: [{role: 'user', content: 'Hi'}]},
      ...attributes,
    },
    status: {code: 1},
  };
}

function toolCall(
  spanId: string,
  start: number,
  name: string,
  attributes: Record<string, unknown>,
  extra: Partial<ToolCallEvent> = {},
): ToolCallEvent {
  return {
    traceId: TRACE,
    spanId,
    parentSpanId: TURN,
    name,
    kind: 3,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(start + 1),
    attributes: {'a2ui.event.kind': 'tool_call', ...attributes},
    status: {code: 1},
    ...extra,
  };
}

/** An MCP request's event, its body the JSON-RPC message. */
function mcpCall(
  spanId: string,
  start: number,
  method: string,
  params: unknown,
  extra: Partial<ToolCallEvent> = {},
): ToolCallEvent {
  return toolCall(
    spanId,
    start,
    method,
    {
      'mcp.method.name': method,
      'jsonrpc.request.id': String(start),
      'http.request.method': 'POST',
      'url.full': 'http://127.0.0.1:9/mcp',
      'a2ui.http.request.body': {
        jsonrpc: '2.0',
        id: start,
        method,
        ...(params !== undefined && {params}),
      },
    },
    extra,
  );
}

function record(...turns: CallEvent[][]): TurnRecord {
  return {
    version: 'v0.1',
    turns: turns.map(calls => ({events: [turnEvent(), ...calls]})) as [Turn, ...Turn[]],
  };
}

function served(answer: ReturnType<ReplayPool['model']>): string | undefined {
  return answer.type === 'served' ? answer.event.spanId : answer.type;
}

describe('the replay pool', () => {
  it("keys a model call by its exchange's method, URL and body, by value, its headers no part of it", () => {
    const call = modelCall('0000000000000001', 10, {
      'http.request.header.x-api-key': ['REMOVED'],
      'http.request.header.user-agent': ['sdk/1.0'],
    });
    const pool = new ReplayPool(record([call]), 'recorded');
    const key = exchangeKey({
      'http.request.method': 'POST',
      'url.full': 'https://api.anthropic.com/v1/messages',
      // The same body, its keys in another order.
      'a2ui.http.request.body': {messages: [{content: 'Hi', role: 'user'}], model: 'claude'},
      'http.request.header.user-agent': ['sdk/2.0'],
    });
    assert.equal(served(pool.model(key)), '0000000000000001');
  });

  it('misses a request whose method, URL or body differs', () => {
    const pool = new ReplayPool(record([modelCall('0000000000000001', 10)]), 'recorded');
    const base = exchangeKey(modelCall('x', 0).attributes);
    assert.equal(served(pool.model({...base, method: 'PUT'})), 'miss');
    assert.equal(
      served(pool.model({...base, url: 'https://api.anthropic.com/v1/messages?beta=true'})),
      'miss',
    );
    assert.equal(served(pool.model({...base, body: {model: 'claude', messages: []}})), 'miss');
    assert.equal(served(pool.model(base)), '0000000000000001');
  });

  it('keys a request whose body the exchange leaves out on its method and URL alone', () => {
    const call = modelCall('0000000000000001', 10, {'a2ui.http.request.body': undefined});
    delete call.attributes['a2ui.http.request.body'];
    const pool = new ReplayPool(record([call]), 'recorded');
    assert.equal(
      served(
        pool.model({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          body: undefined,
        }),
      ),
      '0000000000000001',
    );
  });

  it('serves exchanges with the same key in recorded order, each once, and misses one beyond them', () => {
    const pool = new ReplayPool(
      record([modelCall('0000000000000002', 20), modelCall('0000000000000001', 10)]),
      'recorded',
    );
    const key = exchangeKey(modelCall('x', 0).attributes);
    assert.equal(served(pool.model(key)), '0000000000000001', 'the earlier start first');
    assert.equal(served(pool.model(key)), '0000000000000002');
    assert.equal(served(pool.model(key)), 'miss');
  });

  it("holds every turn's calls in one pool, in turn order and then start order", () => {
    const pool = new ReplayPool(
      record([modelCall('0000000000000001', 50)], [modelCall('0000000000000002', 10)]),
      'recorded',
    );
    const key = exchangeKey(modelCall('x', 0).attributes);
    assert.equal(served(pool.model(key)), '0000000000000001', "the earlier turn's call first");
    assert.equal(served(pool.model(key)), '0000000000000002');
  });

  it('sends a model miss live in the live mode, and still serves what matches', () => {
    const pool = new ReplayPool(record([modelCall('0000000000000001', 10)]), 'model_live');
    const key = exchangeKey(modelCall('x', 0).attributes);
    assert.equal(served(pool.model({...key, body: {changed: true}})), 'live');
    assert.equal(served(pool.model(key)), '0000000000000001');
    assert.equal(served(pool.model(key)), 'live', 'nothing is added for a call that went live');
  });

  it('keys an HTTP tool the same way, with no live fallback in either mode', () => {
    const get = toolCall('0000000000000001', 10, 'GET /api/json', {
      'http.request.method': 'GET',
      'url.full': 'http://127.0.0.1:9/api/json?q=1',
    });
    const pool = new ReplayPool(record([get]), 'model_live');
    const key = exchangeKey(get.attributes);
    assert.equal(pool.httpTool(key)?.spanId, '0000000000000001');
    assert.equal(pool.httpTool(key), undefined);
    assert.equal(pool.model(key).type, 'live', 'a model request never matches a tool call');
  });

  it('keys an MCP request by its method and params, its id and the whole of params._meta left out', () => {
    const pool = new ReplayPool(
      record([
        mcpCall('0000000000000001', 10, 'tools/call', {
          name: 'echo',
          arguments: {text: 'hello'},
          _meta: {progressToken: 3, traceparent: '00-a-b-01'},
        }),
        mcpCall('0000000000000002', 20, 'tools/call', {name: 'echo', arguments: {text: 'hello'}}),
      ]),
      'recorded',
    );
    const params = {name: 'echo', arguments: {text: 'hello'}, _meta: {progressToken: 99}};
    assert.equal(pool.mcpRequest('tools/call', params)?.spanId, '0000000000000001');
    assert.equal(pool.mcpRequest('tools/call', params)?.spanId, '0000000000000002');
    assert.equal(pool.mcpRequest('tools/call', params), undefined, 'each once');
    assert.equal(
      pool.mcpRequest('resources/read', {uri: 'x'}),
      undefined,
      'a method the record lacks',
    );
  });

  it('takes params with nothing but _meta as none', () => {
    assert.equal(paramsKey({_meta: {progressToken: 1}}), undefined);
    assert.equal(paramsKey(undefined), undefined);
    assert.deepEqual(paramsKey({uri: 'x', _meta: {}}), {uri: 'x'});
  });

  it('serves housekeeping by method alone, the latest exchange, as often as asked', () => {
    const pool = new ReplayPool(
      record(
        [mcpCall('0000000000000001', 10, 'initialize', {protocolVersion: '2025-06-18'})],
        [
          mcpCall('0000000000000002', 10, 'initialize', {protocolVersion: '2025-11-25'}),
          mcpCall('0000000000000003', 20, 'tools/list', undefined),
        ],
      ),
      'recorded',
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(pool.mcpRequest('initialize', {other: true})?.spanId, '0000000000000002');
      assert.equal(pool.mcpRequest('tools/list', {cursor: 'x'})?.spanId, '0000000000000003');
    }
    assert.equal(pool.mcpRequest('prompts/list', undefined), undefined);
  });

  it('takes resources/templates/list and logging/setLevel as housekeeping too', () => {
    const pool = new ReplayPool(
      record([
        mcpCall('0000000000000001', 10, 'resources/templates/list', undefined),
        mcpCall('0000000000000002', 20, 'logging/setLevel', {level: 'info'}),
      ]),
      'recorded',
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(
        pool.mcpRequest('resources/templates/list', {cursor: 'next'})?.spanId,
        '0000000000000001',
      );
      assert.equal(
        pool.mcpRequest('logging/setLevel', {level: 'debug'})?.spanId,
        '0000000000000002',
      );
    }
  });

  it('consumes any other request by its key, as tools/call is', () => {
    const pool = new ReplayPool(
      record([
        mcpCall('0000000000000001', 10, 'completion/complete', {argument: {name: 'a', value: 'x'}}),
      ]),
      'recorded',
    );
    assert.equal(
      pool.mcpRequest('completion/complete', {argument: {name: 'a', value: 'y'}}),
      undefined,
      'other params miss',
    );
    assert.equal(
      pool.mcpRequest('completion/complete', {argument: {name: 'a', value: 'x'}})?.spanId,
      '0000000000000001',
    );
    assert.equal(
      pool.mcpRequest('completion/complete', {argument: {name: 'a', value: 'x'}}),
      undefined,
      'each once',
    );
  });

  it("leaves out what is never served: the server's own operations, a client's notification and response", () => {
    const pool = new ReplayPool(
      record([
        mcpCall('0000000000000001', 10, 'sampling/createMessage', {messages: []}, {kind: 4}),
        toolCall('0000000000000002', 20, 'notifications/initialized', {
          'mcp.method.name': 'notifications/initialized',
          'http.request.method': 'POST',
        }),
        toolCall('0000000000000003', 30, 'response', {
          'jsonrpc.request.id': '0',
          'http.request.method': 'POST',
        }),
      ]),
      'recorded',
    );
    assert.equal(pool.mcpRequest('sampling/createMessage', {messages: []}), undefined);
    assert.equal(
      pool.httpTool({method: 'POST', url: undefined, body: undefined}),
      undefined,
      'neither is an HTTP tool',
    );
  });

  it('serves the latest session end as often as asked', () => {
    const end = (spanId: string, start: number) =>
      toolCall(spanId, start, 'DELETE', {
        'mcp.session.id': 's',
        'http.request.method': 'DELETE',
        'http.response.status_code': 200,
      });
    const pool = new ReplayPool(
      record([end('0000000000000001', 10), end('0000000000000002', 20)]),
      'recorded',
    );
    assert.equal(pool.sessionEnd()?.spanId, '0000000000000002');
    assert.equal(pool.sessionEnd()?.spanId, '0000000000000002');
    assert.equal(new ReplayPool(record([]), 'recorded').sessionEnd(), undefined);
  });

  it("finds an HTTP+SSE carrier's initialize by its stream URL's path and its endpoint chunk", () => {
    const initialize = mcpCall(
      '0000000000000001',
      10,
      'initialize',
      {protocolVersion: '2025-11-25'},
      {
        events: [
          {
            timeUnixNano: '10',
            name: 'a2ui.http.response.chunk',
            attributes: {
              'a2ui.http.response.chunk.body': '/messages?sessionId=s1',
              'a2ui.http.response.chunk.event': 'endpoint',
            },
          },
        ],
      },
    );
    initialize.attributes['a2ui.mcp.stream.url'] = 'http://127.0.0.1:9/sse';
    const streamable = mcpCall('0000000000000002', 20, 'initialize', {});
    const pool = new ReplayPool(record([initialize, streamable]), 'recorded');
    const opening = pool.sseOpening('/sse');
    assert.equal(opening?.event.spanId, '0000000000000001');
    assert.equal(
      opening?.endpoint.attributes?.['a2ui.http.response.chunk.body'],
      '/messages?sessionId=s1',
    );
    assert.equal(pool.sseOpening('/other'), undefined);
  });

  it("leaves out a model call or tool call read from the agent's spans: it carries no exchange to serve", () => {
    // As the Python restaurant finder's turn records ADK's spans under opentelemetry-instrument.
    const fromSpans = (
      spanId: string,
      start: number,
      kind: 'model_call' | 'tool_call',
      name: string,
    ) => ({
      traceId: TRACE,
      spanId,
      parentSpanId: TURN,
      name,
      kind: 1,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + 1),
      attributes: {
        'a2ui.event.kind': kind,
        'a2ui.received.dialect': 'adk',
        'gen_ai.operation.name': kind === 'model_call' ? 'generate_content' : 'execute_tool',
        'gen_ai.request.model': 'gemini-3.6-flash',
      },
      status: {code: 1},
    });
    const proxied = modelCall('0000000000000001', 10);
    const spans = [
      fromSpans('0000000000000002', 11, 'model_call', 'call_llm'),
      fromSpans('0000000000000003', 12, 'model_call', 'generate_content gemini-3.6-flash'),
      fromSpans('0000000000000004', 13, 'tool_call', 'execute_tool get_restaurants'),
    ] as CallEvent[];
    const pool = new ReplayPool(record([proxied, ...spans]), 'recorded');
    assert.deepEqual(
      pool.unserved().map(event => event.spanId),
      ['0000000000000001'],
    );
    assert.equal(served(pool.model(exchangeKey(proxied.attributes))), '0000000000000001');
    assert.deepEqual(pool.unserved(), []);
    assert.equal(hasNothingToServe(record(spans)), true, 'spans alone are nothing to serve');
  });

  it('names the recorded calls never served: a consumed exchange and housekeeping that was asked for count as served', () => {
    const hello = modelCall('0000000000000001', 10);
    const again = modelCall('0000000000000002', 20, {
      'a2ui.http.request.body': {model: 'claude', n: 2},
    });
    const list = mcpCall('0000000000000003', 30, 'tools/list', undefined);
    const call = mcpCall('0000000000000004', 40, 'tools/call', {name: 'get', arguments: {}});
    const pool = new ReplayPool(record([hello, again, list], [call]), 'recorded');
    assert.deepEqual(
      pool.unserved().map(event => event.spanId),
      ['0000000000000001', '0000000000000002', '0000000000000003', '0000000000000004'],
    );
    pool.model(exchangeKey(hello.attributes));
    pool.mcpRequest('tools/list', undefined);
    assert.deepEqual(
      pool.unserved().map(event => event.spanId),
      ['0000000000000002', '0000000000000004'],
    );
    pool.mcpRequest('tools/call', {name: 'get', arguments: {}});
    assert.deepEqual(
      pool.unserved().map(event => event.spanId),
      ['0000000000000002'],
    );
  });
});
