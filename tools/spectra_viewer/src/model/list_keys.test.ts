import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {groupItemId, listItemsOf, moveInList, turnItemId} from './list_keys.ts';
import {type GroupedTurn, groupTurns} from './turn_groups.ts';

const turn = (traceId: string, conversationId: string): GroupedTurn => ({
  traceId,
  conversationId,
  startTime: '2026-10-24T09:00:00.000Z',
});

// Newest first: two turns in conversation a, one in b, one in c.
const groups = groupTurns([turn('a2', 'a'), turn('b1', 'b'), turn('a1', 'a'), turn('c1', 'c')]);
const closed = new Set(['b']);
const items = listItemsOf(groups, group => !closed.has(group.key));

describe('listItemsOf', () => {
  it('lists each group’s header, then its turns while it is open', () => {
    assert.deepEqual(
      items.map(item => item.id),
      [
        groupItemId('a'),
        turnItemId('a2'),
        turnItemId('a1'),
        groupItemId('b'),
        groupItemId('c'),
        turnItemId('c1'),
      ],
    );
  });
});

describe('moveInList', () => {
  it('selects a turn the arrows land on, and leaves the selection on a header', () => {
    assert.deepEqual(moveInList(items, turnItemId('a2'), 'ArrowDown'), {
      active: turnItemId('a1'),
      select: 'a1',
    });
    assert.deepEqual(moveInList(items, turnItemId('a2'), 'ArrowUp'), {active: groupItemId('a')});
    assert.deepEqual(moveInList(items, groupItemId('c'), 'ArrowDown'), {
      active: turnItemId('c1'),
      select: 'c1',
    });
  });

  it('skips the turns of a closed group', () => {
    assert.deepEqual(moveInList(items, turnItemId('a1'), 'ArrowDown'), {active: groupItemId('b')});
    assert.deepEqual(moveInList(items, groupItemId('b'), 'ArrowDown'), {active: groupItemId('c')});
  });

  it('moves nowhere past either end', () => {
    assert.equal(moveInList(items, groupItemId('a'), 'ArrowUp'), undefined);
    assert.equal(moveInList(items, turnItemId('c1'), 'ArrowDown'), undefined);
  });

  it('opens a closed group with the right arrow, and closes an open one with the left', () => {
    assert.deepEqual(moveInList(items, groupItemId('b'), 'ArrowRight'), {
      active: groupItemId('b'),
      toggle: {key: 'b', open: true},
    });
    assert.equal(moveInList(items, groupItemId('a'), 'ArrowRight'), undefined);
    assert.deepEqual(moveInList(items, groupItemId('a'), 'ArrowLeft'), {
      active: groupItemId('a'),
      toggle: {key: 'a', open: false},
    });
    assert.equal(moveInList(items, groupItemId('b'), 'ArrowLeft'), undefined);
  });

  it('moves from a turn to its group’s header with the left arrow', () => {
    assert.deepEqual(moveInList(items, turnItemId('a1'), 'ArrowLeft'), {active: groupItemId('a')});
    assert.equal(moveInList(items, turnItemId('a1'), 'ArrowRight'), undefined);
  });
});
