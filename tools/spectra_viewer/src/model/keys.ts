/**
 * The page's keys of one character: `/` for the search, `?` for the list of
 * keys, `n` and Shift+`n` for the next and previous problem, `l` for the
 * latest step. None of them acts while you type in a field, inside a dialog,
 * or with Ctrl, Cmd or Alt held.
 */

export type PageKey = '/' | '?' | 'n' | 'N' | 'l';

const PAGE_KEYS: ReadonlySet<string> = new Set<PageKey>(['/', '?', 'n', 'N', 'l']);

/** The fields of a key press the page reads. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/** The page's key a press is, or nothing when it is not one, or falls where typing goes. */
export function pageKeyOf(event: KeyPress): PageKey | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey || !PAGE_KEYS.has(event.key)) return undefined;
  const target = event.target as {closest?: (selector: string) => unknown} | null;
  if (target?.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')) {
    return undefined;
  }
  return event.key as PageKey;
}
