import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  formatDuration,
  formatDurationCompact,
  formatOffset,
  formatOffsetCompact,
} from './format.ts';

describe('formatDurationCompact', () => {
  it('reads as formatDuration under a minute', () => {
    for (const ms of [0, 12, 999, 1000, 12_340, 59_949]) {
      assert.equal(formatDurationCompact(ms), formatDuration(ms));
    }
  });

  it('writes minutes and seconds without spaces inside them from a minute on', () => {
    assert.equal(formatDuration(87_000), '1 min 27 s');
    assert.equal(formatDurationCompact(87_000), '1m 27s');
    assert.equal(formatDurationCompact(60_000), '1m 0s');
    assert.equal(formatDurationCompact(127_400), '2m 7s');
  });

  it('prefixes an offset with a plus and clamps it at zero', () => {
    assert.equal(formatOffsetCompact(90_200), '+1m 30s');
    assert.equal(formatOffsetCompact(-5), '+0 ms');
    assert.equal(formatOffset(90_200), '+1 min 30 s');
  });
});
