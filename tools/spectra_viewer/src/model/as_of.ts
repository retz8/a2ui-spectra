/**
 * Where the result pane stands for a timeline row: the position the surfaces
 * are replayed to, the moment the row's result shows, the line that says
 * it, and the sentence that stands in for the surfaces when there are none.
 */
import {formatOffset} from '../components/format.ts';
import {parseOfMessage} from './a2ui_step.ts';
import {timedEventOf} from './call_rows.ts';
import {agentMessages} from './messages.ts';
import {type TurnRecordEvent, unixMillis} from './record.ts';
import {offsetOf} from './step_head.ts';
import type {Position, TimelineRow} from './steps.ts';

/** Where the surfaces stand for a row: after its step, or after its whole delivery; the outcome follows everything. */
export function positionOf(row: TimelineRow | undefined): Position | undefined {
  if (row === undefined) return undefined;
  return row.row === 'delivery' ? {eventIndex: row.eventIndex} : row.position;
}

/**
 * The moment a call's or a parse's result shows, in milliseconds since the
 * turn's start: a call's end, or the present while it is in flight; a
 * parse's last wire message. None for any other row, or for a parse no
 * message is traced to, whose result shows right after it.
 */
export function resultMomentOf(
  row: TimelineRow | undefined,
  events: readonly TurnRecordEvent[],
  startMs: number,
): number | undefined {
  if (row === undefined || row.row === 'delivery') return undefined;
  if (row.parse !== undefined) {
    const {parse, position} = row;
    const traced =
      position !== undefined &&
      agentMessages(events).some(
        message =>
          message.eventIndex === position.eventIndex &&
          parseOfMessage(events, message.key)?.spanId === parse.spanId,
      );
    return traced ? unixMillis(events[position.eventIndex].startTimeUnixNano) - startMs : undefined;
  }
  if (row.call !== undefined) {
    const end = timedEventOf(row.call).endTimeUnixNano;
    return end === undefined ? Infinity : unixMillis(end) - startMs;
  }
  return undefined;
}

/** The result pane's line saying which moment of the turn it shows, for a row not followed live. */
export function asOfLabel(
  row: TimelineRow | undefined,
  events: readonly TurnRecordEvent[],
  startMs: number,
): string {
  if (row === undefined) return '';
  if (row.row === 'delivery') return `After the delivery at ${formatOffset(row.offsetMs)}`;
  const moment = resultMomentOf(row, events, startMs);
  if (row.parse !== undefined) {
    return moment === undefined
      ? `Right after the parse at ${formatOffset(row.offsetMs ?? 0)}`
      : `After the parse’s last message, ${formatOffset(moment)}`;
  }
  if (row.call !== undefined) {
    return moment === undefined || moment === Infinity
      ? 'Live · the call is in flight'
      : `At the end of the call, ${formatOffset(moment)}`;
  }
  const offset = offsetOf(row, events, startMs);
  return offset === undefined ? '' : `After the step at ${formatOffset(offset)}`;
}

/** Why the result pane has no surface to show: the sentence that stands in its place. */
export function noSurfaceSentenceOf({
  open,
  later,
  deleted,
  sentA2ui,
  failed,
}: {
  /** Whether the turn is still open. */
  open: boolean;
  /** Whether the turn has surfaces after the step in view. */
  later: boolean;
  /** Whether the turn deleted surfaces it had. */
  deleted: boolean;
  /** Whether the agent sent any A2UI in the turn. */
  sentA2ui: boolean;
  /** Whether the turn failed. */
  failed: boolean;
}): string {
  return open
    ? 'No surfaces yet.'
    : later
      ? 'No surfaces yet at this step.'
      : deleted
        ? 'No surfaces: the turn deleted every surface it had.'
        : sentA2ui
          ? 'No surfaces: the agent sent no A2UI that builds one.'
          : failed
            ? 'No surfaces: the turn failed before any A2UI arrived.'
            : 'No surfaces: the agent sent no A2UI in this turn.';
}
