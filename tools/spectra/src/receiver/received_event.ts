/**
 * A received span as a record event: its kind and dialect, its translated
 * names fitted to the record, every attribute as received, its own events
 * and links, and its attached log records as span events.
 */
import type {SpanEvent, TurnRecordEvent} from '../record/turn_record.js';
import {readSpan} from './dialects.js';
import {fittedValue, withFinishReasonsNormalised} from './genai.js';
import type {ReceivedLog, ReceivedSpan} from './otlp.js';

/** The names the receiver writes itself, which no translated name replaces. */
const OWN_NAMES = new Set([
  'a2ui.event.kind',
  'otel.scope.name',
  'otel.scope.version',
  'a2ui.received.dialect',
  'a2ui.received.attributes',
]);

/**
 * A log record as one of its span's events: the log's time, its event name,
 * else its severity text, its attributes as received, and its body and
 * severity under `a2ui.received.log.` names.
 */
export function logEvent(log: ReceivedLog): SpanEvent {
  return {
    timeUnixNano: log.timeUnixNano,
    name: log.eventName ?? log.severityText ?? '',
    attributes: {
      ...log.attributes,
      ...(log.body !== undefined && {'a2ui.received.log.body': log.body}),
      ...(log.severityNumber !== undefined && {
        'a2ui.received.log.severity_number': log.severityNumber,
      }),
      ...(log.severityText !== undefined && {
        'a2ui.received.log.severity_text': log.severityText,
      }),
    },
  };
}

function byTime(a: {timeUnixNano: string}, b: {timeUnixNano: string}): number {
  const x = BigInt(a.timeUnixNano);
  const y = BigInt(b.timeUnixNano);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** The log records attached to a span, in time order, arrival order among equals. */
export function inTimeOrder(logs: readonly ReceivedLog[]): ReceivedLog[] {
  return [...logs].sort(byTime);
}

/**
 * The event a received span becomes, with its attached logs, before the
 * same-call links are added. `parentSpanId` is the parent it is given in its
 * turn.
 */
export function receivedEvent(
  span: ReceivedSpan,
  logs: readonly ReceivedLog[],
  parentSpanId: string | undefined,
): TurnRecordEvent {
  const ordered = inTimeOrder(logs);
  const reading = readSpan(span, ordered);
  const translated: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(withFinishReasonsNormalised(reading.names))) {
    if (OWN_NAMES.has(name)) continue;
    const fitted = fittedValue(name, value);
    if (fitted !== undefined) translated[name] = fitted;
  }
  const events = [...span.events, ...ordered.map(logEvent)].sort(byTime);
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(parentSpanId !== undefined && {parentSpanId}),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: {
      'a2ui.event.kind': reading.kind,
      'otel.scope.name': span.scope.name,
      ...(span.scope.version !== undefined && {'otel.scope.version': span.scope.version}),
      ...(reading.dialect !== undefined && {'a2ui.received.dialect': reading.dialect}),
      ...translated,
      'a2ui.received.attributes': span.attributes,
    },
    ...(events.length > 0 && {events}),
    ...(span.links.length > 0 && {links: span.links}),
    status: span.status,
  } as TurnRecordEvent;
}
