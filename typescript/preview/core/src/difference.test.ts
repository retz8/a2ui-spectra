import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {differenceOf, keysOf} from './difference.js';

const a = {createSurface: {surfaceId: 'main'}};
const b = {updateComponents: {surfaceId: 'main', components: []}};
const c = {updateDataModel: {surfaceId: 'main', value: {}}};

describe('differenceOf', () => {
  it('appends the tail when the new list begins with the one applied', () => {
    const applied = {surfaceId: 'main', keys: keysOf([a, b])};
    assert.deepEqual(differenceOf(applied, {surfaceId: 'main', keys: keysOf([a, b, c])}), {
      kind: 'append',
      from: 2,
    });
  });

  it('appends nothing for the same list', () => {
    const applied = {surfaceId: 'main', keys: keysOf([a, b])};
    assert.deepEqual(differenceOf(applied, {surfaceId: 'main', keys: keysOf([a, b])}), {
      kind: 'append',
      from: 2,
    });
  });

  it('resets for a shorter list, as when the step moves backward', () => {
    const applied = {surfaceId: 'main', keys: keysOf([a, b, c])};
    assert.deepEqual(differenceOf(applied, {surfaceId: 'main', keys: keysOf([a, b])}), {
      kind: 'reset',
    });
  });

  it('resets for a list that differs from the one applied', () => {
    const applied = {surfaceId: 'main', keys: keysOf([a, b])};
    assert.deepEqual(differenceOf(applied, {surfaceId: 'main', keys: keysOf([a, c, b])}), {
      kind: 'reset',
    });
  });

  it('resets for another surface, and with nothing applied', () => {
    const applied = {surfaceId: 'main', keys: keysOf([a])};
    assert.deepEqual(differenceOf(applied, {surfaceId: 'other', keys: keysOf([a, b])}), {
      kind: 'reset',
    });
    assert.deepEqual(differenceOf(undefined, {surfaceId: 'main', keys: keysOf([a])}), {
      kind: 'reset',
    });
  });
});
