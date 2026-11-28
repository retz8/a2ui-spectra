import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {jsonEqual} from './json_value.js';

describe('jsonEqual, two parsed JSON values compared by value', () => {
  it('takes scalars by their value, and a zero of either sign as zero', () => {
    assert.equal(jsonEqual(1, 1), true);
    assert.equal(jsonEqual('a', 'a'), true);
    assert.equal(jsonEqual(null, null), true);
    assert.equal(jsonEqual(true, true), true);
    assert.equal(jsonEqual(0, -0), true);
    assert.equal(jsonEqual(1, '1'), false);
    assert.equal(jsonEqual(0, false), false);
    assert.equal(jsonEqual(null, undefined), false);
    assert.equal(jsonEqual(undefined, undefined), true);
  });

  it("takes objects by their members, whatever the members' order", () => {
    assert.equal(jsonEqual({a: 1, b: [1, {c: null}]}, {b: [1, {c: null}], a: 1}), true);
    assert.equal(jsonEqual({a: 1}, {a: 1, b: 2}), false);
    assert.equal(jsonEqual({a: 1, b: 2}, {a: 1}), false);
    assert.equal(jsonEqual({a: 1}, {b: 1}), false);
    assert.equal(jsonEqual({a: undefined}, {}), false);
    assert.equal(jsonEqual({}, null), false);
    assert.equal(jsonEqual({}, []), false);
  });

  it('takes arrays by their elements, in order', () => {
    assert.equal(jsonEqual([1, 2], [1, 2]), true);
    assert.equal(jsonEqual([1, 2], [2, 1]), false);
    assert.equal(jsonEqual([1], [1, 2]), false);
    assert.equal(jsonEqual([[-0]], [[0]]), true);
  });
});
