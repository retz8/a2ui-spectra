import type {ListedTurn} from '@/api.ts';
import type {Brand} from '@/model/model_calls.ts';
import type {TurnOutcome} from '@/model/record.ts';

import type {IconKind} from './icons.tsx';

/** A turn's status: its outcome once it has closed, else open. */
export type TurnStatus = TurnOutcome | 'open';

/** Each status's label, as the turn header's badge writes it. */
export const STATUS_LABELS: Record<TurnStatus, string> = {
  completed: 'Completed',
  waiting_for_input: 'Waiting for input',
  failed: 'Failed',
  cancelled: 'Cancelled',
  open: 'Open',
};

/** Each status's icon. */
export const STATUS_ICONS: Record<TurnStatus, IconKind> = {
  completed: 'completed',
  waiting_for_input: 'waiting',
  failed: 'failed',
  cancelled: 'cancelled',
  open: 'open',
};

/**
 * A listed turn's status icon, in the turn list and the strip; a file for a
 * stored turn whose record this Spectra does not read.
 */
export function turnIconOf(turn: Pick<ListedTurn, 'open' | 'outcome' | 'newer'>): IconKind {
  if (turn.newer !== undefined) return 'file';
  return STATUS_ICONS[turn.open ? 'open' : (turn.outcome ?? 'open')];
}

/**
 * A model call's icon in its provider's colour: Claude's clay, OpenAI's in the
 * text colour, since OpenAI's mark carries no colour of its own, and Gemini's
 * in its gradient, which the icon draws.
 */
export function brandIconOf(brand: Brand): {className: string; gradient?: 'gemini'} {
  if (brand === 'gemini') return {className: 'tone-gemini', gradient: 'gemini'};
  if (brand === 'claude') return {className: 'tone-claude'};
  return {className: 'tone-foreground'};
}

/** An icon's colour: grey for its shape alone, red for trouble, the accent for what is live. */
export function toneOf(icon: IconKind): string {
  if (icon === 'failed') return 'tone-problem';
  if (icon === 'open') return 'tone-brand';
  return 'tone-muted';
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

/** A duration: milliseconds under a second, seconds to a tenth under a minute, else minutes and seconds. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** A time since the turn's start, such as `+12 ms`. */
export function formatOffset(ms: number): string {
  return `+${formatDuration(Math.max(0, ms))}`;
}

/** An id cut to its first eight characters, for a line that names it in brief. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
