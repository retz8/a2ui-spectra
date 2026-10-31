/**
 * The receiver capture suite (`conformance/receiver_capture/`): each case's
 * recorded OTLP/JSON export requests posted to the receiver's listener, with
 * the turns of its expected record opened at their start, their proxies'
 * calls placed in them, and each turn closed at its end, so that an export
 * that arrived after a turn closed amends the written turn, as it did live.
 * Each turn as written must match the expected record's, and the receiver
 * must print the case's lines, when it names them, and no others.
 *
 * With `SPECTRA_WRITE_RECEIVER_CAPTURE=1` the harness writes each expected
 * record from what it captures instead of comparing, keeping the record's
 * turn events and calls as the input; the record written is then checked by
 * hand.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as yaml from 'js-yaml';

import {CallPlacer} from '../placement.js';
import {
  type CallEvent,
  isEventOfKind,
  type Turn,
  type TurnEvent,
  type TurnRecord,
  type TurnRecordEvent,
} from '../record/turn_record.js';
import {TurnStore} from '../store/store.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {isReceived} from './assemble.js';
import {startReceiverListener} from './listener.js';
import {SpanReceiver} from './receiver.js';

interface CaptureReceiverCase {
  name: string;
  description: string;
  action: 'capture_receiver';
  exports: string;
  expect: string;
  log?: string[];
}

/** One recorded export request. */
interface RecordedExport {
  path: '/v1/traces' | '/v1/logs';
  receivedTimeUnixNano: string;
  body: unknown;
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
const SUITE = path.join(CONFORMANCE_DIR, 'receiver_capture/capture_v0_1.yaml');
const WRITE = process.env.SPECTRA_WRITE_RECEIVER_CAPTURE === '1';

function freePort(): Promise<number> {
  return new Promise(resolve => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === 'object' && address !== null ? address.port : 0),
      );
    });
  });
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as T;
}

function turnEventOf(turn: Turn): TurnEvent {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  assert.ok(turnEvent, 'each expected turn has its turn event');
  return turnEvent;
}

/** The turn's own events as the harness gives them: its turn event and its proxies' calls, without the receiver's links. */
function inputOf(turn: Turn): {turnEvent: TurnEvent; calls: TurnRecordEvent[]} {
  const turnEvent = turnEventOf(turn);
  const calls = turn.events
    .filter(event => !isReceived(event) && !isEventOfKind(event, 'turn'))
    .map(event => {
      const call = {...event};
      delete call.links;
      return call as TurnRecordEvent;
    });
  return {turnEvent, calls};
}

async function runCase(c: CaptureReceiverCase): Promise<void> {
  const expected = readJson<TurnRecord>(c.expect);
  const exports = readJson<RecordedExport[]>(c.exports);
  const dir = await mkdtemp(path.join(tmpdir(), 'spectra-receiver-capture-'));
  const lines: string[] = [];
  const writes: Array<Promise<unknown>> = [];
  try {
    const store = await TurnStore.open(dir);
    const placer: CallPlacer = new CallPlacer({
      onTurn: notification => {
        if (notification.type === 'turn_closed') writes.push(store.write(notification.turn));
      },
      log: line => lines.push(line),
      assemble: (turn: Turn): Turn => spans.assemble(turn),
    });
    const spans: SpanReceiver = new SpanReceiver({
      turns: placer,
      store,
      log: line => lines.push(line),
    });
    const listener = await startReceiverListener({
      port: await freePort(),
      onSpans: received => spans.takeSpans(received),
      onLogs: received => spans.takeLogs(received),
    });
    const turns = expected.turns.map(inputOf);
    const open = new Set(turns.map(turn => turn.turnEvent.traceId));
    try {
      for (const {turnEvent, calls} of turns) {
        placer.onTurn({
          type: 'turn_opened',
          traceId: turnEvent.traceId,
          spanId: turnEvent.spanId,
          startTimeUnixNano: turnEvent.startTimeUnixNano,
        });
        for (const call of calls) {
          // Placed by the turn's own trace context, so each call joins its turn however many are open.
          const placed = placer.tryPlace({
            what: call.name,
            startTimeUnixNano: call.startTimeUnixNano,
            traceparent: `00-${turnEvent.traceId}-${turnEvent.spanId}-01`,
          });
          assert.ok(!('line' in placed), `the call ${call.name} is placed`);
          placed.ended(call as CallEvent);
        }
      }
      const closeUpTo = (time?: bigint) => {
        for (const {turnEvent} of turns) {
          if (
            open.has(turnEvent.traceId) &&
            (time === undefined || BigInt(turnEvent.endTimeUnixNano) < time)
          ) {
            open.delete(turnEvent.traceId);
            placer.onTurn({
              type: 'turn_closed',
              traceId: turnEvent.traceId,
              turn: {events: [turnEvent]},
            });
          }
        }
      };
      for (const recorded of exports) {
        closeUpTo(BigInt(recorded.receivedTimeUnixNano));
        const answer = await fetch(`${listener.origin}${recorded.path}`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(recorded.body),
        });
        assert.equal(answer.status, 200, `${recorded.path} is read`);
        await answer.text();
      }
      closeUpTo();
      await Promise.all(writes);
      await spans.idle();
    } finally {
      await listener.close();
    }
    const listed = await store.list();
    const captured: Turn[] = [];
    for (const {turnEvent} of turns) {
      const file = listed.find(turn => turn.traceId === turnEvent.traceId)?.file;
      assert.ok(file, `the turn ${turnEvent.traceId} is written`);
      const record = await store.read(file);
      captured.push(record.turns[record.turns.length - 1]);
    }
    const record = {version: 'v0.1', turns: captured} as TurnRecord;
    assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');
    if (WRITE) {
      fs.writeFileSync(
        path.join(CONFORMANCE_DIR, c.expect),
        `${JSON.stringify(record, null, 2)}\n`,
      );
      return;
    }
    assert.deepEqual(turnRecordErrors(expected), [], 'the expected record validates');
    for (const [index, turn] of captured.entries()) {
      assert.deepEqual(
        turn,
        expected.turns[index],
        `turn ${index + 1} matches the expected record`,
      );
    }
    assert.deepEqual(lines, c.log ?? [], "the receiver's lines");
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureReceiverCase[];

describe('receiver capture v0.1', () => {
  for (const c of cases) {
    it(c.name, () => runCase(c));
  }
});
