import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {agentMessages, locateFinding, messageKey} from './messages.ts';
import type {TurnRecordEvent, WirePart} from './record.ts';

function output(...parts: WirePart[]): TurnRecordEvent {
  return {
    traceId: '0'.repeat(32),
    spanId: '1'.repeat(16),
    parentSpanId: '2'.repeat(16),
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {role: 'assistant', parts},
    },
  };
}

const CREATE = {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'c'}};
const UPDATE = {version: 'v0.9', updateComponents: {surfaceId: 's', components: []}};

/** A turn's events: the turn event's place taken by a text output, then two A2UI parts. */
const EVENTS: TurnRecordEvent[] = [
  output({type: 'text', content: 'hi'}),
  output({type: 'text', content: 'two parts'}, {type: 'a2ui', content: CREATE}),
  output({type: 'a2ui', content: [CREATE, UPDATE]}),
];

describe('agentMessages', () => {
  it("lists the agent's A2UI messages in order, each element of an array on its own", () => {
    assert.deepEqual(
      agentMessages(EVENTS).map(({key, message, index}) => ({key, message, index})),
      [
        {key: messageKey(1, 1), message: CREATE, index: undefined},
        {key: messageKey(2, 0, 0), message: CREATE, index: 0},
        {key: messageKey(2, 0, 1), message: UPDATE, index: 1},
      ],
    );
  });

  it('counts the TypeScript restaurant finder messages of its first turn', () => {
    const record = readRecording('node_restaurant_finder/stream_v1_0_booking');
    assert.equal(agentMessages(record.turns[0].events).length, 8);
  });
});

describe('locateFinding', () => {
  const base = '/events/2/attributes/a2ui.wire.message/parts/0/content';

  it('finds a message in an array, with the path inside it', () => {
    assert.deepEqual(locateFinding(EVENTS, `${base}/1/updateComponents/components`), {
      key: messageKey(2, 0, 1),
      inner: '/updateComponents/components',
    });
  });

  it('finds a message that is the whole content', () => {
    assert.deepEqual(
      locateFinding(EVENTS, '/events/1/attributes/a2ui.wire.message/parts/1/content/version'),
      {key: messageKey(1, 1), inner: '/version'},
    );
  });

  it('finds the message itself when the path ends at it', () => {
    assert.deepEqual(locateFinding(EVENTS, `${base}/0`), {key: messageKey(2, 0, 0), inner: ''});
  });

  it('finds nothing for a path that names no A2UI message', () => {
    assert.equal(
      locateFinding(EVENTS, '/events/0/attributes/a2ui.wire.message/parts/0/content'),
      undefined,
    );
    assert.equal(locateFinding(EVENTS, `${base}/7`), undefined);
    assert.equal(locateFinding(EVENTS, '/events/9'), undefined);
    assert.equal(locateFinding(EVENTS, undefined), undefined);
  });
});
