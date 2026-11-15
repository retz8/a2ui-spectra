import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {nowUnixNano} from './clock.js';

describe('nowUnixNano', () => {
  it('reads the wall clock, with the monotonic clock an hour behind it', t => {
    const monotonic = performance.now();
    t.mock.method(performance, 'now', () => monotonic - 3_600_000);
    const before = BigInt(Date.now()) * 1_000_000n;
    const now = nowUnixNano();
    const after = BigInt(Date.now()) * 1_000_000n;
    assert.ok(before <= now && now <= after, `${before} <= ${now} <= ${after}`);
  });
});
