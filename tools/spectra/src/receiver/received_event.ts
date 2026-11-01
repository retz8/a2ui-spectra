/**
 * A received span as a record event: its kind and dialect, its translated
 * names fitted to the record, every attribute as received, its own events
 * and links, and its attached log records as span events. A span of the
 * A2UI step is read by its own `a2ui.event.kind`, before any dialect.
 */
import type {EventKind, SpanEvent, TurnRecordEvent} from '../record/turn_record.js';
import {fittedSpanEvents, readA2uiStep} from './a2ui_step.js';
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
  const reading = readReceived(span, ordered);
  const events = fittedSpanEvents([...span.events, ...ordered.map(logEvent)].sort(byTime));
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
      ...reading.translated,
      'a2ui.received.attributes': span.attributes,
    },
    ...(events.length > 0 && {events}),
    ...(span.links.length > 0 && {links: span.links}),
    status: span.status,
  } as TurnRecordEvent;
}

/** A received span's kind, its dialect, and its names translated and fitted to the record. */
function readReceived(
  span: ReceivedSpan,
  logs: readonly ReceivedLog[],
): {kind: EventKind; dialect?: string; translated: Record<string, unknown>} {
  const step = readA2uiStep(span);
  if (step !== undefined) {
    // A half-formed span of the step is a framework span, with nothing translated.
    return step.missing.length === 0
      ? {kind: step.kind, translated: step.names}
      : {kind: 'framework_span', translated: {}};
  }
  const reading = readSpan(span, logs);
  const translated: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(withFinishReasonsNormalised(reading.names))) {
    if (OWN_NAMES.has(name)) continue;
    const fitted = fittedValue(name, value);
    if (fitted !== undefined) translated[name] = fitted;
  }
  const attempt = span.attributes['a2ui.retry.attempt'];
  if (
    reading.kind === 'model_call' &&
    typeof attempt === 'number' &&
    Number.isInteger(attempt) &&
    attempt >= 1
  ) {
    translated['a2ui.retry.attempt'] = attempt;
  }
  return {
    kind: reading.kind,
    ...(reading.dialect !== undefined && {dialect: reading.dialect}),
    translated,
  };
}
