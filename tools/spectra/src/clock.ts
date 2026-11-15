/**
 * Now, as nanoseconds since the Unix epoch, to the millisecond: the wall
 * clock, which an agent stamps its spans with.
 */
export function nowUnixNano(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}
