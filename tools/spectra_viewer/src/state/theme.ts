/**
 * The theme: the system's light or dark setting by default, or the choice
 * made at the foot of the rail, remembered in the browser.
 */
import {useEffect, useSyncExternalStore} from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'a2ui-spectra.theme';
const DARK = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();
let choice: ThemeChoice = readChoice();

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Sets the page's root to the chosen theme. */
export function applyTheme(): void {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia(DARK).matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function chooseTheme(next: ThemeChoice): void {
  choice = next;
  try {
    if (next === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // Not remembered where the browser keeps no storage; the choice holds for this page.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

/** The theme chosen, kept on the page while the system's setting changes. */
export function useTheme(): ThemeChoice {
  const current = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choice,
  );
  useEffect(() => {
    const media = window.matchMedia(DARK);
    media.addEventListener('change', applyTheme);
    return () => {
      media.removeEventListener('change', applyTheme);
    };
  }, []);
  return current;
}
