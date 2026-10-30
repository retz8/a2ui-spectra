/**
 * The preview pages' place in the viewer's tab order. The iframes sit
 * outside the viewer's tree, after it, so Tab would reach a page's controls
 * last. A stop in the Preview pane hands focus to the shown page, and a
 * sentinel on each side of the iframes hands it back beside the pane: Tab
 * out of a page's last control lands on the one after them, Shift+Tab out
 * of its first on the one before.
 */

/** Which sentinel took focus: before the iframes or after them. */
export type Side = 'before' | 'after';

/**
 * Where focus goes from a sentinel, the viewer's stops in order given, the
 * pane's own stop among them when a page is shown. Focus that reaches the
 * sentinels by a Tab pressed in the viewer itself, past its last stop, wraps
 * to its first; with no page shown, the sentinel after the iframes gives
 * focus to the viewer's last stop.
 */
export function stopBeside<T>(
  stops: readonly T[],
  entry: T | undefined,
  side: Side,
  fromViewer: boolean,
): T | undefined {
  const index = entry === undefined ? -1 : stops.indexOf(entry);
  if (fromViewer || index === -1) return side === 'before' ? stops[0] : stops[stops.length - 1];
  return stops[side === 'before' ? index - 1 : index + 1];
}
