import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {scrollIntoColumn} from './scroll.ts';

/** A column from its top to its bottom on the page, and an item at its own top and bottom. */
function column(top: number, bottom: number, scrollTop = 0) {
  return {scrollTop, scrollLeft: 0, getBoundingClientRect: () => ({top, bottom})};
}
function item(top: number, bottom: number) {
  return {getBoundingClientRect: () => ({top, bottom})};
}

describe('scrollIntoColumn', () => {
  it('scrolls down by what an item below the column hides', () => {
    const list = column(100, 400, 50);
    scrollIntoColumn(list, item(390, 422));
    assert.equal(list.scrollTop, 72);
  });

  it('scrolls up by what an item above the column hides', () => {
    const list = column(100, 400, 50);
    scrollIntoColumn(list, item(80, 112));
    assert.equal(list.scrollTop, 30);
  });

  it('leaves an item already in view, and never scrolls sideways', () => {
    const list = column(100, 400, 50);
    scrollIntoColumn(list, item(200, 232));
    assert.equal(list.scrollTop, 50);
    assert.equal(list.scrollLeft, 0);
  });

  it('does nothing without the column or the item', () => {
    const list = column(100, 400, 50);
    scrollIntoColumn(list, null);
    scrollIntoColumn(null, item(390, 422));
    assert.equal(list.scrollTop, 50);
  });
});
