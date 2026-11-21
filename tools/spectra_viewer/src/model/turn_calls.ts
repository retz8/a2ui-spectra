/**
 * The turn header's second line: the time to the first token and to the
 * first component, the model calls, the retries among them, and the tool
 * calls, their tokens, the
 * share read from the cache and the estimated cost, from the timeline's call
 * rows so far. A call read from spans only counts with its tokens; the tool
 * calls counted are the full rows, housekeeping and the toolset's calls,
 * shown as their parses, left out. A replayed turn counts its live calls
 * alone, adding how many came from the record; with no live model call it is free,
 * with no tokens or price table's date.
 */
import {retryCountOf} from './a2ui_step.ts';
import {type CallRow, callRowsOf, modelReadingOf, timedEventOf} from './call_rows.ts';
import {
  callCostOf,
  formatCost,
  formatShare,
  formatTokensBrief,
  type Prices,
  shownCostOf,
} from './cost.ts';
import {firstChunkMs, hitRatioOf, isReadInFull, usageOf} from './model_calls.ts';
import {isMissCall, isServedRow} from './provenance.ts';
import {isWireOutput, type ModelCallEvent, type TurnRecordEvent, unixMillis} from './record.ts';
import {plural, toolRowsOfParses} from './steps.ts';
import {isFullToolRow} from './tool_calls.ts';

/** A facts line's parts in sentence case: the first fact with its capital, the others as written. */
function sentenceCase(parts: string[]): string[] {
  return parts.map((part, index) =>
    index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part,
  );
}

/** The second line's parts, in order, or none for a turn with no model call and no tool call. */
export function insideLineOf(
  events: readonly TurnRecordEvent[],
  startMs: number,
  prices: Prices | undefined,
): string[] | undefined {
  const parts = insidePartsOf(events, startMs, prices);
  return parts === undefined ? undefined : sentenceCase(parts);
}

function insidePartsOf(
  events: readonly TurnRecordEvent[],
  startMs: number,
  prices: Prices | undefined,
): string[] | undefined {
  const rows = callRowsOf(events);
  const models = rows.filter(row => row.kind === 'model');
  const parsed = toolRowsOfParses(events, rows);
  const tools = rows.filter(
    row => row.kind === 'tool' && isFullToolRow(row) && !parsed.has(row.id),
  );
  if (models.length === 0 && tools.length === 0) return undefined;
  const parts: string[] = [];
  const liveModels = models.filter(row => !isServedRow(row));
  const liveTools = tools.filter(row => !isServedRow(row));
  const served = models.length + tools.length - liveModels.length - liveTools.length;
  // A miss was answered by the proxy: no token of it came from a model.
  const firstToken = firstTokenMs(
    models.filter(row => row.proxy === undefined || !isMissCall(row.proxy)),
  );
  if (firstToken !== undefined) parts.push(`first token ${seconds(firstToken - startMs)}`);
  const firstComponent = firstComponentMs(events);
  if (firstComponent !== undefined)
    parts.push(`first component ${seconds(firstComponent - startMs)}`);
  if (liveModels.length > 0) parts.push(plural(liveModels.length, 'model call'));
  const retries = retryCountOf(events);
  if (retries > 0) parts.push(plural(retries, 'retry').replace(/retrys$/, 'retries'));
  if (liveTools.length > 0) parts.push(plural(liveTools.length, 'tool call'));
  if (served > 0) parts.push(`${plural(served, 'call')} from the record`);
  // A replay pays for the model alone: a live tool call, such as a function in the agent's process, costs nothing.
  if (served > 0 && liveModels.length === 0) {
    parts.push('free');
    return parts;
  }

  // A call in flight counts among the calls; its tokens and cost join once it ends.
  const ended = liveModels
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
    parts.push(`est. ${formatCost(priced.reduce((sum, cost) => sum + cost.usd, 0))}`);
  }
  if (unpriced > 0) parts.push(`${plural(unpriced, 'call')} unpriced`);
  if (priced.length > 0) {
    parts.push(
      priced.every(cost => cost.source === 'config')
        ? 'prices from the config'
        : `LiteLLM prices ${prices?.date ?? ''}`,
    );
  }
  const raw = liveModels.filter(
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

/**
 * A model call's usage as the head of its detail says it, in the turn
 * header's form: its tokens in and out, its reasoning tokens, its share from
 * the cache, its estimated cost and where the price came from, and the spans
 * its tokens were read from; none for a call with no tokens recorded.
 */
export function callUsageLineOf(
  call: ModelCallEvent,
  prices: Prices | undefined,
  source?: string,
): string | undefined {
  const usage = usageOf(call);
  if (usage.input === undefined) return undefined;
  const parts = [
    `${formatTokensBrief(usage.input)} in`,
    `${formatTokensBrief(usage.output ?? 0)} out`,
  ];
  if ((usage.reasoning ?? 0) > 0) parts.push(`${formatTokensBrief(usage.reasoning!)} reasoning`);
  const ratio = hitRatioOf(usage);
  if (ratio !== undefined) parts.push(`${formatShare(ratio)} from cache`);
  const {value, note} = shownCostOf(call, prices);
  if (value !== undefined) parts.push(value.startsWith('$') ? `est. ${value}` : lowerFirst(value));
  if (note !== undefined) parts.push(lowerFirst(note.replace(' · ', ' ')));
  if (source !== undefined) parts.push(`tokens from ${source}`);
  return parts.join(' · ');
}

/** A fact after the line's first, in lower case unless it starts with a name. */
function lowerFirst(fact: string): string {
  return /^LiteLLM/.test(fact) ? fact : `${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
}
