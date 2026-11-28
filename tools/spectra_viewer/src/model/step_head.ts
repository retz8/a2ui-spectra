/**
 * The head of a step's detail, worked out from the record: a call's title
 * line, the facts line and the usage line under it, a row's offset, and the
 * head's height, which the detail keeps when collapsed.
 */
import {formatDuration, formatOffset} from '../components/format.ts';
import {generationTitleOf, parseTitleOf} from './a2ui_step.ts';
import {
  type CallRow,
  modelReadingOf,
  sourceOfNames,
  sourcesOfRow,
  timedEventOf,
} from './call_rows.ts';
import type {Prices} from './cost.ts';
import {apiOf, isReadInFull, methodAndPath, spanApiOf} from './model_calls.ts';
import {isModelCall, type TurnRecordEvent, unixMillis} from './record.ts';
import type {TimelineRow} from './steps.ts';
import {callUsageLineOf} from './turn_calls.ts';

/**
 * The head's title row with the detail's top rule, in pixels: also the
 * detail's height when collapsed with no step in it.
 */
export const TITLE_ROW = 41;

/** The head's facts line and its usage line, in pixels. */
const FACTS_LINE = 22;
const USAGE_LINE = 18;

/** The tallest head: a model call's, with its usage line. */
export const HEAD_MOST = TITLE_ROW + FACTS_LINE + USAGE_LINE;

/** A parse's, a prompt generation's or a call's title line; none for any other row. */
export function titleOf(
  row: TimelineRow,
  startMs: number,
): {target: string; times: string} | undefined {
  if (row.row !== 'step') return undefined;
  if (row.parse !== undefined) return parseTitleOf(row, startMs);
  if (row.generation !== undefined) return generationTitleOf(row);
  return row.call === undefined ? undefined : callTitleOf(row.call, row.target, startMs);
}

/** The head's facts line: the title's times, or the step's offset. */
export function factsOf(
  row: TimelineRow,
  events: readonly TurnRecordEvent[],
  startMs: number,
): string | undefined {
  const title = titleOf(row, startMs);
  if (title !== undefined) return title.times;
  const offset = offsetOf(row, events, startMs);
  return offset === undefined ? undefined : formatOffset(offset);
}

/** A model call's usage line, as the head's second facts line says it. */
export function usageOf(row: TimelineRow, prices: Prices | undefined): string | undefined {
  const call = row.row === 'step' ? row.call : undefined;
  if (call?.kind !== 'model') return undefined;
  const {event, fromSpans} = modelReadingOf(call);
  return callUsageLineOf(
    event,
    prices,
    fromSpans ? sourceOfNames(call, ['gen_ai.usage.input_tokens']) : undefined,
  );
}

/** The head's height, which the detail keeps when collapsed: its title row, and its facts lines under it. */
export function headHeightOf(
  row: TimelineRow,
  events: readonly TurnRecordEvent[],
  startMs: number,
  prices: Prices | undefined,
): number {
  return (
    TITLE_ROW +
    (factsOf(row, events, startMs) === undefined ? 0 : FACTS_LINE) +
    (usageOf(row, prices) === undefined ? 0 : USAGE_LINE)
  );
}

/**
 * A call's title line: what it went to and where it was seen, then its
 * times. A model call read in full names its API; one recorded raw its
 * method, path and status; one read from spans the API its provider
 * implies. A tool call names its target. The sources follow: the proxy, then
 * each dialect of its spans.
 */
export function callTitleOf(
  row: CallRow,
  target: string,
  startMs: number,
): {target: string; times: string} {
  const sources = sourcesOfRow(row);
  const proxy = row.proxy !== undefined && isModelCall(row.proxy) ? row.proxy : undefined;
  let what: string[];
  if (row.kind === 'tool') {
    what = [target];
  } else if (proxy !== undefined && isReadInFull(proxy)) {
    what = [apiOf(proxy) ?? ''];
  } else if (proxy !== undefined) {
    const status = proxy.attributes['http.response.status_code'];
    what = [methodAndPath(proxy), ...(typeof status === 'number' ? [String(status)] : [])];
  } else {
    const api = spanApiOf(modelReadingOf(row).event);
    what = api === undefined ? [] : [api];
  }
  const timed = timedEventOf(row);
  const start = unixMillis(timed.startTimeUnixNano);
  const times = [formatOffset(start - startMs)];
  if (timed.endTimeUnixNano !== undefined) {
    times.push(formatDuration(unixMillis(timed.endTimeUnixNano) - start));
  }
  const first =
    row.kind === 'model'
      ? modelReadingOf(row).event.attributes['gen_ai.response.time_to_first_chunk']
      : undefined;
  if (typeof first === 'number') times.push(`first token ${formatDuration(first * 1000)}`);
  return {
    target: [...what.filter(part => part !== ''), ...sources].join(' · '),
    times: times.join(' · '),
  };
}

/** A row's offset from the turn's start: its own, or its position's event's start. */
export function offsetOf(
  row: TimelineRow,
  events: readonly TurnRecordEvent[],
  startMs: number,
): number | undefined {
  if (row.offsetMs !== undefined) return row.offsetMs;
  const event =
    row.row === 'step' && row.position !== undefined ? events[row.position.eventIndex] : undefined;
  return event === undefined ? undefined : unixMillis(event.startTimeUnixNano) - startMs;
}
