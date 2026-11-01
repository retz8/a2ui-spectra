import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isBlockFolded, resetBlockFolds, toggleBlockFold} from './block_folds.ts';

describe('block folds', () => {
  it('folds a block by its label and unfolds it on the next toggle', () => {
    resetBlockFolds();
    assert.equal(isBlockFolded('System prompt'), false);
    toggleBlockFold('System prompt');
    assert.equal(isBlockFolded('System prompt'), true);
    assert.equal(isBlockFolded('Message 1'), false);
    toggleBlockFold('System prompt');
    assert.equal(isBlockFolded('System prompt'), false);
  });

  it('keeps every fold until reset', () => {
    resetBlockFolds();
    toggleBlockFold('Arguments');
    toggleBlockFold('Result');
    assert.deepEqual([isBlockFolded('Arguments'), isBlockFolded('Result')], [true, true]);
    resetBlockFolds();
    assert.deepEqual([isBlockFolded('Arguments'), isBlockFolded('Result')], [false, false]);
  });
});
