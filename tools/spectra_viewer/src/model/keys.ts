/**
 * The page's keys of one character: `/` for the search, `?` for the list of
 * keys, `n` and Shift+`n` for the next and previous problem, `l` for the
 * latest step, `m` to maximize or restore the step's detail. None of them acts while you type in a field, inside a dialog,
 * or with Ctrl, Cmd or Alt held.
 */

export type PageKey = '/' | '?' | 'n' | 'N' | 'l' | 'm';

const PAGE_KEYS: ReadonlySet<string> = new Set<PageKey>(['/', '?', 'n', 'N', 'l', 'm']);

/** The fields of a key press the page reads. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

/**
 * The page's key a press is, or nothing when it is not one, or falls where
 * typing goes. A letter is read by whether Shift is held, not by its case, so
 * Caps Lock changes nothing.
 */
export function pageKeyOf(event: KeyPress): PageKey | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const letter = event.key.length === 1 ? event.key.toLowerCase() : undefined;
  const key =
    letter === 'n'
      ? event.shiftKey
        ? 'N'
        : 'n'
      : letter === 'l' || letter === 'm'
        ? event.shiftKey
          ? undefined
          : letter
        : event.key;
  if (key === undefined || !PAGE_KEYS.has(key)) return undefined;
  const target = event.target as {closest?: (selector: string) => unknown} | null;
  if (target?.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')) {
    return undefined;
  }
  return key as PageKey;
}
