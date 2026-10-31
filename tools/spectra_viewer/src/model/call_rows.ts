/**
 * A turn's calls as timeline rows. Each event a proxy wrote is a row, with
 * the received call spans linked to it as the same call. Received spans of
 * one kind, `model_call` or `tool_call`, that nest one inside the next are
 * one chain: a span and the nearest span of its kind above it are one chain
 * when that span holds no other span of the kind. A chain linked to a
 * proxy's event joins that event's row, every row it is linked to; a chain
 * linked to none is a row of its own, read from spans only. Framework spans
 * have no rows. The server's `call_rows.ts` holds the same rule for the
 * listing's count of failed calls.
 *
 * A row's sections are filled by the proxy's reading when it read the call,
 * else from the chain: each name by the first span, walking from the
 * innermost outward, that carries it, the token counts together from one
 * span.
 */
import {isModelCall, type ModelCallEvent, type OtherEvent, type TurnRecordEvent} from './record.ts';

export type CallKind = 'model' | 'tool';

/** A call's row on the timeline. */
export interface CallRow {
  kind: CallKind;
  /**
   * Names the row: the proxy's event's span id when it has one, else its
   * innermost span's.
   */
  id: string;
  /** The event a proxy wrote, when one did. */
  proxy?: OtherEvent;
  /** The received spans of its chain, outermost first. */
  spans: OtherEvent[];
}

function callKindOf(event: TurnRecordEvent): CallKind | undefined {
  const kind = event.attributes['a2ui.event.kind'];
  return kind === 'model_call' ? 'model' : kind === 'tool_call' ? 'tool' : undefined;
}

/** Whether an event came from the receiver. */
export function isReceivedEvent(event: TurnRecordEvent): boolean {
  return 'a2ui.received.attributes' in event.attributes;
}

/** A call a proxy wrote: a model or tool call that is not a span the receiver placed. */
export function isProxyCall(event: TurnRecordEvent): event is OtherEvent {
  return callKindOf(event) !== undefined && !isReceivedEvent(event);
}

function keyOf(event: {traceId: string; spanId: string}): string {
  return `${event.traceId}:${event.spanId}`;
}

/** The parent of each event within the turn, by its key. */
function parentsOf(
  events: readonly TurnRecordEvent[],
): (event: TurnRecordEvent) => TurnRecordEvent | undefined {
  const byKey = new Map(events.map(event => [keyOf(event), event]));
  return event =>
    event.parentSpanId === undefined
      ? undefined
      : byKey.get(keyOf({traceId: event.traceId, spanId: event.parentSpanId}));
}

/** Every ancestor of an event within the turn, nearest first. */
export function ancestorsOf(
  event: TurnRecordEvent,
  events: readonly TurnRecordEvent[],
): TurnRecordEvent[] {
  const parentOf = parentsOf(events);
  const seen = new Set<string>([keyOf(event)]);
  const ancestors: TurnRecordEvent[] = [];
  for (let at = parentOf(event); at !== undefined && !seen.has(keyOf(at)); at = parentOf(at)) {
    seen.add(keyOf(at));
    ancestors.push(at);
  }
  return ancestors;
}

/** The turn's call rows: the proxies' in the record's order, then each chain linked to none. */
export function callRowsOf(events: readonly TurnRecordEvent[]): CallRow[] {
  const byKey = new Map(events.map(event => [keyOf(event), event]));
  const parentOf = parentsOf(events);
  const spans = events.filter(
    (event): event is OtherEvent => callKindOf(event) !== undefined && isReceivedEvent(event),
  );
  const spanKeys = new Set(spans.map(keyOf));

  // The nearest span of the same kind above each span, and how many each holds so.
  const above = new Map<string, string>();
  const held = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const span of spans) {
    const seen = new Set<string>();
    let levels = 0;
    for (let at = parentOf(span); at !== undefined && !seen.has(keyOf(at)); at = parentOf(at)) {
      seen.add(keyOf(at));
      levels++;
      if (
        !above.has(keyOf(span)) &&
        spanKeys.has(keyOf(at)) &&
        callKindOf(at) === callKindOf(span)
      ) {
        above.set(keyOf(span), keyOf(at));
        held.set(keyOf(at), (held.get(keyOf(at)) ?? 0) + 1);
      }
    }
    depth.set(keyOf(span), levels);
  }
  // A chain is named by its outermost span.
  const headOf = (key: string): string => {
    let at = key;
    for (let parent = above.get(at); parent !== undefined && held.get(parent) === 1;) {
      at = parent;
      parent = above.get(at);
    }
    return at;
  };
  const chainOf = new Map<string, string>();
  const chains = new Map<string, OtherEvent[]>();
  for (const span of spans) {
    const head = headOf(keyOf(span));
    chainOf.set(keyOf(span), head);
    chains.set(head, [...(chains.get(head) ?? []), span]);
  }
  const outermostFirst = (list: OtherEvent[]) =>
    [...list].sort((a, b) => (depth.get(keyOf(a)) ?? 0) - (depth.get(keyOf(b)) ?? 0));

  const linkedChains = new Set<string>();
  const rows: CallRow[] = [];
  for (const proxy of events) {
    if (!isProxyCall(proxy)) continue;
    const kind = callKindOf(proxy)!;
    const heads = new Set(
      (proxy.links ?? []).flatMap(link => {
        const head = chainOf.get(keyOf(link));
        const span = byKey.get(keyOf(link));
        return head !== undefined && span !== undefined && callKindOf(span) === kind ? [head] : [];
      }),
    );
    for (const head of heads) linkedChains.add(head);
    rows.push({
      kind,
      id: proxy.spanId,
      proxy,
      spans: outermostFirst([...heads].flatMap(head => chains.get(head) ?? [])),
    });
  }
  for (const [head, chain] of chains) {
    if (linkedChains.has(head)) continue;
    const ordered = outermostFirst(chain);
    rows.push({
      kind: callKindOf(ordered[0])!,
      id: ordered[ordered.length - 1].spanId,
      spans: ordered,
    });
  }
  return rows;
}

/** Every span id a row holds: its proxy's and its chain's, for a row whose id changed. */
export function idsOf(row: CallRow): string[] {
  return [...(row.proxy === undefined ? [] : [row.proxy.spanId]), ...row.spans.map(s => s.spanId)];
}

/** The innermost span of a row's chain. */
export function innermostOf(row: CallRow): OtherEvent | undefined {
  return row.spans[row.spans.length - 1];
}

/**
 * The event that times a row: its proxy's exchange, else its innermost span.
 * A row has one or the other.
 */
export function timedEventOf(row: CallRow): OtherEvent {
  return row.proxy ?? innermostOf(row)!;
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

/** The names that make a call's token counts, taken together from one span. */
const USAGE_PREFIX = 'gen_ai.usage.';

/** The names the receiver writes about a span itself, which are not a call's sections. */
const SPAN_NAMES = new Set([
  'a2ui.event.kind',
  'otel.scope.name',
  'otel.scope.version',
  'a2ui.received.dialect',
  'a2ui.received.attributes',
]);

/**
 * A chain's translated names together: each name from the innermost span
 * that carries it, the token counts from the innermost span that has input
 * tokens.
 */
export function mergedNamesOf(spans: readonly OtherEvent[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const innermostFirst = [...spans].reverse();
  for (const span of innermostFirst) {
    for (const [name, value] of Object.entries(span.attributes)) {
      if (SPAN_NAMES.has(name) || name.startsWith(USAGE_PREFIX) || name in merged) continue;
      merged[name] = value;
    }
  }
  const counted = innermostFirst.find(
    span => span.attributes['gen_ai.usage.input_tokens'] !== undefined,
  );
  for (const [name, value] of Object.entries(counted?.attributes ?? {})) {
    if (name.startsWith(USAGE_PREFIX)) merged[name] = value;
  }
  return merged;
}

/** Whether a proxy read the call: a model call read in full, or an MCP request. */
export function proxyReadIt(proxy: OtherEvent): boolean {
  if (isModelCall(proxy)) return typeof proxy.attributes['gen_ai.provider.name'] === 'string';
  return isMcpEvent(proxy);
}

/** An MCP request or message the tool proxy read, as opposed to an HTTP tool recorded raw. */
export function isMcpEvent(event: OtherEvent): boolean {
  return Object.keys(event.attributes).some(
    name => name.startsWith('mcp.') || name.startsWith('jsonrpc.'),
  );
}

/**
 * What a row's sections are read from: the proxy's event when it read the
 * call; else the chain's names over the proxy's exchange, or over the
 * innermost span for a row read from spans only.
 */
export function readingOf(row: CallRow): {event: OtherEvent; fromSpans: boolean} {
  if (row.proxy !== undefined && (proxyReadIt(row.proxy) || row.spans.length === 0)) {
    return {event: row.proxy, fromSpans: false};
  }
  const base = timedEventOf(row);
  return {
    event: {
      ...base,
      attributes: {
        ...(row.proxy?.attributes ?? {}),
        ...mergedNamesOf(row.spans),
        'a2ui.event.kind': base.attributes['a2ui.event.kind'],
      },
    } as OtherEvent,
    fromSpans: true,
  };
}

/** A model row's reading, as the model call it reads as. */
export function modelReadingOf(row: CallRow): {event: ModelCallEvent; fromSpans: boolean} {
  const {event, fromSpans} = readingOf(row);
  return {event: event as ModelCallEvent, fromSpans};
}

/** The record's dialects, as a source from the receiver is named. */
const DIALECTS: Record<string, string> = {
  adk: 'ADK spans',
  openinference: 'OpenInference spans',
  genai: 'GenAI spans',
};

/** A received span's source: the dialect it was translated from, else "Received spans". */
export function sourceOfSpan(span: TurnRecordEvent): string {
  const dialect = (span.attributes as Record<string, unknown>)['a2ui.received.dialect'];
  return typeof dialect === 'string' ? (DIALECTS[dialect] ?? `${dialect} spans`) : 'Received spans';
}

/** The sources of a row's chain, innermost first, each once: the one a section read from spans names. */
export function spanSourcesOf(row: CallRow): string[] {
  return [...new Set([...row.spans].reverse().map(sourceOfSpan))];
}

/**
 * The source a section read from spans names: that of the innermost span
 * carrying one of `names`, else of the innermost span.
 */
export function sourceOfNames(row: CallRow, names: readonly string[]): string | undefined {
  const innermostFirst = [...row.spans].reverse();
  const carrying = innermostFirst.find(span =>
    names.some(name => span.attributes[name] !== undefined),
  );
  const span = carrying ?? innermostFirst[0];
  return span === undefined ? undefined : sourceOfSpan(span);
}

/** Every source in a row, the proxy first, then each dialect outermost first. */
export function sourcesOfRow(row: CallRow): string[] {
  const proxy =
    row.proxy === undefined ? [] : [row.kind === 'model' ? 'Model proxy' : 'Tool proxy'];
  return [...proxy, ...new Set(row.spans.map(sourceOfSpan))];
}

/** A span's source line: its source, then its scope's name and version. */
export function sourceLineOf(span: TurnRecordEvent): string {
  const attributes = span.attributes as Record<string, unknown>;
  const scope = [attributes['otel.scope.name'], attributes['otel.scope.version']]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  return scope === '' ? sourceOfSpan(span) : `${sourceOfSpan(span)} · ${scope}`;
}

/** The spans section's source lines: one per source and scope of the row's chain, outermost first. */
export function sourceLinesOf(row: CallRow): string[] {
  return [...new Set(row.spans.map(sourceLineOf))];
}
