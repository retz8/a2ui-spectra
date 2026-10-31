import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import type {TurnNotification} from '../a2a/turn.js';
import {CallPlacer} from '../placement.js';
import type {Turn, TurnEvent, TurnRecordEvent} from '../record/turn_record.js';
import {TurnStore} from '../store/store.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';
import {SpanReceiver} from './receiver.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const FOREIGN = 'c'.repeat(32);
const ADK = {name: 'gcp.vertex.agent', version: '2.3.0'};
const S = (n: number) => String(n).padStart(16, '0');
const SECOND = 1_000_000_000n;
const BASE = 1_793_000_000n * SECOND;

function turnEvent(traceId: string, spanId: string, start: bigint, end: bigint): TurnEvent {
  return {
    traceId,
    spanId,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: end.toString(),
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.conversation.id': 'conversation',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'test',
      'a2ui.turn.writer.version': '0',
    },
    status: {code: 1},
  };
}

function span(
  traceId: string,
  spanId: string,
  start: bigint,
  {name = 'invocation', parent}: {name?: string; parent?: string} = {},
): ReceivedSpan {
  return {
    traceId,
    spanId,
    ...(parent !== undefined && {parentSpanId: parent}),
    name,
    kind: 1,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: (start + SECOND).toString(),
    attributes: {},
    events: [],
    links: [],
    status: {code: 0},
    scope: ADK,
  };
}

function log(traceId: string | undefined, spanId: string | undefined, time: bigint): ReceivedLog {
  return {
    timeUnixNano: time.toString(),
    ...(traceId !== undefined && {traceId}),
    ...(spanId !== undefined && {spanId}),
    eventName: 'gen_ai.choice',
    body: {index: 0},
    attributes: {},
    scope: ADK,
  };
}

interface Harness {
  placer: CallPlacer;
  receiver: SpanReceiver;
  store: TurnStore;
  lines: string[];
  amended: Array<{traceId: string; events: TurnRecordEvent[]}>;
  handedOn: Turn[];
  now: {value: bigint};
  open(traceId: string, spanId: string, start: bigint): void;
  close(traceId: string, spanId: string, start: bigint, end: bigint): void;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spectra-receiver-'));
});

afterEach(async () => {
  await rm(dir, {recursive: true, force: true});
});

async function harness(): Promise<Harness> {
  const store = await TurnStore.open(dir);
  const lines: string[] = [];
  const amended: Harness['amended'] = [];
  const handedOn: Turn[] = [];
  const now = {value: BASE + 100n * SECOND};
  const placer: CallPlacer = new CallPlacer({
    onTurn: (notification: TurnNotification) => {
      if (notification.type === 'turn_closed') {
        handedOn.push(notification.turn);
        void store.write(notification.turn);
      }
    },
    log: line => lines.push(line),
    assemble: (turn: Turn): Turn => receiver.assemble(turn),
    now: () => now.value,
  });
  const receiver: SpanReceiver = new SpanReceiver({
    turns: placer,
    store,
    onAmended: (traceId, events) => amended.push({traceId, events}),
    log: line => lines.push(line),
  });
  return {
    placer,
    receiver,
    store,
    lines,
    amended,
    handedOn,
    now,
    open(traceId, spanId, start) {
      placer.onTurn({type: 'turn_opened', traceId, spanId, startTimeUnixNano: start.toString()});
    },
    close(traceId, spanId, start, end) {
      placer.onTurn({
        type: 'turn_closed',
        traceId,
        turn: {events: [turnEvent(traceId, spanId, start, end)]},
      });
    },
  };
}

async function stored(store: TurnStore, traceId: string): Promise<Turn> {
  const file = (await store.list()).find(turn => turn.traceId === traceId)?.file;
  assert.ok(file);
  const record = await store.read(file);
  return record.turns[record.turns.length - 1];
}

const names = (turn: Turn) => turn.events.map(event => event.name);

describe('the span receiver', () => {
  it("places a span carrying a turn's trace id in it while open, sending it live, and hands it on with the turn", async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.receiver.takeSpans([span(A, S(10), BASE + SECOND, {parent: S(1)})]);
    assert.deepEqual(
      h.amended.map(({traceId, events}) => [traceId, events.map(event => event.spanId)]),
      [[A, [S(10)]]],
    );
    // A span already in its turn is ignored.
    h.receiver.takeSpans([span(A, S(10), BASE + SECOND)]);
    assert.equal(h.amended.length, 1);
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    assert.deepEqual(names(h.handedOn[0]), ['invoke_agent', 'invocation']);
    assert.deepEqual((h.handedOn[0].events[0] as TurnEvent).attributes['a2ui.turn.capture_paths'], [
      'wire',
      'otel_receiver',
    ]);
    assert.deepEqual(h.lines, []);
  });

  it('places a span of another trace by its start in the one turn whose range holds it, and counts the rest', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    h.open(B, S(2), BASE + 20n * SECOND);
    h.receiver.takeSpans([
      span(FOREIGN, S(10), BASE + 5n * SECOND),
      span(FOREIGN, S(11), BASE + 15n * SECOND),
      span(FOREIGN, S(12), BASE + 16n * SECOND),
      span(FOREIGN, S(13), BASE + 25n * SECOND, {name: 'call_llm'}),
    ]);
    assert.deepEqual(h.lines, [
      'The receiver did not record 2 spans from gcp.vertex.agent, which started from ' +
        "2026-10-26T07:33:35.000Z to 2026-10-26T07:33:36.000Z: their start falls in no turn's time range.",
    ]);
    await h.receiver.idle();
    assert.deepEqual(names(await stored(h.store, A)), ['invoke_agent', 'invocation']);
    assert.deepEqual(
      h.amended.find(({traceId}) => traceId === B)?.events.map(event => event.name),
      ['call_llm'],
    );
    // Two turns open at once both hold a later start.
    h.open('d'.repeat(32), S(3), BASE + 21n * SECOND);
    h.receiver.takeSpans([span(FOREIGN, S(14), BASE + 30n * SECOND)]);
    assert.match(
      h.lines[1],
      /^The receiver did not record 1 span from gcp\.vertex\.agent, which started at 2026-10-26T07:33:50\.000Z: their start falls in the time ranges of two or more turns\.$/,
    );
  });

  it('amends a written turn in the store, its end and its other events unchanged, and sends what changed', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    await h.store.amend(A, turn => turn);
    h.receiver.takeSpans([span(A, S(10), BASE + 20n * SECOND, {parent: S(1)})]);
    await h.receiver.idle();
    const turn = await stored(h.store, A);
    assert.deepEqual(names(turn), ['invoke_agent', 'invocation']);
    assert.equal(turn.events[0].endTimeUnixNano, (BASE + 10n * SECOND).toString());
    assert.deepEqual((turn.events[0] as TurnEvent).attributes['a2ui.turn.capture_paths'], [
      'wire',
      'otel_receiver',
    ]);
    assert.deepEqual(
      h.amended.map(({events}) => events.map(event => event.spanId)),
      [[S(1), S(10)]],
    );
  });

  it('holds a log until its span arrives, attaches a later one and translates the span again', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.receiver.takeLogs([log(A, S(10), BASE + 2n * SECOND)]);
    assert.equal(h.amended.length, 0);
    h.receiver.takeSpans([span(A, S(10), BASE + SECOND, {name: 'generate_content m'})]);
    assert.deepEqual(
      h.amended[0].events[0].events?.map(event => event.name),
      ['gen_ai.choice'],
    );
    h.receiver.takeLogs([log(A, S(10), BASE + 3n * SECOND)]);
    assert.deepEqual(
      h.amended[1].events[0].events?.map(event => event.timeUnixNano),
      [(BASE + 2n * SECOND).toString(), (BASE + 3n * SECOND).toString()],
    );
  });

  it('drops a log without span context and the logs of a span not placed, counted with it', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.receiver.takeLogs([
      log(undefined, undefined, BASE + SECOND),
      log(FOREIGN, S(20), BASE - SECOND),
    ]);
    assert.deepEqual(h.lines, [
      'The receiver did not record 1 log record from gcp.vertex.agent, which started at 2026-10-26T07:33:21.000Z: they carry no span context.',
    ]);
    h.receiver.takeSpans([span(FOREIGN, S(20), BASE - 2n * SECOND)]);
    assert.match(
      h.lines[1],
      /^The receiver did not record 1 span and 1 log record from gcp\.vertex\.agent, which started from .* to .*: their start falls in no turn's time range\.$/,
    );
    h.receiver.takeLogs([log(FOREIGN, S(20), BASE)]);
    assert.match(h.lines[2], /^The receiver did not record 1 log record .*no turn's time range\.$/);
  });
});
