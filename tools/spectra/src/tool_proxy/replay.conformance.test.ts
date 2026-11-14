/**
 * The tool replay suite (`conformance/tool_replay/`): each tool capture
 * scenario run against its expected record instead of the tool server. The
 * tool proxy, armed with the record and answering as the server, must give
 * the client each reply as recorded, write `tool_call` events that match the
 * record, every served one naming the event it was served from, and answer
 * one changed call with the miss. The record's `<origin>`, `<session-N>` and
 * `<id-N>` placeholders are made concrete before arming.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as yaml from 'js-yaml';

import {SseParser} from '../a2a/sse.js';
import {CallPlacer} from '../placement.js';
import type {ToolCallEvent, Turn, TurnEvent, TurnRecord} from '../record/turn_record.js';
import {ReplayPool} from '../replay/pool.js';
import {recordedEvents} from '../replay/served.js';
import {
  comparable,
  type HttpReply,
  PATHS,
  SCENARIOS,
  toolCalls,
  type Transport,
  withClient,
} from '../testing/tool_scenarios.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {startToolProxy, type ToolProxy} from './proxy.js';
import type {ToolServer} from './servers.js';
import {freePort} from '../testing/free_port.js';

interface ReplayToolCase {
  name: string;
  description: string;
  action: 'replay_tool';
  scenario: string;
  expect: Partial<Record<Transport, string>>;
}

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CONFORMANCE_DIR = findConformanceDir();
const SUITE = path.join(CONFORMANCE_DIR, 'tool_replay/replay_v0_1.yaml');

const TRACE_ID = 'c'.repeat(32);
const TURN_SPAN_ID = 'd'.repeat(16);
const MISS_TRACE_ID = 'e'.repeat(32);
const MISS_SPAN_ID = 'f'.repeat(16);

function turnEvent(traceId: string, spanId: string): TurnEvent {
  return {
    traceId,
    spanId,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1792577000000000000',
    endTimeUnixNano: '1792577001000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire', 'tool_proxy'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.0',
    },
    status: {code: 1},
  };
}

/**
 * The record with its placeholders made concrete: `<origin>` the origin
 * given, `<session-N>` a session id, and `<id-N>` the id the SDK's client
 * gave it, N - 1, a number in a message and a string as `jsonrpc.request.id`.
 */
function concrete(record: TurnRecord, origin: string): TurnRecord {
  const walk = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map(item => walk(item));
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name)]),
      );
    }
    if (typeof value !== 'string') return value;
    const id = /^<id-(\d+)>$/.exec(value);
    if (id !== null) {
      const number = Number(id[1]) - 1;
      return key === 'jsonrpc.request.id' ? String(number) : number;
    }
    return value.replaceAll('<origin>', origin).replace(/<session-(\d+)>/g, 'replay-session-$1');
  };
  return walk(record) as TurnRecord;
}

/** An answer the proxy gives from the protocol, never served from the record: a notification's 202, a client's response's 202, a ping. */
function isProtocolAnswer(event: ToolCallEvent): boolean {
  const method = event.attributes['mcp.method.name'];
  return (
    event.name === 'response' ||
    method === 'ping' ||
    (typeof method === 'string' && method.startsWith('notifications/'))
  );
}

/** An event as the comparison takes it: no `served_from`, and a protocol answer without its response headers. */
function comparedForm(event: ToolCallEvent): ToolCallEvent {
  const protocol = isProtocolAnswer(event);
  const attributes = Object.fromEntries(
    Object.entries(event.attributes).filter(
      ([name]) =>
        name !== 'a2ui.replay.served_from' &&
        !(protocol && name.startsWith('http.response.header.')),
    ),
  );
  return {...event, attributes: attributes as ToolCallEvent['attributes']};
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Each plain HTTP reply against the recorded call it was served from: the status, and the body by JSON value or by server-sent events. */
function assertHttpReplies(replies: HttpReply[], recorded: ToolCallEvent[]): void {
  assert.equal(replies.length, recorded.length, 'one reply per recorded call');
  for (const [index, reply] of replies.entries()) {
    const event = recorded[index];
    const label = `reply ${index + 1}, ${event.name}`;
    assert.equal(
      reply.status,
      event.attributes['http.response.status_code'],
      `${label}: the status`,
    );
    if (/^text\/event-stream\b/i.test(reply.contentType)) {
      assert.deepEqual(
        new SseParser().push(reply.body).map(chunk => ({...chunk, data: jsonOrText(chunk.data)})),
        recordedEvents(event).map(chunk => ({...chunk, data: jsonOrText(chunk.data)})),
        `${label}: the stream as recorded`,
      );
    } else {
      assert.deepEqual(
        jsonOrText(reply.body),
        event.attributes['a2ui.http.response.body'],
        `${label}: the body as recorded`,
      );
    }
  }
}

/** Waits until the placer has handed on `count` turns. */
async function handedOnBy(handedOn: Turn[], count: number, lines: string[]): Promise<void> {
  const deadline = Date.now() + 5000;
  while (handedOn.length < count) {
    assert.ok(
      Date.now() < deadline,
      `The turn was not handed on; the proxy said:\n${lines.join('\n')}`,
    );
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** The changed call: the first recorded `tools/call` with one argument changed, else `echo` with a text no record holds. */
function changedCall(calls: ToolCallEvent[]): {name: string; arguments: Record<string, unknown>} {
  const call = calls.find(event => event.attributes['mcp.method.name'] === 'tools/call');
  const name = call?.attributes['gen_ai.tool.name'];
  if (call === undefined || typeof name !== 'string') {
    return {name: 'echo', arguments: {text: 'changed'}};
  }
  const args = {...(call.attributes['gen_ai.tool.call.arguments'] ?? {})};
  const [first] = Object.keys(args);
  if (first === undefined) return {name, arguments: {changed: 'yes'}};
  args[first] = typeof args[first] === 'string' ? `${args[first]} (changed)` : 'changed';
  return {name, arguments: args};
}

/**
 * Posts a changed `tools/call` on an HTTP+SSE carrier it opens itself, and
 * returns the message the carrier carries for it once the POST got its 502.
 */
async function missOnCarrier(
  sseUrl: URL,
  call: {name: string; arguments: Record<string, unknown>},
): Promise<unknown> {
  const abort = new AbortController();
  const stream = await fetch(sseUrl, {
    headers: {accept: 'text/event-stream'},
    signal: abort.signal,
  });
  assert.ok(stream.body !== null, 'the carrier opens');
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  const pending: Array<{event?: string; data: string}> = [];
  const next = async (): Promise<{event?: string; data: string}> => {
    while (pending.length === 0) {
      const {value, done} = await reader.read();
      assert.ok(!done, 'the carrier stays open');
      pending.push(...parser.push(value));
    }
    return pending.shift()!;
  };
  try {
    const endpoint = await next();
    assert.equal(endpoint.event, 'endpoint');
    const posted = await fetch(new URL(endpoint.data, sseUrl), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 'changed-1', method: 'tools/call', params: call}),
    });
    assert.equal(posted.status, 502, 'the changed request gets the 502');
    await posted.text();
    const message = await next();
    assert.equal(message.event, 'message');
    return JSON.parse(message.data);
  } finally {
    abort.abort();
  }
}

async function runCase(c: ReplayToolCase, transport: Transport, expectFile: string): Promise<void> {
  const expected = JSON.parse(
    fs.readFileSync(path.join(CONFORMANCE_DIR, expectFile), 'utf8'),
  ) as TurnRecord;
  // Nothing listens at the original: a request the proxy forwarded would fail.
  const originalOrigin = `http://127.0.0.1:${await freePort()}`;
  const record = concrete(expected, originalOrigin);

  const handedOn: Turn[] = [];
  const unplaced: string[] = [];
  const lines: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => {
      if (notification.type === 'turn_closed') handedOn.push(notification.turn);
    },
    log: line => unplaced.push(line),
  });
  const port = await freePort();
  const proxyOrigin = `http://127.0.0.1:${port}`;
  const original = new URL(`${originalOrigin}${PATHS[transport]}`);
  const server: ToolServer = {
    variable: 'TOOL_SERVER_URL',
    port,
    proxyOrigin,
    value: `${proxyOrigin}${original.pathname}`,
    original,
  };
  let proxy: ToolProxy | undefined;
  try {
    proxy = await startToolProxy({
      servers: [server],
      place: call => placer.tryPlace(call),
      log: line => lines.push(line),
    });

    // The scenario, served from the record.
    placer.onTurn({
      type: 'turn_opened',
      traceId: TRACE_ID,
      spanId: TURN_SPAN_ID,
      startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    });
    proxy.arm(new ReplayPool(record, 'recorded'));
    const scenario = SCENARIOS[c.scenario];
    assert.ok(scenario !== undefined, `the scenario ${c.scenario} exists`);
    const replies = await scenario(new URL(server.value), transport);
    if (replies !== undefined) assertHttpReplies(replies, toolCalls(record.turns[0]));
    proxy.disarm();
    placer.onTurn({
      type: 'turn_closed',
      traceId: TRACE_ID,
      turn: {events: [turnEvent(TRACE_ID, TURN_SPAN_ID)]},
    });
    await handedOnBy(handedOn, 1, lines);
    assert.deepEqual(unplaced, [], 'every call was placed');
    assert.deepEqual(lines, [], 'the proxy had nothing to say');
    const [turn] = handedOn;
    assert.deepEqual(
      turnRecordErrors({version: 'v0.1', turns: [turn]}),
      [],
      'the captured record validates',
    );
    const captured = toolCalls(turn);
    const recorded = new Map(toolCalls(record.turns[0]).map(event => [event.spanId, event]));
    for (const [index, event] of captured.entries()) {
      const servedFrom = event.attributes['a2ui.replay.served_from'];
      if (isProtocolAnswer(event)) {
        assert.equal(
          servedFrom,
          undefined,
          `call ${index + 1}, ${event.name}: answered by the protocol`,
        );
      } else {
        assert.equal(
          typeof servedFrom === 'string' ? recorded.get(servedFrom)?.name : undefined,
          event.name,
          `call ${index + 1}, ${event.name}: served from the recorded call`,
        );
      }
    }
    // An operation the server initiated is not replayed.
    const wanted = toolCalls(expected.turns[0]).filter(event => event.kind !== 4);
    assert.deepEqual(
      comparable(captured.map(comparedForm)),
      comparable(wanted.map(comparedForm)),
      'the calls match the expected record',
    );

    // One changed call, against the same record.
    placer.onTurn({
      type: 'turn_opened',
      traceId: MISS_TRACE_ID,
      spanId: MISS_SPAN_ID,
      startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    });
    proxy.arm(new ReplayPool(record, 'recorded'));
    let missName: string;
    if (transport === 'http') {
      const answer = await fetch(new URL('/api/json', server.value), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{"x": 2}',
      });
      assert.equal(answer.status, 502, 'the changed request gets the 502');
      assert.deepEqual(lines, [(await answer.text()).trimEnd()], 'the 502 carries the line');
      missName = 'POST /api/json';
    } else if (transport === 'http_sse') {
      // Under HTTP+SSE the client waits for its reply on the carrier: the miss answers there too.
      const call = changedCall(toolCalls(record.turns[0]));
      const error = await missOnCarrier(new URL(server.value), call);
      assert.deepEqual(error, {
        jsonrpc: '2.0',
        id: 'changed-1',
        error: {code: -32603, message: lines[0]},
      });
      missName = `tools/call ${call.name}`;
    } else {
      const call = changedCall(toolCalls(record.turns[0]));
      await withClient(transport, new URL(server.value), async client => {
        await assert.rejects(client.callTool(call), 'the changed call fails');
      });
      missName = `tools/call ${call.name}`;
    }
    proxy.disarm();
    assert.equal(lines.length, 1, 'the terminal gets one line for the miss');
    const [line] = lines;
    assert.match(
      line,
      /^a2ui-spectra's tool proxy is replaying, and POST \/\S* matched nothing in the record\.$/,
    );
    placer.onTurn({
      type: 'turn_closed',
      traceId: MISS_TRACE_ID,
      turn: {events: [turnEvent(MISS_TRACE_ID, MISS_SPAN_ID)]},
    });
    await handedOnBy(handedOn, 2, lines);
    const missTurn = handedOn[1];
    assert.deepEqual(
      turnRecordErrors({version: 'v0.1', turns: [missTurn]}),
      [],
      'the record of the miss validates',
    );
    const miss = toolCalls(missTurn).find(event => event.name === missName);
    assert.ok(miss !== undefined, `the miss is recorded as ${missName}`);
    assert.equal(miss.attributes['error.type'], 'replay_miss');
    assert.deepEqual(miss.status, {code: 2, message: line});
    assert.equal(miss.attributes['a2ui.replay.served_from'], undefined, 'nothing served');
    assert.deepEqual(
      Object.keys(miss.attributes).filter(name => name.startsWith('http.response.')),
      [],
      'no response attributes',
    );
  } finally {
    await proxy?.close();
  }
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as ReplayToolCase[];

describe('tool replay v0.1', () => {
  for (const c of cases) {
    for (const [transport, expectFile] of Object.entries(c.expect) as Array<[Transport, string]>) {
      it(`${c.name} over ${transport}`, () => runCase(c, transport, expectFile));
    }
  }
});
