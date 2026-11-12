/**
 * The agent's output as the logs drawer and the first screen draw it: the
 * buffer's entries as it stands, every divider it holds, and the turn
 * markers, placed by time from the turns the viewer already lists. Worked out
 * when shown; nothing of the agent's process is in a turn record.
 */
import type {LogEntry, RestartCause} from '../api.ts';
import type {InputBrief} from './input_brief.ts';
import type {TurnOutcome} from './record.ts';
import {briefText} from './turn_groups.ts';

/** The fields of a listed turn a marker reads. */
export interface MarkedTurn {
  traceId: string;
  startTime: string;
  open?: true;
  outcome?: TurnOutcome;
  durationMs?: number;
  input?: InputBrief;
}

/** One row of the drawer. */
export type DrawerRow =
  /** An output line: its time, the stream it was written to and its text as shown. */
  | {kind: 'line'; key: string; time: string; stream: 'out' | 'err'; text: string}
  /** A stop or a start of the agent's process. */
  | {kind: 'divider'; key: string; text: string}
  /** Where a turn opened: its name links to it. */
  | {kind: 'opened'; key: string; traceId: string; name: string}
  /** Where a turn closed: its outcome in the header's words, lower-case, and its duration. */
  | {kind: 'closed'; key: string; outcome: string; durationMs: number};

/** ANSI escape codes: CSI and OSC sequences, and the two-character escapes. */
const ANSI = new RegExp(
  [
    '\\u001b\\[[0-?]*[ -/]*[@-~]',
    '\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)',
    '\\u001b[@-Z\\\\^_]',
  ].join('|'),
  'g',
);

/**
 * A line's text as shown: its ANSI codes stripped, then what follows its last
 * carriage return, the ones it ends in not counted, what a terminal would
 * leave. The buffer keeps the text as written.
 */
export function shownText(text: string): string {
  const plain = text.replace(ANSI, '').replace(/\r+$/, '');
  return plain.slice(plain.lastIndexOf('\r') + 1);
}

/** A cause as a divider words it: the changed file, or the press. */
export function causeWords(cause: RestartCause): string {
  return cause.kind === 'save' ? `${cause.file} changed` : 'Restart pressed';
}

/** A divider's text: "Started · uv run .", "Stopped · prompt_builder.py changed · exited with code 143". */
export function dividerTextOf(entry: Exclude<LogEntry, {type: 'line'}>): string {
  if (entry.type === 'started') return `Started · ${entry.command}`;
  return ['Stopped', ...(entry.cause === undefined ? [] : [causeWords(entry.cause)]), entry.exit]
    .filter(Boolean)
    .join(' · ');
}

/** A turn's outcome in the header's words, lower-case. */
const OUTCOME_WORDS: Record<TurnOutcome, string> = {
  completed: 'completed',
  waiting_for_input: 'waiting for input',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** A turn as its opened marker names it, as the turn list does. */
export function markerNameOf(input: InputBrief | undefined): string {
  return briefText(input) || 'A turn';
}

/** Where a row falls among those of its millisecond: an opened marker before the entries, a closed one after. */
const ENTRY = 1;
const OPENED = 0;
const CLOSED = 2;

/**
 * The drawer's rows: the buffer's entries in order, and a marker where each
 * listed turn opened and where it closed, whatever agent the turn list is
 * showing. A marker is drawn only when its moment is not earlier than the
 * oldest entry the buffer holds, so a turn from an earlier run gets none, and
 * a turn whose opening has left the buffer keeps its closed marker alone. An
 * open turn has its opened marker alone.
 */
export function drawerRowsOf(
  entries: readonly LogEntry[],
  turns: readonly MarkedTurn[],
): DrawerRow[] {
  if (entries.length === 0) return [];
  const placed: Array<{at: number; rank: number; order: number; row: DrawerRow}> = entries.map(
    (entry, order) => ({
      at: Date.parse(entry.time),
      rank: ENTRY,
      order,
      row:
        entry.type === 'line'
          ? {
              kind: 'line',
              key: `entry:${entry.n}`,
              time: entry.time,
              stream: entry.stream === 'stdout' ? 'out' : 'err',
              text: shownText(entry.text),
            }
          : {kind: 'divider', key: `entry:${entry.n}`, text: dividerTextOf(entry)},
    }),
  );
  const oldest = placed[0].at;
  // Listed newest first: the markers of one millisecond keep the turns' own order, oldest first.
  [...turns].reverse().forEach((turn, order) => {
    const start = Date.parse(turn.startTime);
    if (start >= oldest) {
      placed.push({
        at: start,
        rank: OPENED,
        order,
        row: {
          kind: 'opened',
          key: `opened:${turn.traceId}`,
          traceId: turn.traceId,
          name: markerNameOf(turn.input),
        },
      });
    }
    if (turn.open === true || turn.outcome === undefined || turn.durationMs === undefined) return;
    const end = start + turn.durationMs;
    if (end >= oldest) {
      placed.push({
        at: end,
        rank: CLOSED,
        order,
        row: {
          kind: 'closed',
          key: `closed:${turn.traceId}`,
          outcome: OUTCOME_WORDS[turn.outcome],
          durationMs: turn.durationMs,
        },
      });
    }
  });
  return placed
    .sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order)
    .map(({row}) => row);
}

/** One output line as the first screen's down form shows it. */
export interface TailLine {
  key: string;
  time: string;
  stream: 'out' | 'err';
  text: string;
}

/** How many lines the first screen's down form shows. */
export const TAIL_LINES = 12;

/**
 * The first screen's lines while the agent is down: the output lines written
 * since the latest start, the last twelve of them, dividers not counted. None
 * when the command wrote nothing, as when it could not start.
 */
export function tailSinceStartOf(entries: readonly LogEntry[]): TailLine[] {
  let started = entries.length - 1;
  while (started >= 0 && entries[started].type !== 'started') started -= 1;
  return entries
    .slice(started + 1)
    .flatMap(entry =>
      entry.type === 'line'
        ? [
            {
              key: `entry:${entry.n}`,
              time: entry.time,
              stream: entry.stream === 'stdout' ? ('out' as const) : ('err' as const),
              text: shownText(entry.text),
            },
          ]
        : [],
    )
    .slice(-TAIL_LINES);
}

/** A time to the millisecond in the page's time zone, as the drawer shows it: "18:36:26.412". */
export function logTimeOf(time: string): string {
  const date = new Date(time);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** The drawer's line count: "412 lines · 1,000 kept". */
export function lineCountOf(lines: number, cap: number): string {
  return `${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'} · ${cap.toLocaleString('en-US')} kept`;
}
