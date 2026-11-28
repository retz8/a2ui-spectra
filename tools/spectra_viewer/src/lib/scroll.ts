/** The parts of an element the column scroll reads and moves. */
interface Box {
  getBoundingClientRect(): {top: number; bottom: number};
}

interface Column extends Box {
  scrollTop: number;
}

/**
 * Scrolls a list's own column, up or down, by the least that brings an item
 * into view. Unlike `scrollIntoView`, it never scrolls the column sideways or
 * scrolls anything around it, such as the collapsed turn list's panel, which
 * holds the hidden list under the strip.
 */
export function scrollIntoColumn(column: Column | null, item: Box | null): void {
  if (column === null || item === null) return;
  const area = column.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  if (box.top < area.top) column.scrollTop -= area.top - box.top;
  else if (box.bottom > area.bottom) column.scrollTop += box.bottom - area.bottom;
}

/** Whether the reader asked for reduced motion: scrolls jump and the panels swing at once. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The nearest ancestor of an element that scrolls vertically; none when no ancestor does. */
export function scrollingAncestorOf(element: Element): HTMLElement | null {
  let pane = element.parentElement;
  while (pane !== null && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) {
    pane = pane.parentElement;
  }
  return pane;
}
