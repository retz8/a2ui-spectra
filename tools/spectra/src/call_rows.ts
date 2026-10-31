/**
 * A turn's calls as the viewer's timeline rows them, for the listing's count
 * of failed calls; the viewer's `model/call_rows.ts` holds the same rule.
 *
 * Each event a proxy wrote is a row, with the received call spans linked to
 * it as the same call. Received spans of one kind, `model_call` or
 * `tool_call`, that nest one inside the next are one chain: a span and the
 * nearest span of its kind above it are one chain when that span holds no
 * other span of the kind. A chain linked to a proxy's event joins that
 * event's row, every row it is linked to; a chain linked to none is a row of
 * its own. Framework spans have no rows.
 */
import {isReceived} from './receiver/assemble.js';
import type {TurnRecordEvent} from './record/turn_record.js';

/** A row: the proxy's event, when one was written, and the received spans of its chain. */
export interface CallRow {
  proxy?: TurnRecordEvent;
  spans: TurnRecordEvent[];
}

type CallKind = 'model_call' | 'tool_call';

function callKindOf(event: TurnRecordEvent): CallKind | undefined {
  const kind = event.attributes['a2ui.event.kind'];
  return kind === 'model_call' || kind === 'tool_call' ? kind : undefined;
}

function keyOf(event: {traceId: string; spanId: string}): string {
  return `${event.traceId}:${event.spanId}`;
}

/** The turn's call rows, the proxies' in their order, then each chain linked to none. */
export function callRowsOf(events: readonly TurnRecordEvent[]): CallRow[] {
  const byKey = new Map(events.map(event => [keyOf(event), event]));
  const parentOf = (event: TurnRecordEvent): TurnRecordEvent | undefined =>
    event.parentSpanId === undefined
      ? undefined
      : byKey.get(keyOf({traceId: event.traceId, spanId: event.parentSpanId}));
  const spans = events.filter(event => callKindOf(event) !== undefined && isReceived(event));
  const spanKeys = new Set(spans.map(keyOf));

  // The nearest span of the same kind above each span, and how many each holds so.
  const above = new Map<string, string>();
  const held = new Map<string, number>();
  for (const span of spans) {
    const seen = new Set<string>();
    for (let at = parentOf(span); at !== undefined && !seen.has(keyOf(at)); at = parentOf(at)) {
      seen.add(keyOf(at));
      if (spanKeys.has(keyOf(at)) && callKindOf(at) === callKindOf(span)) {
        above.set(keyOf(span), keyOf(at));
        held.set(keyOf(at), (held.get(keyOf(at)) ?? 0) + 1);
        break;
      }
    }
  }
  // A chain is named by its outermost span.
  const chainOf = new Map<string, string>();
  const headOf = (key: string): string => {
    let at = key;
    for (let parent = above.get(at); parent !== undefined && held.get(parent) === 1;) {
      at = parent;
      parent = above.get(at);
    }
    return at;
  };
  const chains = new Map<string, TurnRecordEvent[]>();
  for (const span of spans) {
    const head = headOf(keyOf(span));
    chainOf.set(keyOf(span), head);
    chains.set(head, [...(chains.get(head) ?? []), span]);
  }

  const proxies = events.filter(event => callKindOf(event) !== undefined && !isReceived(event));
  const linkedChains = new Set<string>();
  const rows: CallRow[] = proxies.map(proxy => {
    const heads = new Set(
      (proxy.links ?? []).flatMap(link => {
        const head = chainOf.get(keyOf(link));
        const span = byKey.get(keyOf(link));
        return head !== undefined && span !== undefined && callKindOf(span) === callKindOf(proxy)
          ? [head]
          : [];
      }),
    );
    for (const head of heads) linkedChains.add(head);
    return {proxy, spans: [...heads].flatMap(head => chains.get(head) ?? [])};
  });
  for (const [head, chain] of chains) {
    if (!linkedChains.has(head)) rows.push({spans: chain});
  }
  return rows;
}

/** Whether a row failed: its proxy's event or any span of its chain ended with status 2. */
export function isFailedRow(row: CallRow): boolean {
  return [...(row.proxy === undefined ? [] : [row.proxy]), ...row.spans].some(
    event => event.status?.code === 2,
  );
}

/** How many of a turn's call rows failed, model and tool, proxy and span-only. */
export function failedCallsOf(events: readonly TurnRecordEvent[]): number {
  return callRowsOf(events).filter(isFailedRow).length;
}
