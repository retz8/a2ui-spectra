/**
 * The model replay suite (`conformance/model_replay/`): each model capture
 * case run against its expected record instead of the provider. The model
 * proxy, armed with the record in everything-recorded mode, must answer each
 * recorded request as the recording has it, write `model_call` events that
 * match the record, each naming the event it was served from, and answer one
 * changed request with the miss.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, describe, it} from 'node:test';

import * as yaml from 'js-yaml';

import {SseParser} from '../a2a/sse.js';
import {CallPlacer} from '../placement.js';
import type {ModelCallEvent, Turn, TurnEvent, TurnRecord} from '../record/turn_record.js';
import {ReplayPool} from '../replay/pool.js';
import {
  CONFORMANCE_DIR,
  comparable,
  freePort,
  type HarEntry,
  modelCalls,
  PREFIXES,
  readJson,
  type Received,
  sendEntry,
} from '../testing/model_traffic.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {type ModelProxy, startModelProxy} from './proxy.js';
import {type Redirection, redirections} from './redirection.js';

interface ReplayModelCase {
  name: string;
  description: string;
  action: 'replay_model';
  traffic: string;
  expect: string;
  /** Whether the record's origin is read as the providers' own hosts; every call is read raw otherwise. */
  readInFull?: boolean;
}

const SUITE = path.join(CONFORMANCE_DIR, 'model_replay/replay_v0_1.yaml');

const TRACE_ID = 'c'.repeat(32);
const TURN_SPAN_ID = 'd'.repeat(16);
const MISS_TRACE_ID = 'e'.repeat(32);
const MISS_SPAN_ID = 'f'.repeat(16);

const proxies: ModelProxy[] = [];
after(async () => {
  await Promise.all(proxies.map(proxy => proxy.close()));
});

function nowNano(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

function turnEvent(traceId: string, spanId: string): TurnEvent {
  return {
    traceId,
    spanId,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: String(nowNano() - 1_000_000_000n),
    endTimeUnixNano: String(nowNano()),
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

/** The record with every model call's URL moved to `origin`, where the proxy's targets point. */
function atOrigin(record: TurnRecord, origin: string): TurnRecord {
  return {
    ...record,
    turns: record.turns.map(turn => ({
      ...turn,
      events: turn.events.map(event => {
        const attributes = event.attributes as Record<string, unknown>;
        const url = attributes['url.full'];
        if (attributes['a2ui.event.kind'] !== 'model_call' || typeof url !== 'string') {
          return event;
        }
        return {
          ...event,
          attributes: {...attributes, 'url.full': url.replace(/^https?:\/\/[^/]+/, origin)},
        };
      }),
    })) as TurnRecord['turns'],
  };
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A body read as the agent's side compares it: its server-sent events, each one's data by JSON value, or its JSON value. */
function asReceived(contentType: string, body: string): unknown {
  if (/^text\/event-stream\b/i.test(contentType)) {
    return new SseParser().push(body).map(event => ({...event, data: jsonOrText(event.data)}));
  }
  return jsonOrText(body);
}

function harHeader(entry: HarEntry, name: string): string {
  return entry.response.headers.find(header => header.name.toLowerCase() === name)?.value ?? '';
}

function assertReceived(received: Received, entry: HarEntry, label: string): void {
  assert.equal(received.status, entry.response.status, `${label}: the status`);
  if (entry.response._brokenOff === true) {
    assert.ok(received.brokenOff, `${label}: the reply breaks off for the agent too`);
    return;
  }
  assert.ok(!received.brokenOff, `${label}: the reply ends whole`);
  const contentType = harHeader(entry, 'content-type');
  assert.deepEqual(
    asReceived(contentType, received.body),
    asReceived(contentType, entry.response.content.text),
    `${label}: the reply as recorded`,
  );
}

/** The body with its last string value, walked as JSON in document order, changed. */
function changedBody(text: string): string {
  const value = JSON.parse(text) as unknown;
  let last: {holder: Record<string, unknown> | unknown[]; key: string | number} | undefined;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (typeof item === 'string') last = {holder: node, key: index};
        else walk(item);
      });
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, item] of Object.entries(node)) {
        if (typeof item === 'string') last = {holder: node as Record<string, unknown>, key};
        else walk(item);
      }
    }
  };
  walk(value);
  assert.ok(last !== undefined, 'the request has a text to change');
  const holder = last.holder as Record<string | number, unknown>;
  holder[last.key] = `${String(holder[last.key])} (changed)`;
  return JSON.stringify(value);
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

function withoutServedFrom(event: ModelCallEvent): ModelCallEvent {
  const {'a2ui.replay.served_from': _servedFrom, ...attributes} = event.attributes;
  return {...event, attributes: attributes as ModelCallEvent['attributes']};
}

async function runCase(c: ReplayModelCase): Promise<void> {
  const entries = readJson<{log: {entries: HarEntry[]}}>(c.traffic).log.entries;
  // Nothing listens at the record's origin: a call the proxy forwarded would fail.
  const origin = `http://127.0.0.1:${await freePort()}`;
  const record = atOrigin(readJson<TurnRecord>(c.expect), origin);

  const handedOn: Turn[] = [];
  const unplaced: string[] = [];
  const lines: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => {
      if (notification.type === 'turn_closed') handedOn.push(notification.turn);
    },
    log: line => unplaced.push(line),
  });
  const proxyPort = await freePort();
  const redirected: Redirection[] = redirections({}, `http://127.0.0.1:${proxyPort}`).map(item => ({
    ...item,
    target: {
      kind: 'base',
      base: `${origin}${PREFIXES['api.openai.com'].variable === item.name ? '/v1' : ''}`,
    },
  }));
  const proxy = await startModelProxy({
    port: proxyPort,
    redirections: redirected,
    ...(c.readInFull !== false && {standInOrigin: origin}),
    place: call => placer.place(call),
    log: line => lines.push(line),
  });
  proxies.push(proxy);

  // Every recorded request, served from the record.
  placer.onTurn({
    type: 'turn_opened',
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    startTimeUnixNano: String(nowNano()),
  });
  proxy.arm(new ReplayPool(record, 'recorded'));
  for (const [index, entry] of entries.entries()) {
    const received = await sendEntry(proxy.origin, entry);
    assertReceived(
      received,
      entry,
      `exchange ${index + 1}, ${entry.request.method} ${new URL(entry.request.url).pathname}`,
    );
  }
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
  const captured = modelCalls(turn);
  const wanted = modelCalls(record.turns[record.turns.length - 1]);
  assert.equal(captured.length, wanted.length, 'one model call per exchange');
  for (const [index, event] of captured.entries()) {
    assert.equal(event.traceId, TRACE_ID, `call ${index + 1}: the turn's trace id`);
    assert.equal(event.parentSpanId, TURN_SPAN_ID, `call ${index + 1}: under the turn event`);
    assert.equal(
      event.attributes['a2ui.replay.served_from'],
      wanted[index].spanId,
      `call ${index + 1}: served from the recorded call`,
    );
    assert.deepEqual(
      comparable(withoutServedFrom(event)),
      comparable(wanted[index]),
      `call ${index + 1} matches the expected record`,
    );
  }

  // One changed request: the last text of the first request read in full, else of the first request.
  const changedIndex = Math.max(
    0,
    wanted.findIndex(event => event.attributes['gen_ai.operation.name'] !== undefined),
  );
  const entry = entries[changedIndex];
  const body = changedBody(entry.request.postData?.text ?? '{}');
  placer.onTurn({
    type: 'turn_opened',
    traceId: MISS_TRACE_ID,
    spanId: MISS_SPAN_ID,
    startTimeUnixNano: String(nowNano()),
  });
  proxy.arm(new ReplayPool(record, 'recorded'));
  const missed = await sendEntry(proxy.origin, entry, body);
  proxy.disarm();
  assert.equal(missed.status, 502, 'the changed request gets the 502');
  assert.equal(lines.length, 1, 'the terminal gets one line for the miss');
  const [line] = lines;
  assert.match(
    line,
    /^a2ui-spectra's model proxy is replaying, and POST \/\S+ matched nothing in the record\.$/,
  );
  assert.equal(missed.body, `${line}\n`, 'the 502 carries the line');
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
  const [miss] = modelCalls(missTurn);
  assert.equal(miss.attributes['error.type'], 'replay_miss');
  assert.deepEqual(miss.status, {code: 2, message: line});
  assert.deepEqual(miss.attributes['a2ui.http.request.body'], JSON.parse(body));
  assert.equal(miss.attributes['a2ui.replay.served_from'], undefined, 'nothing served');
  assert.deepEqual(
    Object.keys(miss.attributes).filter(name => name.startsWith('http.response.')),
    [],
    'no response attributes',
  );
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as ReplayModelCase[];

describe('model replay v0.1', () => {
  for (const c of cases) {
    it(c.name, () => runCase(c));
  }
});
