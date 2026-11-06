import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ModelCallEvent, ToolCallEvent, Turn, TurnEvent} from '../record/turn_record.js';
import {createSurface, testTurn, updateComponents, updateDataModel} from '../testing/turns.js';
import {verdictOf} from './verdict.js';

const TURN = 'b7ad6b7169203331';

function withOutcome(turn: Turn, outcome: TurnEvent['attributes']['a2ui.turn.outcome']): Turn {
  const [turnEvent, ...rest] = turn.events as [TurnEvent, ...Turn['events']];
  return {
    events: [
      {...turnEvent, attributes: {...turnEvent.attributes, 'a2ui.turn.outcome': outcome}},
      ...rest,
    ],
  };
}

function withCalls(turn: Turn, ...calls: Array<ModelCallEvent | ToolCallEvent>): Turn {
  return {events: [...turn.events, ...calls]};
}

function modelCall(
  spanId: string,
  attributes: Record<string, unknown>,
  failed = false,
): ModelCallEvent {
  return {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId,
    parentSpanId: TURN,
    name: 'chat',
    kind: 3,
    startTimeUnixNano: '1792576860300000000',
    endTimeUnixNano: '1792576860400000000',
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'url.full':
        'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=REMOVED',
      ...attributes,
    },
    status: failed ? {code: 2, message: 'missed'} : {code: 1},
  };
}

function toolCall(
  spanId: string,
  attributes: Record<string, unknown>,
  failed = false,
): ToolCallEvent {
  return {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId,
    parentSpanId: TURN,
    name: 'tools/call',
    kind: 3,
    startTimeUnixNano: '1792576860300000000',
    endTimeUnixNano: '1792576860400000000',
    attributes: {
      'a2ui.event.kind': 'tool_call',
      'http.request.method': 'POST',
      'url.full': 'http://127.0.0.1:8000/mcp',
      ...attributes,
    },
    status: failed ? {code: 2, message: 'missed'} : {code: 1},
  };
}

const messages = [
  createSurface('s1'),
  updateComponents('s1', [{id: 'root', component: {Text: {text: 'Hi'}}}]),
];

describe('verdictOf, the replayed turn against the recorded one', () => {
  it('passes a turn whose calls were all served, whose outcome is the recorded one and whose A2UI equals the record by value', () => {
    const recorded = withCalls(
      testTurn({messages}),
      modelCall('aaaaaaaaaaaaaaaa', {}),
      toolCall('bbbbbbbbbbbbbbbb', {'mcp.method.name': 'tools/call'}),
    );
    const replayed = withCalls(
      testTurn({messages: [...messages]}),
      modelCall('cccccccccccccccc', {'a2ui.replay.served_from': 'aaaaaaaaaaaaaaaa'}),
      toolCall('dddddddddddddddd', {
        'mcp.method.name': 'tools/call',
        'a2ui.replay.served_from': 'bbbbbbbbbbbbbbbb',
      }),
    );
    assert.deepEqual(verdictOf(recorded, replayed), {verdict: 'passed', reasons: []});
  });

  it('compares the flattened sequence of A2UI messages, so an array part and single parts carrying the same messages are equal', () => {
    const recorded = testTurn({deliveries: [[messages[0]], [messages[1]]]});
    const replayed = testTurn({deliveries: [[messages[0], messages[1]]]});
    assert.equal(verdictOf(recorded, replayed).verdict, 'passed');
    const arrayPart: Turn = {
      events: testTurn({})
        .events.slice(0, 2)
        .concat({
          ...testTurn({messages}).events[2],
          attributes: {
            'a2ui.event.kind': 'wire_output',
            'a2ui.wire.message': {role: 'assistant', parts: [{type: 'a2ui', content: messages}]},
          },
        } as Turn['events'][number]),
    };
    assert.equal(verdictOf(recorded, arrayPart).verdict, 'passed');
  });

  it('fails a miss, one reason per missed call naming its method and path, the credentials gone with the key', () => {
    const recorded = testTurn({messages});
    const replayed = withCalls(
      testTurn({messages}),
      modelCall('cccccccccccccccc', {'error.type': 'replay_miss'}, true),
      toolCall(
        'dddddddddddddddd',
        {'mcp.method.name': 'tools/call', 'error.type': 'replay_miss'},
        true,
      ),
    );
    assert.deepEqual(verdictOf(recorded, replayed), {
      verdict: 'failed',
      reasons: [
        {
          code: 'REPLAY_MISS',
          message:
            'A model call matched nothing in the record: POST /v1beta/models/gemini:generateContent.',
        },
        {code: 'REPLAY_MISS', message: 'A tool call matched nothing in the record: POST /mcp.'},
      ],
    });
  });

  it('does not fail an answer the protocol fixed, a tool call with no served_from that is not a miss, nor a live call', () => {
    const recorded = testTurn({messages});
    const replayed = withCalls(
      testTurn({messages}),
      toolCall('dddddddddddddddd', {'mcp.method.name': 'notifications/initialized'}),
      modelCall('cccccccccccccccc', {}),
    );
    assert.equal(verdictOf(recorded, replayed).verdict, 'passed');
  });

  it('fails a different outcome, naming both', () => {
    const recorded = withOutcome(testTurn({messages}), 'waiting_for_input');
    const replayed = testTurn({messages});
    assert.deepEqual(verdictOf(recorded, replayed).reasons, [
      {
        code: 'OUTCOME_DIFFERS',
        message: 'The turn ended completed; the record ended waiting for input.',
      },
    ]);
  });

  it('fails different A2UI, naming the first message that differs with its path in the replayed turn', () => {
    const recorded = testTurn({messages: [...messages, updateDataModel('s1', {n: 1})]});
    const replayed = testTurn({
      messages: [messages[0], updateComponents('s1', []), updateDataModel('s1', {n: 1})],
    });
    assert.deepEqual(verdictOf(recorded, replayed).reasons, [
      {
        code: 'A2UI_DIFFERS',
        message: 'The A2UI differs from the record: message 2 of 3 is not the recorded one.',
        path: '/events/2/attributes/a2ui.wire.message/parts/1/content',
      },
    ]);
  });

  it('fails A2UI of another length, naming both counts, the path the first message beyond the record when there is one', () => {
    const recorded = testTurn({messages});
    assert.deepEqual(verdictOf(recorded, testTurn({messages: [messages[0]]})).reasons, [
      {
        code: 'A2UI_DIFFERS',
        message: 'The A2UI differs from the record: this turn sent 1 message, the record sent 2.',
      },
    ]);
    assert.deepEqual(
      verdictOf(recorded, testTurn({messages: [...messages, updateDataModel('s1', {n: 1})]}))
        .reasons,
      [
        {
          code: 'A2UI_DIFFERS',
          message:
            'The A2UI differs from the record: this turn sent 3 messages, the record sent 2.',
          path: '/events/2/attributes/a2ui.wire.message/parts/2/content',
        },
      ],
    );
  });

  it('lists every reason, the misses first, then the outcome, then the A2UI', () => {
    const recorded = withOutcome(testTurn({messages}), 'completed');
    const replayed = withOutcome(
      withCalls(
        testTurn({messages: [messages[0]]}),
        modelCall('cccccccccccccccc', {'error.type': 'replay_miss'}, true),
      ),
      'failed',
    );
    assert.deepEqual(
      verdictOf(recorded, replayed).reasons.map(reason => reason.code),
      ['REPLAY_MISS', 'OUTCOME_DIFFERS', 'A2UI_DIFFERS'],
    );
  });
});
