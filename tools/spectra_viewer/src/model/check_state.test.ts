import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {checkLinesOf, checkStateOf} from './check_state.ts';
import type {Turn, TurnRecordEvent} from './record.ts';

function check(passed: boolean, findings = 0): TurnRecordEvent {
  return {
    traceId: '0'.repeat(32),
    spanId: '9'.repeat(16),
    name: 'check schema',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'schema',
      'a2ui.check.passed': passed,
      'a2ui.check.protocol_version': 'v0.9.1',
      'a2ui.check.findings': Array.from({length: findings}, () => ({code: 'X', message: 'Bad.'})),
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
      parts: [{type: 'a2ui', content: {version: 'v0.9.1', deleteSurface: {surfaceId: 's'}}}],
    },
  },
};

describe('checkStateOf', () => {
  it('is the problem count when there are problems', () => {
    assert.deepEqual(checkStateOf({events: [check(false, 2)]}, 3), {state: 'problems', count: 3});
  });

  it('is clean for a passing check of A2UI', () => {
    assert.deepEqual(checkStateOf({events: [a2uiOutput, check(true)]}, 0), {state: 'clean'});
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
  it('lists each check with its version and result', () => {
    const turn: Turn = {events: [a2uiOutput, check(false, 2)]};
    assert.deepEqual(checkLinesOf(turn), [
      {name: 'Schema check', version: 'A2UI v0.9.1', result: '2 findings'},
    ]);
    assert.deepEqual(checkLinesOf({events: [a2uiOutput, check(true)]})[0].result, 'Passed');
    assert.deepEqual(
      checkLinesOf({events: [check(true)]})[0].result,
      'Passed, with no A2UI from the agent',
    );
  });

  it('says the schema check did not run when there is none', () => {
    assert.deepEqual(checkLinesOf({events: []}), [
      {name: 'Schema check', version: '', result: 'Not run: the turn names no A2UI version'},
    ]);
  });
});
