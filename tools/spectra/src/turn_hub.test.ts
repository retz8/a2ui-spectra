import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ModelCallEvent, Turn, WireInputEvent} from './record/turn_record.js';
import {type HubEvent, TurnHub} from './turn_hub.js';

const TRACE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TRACE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function wireInput(traceId: string): WireInputEvent {
  return {
    traceId,
    spanId: '0000000000000001',
    parentSpanId: '0000000000000000',
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: '1792576800001000000',
    attributes: {
      'a2ui.event.kind': 'wire_input',
      'a2ui.wire.message': {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
    },
  };
}

/** A closed turn: its turn event alone. */
function closedTurn(traceId: string): Turn {
  return {
    events: [
      {
        traceId,
        spanId: '0000000000000000',
        name: 'invoke_agent',
        kind: 3,
        startTimeUnixNano: '1792576800000000000',
        endTimeUnixNano: '1792576801000000000',
        attributes: {
          'a2ui.event.kind': 'turn',
          'gen_ai.operation.name': 'invoke_agent',
          'a2ui.turn.outcome': 'completed',
          'a2ui.turn.capture_paths': ['wire'],
          'a2ui.turn.writer.name': 'a2ui-spectra',
          'a2ui.turn.writer.version': '0.0.1',
        },
        status: {code: 1},
      },
    ],
  };
}

function open(hub: TurnHub, traceId: string, conversationId?: string): void {
  hub.onTurn({
    type: 'turn_opened',
    traceId,
    spanId: '0'.repeat(16),
    ...(conversationId !== undefined && {conversationId}),
    startTimeUnixNano: '1792576800000000000',
    messageId: `m-${traceId[0]}`,
  });
  hub.onTurn({type: 'wire_event', traceId, event: wireInput(traceId)});
}

describe('the turn hub', () => {
  it('keeps a turn open until the recorder hands it on, then closes it', () => {
    const hub = new TurnHub();
    const events: HubEvent[] = [];
    hub.subscribe(event => events.push(event));
    open(hub, TRACE_A, 'ctx-1');
    assert.deepEqual(hub.openTurns(), [
      {
        traceId: TRACE_A,
        conversationId: 'ctx-1',
        startTime: '2026-10-21T10:00:00.000Z',
        input: {text: 'Hi'},
      },
    ]);

    hub.onTurn({type: 'turn_closed', traceId: TRACE_A, turn: closedTurn(TRACE_A)});
    assert.equal(hub.isOpen(TRACE_A), true, 'The adapter closing a turn does not close it here.');

    hub.onRecorded(closedTurn(TRACE_A));
    assert.equal(hub.isOpen(TRACE_A), false);
    assert.deepEqual(
      events.map(event => event.type),
      ['turn_opened', 'wire_event', 'turn_closed'],
    );
    assert.deepEqual(events[0], {
      type: 'turn_opened',
      traceId: TRACE_A,
      conversationId: 'ctx-1',
      startTime: '2026-10-21T10:00:00.000Z',
      messageId: 'm-a',
    });
    assert.deepEqual(events[2], {type: 'turn_closed', traceId: TRACE_A, turn: closedTurn(TRACE_A)});
  });

  it("catches a new subscriber up on each open turn's events so far, then goes live", () => {
    const hub = new TurnHub();
    open(hub, TRACE_A);
    open(hub, TRACE_B);
    hub.onRecorded(closedTurn(TRACE_A));

    const events: HubEvent[] = [];
    hub.subscribe(event => events.push(event), {catchUp: true});
    assert.deepEqual(
      events.map(event => [event.type, event.traceId]),
      [
        ['turn_opened', TRACE_B],
        ['wire_event', TRACE_B],
      ],
    );
    hub.onRecorded(closedTurn(TRACE_B));
    assert.deepEqual(events.at(-1)?.type, 'turn_closed');
  });

  it('gives an open turn the conversation a reply names after it opened', () => {
    const hub = new TurnHub();
    const events: HubEvent[] = [];
    hub.subscribe(event => events.push(event));
    open(hub, TRACE_A);
    hub.onTurn({
      type: 'wire_event',
      traceId: TRACE_A,
      conversationId: 'ctx-2',
      event: wireInput(TRACE_A),
    });
    const last = events.at(-1);
    assert.equal(last?.type === 'wire_event' && last.conversationId, 'ctx-2');
    assert.equal(hub.openTurns()[0].conversationId, 'ctx-2');

    const late: HubEvent[] = [];
    hub.subscribe(event => late.push(event), {catchUp: true});
    const [opened] = late;
    assert.equal(opened.type === 'turn_opened' && opened.conversationId, 'ctx-2');
  });

  it("passes a call's events on, and catches a new subscriber up on an open turn's calls with their chunks so far", () => {
    const hub = new TurnHub();
    const events: HubEvent[] = [];
    hub.subscribe(event => events.push(event));
    open(hub, TRACE_A);
    const call = (spanId: string, end?: string): ModelCallEvent => ({
      traceId: TRACE_A,
      spanId,
      parentSpanId: '0'.repeat(16),
      name: 'chat m',
      kind: 3,
      startTimeUnixNano: '1792576800002000000',
      ...(end !== undefined && {endTimeUnixNano: end}),
      attributes: {'a2ui.event.kind': 'model_call'},
    });
    const chunk = (body: string) => ({
      timeUnixNano: '1792576800003000000',
      name: 'a2ui.http.response.chunk',
      attributes: {'a2ui.http.response.chunk.body': body},
    });
    hub.onCall({type: 'call_started', traceId: TRACE_A, event: call('a'.repeat(16))});
    hub.onCall({type: 'call_chunk', traceId: TRACE_A, spanId: 'a'.repeat(16), chunk: chunk('one')});
    hub.onCall({type: 'call_started', traceId: TRACE_A, event: call('b'.repeat(16))});
    hub.onCall({type: 'call_chunk', traceId: TRACE_A, spanId: 'a'.repeat(16), chunk: chunk('two')});
    const progress = (spanId: string, text: string) => ({
      type: 'call_progress' as const,
      traceId: TRACE_A,
      spanId,
      attributes: {
        'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'text', content: text}]}],
      },
    });
    hub.onCall(progress('a'.repeat(16), 'one two'));
    hub.onCall({
      type: 'call_ended',
      traceId: TRACE_A,
      event: call('a'.repeat(16), '1792576800004000000'),
    });
    hub.onCall({type: 'call_chunk', traceId: TRACE_A, spanId: 'b'.repeat(16), chunk: chunk('x')});
    hub.onCall(progress('b'.repeat(16), 'x'));
    hub.onCall({type: 'call_chunk', traceId: TRACE_A, spanId: 'b'.repeat(16), chunk: chunk('y')});
    hub.onCall(progress('b'.repeat(16), 'xy'));
    assert.deepEqual(
      events.map(event => event.type),
      [
        'turn_opened',
        'wire_event',
        'call_started',
        'call_chunk',
        'call_started',
        'call_chunk',
        'call_progress',
        'call_ended',
        'call_chunk',
        'call_progress',
        'call_chunk',
        'call_progress',
      ],
    );

    const late: HubEvent[] = [];
    hub.subscribe(event => late.push(event), {catchUp: true});
    assert.deepEqual(
      late.map(event => [
        event.type,
        'spanId' in event
          ? event.spanId
          : 'event' in event && 'spanId' in event.event
            ? event.event.spanId
            : '',
      ]),
      [
        ['turn_opened', ''],
        ['wire_event', '0000000000000001'],
        ['call_started', 'a'.repeat(16)],
        ['call_chunk', 'a'.repeat(16)],
        ['call_chunk', 'a'.repeat(16)],
        ['call_ended', 'a'.repeat(16)],
        ['call_started', 'b'.repeat(16)],
        ['call_chunk', 'b'.repeat(16)],
        ['call_chunk', 'b'.repeat(16)],
        ['call_progress', 'b'.repeat(16)],
      ],
    );
    // A call in flight catches up with its latest progress only.
    assert.deepEqual(late[late.length - 1], progress('b'.repeat(16), 'xy'));
    hub.onRecorded(closedTurn(TRACE_A));
    const after: HubEvent[] = [];
    hub.subscribe(event => after.push(event), {catchUp: true});
    assert.deepEqual(after, []);
  });

  it('stops passing events to a listener that unsubscribed', () => {
    const hub = new TurnHub();
    const events: HubEvent[] = [];
    const unsubscribe = hub.subscribe(event => events.push(event));
    unsubscribe();
    open(hub, TRACE_A);
    assert.deepEqual(events, []);
  });

  it("passes the receiver's amendments on, and catches a new subscriber up on an open turn's latest", () => {
    const hub = new TurnHub();
    const live: HubEvent[] = [];
    hub.subscribe(event => live.push(event));
    open(hub, TRACE_A);
    const span = {...wireInput(TRACE_A), spanId: 'e'.repeat(16)};
    hub.onAmended(TRACE_A, [span]);
    hub.onAmended(TRACE_A, [{...span, name: 'again'}]);
    hub.onAmended(TRACE_A, []);
    assert.deepEqual(
      live
        .filter(event => event.type === 'turn_amended')
        .map(event => event.type === 'turn_amended' && event.events[0].name),
      [span.name, 'again'],
    );
    const caught: HubEvent[] = [];
    hub.subscribe(event => caught.push(event), {catchUp: true});
    assert.deepEqual(caught[caught.length - 1], {
      type: 'turn_amended',
      traceId: TRACE_A,
      events: [{...span, name: 'again'}],
    });
    hub.onRecorded(closedTurn(TRACE_A));
    // A written turn's amendment is passed on, and kept for no catch-up.
    hub.onAmended(TRACE_A, [span]);
    assert.equal(live[live.length - 1].type, 'turn_amended');
    const later: HubEvent[] = [];
    hub.subscribe(event => later.push(event), {catchUp: true});
    assert.deepEqual(later, []);
  });
});
