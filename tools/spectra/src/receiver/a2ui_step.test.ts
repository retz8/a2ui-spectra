import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {fittedSpanEvents, readA2uiStep, sectionTextOf} from './a2ui_step.js';
import type {ReceivedSpan} from './otlp.js';
import {receivedEvent} from './received_event.js';

const SCOPE = {name: 'a2ui-spectra-instrumentation', version: '0.0.1'};
const CATALOGS = [
  {
    catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
    protocolVersion: 'v1.0',
  },
];

function stepSpan(
  attributes: Record<string, unknown>,
  {status = {code: 0 as const}, events = []}: Partial<Pick<ReceivedSpan, 'status' | 'events'>> = {},
): ReceivedSpan {
  return {
    traceId: 'a'.repeat(32),
    spanId: '1'.repeat(16),
    name: String(attributes['a2ui.event.kind']),
    kind: 1,
    startTimeUnixNano: '1000',
    endTimeUnixNano: '2000',
    attributes,
    events,
    links: [],
    status,
    scope: SCOPE,
  };
}

describe('the A2UI step reader', () => {
  it('copies the record names of a parse, parsing JSON text and leaving out what does not fit', () => {
    const reading = readA2uiStep(
      stepSpan({
        'a2ui.event.kind': 'parse',
        'a2ui.parse.input': 'text',
        'a2ui.parse.entry_point': 'open_stream',
        'a2ui.parse.streamed': true,
        'a2ui.parse.wrapped': 'no',
        'a2ui.parse.inference_format': 'express',
        'a2ui.parse.catalogs': JSON.stringify(CATALOGS),
        'a2ui.parse.messages': '[{"version":"v1.0"}]',
        'a2ui.parse.components': '[{"surfaceId":"main","componentId":"root","start":-1,"end":4}]',
        'gen_ai.tool.call.result': '{"error":"x"}',
        'a2ui.prompt.ui_section': 'not a parse name',
        'a2ui.sdk.name': 'a2ui-agent-sdk',
      }),
    );
    assert.deepEqual(reading, {
      kind: 'parse',
      names: {
        'a2ui.parse.input': 'text',
        'a2ui.parse.entry_point': 'open_stream',
        'a2ui.parse.streamed': true,
        'a2ui.parse.inference_format': 'express',
        'a2ui.parse.catalogs': CATALOGS,
        'a2ui.parse.messages': [{version: 'v1.0'}],
        'gen_ai.tool.call.result': {error: 'x'},
        'a2ui.sdk.name': 'a2ui-agent-sdk',
      },
      missing: [],
    });
  });

  it('names what a half-formed span lacks, a failed generation not needing its section', () => {
    assert.deepEqual(
      readA2uiStep(stepSpan({'a2ui.event.kind': 'parse', 'a2ui.parse.entry_point': 'x'}))?.missing,
      ['a2ui.parse.input', 'a2ui.parse.entry_point'],
    );
    const generation = {
      'a2ui.event.kind': 'prompt_generation',
      'a2ui.prompt.inference_format': 'atom',
      'a2ui.prompt.catalogs': '[{"catalogId":"basic","protocolVersion":"1.0"}]',
    };
    assert.deepEqual(readA2uiStep(stepSpan(generation))?.missing, [
      'a2ui.prompt.ui_section',
      'a2ui.prompt.catalogs',
    ]);
    assert.deepEqual(
      readA2uiStep(stepSpan(generation, {status: {code: 2, message: 'failed'}}))?.missing,
      ['a2ui.prompt.catalogs'],
    );
    assert.equal(readA2uiStep(stepSpan({'a2ui.event.kind': 'turn'})), undefined);
  });

  it('gives the section text of a well-formed prompt generation only', () => {
    const generation = {
      'a2ui.event.kind': 'prompt_generation',
      'a2ui.prompt.inference_format': 'express',
      'a2ui.prompt.catalogs': JSON.stringify(CATALOGS),
    };
    assert.equal(
      sectionTextOf(stepSpan({...generation, 'a2ui.prompt.ui_section': 'the section'})),
      'the section',
    );
    assert.equal(sectionTextOf(stepSpan({...generation, 'a2ui.prompt.ui_section': ''})), undefined);
    assert.equal(sectionTextOf(stepSpan(generation, {status: {code: 2}})), undefined);
  });

  it("fits the record's names on exception and chunk span events, passing the rest as received", () => {
    assert.deepEqual(
      fittedSpanEvents([
        {
          timeUnixNano: '1',
          name: 'exception',
          attributes: {
            'exception.type': 'ExpressSyntaxError',
            'exception.escaped': false,
            'a2ui.parse.block.start': 3,
            'a2ui.parse.block.end': '9',
            'a2ui.parse.error.details':
              '[{"path":"/0","code":"X","message":"m","surfaceId":"main"}]',
          },
        },
        {timeUnixNano: '2', name: 'a2ui.parse.chunk', attributes: {'a2ui.parse.chunk.end': 4}},
        {timeUnixNano: '3', name: 'a2ui.parse.chunk', attributes: {'a2ui.parse.chunk.end': -1}},
        {timeUnixNano: '4', name: 'other', attributes: {'a2ui.parse.block.end': 'kept'}},
      ]),
      [
        {
          timeUnixNano: '1',
          name: 'exception',
          attributes: {
            'exception.type': 'ExpressSyntaxError',
            'exception.escaped': false,
            'a2ui.parse.block.start': 3,
            'a2ui.parse.error.details': [{path: '/0', code: 'X', message: 'm', surfaceId: 'main'}],
          },
        },
        {timeUnixNano: '2', name: 'a2ui.parse.chunk', attributes: {'a2ui.parse.chunk.end': 4}},
        {timeUnixNano: '4', name: 'other', attributes: {'a2ui.parse.block.end': 'kept'}},
      ],
    );
  });

  it('writes a span of the step as its kind with no dialect, and a half-formed one as a framework span', () => {
    const attributes = {
      'a2ui.event.kind': 'parse',
      'a2ui.parse.input': 'text',
      'a2ui.parse.entry_point': 'compile',
      'gen_ai.operation.name': 'chat',
    };
    const event = receivedEvent(stepSpan(attributes), [], undefined);
    assert.deepEqual(event.attributes, {
      'a2ui.event.kind': 'parse',
      'otel.scope.name': SCOPE.name,
      'otel.scope.version': SCOPE.version,
      'a2ui.parse.input': 'text',
      'a2ui.parse.entry_point': 'compile',
      'a2ui.received.attributes': attributes,
    });
    const halfFormed = receivedEvent(
      stepSpan({'a2ui.event.kind': 'parse', 'a2ui.parse.input': 'text'}),
      [],
      undefined,
    );
    assert.deepEqual(halfFormed.attributes, {
      'a2ui.event.kind': 'framework_span',
      'otel.scope.name': SCOPE.name,
      'otel.scope.version': SCOPE.version,
      'a2ui.received.attributes': {'a2ui.event.kind': 'parse', 'a2ui.parse.input': 'text'},
    });
  });

  it("copies a stated retry's attempt onto a model call span of any dialect, and keeps its links", () => {
    const attributes = {
      'gen_ai.operation.name': 'chat',
      'a2ui.retry.attempt': 2,
    };
    const link = {traceId: 'a'.repeat(32), spanId: '2'.repeat(16)};
    const event = receivedEvent(
      {...stepSpan(attributes), name: 'chat m', links: [link]},
      [],
      undefined,
    );
    assert.equal(event.attributes['a2ui.event.kind'], 'model_call');
    assert.equal(event.attributes['a2ui.retry.attempt'], 2);
    assert.deepEqual(event.links, [link]);
    const zero = receivedEvent(
      {...stepSpan({...attributes, 'a2ui.retry.attempt': 0}), name: 'chat m'},
      [],
      undefined,
    );
    assert.equal((zero.attributes as Record<string, unknown>)['a2ui.retry.attempt'], undefined);
  });
});
