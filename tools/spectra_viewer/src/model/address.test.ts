import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {historyOf, readAddress, writeAddress} from './address.ts';

const TRACE = 'f94fdb8f0e8f6531c1d2a3b4c5d6e7f8';
const OTHER = '09b758f035afb6d5a1b2c3d4e5f60718';

describe('the page address', () => {
  it('holds the turn, and the selected step by its id', () => {
    assert.equal(writeAddress(TRACE), `#/turns/${TRACE}`);
    assert.deepEqual(readAddress(`#/turns/${TRACE}`), {traceId: TRACE});
    for (const stepId of [
      'message-1a2b3c4d5e6f7081.2.4',
      'message-1a2b3c4d5e6f7081.0',
      'delivery-1a2b3c4d5e6f7081',
      'part-1a2b3c4d5e6f7081.1',
      'outcome',
    ]) {
      const hash = writeAddress(TRACE, stepId);
      assert.equal(hash, `#/turns/${TRACE}/steps/${stepId}`);
      assert.deepEqual(readAddress(hash), {traceId: TRACE, stepId});
    }
  });

  it('holds the selected tree node after the step, as its surface and component ids, each encoded', () => {
    const node = {surfaceId: 'restaurant card', componentId: 'book/button'};
    const hash = writeAddress(TRACE, 'e9f3a6c15b8d2704', node);
    assert.equal(
      hash,
      `#/turns/${TRACE}/steps/e9f3a6c15b8d2704/nodes/restaurant%20card/book%2Fbutton`,
    );
    assert.deepEqual(readAddress(hash), {traceId: TRACE, stepId: 'e9f3a6c15b8d2704', node});
    assert.deepEqual(readAddress(`#/turns/${TRACE}/steps/x/nodes/s`), {});
  });

  it('replaces the entry when the node changes, as a change of step does', () => {
    const node = {surfaceId: 's', componentId: 'c'};
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'x'}, {traceId: TRACE, stepId: 'x', node}, {own: false}),
      'replace',
    );
    assert.equal(
      historyOf(
        {traceId: TRACE, stepId: 'x', node},
        {traceId: TRACE, stepId: 'x', node},
        {own: false},
      ),
      'none',
    );
  });

  it('holds no turn when it is not a turn’s address', () => {
    for (const hash of [
      '',
      '#',
      '#/turns/',
      '#/turns/xyz',
      `#/turns/${TRACE}/steps/`,
      `#/turns/${TRACE}/x`,
    ]) {
      assert.deepEqual(readAddress(hash), {});
    }
  });
});

describe('historyOf', () => {
  it('adds an entry for another turn, whatever its step', () => {
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'outcome'}, {traceId: OTHER}, {own: false}),
      'push',
    );
    assert.equal(historyOf({}, {traceId: OTHER}, {own: false}), 'push');
  });

  it('replaces the entry for another step of the same turn', () => {
    assert.equal(
      historyOf({traceId: TRACE}, {traceId: TRACE, stepId: 'outcome'}, {own: false}),
      'replace',
    );
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'outcome'}, {traceId: TRACE}, {own: false}),
      'replace',
    );
  });

  it('replaces the entry for the viewer’s own move, to another turn too', () => {
    assert.equal(historyOf({traceId: TRACE}, {traceId: OTHER}, {own: true}), 'replace');
    assert.equal(historyOf({}, {traceId: OTHER}, {own: true}), 'replace');
  });

  it('leaves the history as it is when the address stays', () => {
    assert.equal(
      historyOf(
        {traceId: TRACE, stepId: 'outcome'},
        {traceId: TRACE, stepId: 'outcome'},
        {own: false},
      ),
      'none',
    );
  });
});
