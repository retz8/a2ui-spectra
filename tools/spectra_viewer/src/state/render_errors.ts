/**
 * The render errors the preview counts for the turn in view, for the turn
 * list's row and the strip, which count them while the turn is in view.
 */
import {useSyncExternalStore} from 'react';

export interface RenderErrorsInView {
  traceId: string;
  count: number;
}

let inView: RenderErrorsInView | undefined;
const listeners = new Set<() => void>();

export function setRenderErrorsInView(next: RenderErrorsInView | undefined): void {
  if (next?.traceId === inView?.traceId && next?.count === inView?.count) return;
  inView = next;
  for (const listener of listeners) listener();
}

export function useRenderErrorsInView(): RenderErrorsInView | undefined {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => inView,
  );
}
