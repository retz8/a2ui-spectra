/**
 * The time lane every timeline row ends in, drawn against the length of the
 * whole turn: a call's bar from its start to its end, a step's or a
 * delivery's dot at its moment. The lane runs from the turn's start to the
 * latest of the turn's end and every row's end, so that a span placed after
 * the agent's last reply is never clipped; on a live turn the end is the
 * present, and the scale grows as the turn runs.
 */
import {timedEventOf} from './call_rows.ts';
import {firstChunkMs} from './model_calls.ts';
import {isModelCall, type ModelCallEvent, unixMillis} from './record.ts';
import type {TimelineRow} from './steps.ts';

/** A row's lane, in milliseconds since the turn's start. */
export type Lane =
  | {
      kind: 'bar';
      start: number;
      /** Its end, or the present while it is in flight. */
      end: number;
      /**
       * A model call's first token, when the model proxy saw it stream: the
       * bar is lighter before it. A tool call, a call read from spans only
       * and a call that did not stream are drawn in the darker tone from
       * start to end.
       */
      firstToken?: number;
      inFlight: boolean;
      /** A model call in flight with no token yet: the lighter tone alone. */
      waitsForToken: boolean;
    }
  | {kind: 'dot'; at: number};

/** The timeline's lanes, each row's by its id, and the length they are drawn against. */
export interface Lanes {
  /** Milliseconds from the turn's start to the latest end. */
  total: number;
  byRow: ReadonlyMap<string, Lane>;
}

/**
 * The lanes of a timeline. `endMs` is the turn's end, or the present on a
 * live turn, in milliseconds since the Unix epoch.
 */
export function lanesOf(rows: readonly TimelineRow[], startMs: number, endMs: number): Lanes {
  const byRow = new Map<string, Lane>();
  let latest = Math.max(0, endMs - startMs);
  let moment = 0;
  for (const row of rows) {
    if (row.row === 'step' && row.call !== undefined) {
      const timed = timedEventOf(row.call);
      const start = unixMillis(timed.startTimeUnixNano) - startMs;
      const inFlight = timed.endTimeUnixNano === undefined;
      const end = inFlight
        ? Math.max(start, endMs - startMs)
        : unixMillis(timed.endTimeUnixNano!) - startMs;
      const proxied = row.call.proxy !== undefined && isModelCall(row.call.proxy);
      const first = proxied ? firstChunkMs(row.call.proxy as ModelCallEvent) : undefined;
      byRow.set(row.id, {
        kind: 'bar',
        start,
        end,
        ...(first !== undefined && {firstToken: first - startMs}),
        inFlight,
        waitsForToken: proxied && inFlight && first === undefined,
      });
      latest = Math.max(latest, end);
      moment = start;
      continue;
    }
    // A step under its delivery takes the delivery's moment.
    if (row.offsetMs !== undefined) moment = row.offsetMs;
    byRow.set(row.id, {kind: 'dot', at: moment});
    latest = Math.max(latest, moment);
  }
  return {total: latest, byRow};
}

/** A time's place along the lane, as a share of its length from 0 to 100. */
export function shareOf(ms: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, ms / total)) * 100;
}
