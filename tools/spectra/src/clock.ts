/**
 * The clock Spectra stamps its turns and calls with: the wall clock, which an
 * agent stamps its spans with, read finer than its milliseconds through the
 * monotonic clock, each reading later than the one before.
 *
 * The monotonic clock counts from one wall-clock reading, the anchor, taken
 * again whenever the two are more than a millisecond apart. A new anchor can
 * put the clock back by less than two milliseconds, which the readings step
 * over; a step back the wall clock takes itself, larger than that, is followed.
 */

/** How far apart the monotonic clock and the wall clock may grow before a new anchor, in milliseconds. */
const DRIFT_MS = 1;

/** The most a new anchor can put the clock back, in nanoseconds. */
const ANCHOR_STEP_BACK = 2n * 1_000_000n;

let anchorWall = Date.now();
let anchorMonotonic = performance.now();
let last = 0n;

/** Now, as nanoseconds since the Unix epoch. */
export function nowUnixNano(): bigint {
  const monotonic = performance.now();
  const wall = Date.now();
  if (Math.abs(anchorWall + (monotonic - anchorMonotonic) - wall) > DRIFT_MS) {
    anchorWall = wall;
    anchorMonotonic = monotonic;
  }
  let now =
    BigInt(anchorWall) * 1_000_000n + BigInt(Math.round((monotonic - anchorMonotonic) * 1e6));
  if (now <= last && last - now <= ANCHOR_STEP_BACK) now = last + 1n;
  last = now;
  return now;
}
