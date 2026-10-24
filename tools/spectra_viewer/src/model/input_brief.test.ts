import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {inputBrief, inputBriefOfTurn} from './input_brief.ts';
import type {WireInputEvent, WirePart} from './record.ts';

function input(...parts: WirePart[]): WireInputEvent {
  return {
    traceId: '0'.repeat(32),
    spanId: '1'.repeat(16),
    parentSpanId: '2'.repeat(16),
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'wire_input',
      'a2ui.wire.message': {role: 'user', parts},
    },
  };
}

describe('inputBrief', () => {
  it('is the first text part, with its white space collapsed', () => {
    assert.deepEqual(
      inputBrief(input({type: 'text', content: '  Top 5 Chinese\n restaurants  '})),
      {text: 'Top 5 Chinese restaurants'},
    );
  });

  it('passes over a blank text part for the next one', () => {
    assert.deepEqual(
      inputBrief(input({type: 'text', content: ' '}, {type: 'text', content: 'hello'})),
      {text: 'hello'},
    );
  });

  it("is the action's name when no part is text", () => {
    assert.deepEqual(
      inputBrief(
        input({type: 'a2ui', content: {version: 'v0.9', action: {name: 'submit_booking'}}}),
      ),
      {action: 'submit_booking'},
    );
  });

  it("reads the action's name from an array and from v0.8's userAction", () => {
    assert.deepEqual(
      inputBrief(input({type: 'a2ui', content: [{version: 'v0.9.1', action: {name: 'next'}}]})),
      {action: 'next'},
    );
    assert.deepEqual(inputBrief(input({type: 'a2ui', content: {userAction: {name: 'book'}}})), {
      action: 'book',
    });
  });

  it("is the first part's type when no part is text or an action", () => {
    assert.deepEqual(inputBrief(input({type: 'data', content: {a: 1}}, {type: 'uri'})), {
      partType: 'data',
    });
  });

  it('is nothing for an input with no parts', () => {
    assert.equal(inputBrief(input()), undefined);
  });
});

describe('inputBriefOfTurn', () => {
  it("reads the Angular client's actions in its booking conversation", () => {
    const record = readRecording('angular_client/python_restaurant_finder_booking');
    assert.deepEqual(record.turns.map(inputBriefOfTurn), [
      {text: 'Top 3 Chinese restaurants in New York'},
      {action: 'book_restaurant'},
      {action: 'submit_booking'},
    ]);
  });
});
