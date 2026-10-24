import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn, WireInputEvent} from './record/turn_record.js';
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

  it('stops passing events to a listener that unsubscribed', () => {
    const hub = new TurnHub();
    const events: HubEvent[] = [];
    const unsubscribe = hub.subscribe(event => events.push(event));
    unsubscribe();
    open(hub, TRACE_A);
    assert.deepEqual(events, []);
  });
});
