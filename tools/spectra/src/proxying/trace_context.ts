/**
 * W3C Trace Context's `traceparent` header, as the wire proxy reads a host's
 * and writes its own: `00-<trace id>-<parent id>-<flags>`.
 */

export interface TraceParent {
  /** 32 lowercase hex characters. */
  traceId: string;
  /** 16 lowercase hex characters. */
  parentId: string;
  /** Whether the sampled flag is set. */
  sampled: boolean;
}

const FIELD = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-(.*))?$/;

/**
 * Reads a `traceparent` under W3C's version-00 rules: four lowercase hex
 * fields, a version that is not `ff`, a trace id and a parent id that are not
 * all zeros, and nothing after the flags in version 00. A later version is
 * read by its first four fields, as the standard asks. Anything else reads as
 * absent.
 */
export function parseTraceparent(header: string | string[] | undefined): TraceParent | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    return undefined;
  }
  const match = FIELD.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const [, version, traceId, parentId, flags, rest] = match;
  if (version === 'ff' || (version === '00' && rest !== undefined)) {
    return undefined;
  }
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return undefined;
  }
  return {traceId, parentId, sampled: (Number.parseInt(flags, 16) & 1) === 1};
}

/** A version-00 `traceparent` naming the turn's trace and the turn event as the parent, sampled. */
export function formatTraceparent(traceId: string, parentId: string): string {
  return `00-${traceId}-${parentId}-01`;
}
