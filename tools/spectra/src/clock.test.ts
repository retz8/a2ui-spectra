import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {nowUnixNano} from './clock.js';

/** The wall clock now, to the millisecond, as nanoseconds since the Unix epoch. */
function wallUnixNano(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/** Whether a reading is within the wall clock's millisecond readings around it. */
function within(before: bigint, now: bigint, after: bigint): boolean {
  return before <= now && now < after + 1_000_000n;
}

describe('nowUnixNano', () => {
  for (const [offset, how] of [
    [-3_600_000, 'behind'],
    [3_600_000, 'ahead of'],
  ] as const) {
    it(`reads the wall clock, with the monotonic clock an hour ${how} it`, t => {
      const monotonic = performance.now.bind(performance);
      t.mock.method(performance, 'now', () => monotonic() + offset);
      const before = wallUnixNano();
      const now = nowUnixNano();
      const after = wallUnixNano();
      assert.ok(within(before, now, after), `${before} <= ${now} <= ${after}`);
    });
  }

  it('follows the wall clock stepped back an hour', t => {
    nowUnixNano();
    const wall = Date.now.bind(Date);
    t.mock.method(Date, 'now', () => wall() - 3_600_000);
    const before = wallUnixNano();
    const now = nowUnixNano();
    const after = wallUnixNano();
    assert.ok(within(before, now, after), `${before} <= ${now} <= ${after}`);
  });

  it('gives each reading later than the one before', () => {
    let previous = nowUnixNano();
    for (let i = 0; i < 10_000; i++) {
      const now = nowUnixNano();
      assert.ok(now > previous, `${now} after ${previous}`);
      previous = now;
    }
  });

  it('gives each reading later than the one before, with the wall clock in 50 ms steps', t => {
    const wall = Date.now.bind(Date);
    t.mock.method(Date, 'now', () => Math.floor(wall() / 50) * 50);
    let previous = nowUnixNano();
    const end = performance.now() + 120;
    while (performance.now() < end) {
      const now = nowUnixNano();
      assert.ok(now > previous, `${now} after ${previous}`);
      previous = now;
    }
  });
});
