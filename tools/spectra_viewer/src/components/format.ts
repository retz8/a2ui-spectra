import type {InputBrief} from '@/model/input_brief.ts';
import type {TurnOutcome} from '@/model/record.ts';

export const OUTCOME_LABELS: Record<TurnOutcome, string> = {
  completed: 'completed',
  waiting_for_input: 'waiting for input',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** Text colour for each outcome, and for an open turn. */
export const OUTCOME_TONES: Record<TurnOutcome | 'open', string> = {
  completed: 'text-emerald-700 dark:text-emerald-400',
  waiting_for_input: 'text-amber-700 dark:text-amber-400',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
  open: 'text-sky-700 dark:text-sky-400',
};

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** A start time: the time of day for today, with the date for an earlier day. */
export function formatStart(time: string | number): string {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? TIME.format(date)
    : DAY_AND_TIME.format(date);
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

export function inputBriefText(input: InputBrief): string {
  if ('text' in input) return input.text;
  if ('action' in input) return `action ${input.action}`;
  return `${input.partType} part`;
}
