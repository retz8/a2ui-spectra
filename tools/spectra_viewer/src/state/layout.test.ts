import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {detailOpenHeight} from './layout.ts';

describe('detailOpenHeight', () => {
  it('opens the detail at its remembered height where it fits in half the pane', () => {
    assert.equal(detailOpenHeight(300, 720), 300);
    assert.equal(detailOpenHeight(360, 720), 360);
  });

  it('keeps at least half the pane for the result on a short window', () => {
    assert.equal(detailOpenHeight(357, 520), 260);
  });
});
