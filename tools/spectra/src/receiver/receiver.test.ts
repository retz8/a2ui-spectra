import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import type {TurnNotification} from '../a2a/turn.js';
import {CallPlacer} from '../placement.js';
import type {ModelCallEvent, Turn, TurnEvent, TurnRecordEvent} from '../record/turn_record.js';
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

const WRAPPER = {name: 'a2ui-spectra-instrumentation', version: '0.0.1'};
const SECTION = '## Workflow Description:\nWrite the UI in Express.';

/** A span of the A2UI step, in its wire form. */
function stepSpan(
  traceId: string,
  spanId: string,
  start: bigint,
  attributes: Record<string, unknown>,
): ReceivedSpan {
  return {
    ...span(traceId, spanId, start, {name: String(attributes['a2ui.event.kind'])}),
    attributes,
    scope: WRAPPER,
  };
}

function generation(
  traceId: string,
  spanId: string,
  start: bigint,
  section = SECTION,
): ReceivedSpan {
  return stepSpan(traceId, spanId, start, {
    'a2ui.event.kind': 'prompt_generation',
    'a2ui.prompt.ui_section': section,
    'a2ui.prompt.inference_format': 'express',
    'a2ui.prompt.catalogs': '[{"catalogId":"basic","protocolVersion":"v1.0"}]',
  });
}

/** A proxy's model call whose request's system instruction holds a text. */
function proxyCall(
  traceId: string,
  parent: string,
  spanId: string,
  start: bigint,
  system: string,
): ModelCallEvent {
  return {
    traceId,
    spanId,
    parentSpanId: parent,
    name: 'generate_content m',
    kind: 3,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: (start + SECOND).toString(),
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'a2ui.http.request.body': {
        systemInstruction: {parts: [{text: `You are an agent.\n\n${system}\n\nBe brief.`}]},
        contents: [{role: 'user', parts: [{text: 'Hi'}]}],
      },
    },
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
/** The store writes of the turns handed on, awaited before the store's directory is removed. */
let writes: Array<Promise<unknown>> = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spectra-receiver-'));
});

afterEach(async () => {
  await Promise.allSettled(writes);
  writes = [];
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
        writes.push(store.write(notification.turn));
      }
    },
    log: line => lines.push(line),
    assemble: (turn: Turn): Turn => receiver.assemble(turn),
    onCallEnded: (traceId, call) => receiver.takeCall(traceId, call),
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

  it("reads a span of the A2UI step by its kind, and adds wrapper to the turn's capture paths", async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.receiver.takeSpans([
      stepSpan(FOREIGN, S(10), BASE + SECOND, {
        'a2ui.event.kind': 'parse',
        'a2ui.parse.input': 'root = Text("Hi")',
        'a2ui.parse.entry_point': 'parse_response',
        'a2ui.parse.messages': '[]',
      }),
    ]);
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    const parse = h.handedOn[0].events[1];
    assert.equal(parse.attributes['a2ui.event.kind'], 'parse');
    assert.deepEqual(parse.attributes['a2ui.parse.messages'], []);
    assert.equal(parse.attributes['a2ui.received.dialect'], undefined);
    assert.deepEqual((h.handedOn[0].events[0] as TurnEvent).attributes['a2ui.turn.capture_paths'], [
      'wire',
      'otel_receiver',
      'wrapper',
    ]);
    assert.deepEqual(h.lines, []);
  });

  it('writes a half-formed span of the step as a framework span, one line per export and reason', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    const halfFormed = (spanId: string) =>
      stepSpan(A, spanId, BASE + SECOND, {
        'a2ui.event.kind': 'parse',
        'a2ui.parse.entry_point': 'compile',
      });
    h.receiver.takeSpans([halfFormed(S(10)), halfFormed(S(11))]);
    assert.deepEqual(h.lines, [
      'The receiver wrote 2 spans from a2ui-spectra-instrumentation, which started at 2026-10-26T07:33:21.000Z, ' +
        'as framework_span events: they carry a2ui.event.kind parse without a2ui.parse.input.',
    ]);
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    assert.deepEqual(
      h.handedOn[0].events.map(event => event.attributes['a2ui.event.kind']),
      ['turn', 'framework_span', 'framework_span'],
    );
    assert.deepEqual((h.handedOn[0].events[0] as TurnEvent).attributes['a2ui.turn.capture_paths'], [
      'wire',
      'otel_receiver',
    ]);
  });

  it('keeps a prompt generation that falls in no turn and places it by its text when a model call holding it joins a turn', async () => {
    const h = await harness();
    h.receiver.takeSpans([generation(FOREIGN, S(10), BASE - 5n * SECOND)]);
    assert.deepEqual(h.lines, []);
    h.open(A, S(1), BASE);
    const placed = h.placer.place({
      what: 'a model call',
      startTimeUnixNano: (BASE + SECOND).toString(),
    });
    assert.ok(placed);
    placed.ended(proxyCall(A, S(1), S(20), BASE + SECOND, SECTION));
    // The proxy's call goes live from the proxy; the receiver sends the generation it placed.
    assert.deepEqual(
      h.amended.map(({events}) => events.map(event => event.spanId)),
      [[S(10)]],
    );
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    const turn = h.handedOn[0];
    assert.deepEqual(names(turn), ['invoke_agent', 'generate_content m', 'prompt_generation']);
    // Written as received: its own trace id and no parent in the turn.
    assert.equal(turn.events[2].traceId, FOREIGN);
    assert.equal(turn.events[2].parentSpanId, undefined);
    assert.deepEqual((turn.events[0] as TurnEvent).attributes['a2ui.turn.capture_paths'], [
      'wire',
      'model_proxy',
      'otel_receiver',
      'wrapper',
    ]);
  });

  it('places a kept prompt generation on arrival in every turn of the run whose model calls hold its text, a written one amended', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.placer
      .place({what: 'a model call', startTimeUnixNano: (BASE + SECOND).toString()})
      ?.ended(proxyCall(A, S(1), S(20), BASE + SECOND, SECTION));
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    await h.store.amend(A, turn => turn);
    h.open(B, S(2), BASE + 20n * SECOND);
    h.receiver.takeSpans([
      stepSpan(B, S(30), BASE + 21n * SECOND, {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system_instructions': JSON.stringify([
          {type: 'text', content: `Rules.\n${SECTION}`},
        ]),
      }),
    ]);
    h.open('d'.repeat(32), S(3), BASE + 40n * SECOND);
    // Its start falls in no turn: before every turn of the run.
    h.receiver.takeSpans([generation(FOREIGN, S(10), BASE - 5n * SECOND)]);
    await h.receiver.idle();
    assert.deepEqual(names(await stored(h.store, A)), [
      'invoke_agent',
      'generate_content m',
      'prompt_generation',
    ]);
    assert.deepEqual(
      h.amended
        .filter(({traceId}) => traceId === B)
        .at(-1)
        ?.events.map(event => event.spanId),
      [S(10)],
    );
    assert.equal(
      h.amended.some(({traceId}) => traceId === 'd'.repeat(32)),
      false,
    );
  });

  it('places no second prompt generation of an equal text in a turn, and a text found twice once', async () => {
    const h = await harness();
    h.open(A, S(1), BASE);
    h.receiver.takeSpans([generation(A, S(9), BASE + SECOND)]);
    h.receiver.takeSpans([generation(FOREIGN, S(10), BASE - 5n * SECOND)]);
    for (const [spanId, start] of [
      [S(20), BASE + 2n * SECOND],
      [S(21), BASE + 3n * SECOND],
    ] as const) {
      h.placer
        .place({what: 'a model call', startTimeUnixNano: start.toString()})
        ?.ended(proxyCall(A, S(1), spanId, start, SECTION));
    }
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    assert.equal(
      h.handedOn[0].events.filter(event => event.name === 'prompt_generation').length,
      1,
    );
  });

  it('places a text found in two model calls of a turn once', async () => {
    const h = await harness();
    h.receiver.takeSpans([generation(FOREIGN, S(10), BASE - 5n * SECOND)]);
    h.open(A, S(1), BASE);
    for (const [spanId, start] of [
      [S(20), BASE + 2n * SECOND],
      [S(21), BASE + 3n * SECOND],
    ] as const) {
      h.placer
        .place({what: 'a model call', startTimeUnixNano: start.toString()})
        ?.ended(proxyCall(A, S(1), spanId, start, SECTION));
    }
    h.close(A, S(1), BASE, BASE + 10n * SECOND);
    assert.deepEqual(names(h.handedOn[0]), [
      'invoke_agent',
      'generate_content m',
      'generate_content m',
      'prompt_generation',
    ]);
  });
});
