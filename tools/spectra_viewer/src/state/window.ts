/** Whether the window is small: below 1,280px wide, where the turn list becomes a strip. */
import {useSyncExternalStore} from 'react';

const SMALL = '(max-width: 1279.98px)';

export function useSmallWindow(): boolean {
  return useSyncExternalStore(
    listener => {
      const media = window.matchMedia(SMALL);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => window.matchMedia(SMALL).matches,
  );
}
