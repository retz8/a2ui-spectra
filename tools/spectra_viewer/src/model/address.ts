/**
 * The page address: the turn in view and its selected step, as
 * `#/turns/<trace id>` or `#/turns/<trace id>/steps/<step id>`. Changing the
 * turn adds an entry to the browser's history; changing the step, or the
 * viewer's own move, replaces it.
 */

export interface Address {
  traceId?: string;
  stepId?: string;
}

const ADDRESS = /^#\/turns\/([0-9a-f]{32})(?:\/steps\/([A-Za-z0-9._-]+))?$/;

/** The turn and the step a page address holds; neither when it holds no turn. */
export function readAddress(hash: string): Address {
  const match = ADDRESS.exec(hash);
  if (match === null) return {};
  return {traceId: match[1], ...(match[2] !== undefined && {stepId: match[2]})};
}

/** The page address of a turn and, when one is selected, its step. */
export function writeAddress(traceId: string, stepId?: string): string {
  return stepId === undefined ? `#/turns/${traceId}` : `#/turns/${traceId}/steps/${stepId}`;
}

/**
 * How moving from one address to another goes into the browser's history:
 * a new entry for another turn, the entry replaced for another step of the
 * same turn or for the viewer's own move, and nothing when the address stays.
 */
export function historyOf(
  from: Address,
  to: Required<Pick<Address, 'traceId'>> & Address,
  {own}: {own: boolean},
): 'push' | 'replace' | 'none' {
  if (from.traceId === to.traceId && from.stepId === to.stepId) return 'none';
  if (own || from.traceId === to.traceId) return 'replace';
  return 'push';
}
