import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {inputBriefOf, listingFieldsOf} from './listing.js';
import type {
  CheckEvent,
  ModelCallEvent,
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
  it("lists a closed turn's outcome, agent, duration, input in brief, findings and rejections", () => {
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
      findings: 2,
      rejections: 0,
    });
  });

  it('folds a rejection under a finding that points into its message, and counts the rest', () => {
    const noSurface: WirePart = {
      type: 'a2ui',
      content: {version: 'v0.9', updateDataModel: {path: '/x', value: 1}},
    };
    const unfolded: Turn = {events: [turnEvent, output(createSurface, noSurface)]};
    assert.deepEqual(
      [listingFieldsOf(unfolded)?.findings, listingFieldsOf(unfolded)?.rejections],
      [undefined, 1],
    );
    const found: CheckEvent = {
      ...check(false, 1),
      attributes: {
        ...check(false, 1).attributes,
        'a2ui.check.findings': [
          {
            code: 'VALIDATION_FAILED',
            path: '/events/1/attributes/a2ui.wire.message/parts/1/content/updateDataModel',
            message: "must have required property 'surfaceId'",
          },
        ],
      },
    };
    const folded: Turn = {events: [turnEvent, output(createSurface, noSurface), found]};
    assert.deepEqual(
      [listingFieldsOf(folded)?.findings, listingFieldsOf(folded)?.rejections],
      [1, 0],
    );
  });

  it("counts the rejections after the conversation's earlier turns", () => {
    const turn: Turn = {events: [turnEvent, output(createSurface)]};
    assert.equal(listingFieldsOf(turn)?.rejections, 0);
    assert.equal(listingFieldsOf(turn, [turn])?.rejections, 1);
  });

  it("counts the model proxy's failed calls, and not a failed span the receiver placed", () => {
    const call = (spanId: string, code: 1 | 2, received = false): ModelCallEvent => ({
      traceId: TRACE,
      spanId,
      parentSpanId: TURN_SPAN,
      name: 'generate_content gemini-3.6-flash',
      kind: 3,
      startTimeUnixNano: '1792576800100000000',
      endTimeUnixNano: '1792576800200000000',
      attributes: {
        'a2ui.event.kind': 'model_call',
        ...(code === 2 && {'error.type': '429'}),
        ...(received && {'a2ui.received.attributes': {}}),
      },
      status: {code},
    });
    const fields = listingFieldsOf({
      events: [
        turnEvent,
        call('a'.repeat(16), 2),
        call('b'.repeat(16), 1),
        call('c'.repeat(16), 2),
        call('d'.repeat(16), 2, true),
      ],
    });
    assert.equal(fields?.failedModelCalls, 2);
    assert.equal(
      listingFieldsOf({events: [turnEvent, call('b'.repeat(16), 1)]})?.failedModelCalls,
      undefined,
    );
  });

  it('leaves out what a turn does not have', () => {
    assert.deepEqual(listingFieldsOf({events: [turnEvent]}), {
      outcome: 'waiting_for_input',
      durationMs: 1000,
      rejections: 0,
    });
  });
});
