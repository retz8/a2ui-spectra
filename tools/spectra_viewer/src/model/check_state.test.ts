import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {checkLabelOf, checkLinesOf, checkStateOf} from './check_state.ts';
import type {CheckName, LegacyFormEntry, SkippedSurface, Turn, TurnRecordEvent} from './record.ts';

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

/** A legacy-form entry for a component of the surface `s`. */
function legacy(componentId: string, index: number, keys = ['checks']): LegacyFormEntry {
  return {
    surfaceId: 's',
    componentId,
    keys,
    path: `/events/0/attributes/a2ui.wire.message/parts/0/content/updateComponents/components/${index}`,
  };
}

/** The catalog check, with its findings, its skipped surfaces and its legacy-form entries. */
function catalogCheck(
  findings: number,
  entries: LegacyFormEntry[],
  skipped: SkippedSurface[] = [],
): TurnRecordEvent {
  const event = check(findings === 0, findings, 'catalog', skipped);
  return {
    ...event,
    attributes: {...event.attributes, 'a2ui.check.legacy_form': entries},
  } as TurnRecordEvent;
}

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

  it('notes the legacy form beside no problems, chained after a skip, and not beside problems', () => {
    const entries = [legacy('name', 1)];
    const clean: Turn = {events: [a2uiOutput, check(true), catalogCheck(0, entries)]};
    assert.deepEqual(checkStateOf(clean, 0), {state: 'clean', legacy: true});
    assert.equal(checkLabelOf(checkStateOf(clean, 0)), 'No problems · legacy form');
    const skipped = [{surfaceId: 't', catalogId: CATALOG, reason: 'no_definition' as const}];
    const partial: Turn = {events: [a2uiOutput, check(true), catalogCheck(0, entries, skipped)]};
    assert.equal(
      checkLabelOf(checkStateOf(partial, 0)),
      'No problems · not fully checked · legacy form',
    );
    assert.equal(checkLabelOf(checkStateOf(clean, 4)), '4 problems');
    // An event that carries no attribute reads as one with none.
    const bare: Turn = {events: [a2uiOutput, check(true), check(true, 0, 'catalog')]};
    assert.equal(checkLabelOf(checkStateOf(bare, 0)), 'No problems');
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

  it('remarks on the Catalog check’s row, directly after its result, how many distinct components came in the legacy form', () => {
    const row = (event: TurnRecordEvent) => checkLinesOf({events: [a2uiOutput, event]})[0].result;
    assert.deepEqual(row(catalogCheck(0, [legacy('name', 1, ['checks', 'accessibility'])])), [
      {text: 'Passed'},
      {text: ' · 1 component in the legacy form', muted: true},
    ]);
    // A component sent twice counts once.
    const three = [legacy('name', 1), legacy('date', 2), legacy('submit', 4), legacy('name', 6)];
    assert.deepEqual(row(catalogCheck(1, three)), [
      {text: '1 finding'},
      {text: ' · 3 components in the legacy form', muted: true},
    ]);
    const menu = [{surfaceId: 'menu', catalogId: CATALOG, reason: 'no_definition' as const}];
    assert.deepEqual(row(catalogCheck(0, [legacy('name', 1), legacy('date', 2)], menu)), [
      {text: 'Passed'},
      {text: ' · 2 components in the legacy form', muted: true},
      {text: ' · '},
      {text: 'not checked for '},
      {text: 'menu', mono: true},
      {text: ' · no definition for catalog'},
    ]);
  });

  it('carries no remark on a row whose every surface was skipped', () => {
    const skipped = [
      {surfaceId: 's', catalogId: CATALOG, reason: 'no_definition' as const},
      {surfaceId: 't', catalogId: CATALOG, reason: 'no_definition' as const},
    ];
    const [line] = checkLinesOf({events: [a2uiOutput, catalogCheck(0, [legacy('a', 0)], skipped)]});
    assert.deepEqual(line.result, [{text: 'Not checked'}, {text: ' · no definition for catalog'}]);
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
