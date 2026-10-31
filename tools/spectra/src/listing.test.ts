import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {inputBriefOf, listingFieldsOf} from './listing.js';
import type {
  CheckEvent,
  ModelCallEvent,
  Turn,
  TurnEvent,
  TurnRecord,
  WireInputEvent,
  WireOutputEvent,
  WirePart,
} from './record/turn_record.js';

/** A record of the shared test data, by its path under `conformance/test_data/`. */
function readTestData(file: string): TurnRecord {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'conformance', 'conformance_schema.json'))) {
    dir = path.dirname(dir);
  }
  return JSON.parse(
    fs.readFileSync(path.join(dir, 'conformance', 'test_data', file), 'utf8'),
  ) as TurnRecord;
}

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

  it('counts the failed call rows, model and tool, proxy and span-only, each row once', () => {
    const call = (
      spanId: string,
      code: 1 | 2,
      options: {
        kind?: 'model_call' | 'tool_call';
        received?: boolean;
        parentSpanId?: string;
        links?: string[];
      } = {},
    ): ModelCallEvent =>
      ({
        traceId: TRACE,
        spanId,
        parentSpanId: options.parentSpanId ?? TURN_SPAN,
        name: 'generate_content gemini-3.6-flash',
        kind: options.received === true ? 1 : 3,
        startTimeUnixNano: '1792576800100000000',
        endTimeUnixNano: '1792576800200000000',
        attributes: {
          'a2ui.event.kind': options.kind ?? 'model_call',
          ...(code === 2 && {'error.type': '429'}),
          ...(options.received === true && {'a2ui.received.attributes': {}}),
        },
        ...(options.links !== undefined && {
          links: options.links.map(spanId => ({traceId: TRACE, spanId})),
        }),
        status: {code},
      }) as ModelCallEvent;
    const [a, b, c, d, e, f, g] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(x => x.repeat(16));
    const fields = listingFieldsOf({
      events: [
        turnEvent,
        // A failed proxy call, and one that did not fail.
        call(a, 2),
        call(b, 1),
        // A failed tool call.
        call(c, 2, {kind: 'tool_call'}),
        // A failed proxy call whose linked chain failed too: one row.
        call(d, 2, {links: [e]}),
        call(e, 2, {received: true, links: [d]}),
        // A chain of two spans with no exchange, its inner span failed: one row.
        call(f, 1, {received: true}),
        call(g, 2, {received: true, parentSpanId: f}),
      ],
    });
    assert.equal(fields?.failedCalls, 4);
    assert.equal(listingFieldsOf({events: [turnEvent, call(b, 1)]})?.failedCalls, undefined);
  });

  it('counts the failed rows of the tool and receiver capture suites as the viewer does', () => {
    const count = (file: string, turn = -1) => {
      const {turns} = readTestData(file);
      return listingFieldsOf(turns.at(turn)!)?.failedCalls;
    };
    // tools/call missing answered a JSON-RPC error; tools/call fail is the tool's own isError.
    assert.equal(count('tool_capture/v0_1/tools/streamable_http.json'), 1);
    assert.equal(count('tool_capture/v0_1/tools/http_sse.json'), 1);
    // GET /missing answered 404.
    assert.equal(count('tool_capture/v0_1/http_routes/http.json'), 1);
    assert.equal(count('tool_capture/v0_1/sampling/http_sse.json'), undefined);
    // The 503 the SDK retried inside one generate_content span: the failed exchange's row alone.
    assert.equal(count('receiver_capture/v0_1/several_exchanges/expected.json', 0), 1);
    assert.equal(count('receiver_capture/v0_1/openinference/expected.json'), undefined);
  });

  it('leaves out what a turn does not have', () => {
    assert.deepEqual(listingFieldsOf({events: [turnEvent]}), {
      outcome: 'waiting_for_input',
      durationMs: 1000,
      rejections: 0,
    });
  });
});
