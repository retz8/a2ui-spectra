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
