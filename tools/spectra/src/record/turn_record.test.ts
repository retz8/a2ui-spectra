import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

import {
  isA2uiPart,
  isEventOfKind,
  type CheckEvent,
  type TurnEvent,
  type TurnRecord,
  type WireInputEvent,
} from './turn_record.js';

// The shared test data's minimal fixtures for the four kinds Phase 2 writes,
// written here as typed values: each must compile against the types and equal
// the fixture on disk, which the conformance suite validates against the schema.

const fixtures = new URL('../../../../conformance/test_data/turn_record/v0_1/', import.meta.url);

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));
}

const turnEvent = {
  traceId: '8ffce95ad85ffb2b6b40c6b475f7b1ef',
  spanId: '067705598ded8695',
  name: 'invoke_agent',
  kind: 3,
  startTimeUnixNano: '1792576800000000000',
  endTimeUnixNano: '1792576801500000000',
  attributes: {
    'a2ui.event.kind': 'turn',
    'gen_ai.operation.name': 'invoke_agent',
    'a2ui.turn.outcome': 'completed',
    'a2ui.turn.capture_paths': ['wire'],
    'a2ui.turn.writer.name': 'a2ui-spectra',
    'a2ui.turn.writer.version': '0.0.0',
  },
  status: {code: 1},
} satisfies TurnEvent;

const minimalTurn = {
  version: 'v0.1',
  turns: [{events: [turnEvent]}],
} satisfies TurnRecord;

const minimalWireInput = {
  version: 'v0.1',
  turns: [
    {
      events: [
        turnEvent,
        {
          traceId: '8ffce95ad85ffb2b6b40c6b475f7b1ef',
          spanId: 'b9958b3b914f49bf',
          parentSpanId: '067705598ded8695',
          name: 'wire_input',
          kind: 1,
          startTimeUnixNano: '1792576800005000000',
          attributes: {
            'a2ui.event.kind': 'wire_input',
            'a2ui.wire.message': {
              role: 'user',
              parts: [{type: 'text', content: 'Hello'}],
            },
          },
        },
      ],
    },
  ],
} satisfies TurnRecord;

const minimalWireOutput = {
  version: 'v0.1',
  turns: [
    {
      events: [
        turnEvent,
        {
          traceId: '8ffce95ad85ffb2b6b40c6b475f7b1ef',
          spanId: '4abe90c49064ad49',
          parentSpanId: '067705598ded8695',
          name: 'wire_output',
          kind: 1,
          startTimeUnixNano: '1792576801400000000',
          attributes: {
            'a2ui.event.kind': 'wire_output',
            'a2ui.wire.message': {
              role: 'assistant',
              parts: [
                {
                  type: 'a2ui',
                  content: [
                    {
                      version: 'v0.9',
                      createSurface: {
                        surfaceId: 'main',
                        catalogId:
                          'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
                      },
                    },
                    {
                      version: 'v0.9',
                      updateComponents: {
                        surfaceId: 'main',
                        components: [{id: 'root', component: 'Text', text: 'Hello'}],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  ],
} satisfies TurnRecord;

const minimalCheck = {
  version: 'v0.1',
  turns: [
    {
      events: [
        turnEvent,
        {
          traceId: '8ffce95ad85ffb2b6b40c6b475f7b1ef',
          spanId: '31f363e9a1195d29',
          parentSpanId: '067705598ded8695',
          name: 'check',
          kind: 1,
          startTimeUnixNano: '1792576801450000000',
          attributes: {
            'a2ui.event.kind': 'check',
            'a2ui.check.name': 'schema',
            'a2ui.check.passed': true,
            'a2ui.check.protocol_version': 'v0.9',
            'a2ui.check.findings': [],
          },
        },
      ],
    },
  ],
} satisfies TurnRecord;

// Shapes the schema rejects, which the types must reject too. Each
// declaration compiles only because of its expected error.

export const turnWithParent: TurnEvent = {
  ...turnEvent,
  // @ts-expect-error: the turn event has no parent.
  parentSpanId: 'b9958b3b914f49bf',
};

export const turnAsInternalSpan: TurnEvent = {
  ...turnEvent,
  // @ts-expect-error: the turn event is a client span.
  kind: 1,
};

export const wireInputWithEndTime: WireInputEvent = {
  ...minimalWireInput.turns[0].events[1],
  // @ts-expect-error: a wire event has no end time.
  endTimeUnixNano: '1792576800006000000',
};

export const wireInputFromAssistant: WireInputEvent = {
  ...minimalWireInput.turns[0].events[1],
  attributes: {
    'a2ui.event.kind': 'wire_input',
    // @ts-expect-error: the host's input has the role user.
    'a2ui.wire.message': {role: 'assistant', parts: []},
  },
};

export const checkWithUnknownName: CheckEvent = {
  ...minimalCheck.turns[0].events[1],
  attributes: {
    ...minimalCheck.turns[0].events[1].attributes,
    // @ts-expect-error: the checks are schema, catalog, structural and binding.
    'a2ui.check.name': 'style',
  },
};

describe('turn record types', () => {
  for (const [name, record] of [
    ['minimal_turn.json', minimalTurn],
    ['minimal_wire_input.json', minimalWireInput],
    ['minimal_wire_output.json', minimalWireOutput],
    ['minimal_check.json', minimalCheck],
  ] as const) {
    it(`describe the shared test data's ${name}`, () => {
      assert.deepEqual(record, readFixture(name));
    });
  }

  it('narrow an event to its kind', () => {
    const [turn, output] = (minimalWireOutput as TurnRecord).turns[0].events;
    assert.ok(isEventOfKind(turn, 'turn'));
    assert.equal(turn.attributes['a2ui.turn.outcome'], 'completed');
    assert.ok(isEventOfKind(output, 'wire_output'));
    assert.ok(!isEventOfKind(output, 'wire_input'));
    const [part] = output.attributes['a2ui.wire.message'].parts;
    assert.ok(isA2uiPart(part));
  });
});
