import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {formatDuration, formatOffset, turnIconOf} from './format.ts';

describe('formatOffset', () => {
  it("writes a time since the turn's start in the long form, with a plus, clamped at zero", () => {
    assert.equal(formatOffset(12), '+12 ms');
    assert.equal(formatOffset(2_300), '+2.3 s');
    assert.equal(formatOffset(90_200), '+1 min 30 s');
    assert.equal(formatOffset(630_000), '+10 min 30 s');
    assert.equal(formatOffset(-5), '+0 ms');
  });

  it('writes a duration in the same form, without the plus', () => {
    assert.equal(formatDuration(87_000), '1 min 27 s');
  });
});

describe('turnIconOf', () => {
  it('draws a listed turn by its status, open while it has no outcome', () => {
    assert.equal(turnIconOf({outcome: 'waiting_for_input'}), 'waiting');
    assert.equal(turnIconOf({open: true}), 'open');
    assert.equal(turnIconOf({}), 'open');
  });

  it('draws a stored turn of a newer turn record as a file, with no outcome to show', () => {
    assert.equal(turnIconOf({newer: 'v0.2'}), 'file');
  });
});
