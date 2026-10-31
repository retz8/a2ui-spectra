/**
 * A turn with its received spans: each span's event, its parent in the turn,
 * the same-call links between the proxies' events and the received spans,
 * and `otel_receiver` among the turn's capture paths.
 *
 * The received events follow the turn's own events, the turn event, the wire
 * events and the proxies' calls, and come before its check events, so that
 * amending a written turn moves none of the events its checks' findings
 * point at.
 */
import {parseTraceparent} from '../a2a/trace_context.js';
import {isRecord} from '../model_proxy/genai.js';
import {
  type CapturePath,
  isEventOfKind,
  type Link,
  type Turn,
  type TurnEvent,
  type TurnRecordEvent,
} from '../record/turn_record.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';
import {receivedEvent} from './received_event.js';

/** A span placed in a turn, with the log records attached to it so far. */
export interface PlacedSpan {
  span: ReceivedSpan;
  logs: readonly ReceivedLog[];
}

export function spanKey(traceId: string, spanId: string): string {
  return `${traceId}:${spanId}`;
}

function keyOf(event: {traceId: string; spanId: string}): string {
  return spanKey(event.traceId, event.spanId);
}

/** Whether an event came from the receiver. */
export function isReceived(event: TurnRecordEvent): boolean {
  return attributesOf(event)['a2ui.received.attributes'] !== undefined;
}

/** An event's attributes, read by any name. */
function attributesOf(event: TurnRecordEvent): Record<string, unknown> {
  return event.attributes as Record<string, unknown>;
}

function compareStart(a: TurnRecordEvent, b: TurnRecordEvent): number {
  const x = BigInt(a.startTimeUnixNano);
  const y = BigInt(b.startTimeUnixNano);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * The received spans' events in their turn, in start order, placement order
 * among equals. A span keeps its own parent; under trace propagation, a span
 * carrying the turn's trace id whose parent is in neither the turn nor its
 * received tree is the tree's root, under the turn event.
 */
export function receivedEvents(
  turnEvent: Pick<TurnEvent, 'traceId' | 'spanId'>,
  placed: readonly PlacedSpan[],
): TurnRecordEvent[] {
  const keys = new Set(placed.map(({span}) => spanKey(span.traceId, span.spanId)));
  return placed
    .map(({span, logs}) => {
      let parent = span.parentSpanId;
      if (
        span.traceId === turnEvent.traceId &&
        (parent === undefined ||
          (parent !== turnEvent.spanId && !keys.has(spanKey(span.traceId, parent))))
      ) {
        parent = turnEvent.spanId;
      }
      return receivedEvent(span, logs, parent);
    })
    .sort(compareStart);
}

/** The trace context a proxy's exchange carried: its `traceparent` header, or MCP's `_meta` one. */
function traceparentOf(event: TurnRecordEvent): string | undefined {
  const header = attributesOf(event)['http.request.header.traceparent'];
  if (Array.isArray(header) && typeof header[0] === 'string') return header[0];
  const body = attributesOf(event)['a2ui.http.request.body'];
  const params = isRecord(body) && isRecord(body.params) ? body.params : undefined;
  const meta = params !== undefined && isRecord(params._meta) ? params._meta : undefined;
  return typeof meta?.traceparent === 'string' ? meta.traceparent : undefined;
}

/** A proxy's exchange that can be the same call as a received span: a client call with its HTTP exchange. */
function isExchange(event: TurnRecordEvent): boolean {
  return (
    !isReceived(event) &&
    (isEventOfKind(event, 'model_call') || isEventOfKind(event, 'tool_call')) &&
    event.kind === 3 &&
    attributesOf(event)['http.request.method'] !== undefined
  );
}

function linkTo(event: TurnRecordEvent): Link {
  return {traceId: event.traceId, spanId: event.spanId};
}

/**
 * The same-call links, by each side's key. An exchange whose `traceparent`
 * names a received span is the same call as the nearest span of its kind at
 * or above it, and every such span above that. Without that, it is the same
 * call as the span of its kind whose time range holds the exchange's start,
 * when the spans that hold it are one chain, each the ancestor of the next;
 * two that are not leave it unlinked. A model proxy's call pairs with model
 * call spans, a tool proxy's with tool call spans.
 */
export function sameCallLinks(
  exchanges: readonly TurnRecordEvent[],
  received: readonly TurnRecordEvent[],
): Map<string, Link[]> {
  const byKey = new Map(received.map(event => [keyOf(event), event]));
  const parentOf = (event: TurnRecordEvent): TurnRecordEvent | undefined =>
    event.parentSpanId === undefined
      ? undefined
      : byKey.get(spanKey(event.traceId, event.parentSpanId));
  const ancestors = (event: TurnRecordEvent): Set<string> => {
    const seen = new Set<string>();
    for (let at = parentOf(event); at !== undefined && !seen.has(keyOf(at)); at = parentOf(at)) {
      seen.add(keyOf(at));
    }
    return seen;
  };
  const links = new Map<string, Link[]>();
  const add = (from: TurnRecordEvent, to: TurnRecordEvent) => {
    const list = links.get(keyOf(from)) ?? [];
    list.push(linkTo(to));
    links.set(keyOf(from), list);
  };
  for (const exchange of [...exchanges].sort(compareStart)) {
    const kind = exchange.attributes['a2ui.event.kind'];
    const ofKind = (event: TurnRecordEvent) => event.attributes['a2ui.event.kind'] === kind;
    let same: TurnRecordEvent[] = [];
    const start = BigInt(exchange.startTimeUnixNano);
    const holding = received.filter(
      event =>
        ofKind(event) &&
        BigInt(event.startTimeUnixNano) <= start &&
        start <= BigInt(event.endTimeUnixNano ?? event.startTimeUnixNano),
    );
    const isChain = (events: readonly TurnRecordEvent[]) =>
      events.every((a, i) =>
        events.slice(i + 1).every(b => ancestors(a).has(keyOf(b)) || ancestors(b).has(keyOf(a))),
      );
    const context = parseTraceparent(traceparentOf(exchange));
    const named =
      context === undefined ? undefined : byKey.get(spanKey(context.traceId, context.parentId));
    if (named !== undefined) {
      const seen = new Set<string>();
      for (
        let at: TurnRecordEvent | undefined = named;
        at !== undefined && !seen.has(keyOf(at));
        at = parentOf(at)
      ) {
        seen.add(keyOf(at));
        if (ofKind(at)) same.push(at);
      }
      // The chain goes on below the nearest span of the kind: a span of the
      // kind nested in it that holds the exchange's start, such as a LiteLLM
      // span its instrumentation did not make current around the request.
      const nearest = same[0];
      if (nearest !== undefined) {
        const below = holding.filter(event => ancestors(event).has(keyOf(nearest)));
        if (below.length > 0 && isChain([...same, ...below])) same.push(...below);
      }
    } else if (isChain(holding)) {
      same = holding;
    }
    for (const span of [...same].sort(compareStart)) {
      add(exchange, span);
      add(span, exchange);
    }
  }
  return links;
}

function withCapturePath(event: TurnEvent, path: CapturePath): TurnEvent {
  const paths = event.attributes['a2ui.turn.capture_paths'];
  if (paths.includes(path)) return event;
  return {
    ...event,
    attributes: {...event.attributes, 'a2ui.turn.capture_paths': [...paths, path]},
  };
}

/**
 * The turn with its received spans in place of the ones it held: the turn's
 * own events where they were, the proxies' calls with their same-call links,
 * then the received events in start order with theirs, then the check
 * events.
 */
export function assembleTurn(turn: Turn, placed: readonly PlacedSpan[]): Turn {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  if (turnEvent === undefined || placed.length === 0) return turn;
  const received = receivedEvents(turnEvent, placed);
  const receivedKeys = new Set(received.map(keyOf));
  const own = turn.events.filter(event => !isReceived(event) && !isEventOfKind(event, 'check'));
  const checks = turn.events.filter(event => !isReceived(event) && isEventOfKind(event, 'check'));
  const links = sameCallLinks(own.filter(isExchange), received);
  const withLinks = (event: TurnRecordEvent, kept: Link[]): TurnRecordEvent => {
    const all = [...kept, ...(links.get(keyOf(event)) ?? [])];
    const rest = {...event};
    delete rest.links;
    return (all.length > 0 ? {...rest, links: all} : rest) as TurnRecordEvent;
  };
  const ownEvents = own.map(event => {
    if (isEventOfKind(event, 'turn')) return withCapturePath(event, 'otel_receiver');
    if (!isExchange(event)) return event;
    // A link naming a received span is the receiver's, rebuilt each time; any other stays.
    const kept = (event.links ?? []).filter(link => !receivedKeys.has(keyOf(link)));
    return withLinks(event, kept);
  });
  return {
    events: [
      ...ownEvents,
      ...received.map(event => withLinks(event, event.links ?? [])),
      ...checks,
    ],
  };
}
