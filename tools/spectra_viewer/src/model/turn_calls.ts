/**
 * The turn header's second line: the time to the first token and to the
 * first component, the model calls and the tool calls, their tokens, the
 * share read from the cache and the estimated cost, from the timeline's call
 * rows so far. A call read from spans only counts with its tokens; the tool
 * calls counted are the full rows, housekeeping left out.
 */
import {type CallRow, callRowsOf, modelReadingOf, timedEventOf} from './call_rows.ts';
import {callCostOf, formatCost, formatShare, formatTokensBrief, type Prices} from './cost.ts';
import {firstChunkMs, isReadInFull, usageOf} from './model_calls.ts';
import {isWireOutput, type ModelCallEvent, type TurnRecordEvent, unixMillis} from './record.ts';
import {plural} from './steps.ts';
import {isFullToolRow} from './tool_calls.ts';

/** The second line's parts, in order, or none for a turn with no model call and no tool call. */
export function insideLineOf(
  events: readonly TurnRecordEvent[],
  startMs: number,
  prices: Prices | undefined,
): string[] | undefined {
  const rows = callRowsOf(events);
  const models = rows.filter(row => row.kind === 'model');
  const tools = rows.filter(row => row.kind === 'tool' && isFullToolRow(row));
  if (models.length === 0 && tools.length === 0) return undefined;
  const parts: string[] = [];
  const firstToken = firstTokenMs(models);
  if (firstToken !== undefined) parts.push(`First token ${seconds(firstToken - startMs)}`);
  const firstComponent = firstComponentMs(events);
  if (firstComponent !== undefined)
    parts.push(`First component ${seconds(firstComponent - startMs)}`);
  if (models.length > 0) parts.push(plural(models.length, 'model call'));
  if (tools.length > 0) parts.push(plural(tools.length, 'tool call'));

  // A call in flight counts among the calls; its tokens and cost join once it ends.
  const ended = models
    .filter(row => timedEventOf(row).endTimeUnixNano !== undefined)
    .map(row => modelReadingOf(row).event);
  const usages = ended.map(usageOf).filter(usage => usage.input !== undefined);
  if (usages.length > 0) {
    const input = usages.reduce((sum, usage) => sum + (usage.input ?? 0), 0);
    const output = usages.reduce((sum, usage) => sum + (usage.output ?? 0), 0);
    const cacheRead = usages.reduce((sum, usage) => sum + (usage.cacheRead ?? 0), 0);
    parts.push(`${formatTokensBrief(input)} in`, `${formatTokensBrief(output)} out`);
    if (cacheRead > 0 && input > 0) parts.push(`${formatShare(cacheRead / input)} from cache`);
  }
  const costs = ended.map(call => callCostOf(call, prices));
  const priced = costs.filter(cost => cost.kind === 'priced');
  const unpriced = costs.filter(cost => cost.kind === 'unpriced').length;
  if (priced.length > 0) {
    parts.push(`Est. ${formatCost(priced.reduce((sum, cost) => sum + cost.usd, 0))}`);
  }
  if (unpriced > 0) parts.push(`${plural(unpriced, 'call')} unpriced`);
  if (priced.length > 0) {
    parts.push(
      priced.every(cost => cost.source === 'config')
        ? 'Prices from the config'
        : `LiteLLM prices ${prices?.date ?? ''}`,
    );
  }
  const raw = models.filter(
    row => row.proxy !== undefined && !isReadInFull(row.proxy as ModelCallEvent),
  ).length;
  if (raw > 0) parts.push(`${plural(raw, 'call')} recorded raw`);
  return parts;
}

/**
 * When the first model call gave its first token: its first chunk when the
 * model proxy saw it stream, its end when it did not or when it is read from
 * spans only; nothing while it is in flight with no chunk yet.
 */
function firstTokenMs(rows: readonly CallRow[]): number | undefined {
  const first = [...rows].sort((a, b) =>
    BigInt(timedEventOf(a).startTimeUnixNano) < BigInt(timedEventOf(b).startTimeUnixNano) ? -1 : 1,
  )[0];
  if (first === undefined) return undefined;
  const chunk = first.proxy === undefined ? undefined : firstChunkMs(first.proxy as ModelCallEvent);
  const end = timedEventOf(first).endTimeUnixNano;
  return chunk ?? (end === undefined ? undefined : unixMillis(end));
}

/** When the agent's first A2UI message came. */
function firstComponentMs(events: readonly TurnRecordEvent[]): number | undefined {
  const delivery = events.find(
    event =>
      isWireOutput(event) &&
      event.attributes['a2ui.wire.message'].parts.some(part => part.type === 'a2ui'),
  );
  return delivery === undefined ? undefined : unixMillis(delivery.startTimeUnixNano);
}

/** A time as the second line reads it: "71 ms" below a second, "1.2 s" above. */
function seconds(ms: number): string {
  const at = Math.max(0, ms);
  return at < 1000 ? `${Math.round(at)} ms` : `${(at / 1000).toFixed(1)} s`;
}
