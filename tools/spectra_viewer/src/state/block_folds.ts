/**
 * The labelled blocks of a step's detail folded on their label line, by
 * label: a block folded stays folded on every step for the session, so a long
 * system prompt folded once stays out of the way on every call.
 */
import {useSyncExternalStore} from 'react';

/** A block's fold: whether its content is shown, and the toggle for its label line. */
export interface BlockFold {
  open: boolean;
  onToggle: () => void;
}

let folded: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: ReadonlySet<string>): void {
  folded = next;
  for (const listener of listeners) listener();
}

export function isBlockFolded(label: string): boolean {
  return folded.has(label);
}

/** Folds a block by its label, or unfolds it. */
export function toggleBlockFold(label: string): void {
  const next = new Set(folded);
  if (!next.delete(label)) next.add(label);
  set(next);
}

/** Unfolds every block. */
export function resetBlockFolds(): void {
  set(new Set());
}

export function useBlockFold(label: string): BlockFold {
  const current = useSyncExternalStore(subscribe, () => folded);
  return {open: !current.has(label), onToggle: () => toggleBlockFold(label)};
}
