/**
 * Spectra's icons, drawn as the design artifact draws them: strokes on a 24
 * pixel grid, each step type and outcome its own shape. The mark is a card
 * with a lens over its corner, the card solid outside the lens and
 * see-through under it.
 */
import {type ReactNode, useId} from 'react';

import {cn} from '@/lib/utils';

const PATHS = {
  fixtures: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M13.5 4.5v7.25l2.75-1.75L19 11.75V4.5" />
      <path d="M6.5 11h3.5M6.5 15h7" />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M10.25 9.25l4.5 2.75-4.5 2.75z" />
    </>
  ),
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
  model: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
      <path d="M10 12h4" />
    </>
  ),
  tool: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.9 7.9l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3a6 6 0 0 1 7.9-7.9l-3.1 3.1z" />
  ),
  // A parse: lines of raw text beside the components they became.
  parse: (
    <>
      <path d="M3 6.5h7M3 11h5M3 15.5h7" />
      <rect x="14" y="3.5" width="7" height="5.5" rx="1.5" />
      <rect x="14" y="15" width="7" height="5.5" rx="1.5" />
      <path d="M17.5 9v6" />
    </>
  ),
  // A prompt generation: lines of the prompt, and the pen writing its UI section.
  prompt: (
    <>
      <path d="M4 6h12M4 10h12M4 14h6" />
      <path d="M13.5 20.5l.7-2.9 5.6-5.6a1.5 1.5 0 0 1 2.2 2.2l-5.6 5.6z" />
    </>
  ),
  maximize: (
    <>
      <path d="M14 4h6v6M10 20H4v-6" />
      <path d="M20 4l-6.5 6.5M4 20l6.5-6.5" />
    </>
  ),
  restore: (
    <>
      <path d="M19 10h-5V5M5 14h5v5" />
      <path d="M14 10l6-6M10 14l-6 6" />
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

/**
 * Gemini's colours, the four of Google's that Gemini's mark blends from blue,
 * as Lobe Icons' Gemini mark draws them: red, yellow and green into blue,
 * corner to corner.
 */
const GEMINI_STOPS: ReadonlyArray<[offset: number, colour: string]> = [
  [0, '#F94543'],
  [0.3, '#FABC12'],
  [0.55, '#08B962'],
  [0.8, '#3186FF'],
];

export function Icon({
  kind,
  size = 16,
  gradient,
  className,
}: {
  kind: IconKind;
  size?: number;
  /** Strokes the icon in a gradient in place of its colour: Gemini's colours. */
  gradient?: 'gemini';
  className?: string;
}) {
  const gradientId = `gradient-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={gradient === undefined ? 'currentColor' : `url(#${gradientId})`}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        'block shrink-0',
        kind === 'open' && 'animate-spin motion-reduce:animate-none',
        className,
      )}
    >
      {gradient === 'gemini' && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="4"
            y1="4"
            x2="20"
            y2="20"
          >
            {GEMINI_STOPS.map(([offset, colour]) => (
              <stop key={offset} offset={offset} stopColor={colour} />
            ))}
          </linearGradient>
        </defs>
      )}
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
