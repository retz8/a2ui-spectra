/**
 * The tree node the page address holds, mirrored for the panes that draw it:
 * the turn body in view publishes the node it was given and its two ways to
 * select one, and Structure's tree and a parse's raw text read them. The page
 * address stays the node's one source: a selection writes it, through the
 * turn body's step, and comes back here as the node the body is given.
 */
import {useSyncExternalStore} from 'react';

import type {NodeRef} from '../model/address.ts';

export interface SelectedNode {
  node: NodeRef | undefined;
  /** Selects a node in Structure's tree, and the parse it came from with it. */
  selectInTree: (node: NodeRef) => void;
  /** Selects a node by its range in a parse's raw text, keeping that parse. */
  selectInRawText: (node: NodeRef) => void;
}

/** No turn body in view: no node, and selecting does nothing. */
const NONE: SelectedNode = {node: undefined, selectInTree: () => {}, selectInRawText: () => {}};

let current = NONE;
const listeners = new Set<() => void>();

/** Publishes the turn body's node and its ways to select one; none once the body is gone. */
export function setSelectedNode(next: SelectedNode | undefined): void {
  const value = next ?? NONE;
  if (
    value.node?.surfaceId === current.node?.surfaceId &&
    value.node?.componentId === current.node?.componentId &&
    value.selectInTree === current.selectInTree &&
    value.selectInRawText === current.selectInRawText
  ) {
    return;
  }
  current = value;
  for (const listener of listeners) listener();
}

export function useSelectedNode(): SelectedNode {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
