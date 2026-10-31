/**
 * OTLP/JSON export requests for the receiver's tests, built from plain
 * values: attributes as an object, each span or log with only the fields a
 * test sets.
 */
import type {OtlpAnyValue, OtlpKeyValue} from '../receiver/otlp.js';

/** A plain value as OTLP/JSON's AnyValue. */
export function anyValue(value: unknown): OtlpAnyValue {
  if (typeof value === 'string') return {stringValue: value};
  if (typeof value === 'boolean') return {boolValue: value};
  if (typeof value === 'number') {
    return Number.isInteger(value) ? {intValue: String(value)} : {doubleValue: value};
  }
  if (Array.isArray(value)) return {arrayValue: {values: value.map(anyValue)}};
  if (typeof value === 'object' && value !== null) {
    return {kvlistValue: {values: keyValues(value as Record<string, unknown>)}};
  }
  return {};
}

export function keyValues(attributes: Record<string, unknown>): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({key, value: anyValue(value)}));
}

export interface TestSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  start: bigint | string;
  end: bigint | string;
  attributes?: Record<string, unknown>;
  status?: {code: number; message?: string};
}

export interface TestLog {
  traceId?: string;
  spanId?: string;
  time: bigint | string;
  eventName?: string;
  severityNumber?: number;
  severityText?: string;
  body?: unknown;
  attributes?: Record<string, unknown>;
}

/** One trace export request: each scope with its spans. */
export function traceExport(
  scopes: Array<{scope: {name: string; version?: string}; spans: TestSpan[]}>,
): unknown {
  return {
    resourceSpans: [
      {
        resource: {attributes: keyValues({'service.name': 'test-agent'})},
        scopeSpans: scopes.map(({scope, spans}) => ({
          scope,
          spans: spans.map(span => ({
            traceId: span.traceId,
            spanId: span.spanId,
            ...(span.parentSpanId !== undefined && {parentSpanId: span.parentSpanId}),
            name: span.name,
            kind: span.kind ?? 1,
            startTimeUnixNano: String(span.start),
            endTimeUnixNano: String(span.end),
            attributes: keyValues(span.attributes ?? {}),
            ...(span.status !== undefined && {status: span.status}),
          })),
        })),
      },
    ],
  };
}

/** One log export request: each scope with its log records. */
export function logExport(
  scopes: Array<{scope: {name: string; version?: string}; logs: TestLog[]}>,
): unknown {
  return {
    resourceLogs: [
      {
        scopeLogs: scopes.map(({scope, logs}) => ({
          scope,
          logRecords: logs.map(log => ({
            timeUnixNano: String(log.time),
            observedTimeUnixNano: String(log.time),
            ...(log.severityNumber !== undefined && {severityNumber: log.severityNumber}),
            ...(log.severityText !== undefined && {severityText: log.severityText}),
            ...(log.body !== undefined && {body: anyValue(log.body)}),
            attributes: keyValues(log.attributes ?? {}),
            ...(log.traceId !== undefined && {traceId: log.traceId}),
            ...(log.spanId !== undefined && {spanId: log.spanId}),
            ...(log.eventName !== undefined && {eventName: log.eventName}),
          })),
        })),
      },
    ],
  };
}

/** A JSON value as the bytes a request carries. */
export function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}
