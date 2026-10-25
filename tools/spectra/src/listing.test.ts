import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {inputBriefOf, listingFieldsOf} from './listing.js';
import type {
  CheckEvent,
  Turn,
  TurnEvent,
  WireInputEvent,
  WireOutputEvent,
  WirePart,
} from './record/turn_record.js';

const TRACE = '0'.repeat(32);
const TURN_SPAN = '1'.repeat(16);

function input(...parts: WirePart[]): WireInputEvent {
  return {
    traceId: TRACE,
    spanId: '2'.repeat(16),
    parentSpanId: TURN_SPAN,
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {'a2ui.event.kind': 'wire_input', 'a2ui.wire.message': {role: 'user', parts}},
  };
}

function output(...parts: WirePart[]): WireOutputEvent {
  return {
    traceId: TRACE,
    spanId: '4'.repeat(16),
    parentSpanId: TURN_SPAN,
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: '1792800000500000000',
    attributes: {'a2ui.event.kind': 'wire_output', 'a2ui.wire.message': {role: 'assistant', parts}},
  };
}

const createSurface: WirePart = {
  type: 'a2ui',
  content: {
    version: 'v0.9',
    createSurface: {
      surfaceId: 's1',
      catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    },
  },
};

const turnEvent: TurnEvent = {
  traceId: TRACE,
  spanId: TURN_SPAN,
  name: 'invoke_agent',
  kind: 3,
  startTimeUnixNano: '1792800000000000000',
  endTimeUnixNano: '1792800001000000000',
  attributes: {
    'a2ui.event.kind': 'turn',
    'gen_ai.operation.name': 'invoke_agent',
    'a2ui.turn.outcome': 'waiting_for_input',
    'a2ui.turn.capture_paths': ['wire'],
    'a2ui.turn.writer.name': 'a2ui-spectra',
    'a2ui.turn.writer.version': '0.0.1',
  },
  status: {code: 1},
};

function check(passed: boolean, findings: number): CheckEvent {
  return {
    traceId: TRACE,
    spanId: '3'.repeat(16),
    parentSpanId: TURN_SPAN,
    name: 'check schema',
    kind: 1,
    startTimeUnixNano: '1792800001000000000',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'schema',
      'a2ui.check.passed': passed,
      'a2ui.check.protocol_version': 'v0.9',
      'a2ui.check.findings': Array.from({length: findings}, () => ({
        code: 'VALIDATION_FAILED',
        message: 'Bad.',
      })),
    },
  };
}

describe('inputBriefOf', () => {
  it('is the first text part that is not blank, its white space collapsed', () => {
    assert.deepEqual(
      inputBriefOf(
        input({type: 'text', content: ' '}, {type: 'text', content: ' Book\n a table '}),
      ),
      {text: 'Book a table'},
    );
  });

  it("is the action's name when no part is text, in v0.9's action or v0.8's userAction", () => {
    assert.deepEqual(
      inputBriefOf(input({type: 'a2ui', content: [{version: 'v0.9.1', action: {name: 'next'}}]})),
      {action: 'next'},
    );
    assert.deepEqual(inputBriefOf(input({type: 'a2ui', content: {userAction: {name: 'book'}}})), {
      action: 'book',
    });
  });

  it("is the first part's type otherwise, and nothing with no parts", () => {
    assert.deepEqual(inputBriefOf(input({type: 'data', content: {}})), {partType: 'data'});
    assert.equal(inputBriefOf(input()), undefined);
  });
});

describe('listingFieldsOf', () => {
  it("lists a closed turn's outcome, agent, duration, input in brief, schema check and rejections", () => {
    const turn: Turn = {
      events: [
        {
          ...turnEvent,
          attributes: {...turnEvent.attributes, 'gen_ai.agent.name': 'Restaurant Agent'},
        },
        input({type: 'text', content: 'Hi'}),
        check(false, 2),
      ],
    };
    assert.deepEqual(listingFieldsOf(turn), {
      outcome: 'waiting_for_input',
      agentName: 'Restaurant Agent',
      durationMs: 1000,
      input: {text: 'Hi'},
      schemaCheck: {passed: false, findings: 2},
      rejections: 0,
    });
  });

  it("counts the rejections after the conversation's earlier turns", () => {
    const turn: Turn = {events: [turnEvent, output(createSurface)]};
    assert.equal(listingFieldsOf(turn)?.rejections, 0);
    assert.equal(listingFieldsOf(turn, [turn])?.rejections, 1);
  });

  it('leaves out what a turn does not have', () => {
    assert.deepEqual(listingFieldsOf({events: [turnEvent]}), {
      outcome: 'waiting_for_input',
      durationMs: 1000,
      rejections: 0,
    });
  });
});
