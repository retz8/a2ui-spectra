/**
 * The page address: the turn in view, its selected step and, after the
 * step, the selected tree node, as `#/turns/<trace id>`,
 * `#/turns/<trace id>/steps/<step id>` or
 * `#/turns/<trace id>/steps/<step id>/nodes/<surface id>/<component id>`,
 * the node's ids encoded. Changing the turn adds an entry to the browser's
 * history; changing the step or the node, or the viewer's own move,
 * replaces it.
 */

/** A tree node, by its surface and its component id. */
export interface NodeRef {
  surfaceId: string;
  componentId: string;
}

export interface Address {
  traceId?: string;
  stepId?: string;
  node?: NodeRef;
}

const ADDRESS =
  /^#\/turns\/([0-9a-f]{32})(?:\/steps\/([A-Za-z0-9._-]+)(?:\/nodes\/([^/]+)\/([^/]+))?)?$/;

/** The turn, the step and the node a page address holds; nothing when it holds no turn. */
export function readAddress(hash: string): Address {
  const match = ADDRESS.exec(hash);
  if (match === null) return {};
  const [, traceId, stepId, surfaceId, componentId] = match;
  return {
    traceId,
    ...(stepId !== undefined && {stepId}),
    ...(surfaceId !== undefined &&
      componentId !== undefined && {
        node: {
          surfaceId: decodeURIComponent(surfaceId),
          componentId: decodeURIComponent(componentId),
        },
      }),
  };
}

/** The page address of a turn and, when selected, its step and its node. */
export function writeAddress(traceId: string, stepId?: string, node?: NodeRef): string {
  if (stepId === undefined) return `#/turns/${traceId}`;
  const step = `#/turns/${traceId}/steps/${stepId}`;
  return node === undefined
    ? step
    : `${step}/nodes/${encodeURIComponent(node.surfaceId)}/${encodeURIComponent(node.componentId)}`;
}

function sameNode(a: NodeRef | undefined, b: NodeRef | undefined): boolean {
  return a?.surfaceId === b?.surfaceId && a?.componentId === b?.componentId;
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
  if (from.traceId === to.traceId && from.stepId === to.stepId && sameNode(from.node, to.node)) {
    return 'none';
  }
  if (own || from.traceId === to.traceId) return 'replace';
  return 'push';
}
