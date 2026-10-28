/**
 * What the viewer remembers of how it is laid out, besides the dividers'
 * positions: the result pane's Preview and Structure toggles, the preview's
 * width, and the turn list collapsed to its strip.
 */
import {useSyncExternalStore} from 'react';

export interface ViewSettings {
  /** Whether the Preview pane is shown. */
  preview: boolean;
  /** Whether the Structure pane is shown. */
  structure: boolean;
  width: 'narrow' | 'wide';
  /** Whether the turn list is collapsed to its strip on a wide window. */
  turnListCollapsed: boolean;
}

const KEY = 'a2ui-spectra.view';

const DEFAULTS: ViewSettings = {
  preview: true,
  structure: true,
  width: 'wide',
  turnListCollapsed: false,
};

function read(): ViewSettings {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    if (typeof stored !== 'object' || stored === null) return DEFAULTS;
    const {preview, structure, width, turnListCollapsed} = stored as Partial<ViewSettings>;
    return {
      preview: typeof preview === 'boolean' ? preview : DEFAULTS.preview,
      structure: typeof structure === 'boolean' ? structure : DEFAULTS.structure,
      width: width === 'narrow' || width === 'wide' ? width : DEFAULTS.width,
      turnListCollapsed:
        typeof turnListCollapsed === 'boolean' ? turnListCollapsed : DEFAULTS.turnListCollapsed,
    };
  } catch {
    return DEFAULTS;
  }
}

let settings: ViewSettings | undefined;
const listeners = new Set<() => void>();

function current(): ViewSettings {
  settings ??= read();
  return settings;
}

export function setViewSetting<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
  settings = {...current(), [key]: value};
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered where the browser keeps no storage; the setting holds for this page.
  }
  for (const listener of listeners) listener();
}

export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}
