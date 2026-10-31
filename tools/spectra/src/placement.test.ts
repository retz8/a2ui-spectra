import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {TurnNotification} from './a2a/turn.js';
import {CallPlacer} from './placement.js';
import type {ModelCallEvent, Turn, TurnEvent} from './record/turn_record.js';

const T1 = 'a'.repeat(32);
const T2 = 'b'.repeat(32);
const S1 = '1'.repeat(16);
const S2 = '2'.repeat(16);

function turnEvent(traceId: string, spanId: string): TurnEvent {
  return {
    traceId,
    spanId,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1000000000000',
    endTimeUnixNano: '5000000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'test',
      'a2ui.turn.writer.version': '0',
    },
    status: {code: 1},
  };
}

function wireOutput(traceId: string, parent: string, at: string) {
  return {
    traceId,
    spanId: 'c'.repeat(16),
    parentSpanId: parent,
    name: 'wire_output',
    kind: 1 as const,
    startTimeUnixNano: at,
    attributes: {
      'a2ui.event.kind': 'wire_output' as const,
      'a2ui.wire.message': {role: 'assistant' as const, parts: []},
    },
  };
}

function call(traceId: string, parent: string, start: string, end: string): ModelCallEvent {
  return {
    traceId,
    spanId: 'd'.repeat(16),
    parentSpanId: parent,
    name: 'chat m',
    kind: 3,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: {'a2ui.event.kind': 'model_call'},
  };
}

function opened(traceId: string, spanId: string): TurnNotification {
  return {type: 'turn_opened', traceId, spanId, startTimeUnixNano: '1000000000000'};
}

function closed(traceId: string, spanId: string): TurnNotification {
  return {
    type: 'turn_closed',
    traceId,
    turn: {events: [turnEvent(traceId, spanId), wireOutput(traceId, spanId, '3000000000000')]},
  };
}

function setUp(alwaysCapturePaths?: Array<'model_proxy'>) {
  const out: TurnNotification[] = [];
  const log: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => out.push(notification),
    log: line => log.push(line),
    ...(alwaysCapturePaths && {alwaysCapturePaths}),
  });
  const handedOn = () =>
    out.filter(
      (n): n is Extract<TurnNotification, {type: 'turn_closed'}> => n.type === 'turn_closed',
    );
  return {placer, out, log, handedOn};
}

const aCall = {what: 'a model call to h, POST /p', startTimeUnixNano: '2000000000000'};

describe('CallPlacer', () => {
  it('passes a turn opened on at once, and a turn closed with no calls', () => {
    const {placer, out} = setUp();
    placer.onTurn(opened(T1, S1));
    assert.equal(out[0]?.type, 'turn_opened');
    placer.onTurn(closed(T1, S1));
    assert.equal(out[1]?.type, 'turn_closed');
  });

  it('places a call without trace context in the one open turn, and holds the turn until the call ends', () => {
    const {placer, handedOn, log} = setUp();
    placer.onTurn(opened(T1, S1));
    const placed = placer.place(aCall);
    assert.deepEqual([placed?.traceId, placed?.parentSpanId], [T1, S1]);
    placer.onTurn(closed(T1, S1));
    assert.equal(handedOn().length, 0, 'the turn waits for its call');
    placed?.ended(call(T1, S1, '2000000000000', '4000000000000'));
    const [turn] = handedOn();
    const kinds = turn.turn.events.map(event => event.attributes['a2ui.event.kind']);
    assert.deepEqual(
      kinds,
      ['turn', 'model_call', 'wire_output'],
      'the call joins the events by start time',
    );
    const event = turn.turn.events[0] as TurnEvent;
    assert.deepEqual(event.attributes['a2ui.turn.capture_paths'], ['wire', 'model_proxy']);
    assert.equal(
      event.endTimeUnixNano,
      '5000000000000',
      "the turn's end stays the agent's last reply",
    );
    assert.deepEqual(log, []);
  });

  it('places a call by its trace id while two turns are open', () => {
    const {placer} = setUp();
    placer.onTurn(opened(T1, S1));
    placer.onTurn(opened(T2, S2));
    const placed = placer.place({...aCall, traceparent: `00-${T2}-${S1}-01`});
    assert.deepEqual([placed?.traceId, placed?.parentSpanId], [T2, S2]);
  });

  it('places a call whose trace id names no turn by the time window', () => {
    const {placer} = setUp();
    placer.onTurn(opened(T1, S1));
    const placed = placer.place({...aCall, traceparent: `00-${'e'.repeat(32)}-${S1}-01`});
    assert.equal(placed?.traceId, T1);
  });

  it('does not place a call when no turn is open, or two are, and says why', () => {
    const {placer, log} = setUp();
    assert.equal(placer.place(aCall), undefined);
    placer.onTurn(opened(T1, S1));
    placer.onTurn(opened(T2, S2));
    assert.equal(placer.place(aCall), undefined);
    assert.deepEqual(log, [
      'A model call to h, POST /p at 1970-01-01T00:33:20.000Z was not placed in a turn: no turn is open. It is not recorded.',
      'A model call to h, POST /p at 1970-01-01T00:33:20.000Z was not placed in a turn: 2 turns are open. It is not recorded.',
    ]);
  });

  it('does not place a call whose trace id names a turn already written', () => {
    const {placer, log} = setUp();
    placer.onTurn(opened(T1, S1));
    placer.onTurn(closed(T1, S1));
    placer.onTurn(opened(T2, S2));
    assert.equal(placer.place({...aCall, traceparent: `00-${T1}-${S1}-01`}), undefined);
    assert.match(log[0], new RegExp(`its turn ${T1} is already written`));
  });

  it('places a call carrying the trace id of a turn waiting for its calls, and hands the turn on after both', () => {
    const {placer, handedOn} = setUp();
    placer.onTurn(opened(T1, S1));
    const first = placer.place(aCall);
    placer.onTurn(closed(T1, S1));
    placer.onTurn(opened(T2, S2));
    const second = placer.place({...aCall, traceparent: `00-${T1}-${S1}-01`});
    assert.equal(second?.traceId, T1);
    first?.ended(call(T1, S1, '2000000000000', '4000000000000'));
    assert.equal(handedOn().length, 0);
    second?.ended(call(T1, S1, '4100000000000', '4200000000000'));
    assert.equal(handedOn().length, 1);
    assert.equal(
      handedOn()[0].turn.events.filter(
        event => event.attributes['a2ui.event.kind'] === 'model_call',
      ).length,
      2,
    );
  });

  it('counts a turn waiting for its calls as open for the time window', () => {
    const {placer, log} = setUp();
    placer.onTurn(opened(T1, S1));
    const first = placer.place(aCall);
    placer.onTurn(closed(T1, S1));
    assert.equal(placer.place(aCall)?.traceId, T1);
    placer.onTurn(opened(T2, S2));
    assert.equal(placer.place(aCall), undefined);
    assert.match(log[0], /2 turns are open/);
    first?.ended(call(T1, S1, '2000000000000', '4000000000000'));
  });

  it('lists model_proxy on every turn under run, and only on a turn with a call under attach', () => {
    const run = setUp(['model_proxy']);
    run.placer.onTurn(opened(T1, S1));
    run.placer.onTurn(closed(T1, S1));
    const runTurn = run.handedOn()[0].turn.events[0] as TurnEvent;
    assert.deepEqual(runTurn.attributes['a2ui.turn.capture_paths'], ['wire', 'model_proxy']);

    const attach = setUp();
    attach.placer.onTurn(opened(T1, S1));
    attach.placer.onTurn(closed(T1, S1));
    const attachTurn = attach.handedOn()[0].turn.events[0] as TurnEvent;
    assert.deepEqual(attachTurn.attributes['a2ui.turn.capture_paths'], ['wire']);
  });

  it('ends a call once', () => {
    const {placer, handedOn} = setUp();
    placer.onTurn(opened(T1, S1));
    const placed = placer.place(aCall);
    placer.onTurn(closed(T1, S1));
    placed?.ended(call(T1, S1, '2000000000000', '4000000000000'));
    placed?.ended(call(T1, S1, '2000000000000', '4000000000000'));
    const turn: Turn = handedOn()[0].turn;
    assert.equal(
      turn.events.filter(event => event.attributes['a2ui.event.kind'] === 'model_call').length,
      1,
    );
  });
});
