/**
 * The turn header's second line: the time to the first token and to the
 * first component, the model calls, their tokens, the share read from the
 * cache and the estimated cost, from the calls the turn holds so far.
 */
import {callCostOf, formatCost, formatShare, formatTokensBrief, type Prices} from './cost.ts';
import {firstChunkMs, isProxyModelCall, isReadInFull, timesOf, usageOf} from './model_calls.ts';
import {isWireOutput, type ModelCallEvent, type TurnRecordEvent, unixMillis} from './record.ts';
import {plural} from './steps.ts';

/** The second line's parts, in order, or none for a turn with no model call. */
export function insideLineOf(
  events: readonly TurnRecordEvent[],
  startMs: number,
  prices: Prices | undefined,
): string[] | undefined {
  const calls = events.filter(isProxyModelCall);
  if (calls.length === 0) return undefined;
  const parts: string[] = [];
  const firstToken = firstTokenMs(calls);
  if (firstToken !== undefined) parts.push(`First token ${seconds(firstToken - startMs)}`);
  const firstComponent = firstComponentMs(events);
  if (firstComponent !== undefined)
    parts.push(`First component ${seconds(firstComponent - startMs)}`);
  parts.push(plural(calls.length, 'model call'));

  // A call in flight counts among the calls; its tokens and cost join once it ends.
  const ended = calls.filter(call => call.endTimeUnixNano !== undefined);
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
  const raw = calls.filter(call => !isReadInFull(call)).length;
  if (raw > 0) parts.push(`${plural(raw, 'call')} recorded raw`);
  return parts;
}

/**
 * When the first model call gave its first token: its first chunk when it
 * streamed, its end when it did not; nothing while it is in flight with no
 * chunk yet.
 */
function firstTokenMs(calls: readonly ModelCallEvent[]): number | undefined {
  const first = [...calls].sort((a, b) =>
    BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1,
  )[0];
  return firstChunkMs(first) ?? timesOf(first).endMs;
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
