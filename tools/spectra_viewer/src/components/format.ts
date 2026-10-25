import type {TurnOutcome} from '@/model/record.ts';

import type {IconKind} from './icons.tsx';

export type TurnStatus = TurnOutcome | 'open';

export const STATUS_LABELS: Record<TurnStatus, string> = {
  completed: 'Completed',
  waiting_for_input: 'Waiting for input',
  failed: 'Failed',
  cancelled: 'Cancelled',
  open: 'Open',
};

export const STATUS_ICONS: Record<TurnStatus, IconKind> = {
  completed: 'completed',
  waiting_for_input: 'waiting',
  failed: 'failed',
  cancelled: 'cancelled',
  open: 'open',
};

/** An icon's colour: grey for its shape alone, red for trouble, teal for what is live. */
export function toneOf(icon: IconKind): string {
  if (icon === 'failed') return 'text-problem';
  if (icon === 'open') return 'text-brand';
  return 'text-muted-foreground';
}

// Times read on a 24-hour clock, as the design artifact sets them.
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const DAY = new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'});

/** A start time: the time of day for today, with the date for an earlier day. */
export function formatStart(time: string | number): string {
  const date = new Date(time);
  return isToday(date) ? TIME.format(date) : DAY_AND_TIME.format(date);
}

/** A time of day alone, for a row under its conversation, which gives the day. */
export function formatTime(time: string | number): string {
  return TIME.format(new Date(time));
}

/** A conversation's time in the list: the hour and minute today, the day before. */
export function formatClock(time: string | number): string {
  const date = new Date(time);
  return isToday(date) ? CLOCK.format(date) : DAY.format(date);
}

function isToday(date: Date): boolean {
  return date.toDateString() === new Date().toDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** A time since the turn's start, such as `+12 ms`. */
export function formatOffset(ms: number): string {
  return `+${formatDuration(Math.max(0, ms))}`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
