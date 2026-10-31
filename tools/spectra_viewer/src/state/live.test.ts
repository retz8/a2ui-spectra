import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedTurn} from '../api.ts';
import {pickedRowId} from '../model/follow.ts';
import type {OtherEvent, Turn, TurnEvent, TurnRecordEvent} from '../model/record.ts';
import {timelineOf} from '../model/steps.ts';
import {at, linked, modelCall, receivedSpan, T0, toolCall, TRACE} from '../testing/model_calls.ts';
import {
  callChanged,
  type LiveState,
  recordRead,
  rowFromRecord,
  turnAmended,
  turnOpened,
} from './live.ts';

const START = Number(T0 / 1_000_000n);

function turnEvent(): TurnEvent {
  return {
    traceId: TRACE,
    spanId: '0'.repeat(16),
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: at(0),
    endTimeUnixNano: at(3000),
    attributes: {'a2ui.event.kind': 'turn', 'a2ui.turn.outcome': 'completed'},
    status: {code: 1},
  };
}

const proxy = modelCall({
  spanId: 'p'.repeat(16),
  start: 100,
  end: 1100,
  provider: 'gcp.gemini',
  model: 'gemini-3.6-flash',
});

const span = receivedSpan({
  spanId: 's'.repeat(16),
  name: 'generate_content gemini-3.6-flash',
  start: 90,
  end: 1200,
  names: {'gen_ai.provider.name': 'gcp.gemini', 'gen_ai.request.model': 'gemini-3.6-flash'},
  status: {code: 2, message: 'Span failed.'},
});

function stateWith(changes: Partial<LiveState> = {}): LiveState {
  return {
    turns: [{traceId: TRACE, startTime: new Date(START).toISOString(), outcome: 'completed'}],
    live: new Map(),
    closed: new Map(),
    records: new Map(),
    pending: new Map(),
    ...changes,
  };
}

function held(turn: Turn): LiveState {
  return stateWith({records: new Map([[TRACE, {record: {version: 'v0.1', turns: [turn]}}]])});
}

function heldTurn(state: LiveState): Turn {
  const record = state.records.get(TRACE);
  assert.ok(record !== undefined && 'record' in record);
  const {turns} = record.record;
  return turns[turns.length - 1];
}

function rowIds(turn: Turn): string[] {
  return timelineOf(turn.events, START).map(row => row.id);
}

describe('turn_amended', () => {
  it('adds a span to a held record, a row appearing, the list row computed again', () => {
    const before = held({events: [turnEvent(), proxy]});
    assert.deepEqual(rowIds(heldTurn(before)), ['p'.repeat(16), 'outcome']);
    const {state, fetch} = turnAmended(before, {traceId: TRACE, events: [span]});
    assert.equal(fetch, undefined);
    // Unlinked, the span is a row of its own, read from spans only.
    assert.deepEqual(rowIds(heldTurn(state)), ['s'.repeat(16), 'p'.repeat(16), 'outcome']);
    assert.equal((state.turns[0] as ListedTurn).failedCalls, 1);
  });

  it('merges a span-only row into its proxy row when the link arrives, the selection following', () => {
    const first = turnAmended(held({events: [turnEvent(), proxy]}), {
      traceId: TRACE,
      events: [span],
    }).state;
    const picked = 's'.repeat(16);
    assert.equal(pickedRowId(picked, timelineOf(heldTurn(first).events, START)), picked);
    // The next export links the two: the proxy's call and the span, each replaced by span id.
    const second = turnAmended(first, {
      traceId: TRACE,
      events: [linked(proxy, span.spanId), linked(span, proxy.spanId)],
    }).state;
    const rows = timelineOf(heldTurn(second).events, START);
    assert.deepEqual(
      rows.map(row => row.id),
      ['p'.repeat(16), 'outcome'],
    );
    assert.equal(pickedRowId(picked, rows), 'p'.repeat(16));
    // One problem for the pair, the span's failure on the proxy's row.
    assert.equal((second.turns[0] as ListedTurn).failedCalls, 1);
  });

  it('keeps the turn’s own events where they were, the received ones after them, the checks last', () => {
    const check = {
      traceId: TRACE,
      spanId: 'c'.repeat(16),
      name: 'check schema',
      kind: 1,
      startTimeUnixNano: at(3000),
      attributes: {
        'a2ui.event.kind': 'check',
        'a2ui.check.name': 'schema',
        'a2ui.check.passed': true,
        'a2ui.check.protocol_version': 'v0.9',
        'a2ui.check.findings': [],
      },
    } as TurnRecordEvent;
    const {state} = turnAmended(held({events: [turnEvent(), proxy, check]}), {
      traceId: TRACE,
      events: [span],
    });
    assert.deepEqual(
      heldTurn(state).events.map(event => event.spanId),
      ['0'.repeat(16), 'p'.repeat(16), 's'.repeat(16), 'c'.repeat(16)],
    );
  });

  it('fetches a turn the page holds in no form once, applying what came while it was on its way', () => {
    const {state, fetch} = turnAmended(stateWith(), {traceId: TRACE, events: [span]});
    assert.equal(fetch, TRACE);
    // The store marks the record as on its way; a second amendment waits for it.
    const loading = {...state, records: new Map([[TRACE, {loading: true as const}]])};
    const again = turnAmended(loading, {traceId: TRACE, events: [linked(span, proxy.spanId)]});
    assert.equal(again.fetch, undefined);
    assert.equal(again.state.pending.get(TRACE)?.length, 1);
    // The record read before the second export was written: the kept amendment is applied to it.
    const read = rowFromRecord(
      recordRead(again.state, TRACE, {
        version: 'v0.1',
        turns: [{events: [turnEvent(), proxy, span]}],
      }),
      TRACE,
    );
    assert.equal(read.pending.size, 0);
    assert.deepEqual(
      (heldTurn(read).events.find(event => event.spanId === span.spanId) as OtherEvent).links,
      [{traceId: TRACE, spanId: proxy.spanId}],
    );
    assert.equal((read.turns[0] as ListedTurn).failedCalls, 1);
  });

  it('adds the spans to an open turn after its calls, and gives its calls their links', () => {
    let state = turnOpened(
      stateWith({turns: []}),
      {traceId: TRACE, startTime: new Date(START).toISOString()},
      'Agent',
    );
    state = callChanged(state, TRACE, proxy.spanId, () => proxy as OtherEvent);
    state = turnAmended(state, {
      traceId: TRACE,
      events: [linked(proxy, span.spanId), linked(span, proxy.spanId)],
    }).state;
    const live = state.live.get(TRACE)!;
    assert.deepEqual(
      live.events.map(event => event.spanId),
      ['p'.repeat(16), 's'.repeat(16)],
    );
    assert.deepEqual(
      timelineOf(live.events, START).map(row => row.id),
      ['p'.repeat(16)],
    );
  });
});

describe("a tool call's live events", () => {
  it('starts a row in flight, fills it as chunks arrive, and ends it', () => {
    let state = turnOpened(
      stateWith({turns: []}),
      {traceId: TRACE, startTime: new Date(START).toISOString()},
      'Agent',
    );
    const started = toolCall({
      spanId: 't'.repeat(16),
      start: 50,
      method: 'tools/call',
      tool: 'list_runs',
      arguments: {limit: 5},
    }) as OtherEvent;
    state = callChanged(state, TRACE, started.spanId, () => started);
    let rows = timelineOf(state.live.get(TRACE)!.events, START);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].row === 'step' && rows[0].position === undefined);
    const chunk = {
      timeUnixNano: at(60),
      name: 'a2ui.http.response.chunk',
      attributes: {'a2ui.http.response.chunk.body': {method: 'notifications/progress'}},
    };
    state = callChanged(
      state,
      TRACE,
      started.spanId,
      call => call && {...call, events: [...(call.events ?? []), chunk]},
    );
    assert.equal(state.live.get(TRACE)!.calls.get(started.spanId)!.events?.length, 1);
    const ended = toolCall({
      spanId: 't'.repeat(16),
      start: 50,
      end: 90,
      method: 'tools/call',
      tool: 'list_runs',
      arguments: {limit: 5},
      result: {content: [{type: 'text', text: '[]'}]},
    }) as OtherEvent;
    state = callChanged(state, TRACE, ended.spanId, () => ended);
    rows = timelineOf(state.live.get(TRACE)!.events, START);
    assert.equal(rows[0].row === 'step' && rows[0].call?.proxy?.endTimeUnixNano, at(90));
  });

  it("shows a server's notification at once, sent as started and ended back to back", () => {
    let state = turnOpened(
      stateWith({turns: []}),
      {traceId: TRACE, startTime: new Date(START).toISOString()},
      'Agent',
    );
    const notification = {
      ...toolCall({spanId: 'n'.repeat(16), start: 70, end: 70, method: 'notifications/message'}),
      kind: 4,
    } as OtherEvent;
    state = callChanged(state, TRACE, notification.spanId, () => notification);
    state = callChanged(state, TRACE, notification.spanId, () => notification);
    const rows = timelineOf(state.live.get(TRACE)!.events, START);
    assert.deepEqual(
      rows.map(row => (row.row === 'step' ? [row.label, row.housekeeping] : [])),
      [['notifications/message', true]],
    );
  });
});
