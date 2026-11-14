/**
 * The model capture suite (`conformance/model_capture/`): each HAR recording
 * of model API traffic replayed through the model proxy, with the stand-in
 * provider standing in for the provider. The agent's side must receive each
 * recorded response as recorded, and the `model_call` events the proxy
 * writes into the turn must match the expected record.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, describe, it} from 'node:test';

import * as yaml from 'js-yaml';

import {CallPlacer} from '../placement.js';
import type {Turn, TurnRecord} from '../record/turn_record.js';
import {
  CONFORMANCE_DIR,
  comparable,
  type HarEntry,
  modelCalls,
  PREFIXES,
  readJson,
  sendEntry,
} from '../testing/model_traffic.js';
import {startStandIn} from '../testing/stand_in_provider.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {type ModelProxy, startModelProxy} from './proxy.js';
import {type Redirection, redirections} from './redirection.js';
import {freePort} from '../testing/free_port.js';

interface CaptureModelCase {
  name: string;
  description: string;
  action: 'capture_model';
  traffic: string;
  expect: string;
  /** Whether the stand-in is read as the providers' own hosts; a call to it is recorded raw otherwise. */
  readInFull?: boolean;
}

const SUITE = path.join(CONFORMANCE_DIR, 'model_capture/capture_v0_1.yaml');

const TRACE_ID = 'c'.repeat(32);
const TURN_SPAN_ID = 'd'.repeat(16);

const proxies: ModelProxy[] = [];
after(async () => {
  await Promise.all(proxies.map(proxy => proxy.close()));
});

async function runCase(c: CaptureModelCase): Promise<void> {
  const entries = readJson<{log: {entries: HarEntry[]}}>(c.traffic).log.entries;
  const expected = readJson<TurnRecord>(c.expect);

  const standIn = await startStandIn(await freePort(), [path.join(CONFORMANCE_DIR, c.traffic)]);
  const handedOn: Turn[] = [];
  const unplaced: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => {
      if (notification.type === 'turn_closed') handedOn.push(notification.turn);
    },
    log: line => unplaced.push(line),
  });
  placer.onTurn({
    type: 'turn_opened',
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
  });
  const proxyPort = await freePort();
  const redirected: Redirection[] = redirections({}, `http://127.0.0.1:${proxyPort}`).map(item => ({
    ...item,
    target: {
      kind: 'base',
      base: `${standIn.origin}${PREFIXES['api.openai.com'].variable === item.name ? '/v1' : ''}`,
    },
  }));
  const proxy = await startModelProxy({
    port: proxyPort,
    redirections: redirected,
    ...(c.readInFull !== false && {standInOrigin: standIn.origin}),
    place: call => placer.place(call),
  });
  proxies.push(proxy);

  try {
    for (const [index, entry] of entries.entries()) {
      const received = await sendEntry(proxy.origin, entry);
      const label = `exchange ${index + 1}, ${entry.request.method} ${new URL(entry.request.url).pathname}`;
      assert.equal(received.status, entry.response.status, `${label}: the status`);
      if (entry.response._brokenOff === true) {
        assert.ok(received.brokenOff, `${label}: the reply breaks off for the agent too`);
        assert.ok(
          entry.response.content.text.startsWith(received.body),
          `${label}: what arrived before the break is as recorded`,
        );
      } else {
        assert.equal(received.body, entry.response.content.text, `${label}: the body as recorded`);
      }
    }
    assert.doesNotMatch(standIn.output(), /unexpected:/, 'the requests the stand-in received');
  } finally {
    standIn.process.kill('SIGKILL');
  }

  const turnEvent = {
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    name: 'invoke_agent',
    kind: 3 as const,
    startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n - 1_000_000_000n),
    endTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
    attributes: {
      'a2ui.event.kind': 'turn' as const,
      'gen_ai.operation.name': 'invoke_agent' as const,
      'a2ui.turn.outcome': 'completed' as const,
      'a2ui.turn.capture_paths': ['wire' as const],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.0',
    },
    status: {code: 1 as const},
  };
  placer.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: {events: [turnEvent]}});
  assert.deepEqual(unplaced, [], 'every call was placed');
  assert.equal(handedOn.length, 1, 'the turn was handed on once its calls ended');
  const [turn] = handedOn;
  const record: TurnRecord = {version: 'v0.1', turns: [turn]};
  assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');

  const captured = modelCalls(turn);
  const wanted = modelCalls(expected.turns[expected.turns.length - 1]);
  assert.equal(captured.length, wanted.length, 'one model call per exchange');
  for (const [index, event] of captured.entries()) {
    assert.equal(event.traceId, TRACE_ID, `call ${index + 1}: the turn's trace id`);
    assert.equal(event.parentSpanId, TURN_SPAN_ID, `call ${index + 1}: under the turn event`);
    assert.match(event.spanId, /^[0-9a-f]{16}$/);
    assert.ok(
      BigInt(event.endTimeUnixNano ?? '0') >= BigInt(event.startTimeUnixNano),
      `call ${index + 1}: ends after it starts`,
    );
    assert.equal(
      event.attributes['server.address'],
      '127.0.0.1',
      `call ${index + 1}: went to the stand-in`,
    );
    assert.deepEqual(
      comparable(event),
      comparable(wanted[index]),
      `call ${index + 1} matches the expected record`,
    );
  }
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureModelCase[];

describe('model capture v0.1', () => {
  for (const c of cases) {
    it(c.name, () => runCase(c));
  }
});
