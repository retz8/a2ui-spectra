/**
 * The dividers' positions, remembered in the browser: the turn list's width,
 * the timeline's width and the step's detail's height when open, in pixels,
 * one each for every turn and both layouts. The detail opens at its
 * remembered height, at most half the pane it shares with the result.
 */

export type Divider = 'turnList' | 'timeline' | 'detail';

const KEY = 'a2ui-spectra.layout';

function readSizes(): Partial<Record<Divider, number>> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    return typeof stored === 'object' && stored !== null ? stored : {};
  } catch {
    return {};
  }
}

let sizes = readSizes();

/** The position a divider was last dragged to, if it was. */
export function rememberedSize(divider: Divider): number | undefined {
  const size = sizes[divider];
  return typeof size === 'number' && size > 0 ? size : undefined;
}

/** The height the detail opens at, from the height remembered and the pane it shares with the result. */
export function detailOpenHeight(remembered: number, pane: number): number {
  return Math.min(remembered, pane / 2);
}

export function rememberSize(divider: Divider, size: number): void {
  sizes = {...sizes, [divider]: Math.round(size)};
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // Not remembered where the browser keeps no storage; the position holds for this page.
  }
}
