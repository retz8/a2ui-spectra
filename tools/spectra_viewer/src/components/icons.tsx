/**
 * Spectra's icons, drawn as the design artifact draws them: strokes on a 24
 * pixel grid, each step type and outcome its own shape. The mark is a card
 * with a lens over its corner, the card solid outside the lens and
 * see-through under it.
 */
import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';

const PATHS = {
  completed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  waiting: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  failed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  cancelled: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.8 18.2L18.2 5.8" />
    </>
  ),
  open: (
    <>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </>
  ),
  input: (
    <>
      <path d="M4 12h12" />
      <path d="M11 7l5 5-5 5" />
      <path d="M20 5v14" />
    </>
  ),
  status: <circle cx="12" cy="12" r="3" />,
  text: (
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.75" />
      <path d="M5 6v12c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6" />
      <path d="M5 12c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  createSurface: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  updateComponents: (
    <>
      <rect x="3" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="14" y="10" width="7" height="4.5" rx="1.5" />
      <rect x="14" y="16.5" width="7" height="4.5" rx="1.5" />
      <path d="M6.5 8.5v10.25H14M6.5 12.25H14" />
    </>
  ),
  updateDataModel: (
    <>
      <path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
      <path d="M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
    </>
  ),
  deleteSurface: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </>
  ),
  message: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 10h7M8.5 14h4" />
    </>
  ),
  delivery: (
    <>
      <path d="M12 4l8 4-8 4-8-4 8-4z" />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 16l8 4 8-4" />
    </>
  ),
  checked: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  unchecked: <circle cx="12" cy="12" r="8" strokeDasharray="2.5 3.3" />,
  turns: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  ),
  send: (
    <>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  jump: (
    <>
      <path d="M12 4v11" />
      <path d="M7 10.5l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  dot: <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  keys: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path
        d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M6.5 14h.01M17.5 14h.01"
        strokeWidth="2.2"
      />
      <path d="M9.5 14h5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconKind = keyof typeof PATHS;

export function Icon({
  kind,
  size = 16,
  className,
}: {
  kind: IconKind;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'block shrink-0',
        kind === 'open' && 'animate-spin [animation-duration:900ms] motion-reduce:animate-none',
        className,
      )}
    >
      {PATHS[kind]}
    </svg>
  );
}

/** Spectra's mark. */
export function Mark({size = 48, className}: {size?: number; className?: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={cn('block shrink-0', className)}
    >
      <path d="M5.5 2H13.5A3.5 3.5 0 0 1 17 5.5V7.66A8.4 8.4 0 0 0 7.66 17H5.5A3.5 3.5 0 0 1 2 13.5V5.5A3.5 3.5 0 0 1 5.5 2Z" />
      <path
        d="M17 10.592V13.5A3.5 3.5 0 0 1 13.5 17H10.592A5.5 5.5 0 0 1 17 10.592Z"
        fillOpacity="0.3"
      />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
