import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {coveredRowsOf} from './covered.ts';
import type {Step, TimelineRow} from './steps.ts';

function step(id: string, offsetMs?: number, grouped = false): Step {
  return {
    row: 'step',
    id,
    kind: 'message',
    icon: 'updateComponents',
    label: id,
    target: '',
    ...(offsetMs !== undefined && {offsetMs}),
    grouped,
  };
}

const rows: TimelineRow[] = [
  step('call', 5_400),
  step('parse', 17_900),
  step('text', 17_900),
  {row: 'delivery', id: 'delivery', eventIndex: 4, offsetMs: 18_200, parts: 2, messages: 2},
  step('createSurface', undefined, true),
  step('updateComponents', 19_200),
  step('updateDataModel', 25_300),
  step('retry', 25_500),
];

describe('coveredRowsOf', () => {
  it('covers the rows after the selected one that start up to the moment its result shows', () => {
    assert.deepEqual(
      [...coveredRowsOf(rows, 'parse', 25_300)],
      ['text', 'delivery', 'createSurface', 'updateComponents', 'updateDataModel'],
    );
  });

  it('times a row its delivery times at its delivery’s moment', () => {
    assert.deepEqual(
      [...coveredRowsOf(rows, 'parse', 18_500)],
      ['text', 'delivery', 'createSurface'],
    );
  });

  it('covers every later row while the call is in flight', () => {
    assert.equal(coveredRowsOf(rows, 'call', Infinity).size, 7);
  });

  it('covers nothing for a row not in the list, or a moment before the next row', () => {
    assert.equal(coveredRowsOf(rows, 'gone', Infinity).size, 0);
    assert.equal(coveredRowsOf(rows, 'retry', Infinity).size, 0);
    assert.equal(coveredRowsOf(rows, 'call', 5_400).size, 0);
  });
});
