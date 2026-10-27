import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {checkLinesOf, checkStateOf} from './check_state.ts';
import type {CheckName, SkippedSurface, Turn, TurnRecordEvent} from './record.ts';

function check(
  passed: boolean,
  findings = 0,
  name: CheckName = 'schema',
  skipped?: SkippedSurface[],
): TurnRecordEvent {
  return {
    traceId: '0'.repeat(32),
    spanId: '9'.repeat(16),
    name: 'check',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': name,
      'a2ui.check.passed': passed,
      'a2ui.check.protocol_version': 'v0.9.1',
      'a2ui.check.findings': Array.from({length: findings}, () => ({code: 'X', message: 'Bad.'})),
      ...(name !== 'schema' && {'a2ui.check.skipped': skipped ?? []}),
    },
  };
}

const a2uiOutput: TurnRecordEvent = {
  traceId: '0'.repeat(32),
  spanId: '2'.repeat(16),
  name: 'wire_output',
  kind: 1,
  startTimeUnixNano: '1792800000000000000',
  attributes: {
    'a2ui.event.kind': 'wire_output',
    'a2ui.wire.message': {
      role: 'assistant',
      parts: [
        {type: 'a2ui', content: {version: 'v0.9.1', deleteSurface: {surfaceId: 's'}}},
        {type: 'a2ui', content: {version: 'v0.9.1', deleteSurface: {surfaceId: 't'}}},
      ],
    },
  },
};

const CATALOG = 'https://example.com/shop/catalog.json';

describe('checkStateOf', () => {
  it('is the problem count when there are problems', () => {
    assert.deepEqual(checkStateOf({events: [check(false, 2)]}, 3), {state: 'problems', count: 3});
  });

  it('is clean for passing checks of A2UI that skipped nothing', () => {
    const turn: Turn = {events: [a2uiOutput, check(true), check(true, 0, 'catalog')]};
    assert.deepEqual(checkStateOf(turn, 0), {state: 'clean'});
  });

  it('is partial when no problem was found but a check skipped a surface', () => {
    const skipped = [{surfaceId: 's', catalogId: CATALOG, reason: 'no_definition' as const}];
    const turn: Turn = {events: [a2uiOutput, check(true), check(true, 0, 'catalog', skipped)]};
    assert.deepEqual(checkStateOf(turn, 0), {state: 'partial'});
  });

  it('is not checked when the agent sent no A2UI, or the turn names no version', () => {
    assert.deepEqual(checkStateOf({events: [check(true)]}, 0), {
      state: 'unchecked',
      reason: 'no A2UI in this turn',
    });
    assert.deepEqual(checkStateOf({events: []}, 0), {
      state: 'unchecked',
      reason: 'no schema check',
    });
  });
});

describe('checkLinesOf', () => {
  it("lists the checks in the record's order, each with its version and result", () => {
    const turn: Turn = {
      events: [a2uiOutput, check(true, 0, 'binding'), check(false, 2), check(true, 0, 'catalog')],
    };
    assert.deepEqual(checkLinesOf(turn), [
      {name: 'Schema check', version: 'A2UI v0.9.1', result: [{text: '2 findings'}], notes: []},
      {name: 'Catalog check', version: 'A2UI v0.9.1', result: [{text: 'Passed'}], notes: []},
      {name: 'Binding check', version: 'A2UI v0.9.1', result: [{text: 'Passed'}], notes: []},
    ]);
    assert.deepEqual(checkLinesOf({events: [check(true)]})[0].result, [
      {text: 'Passed, with no A2UI from the agent'},
    ]);
  });

  it('says a check skipped every surface, with the catalog id as its note', () => {
    const skipped = [
      {surfaceId: 's', catalogId: CATALOG, reason: 'no_definition' as const},
      {surfaceId: 't', catalogId: CATALOG, reason: 'no_definition' as const},
    ];
    const [line] = checkLinesOf({events: [a2uiOutput, check(true, 0, 'catalog', skipped)]});
    assert.deepEqual(line, {
      name: 'Catalog check',
      version: '',
      result: [{text: 'Not checked'}, {text: ' · no definition for catalog'}],
      notes: [CATALOG],
    });
  });

  it('names the surfaces a check skipped, in monospace, after its result, one pair per reason', () => {
    const skipped: SkippedSurface[] = [
      {surfaceId: 's', reason: 'not_created'},
      {surfaceId: 't', catalogId: CATALOG, reason: 'no_definition'},
    ];
    const output: TurnRecordEvent = {
      ...a2uiOutput,
      attributes: {
        ...a2uiOutput.attributes,
        'a2ui.wire.message': {
          role: 'assistant',
          parts: [
            ...a2uiOutput.attributes['a2ui.wire.message'].parts,
            {type: 'a2ui', content: {version: 'v0.9.1', deleteSurface: {surfaceId: 'u'}}},
          ],
        },
      },
    };
    const [line] = checkLinesOf({events: [output, check(false, 1, 'structural', skipped)]});
    assert.deepEqual(line, {
      name: 'Structural check',
      version: 'A2UI v0.9.1',
      result: [
        {text: '1 finding'},
        {text: ' · '},
        {text: 'not checked for '},
        {text: 's', mono: true},
        {text: ' · surface never created'},
        {text: ' · '},
        {text: 'not checked for '},
        {text: 't', mono: true},
        {text: ' · no definition for catalog'},
      ],
      notes: [CATALOG],
    });
  });

  it('says the schema check did not run when there is none', () => {
    assert.deepEqual(checkLinesOf({events: []}), [
      {
        name: 'Schema check',
        version: '',
        result: [{text: 'Not run: the turn names no A2UI version'}],
        notes: [],
      },
    ]);
  });
});
