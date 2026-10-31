/**
 * OTLP export requests, as the receiver takes them: protobuf, decoded with
 * the code generated from the copied `.proto` files, and OTLP/JSON, both
 * brought to the OTLP/JSON shape, with trace and span ids as lowercase hex,
 * times as decimal strings and enums as integers. From that shape, the spans
 * and log records are read into the record's shape: attributes as an object
 * of plain values, every value as received.
 */
import {fromBinary} from '@bufbuild/protobuf';

import {ExportLogsServiceRequestSchema} from './gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js';
import {ExportTraceServiceRequestSchema} from './gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js';
import type {
  AnyValue,
  InstrumentationScope,
  KeyValue,
} from './gen/opentelemetry/proto/common/v1/common_pb.js';
import type {LogRecord} from './gen/opentelemetry/proto/logs/v1/logs_pb.js';
import type {Span} from './gen/opentelemetry/proto/trace/v1/trace_pb.js';
import type {Link, SpanEvent, SpanKind, Status} from '../record/turn_record.js';

// The OTLP/JSON shape.

export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string;
  doubleValue?: number | string;
  arrayValue?: {values?: OtlpAnyValue[]};
  kvlistValue?: {values?: OtlpKeyValue[]};
  bytesValue?: string;
}

export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

export interface OtlpScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  traceState?: string;
  parentSpanId?: string;
  flags?: number;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpKeyValue[];
  events?: Array<{timeUnixNano: string; name: string; attributes?: OtlpKeyValue[]}>;
  links?: Array<{
    traceId: string;
    spanId: string;
    traceState?: string;
    attributes?: OtlpKeyValue[];
    flags?: number;
  }>;
  status?: {message?: string; code?: number};
}

export interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  flags?: number;
  traceId?: string;
  spanId?: string;
  eventName?: string;
}

export interface ExportTraces {
  resourceSpans: Array<{
    resource?: {attributes?: OtlpKeyValue[]};
    scopeSpans: Array<{scope?: OtlpScope; spans: OtlpSpan[]; schemaUrl?: string}>;
    schemaUrl?: string;
  }>;
}

export interface ExportLogs {
  resourceLogs: Array<{
    resource?: {attributes?: OtlpKeyValue[]};
    scopeLogs: Array<{scope?: OtlpScope; logRecords: OtlpLogRecord[]; schemaUrl?: string}>;
    schemaUrl?: string;
  }>;
}

/** An export request body that does not decode as its signal's request. */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export type Encoding = 'protobuf' | 'json';

/** Decodes an `ExportTraceServiceRequest` into the OTLP/JSON shape. */
export function decodeTraces(body: Uint8Array, encoding: Encoding): ExportTraces {
  if (encoding === 'json') {
    return tracesFromJson(parseJson(body));
  }
  let request;
  try {
    request = fromBinary(ExportTraceServiceRequestSchema, body);
  } catch (error) {
    throw new DecodeError(`The body is not an OTLP trace export: ${messageOf(error)}`);
  }
  return {
    resourceSpans: request.resourceSpans.map(resourceSpans => ({
      ...(resourceSpans.resource !== undefined && {
        resource: {attributes: resourceSpans.resource.attributes.map(keyValueFromProto)},
      }),
      scopeSpans: resourceSpans.scopeSpans.map(scopeSpans => ({
        ...(scopeSpans.scope !== undefined && {scope: scopeFromProto(scopeSpans.scope)}),
        spans: scopeSpans.spans.map(spanFromProto),
        ...(scopeSpans.schemaUrl !== '' && {schemaUrl: scopeSpans.schemaUrl}),
      })),
      ...(resourceSpans.schemaUrl !== '' && {schemaUrl: resourceSpans.schemaUrl}),
    })),
  };
}

/** Decodes an `ExportLogsServiceRequest` into the OTLP/JSON shape. */
export function decodeLogs(body: Uint8Array, encoding: Encoding): ExportLogs {
  if (encoding === 'json') {
    return logsFromJson(parseJson(body));
  }
  let request;
  try {
    request = fromBinary(ExportLogsServiceRequestSchema, body);
  } catch (error) {
    throw new DecodeError(`The body is not an OTLP log export: ${messageOf(error)}`);
  }
  return {
    resourceLogs: request.resourceLogs.map(resourceLogs => ({
      ...(resourceLogs.resource !== undefined && {
        resource: {attributes: resourceLogs.resource.attributes.map(keyValueFromProto)},
      }),
      scopeLogs: resourceLogs.scopeLogs.map(scopeLogs => ({
        ...(scopeLogs.scope !== undefined && {scope: scopeFromProto(scopeLogs.scope)}),
        logRecords: scopeLogs.logRecords.map(logFromProto),
        ...(scopeLogs.schemaUrl !== '' && {schemaUrl: scopeLogs.schemaUrl}),
      })),
      ...(resourceLogs.schemaUrl !== '' && {schemaUrl: resourceLogs.schemaUrl}),
    })),
  };
}

// From protobuf.

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

function scopeFromProto(scope: InstrumentationScope): OtlpScope {
  return {
    name: scope.name,
    ...(scope.version !== '' && {version: scope.version}),
    ...(scope.attributes.length > 0 && {attributes: scope.attributes.map(keyValueFromProto)}),
  };
}

function keyValueFromProto(keyValue: KeyValue): OtlpKeyValue {
  return {
    key: keyValue.key,
    ...(keyValue.value !== undefined && {value: anyValueFromProto(keyValue.value)}),
  };
}

function anyValueFromProto(value: AnyValue): OtlpAnyValue {
  switch (value.value.case) {
    case 'stringValue':
      return {stringValue: value.value.value};
    case 'boolValue':
      return {boolValue: value.value.value};
    case 'intValue':
      return {intValue: value.value.value.toString()};
    case 'doubleValue':
      return {doubleValue: value.value.value};
    case 'arrayValue':
      return {arrayValue: {values: value.value.value.values.map(anyValueFromProto)}};
    case 'kvlistValue':
      return {kvlistValue: {values: value.value.value.values.map(keyValueFromProto)}};
    case 'bytesValue':
      return {bytesValue: Buffer.from(value.value.value).toString('base64')};
    default:
      return {};
  }
}

function spanFromProto(span: Span): OtlpSpan {
  if (span.traceId.length !== 16 || span.spanId.length !== 8) {
    throw new DecodeError(`The span '${span.name}' has no 16-byte trace id or 8-byte span id.`);
  }
  return {
    traceId: hex(span.traceId),
    spanId: hex(span.spanId),
    ...(span.traceState !== '' && {traceState: span.traceState}),
    ...(span.parentSpanId.length === 8 && {parentSpanId: hex(span.parentSpanId)}),
    ...(span.flags !== 0 && {flags: span.flags}),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano.toString(),
    endTimeUnixNano: span.endTimeUnixNano.toString(),
    attributes: span.attributes.map(keyValueFromProto),
    events: span.events.map(event => ({
      timeUnixNano: event.timeUnixNano.toString(),
      name: event.name,
      attributes: event.attributes.map(keyValueFromProto),
    })),
    links: span.links
      .filter(link => link.traceId.length === 16 && link.spanId.length === 8)
      .map(link => ({
        traceId: hex(link.traceId),
        spanId: hex(link.spanId),
        ...(link.traceState !== '' && {traceState: link.traceState}),
        attributes: link.attributes.map(keyValueFromProto),
        ...(link.flags !== 0 && {flags: link.flags}),
      })),
    ...(span.status !== undefined && {
      status: {
        ...(span.status.message !== '' && {message: span.status.message}),
        code: span.status.code,
      },
    }),
  };
}

function logFromProto(log: LogRecord): OtlpLogRecord {
  return {
    timeUnixNano: log.timeUnixNano.toString(),
    observedTimeUnixNano: log.observedTimeUnixNano.toString(),
    severityNumber: log.severityNumber,
    ...(log.severityText !== '' && {severityText: log.severityText}),
    ...(log.body !== undefined && {body: anyValueFromProto(log.body)}),
    attributes: log.attributes.map(keyValueFromProto),
    ...(log.flags !== 0 && {flags: log.flags}),
    ...(log.traceId.length === 16 && {traceId: hex(log.traceId)}),
    ...(log.spanId.length === 8 && {spanId: hex(log.spanId)}),
    ...(log.eventName !== '' && {eventName: log.eventName}),
  };
}

// From OTLP/JSON: read leniently where the encoding allows two forms, such as
// an int64 as a string or a number, and strictly where the shape is wrong.

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
  } catch (error) {
    throw new DecodeError(`The body is not JSON: ${messageOf(error)}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) throw new DecodeError(`${where} is not an object.`);
  return value;
}

function listAt(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DecodeError(`${where} is not a list.`);
  return value;
}

function stringAt(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new DecodeError(`${where} is not a string.`);
  return value;
}

/** A 64-bit integer, as a string or a number, as a decimal string. */
function int64At(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value).toString();
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value).toString();
  throw new DecodeError(`${where} is not an integer.`);
}

/** An enum, by its integer, which OTLP/JSON requires. */
function enumAt(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new DecodeError(`${where} is not an enum's integer.`);
}

/** A trace id, 16 bytes, or a span id, 8 bytes: hex, any case, as lowercase hex; empty as absent. */
function idAt(value: unknown, where: string, bytes: 16 | 8): string | undefined {
  const text = stringAt(value, where);
  if (text === undefined || text === '') return undefined;
  if (text.length !== bytes * 2 || !/^[0-9a-fA-F]+$/.test(text)) {
    throw new DecodeError(`${where} is not ${bytes} bytes of hex.`);
  }
  return text.toLowerCase();
}

/** A log's trace or span id; one of the wrong length reads as no span context. */
function logIdAt(value: unknown, where: string, bytes: 16 | 8): string | undefined {
  const text = stringAt(value, where);
  return text !== undefined && text.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(text)
    ? text.toLowerCase()
    : undefined;
}

function anyValueFromJson(value: unknown, where: string): OtlpAnyValue {
  const field = objectAt(value, where);
  if ('stringValue' in field) return {stringValue: stringAt(field.stringValue, where) ?? ''};
  if ('boolValue' in field) {
    if (typeof field.boolValue !== 'boolean') throw new DecodeError(`${where} is not a boolean.`);
    return {boolValue: field.boolValue};
  }
  if ('intValue' in field) return {intValue: int64At(field.intValue, where) ?? '0'};
  if ('doubleValue' in field) {
    const double = field.doubleValue;
    if (typeof double === 'number' || (typeof double === 'string' && double !== '')) {
      return {
        doubleValue: typeof double === 'string' && !isNaN(Number(double)) ? Number(double) : double,
      };
    }
    throw new DecodeError(`${where} is not a number.`);
  }
  if ('arrayValue' in field) {
    const array = objectAt(field.arrayValue ?? {}, where);
    return {
      arrayValue: {
        values: listAt(array.values, where).map((item, i) =>
          anyValueFromJson(item, `${where}[${i}]`),
        ),
      },
    };
  }
  if ('kvlistValue' in field) {
    const list = objectAt(field.kvlistValue ?? {}, where);
    return {kvlistValue: {values: keyValuesFromJson(list.values, where)}};
  }
  if ('bytesValue' in field) return {bytesValue: stringAt(field.bytesValue, where) ?? ''};
  return {};
}

function keyValuesFromJson(value: unknown, where: string): OtlpKeyValue[] {
  return listAt(value, where).map((item, i) => {
    const keyValue = objectAt(item, `${where}[${i}]`);
    const key = stringAt(keyValue.key, `${where}[${i}].key`) ?? '';
    return {
      key,
      ...(keyValue.value !== undefined &&
        keyValue.value !== null && {value: anyValueFromJson(keyValue.value, `${where}.${key}`)}),
    };
  });
}

function scopeFromJson(value: unknown, where: string): OtlpScope | undefined {
  if (value === undefined || value === null) return undefined;
  const scope = objectAt(value, where);
  const name = stringAt(scope.name, `${where}.name`);
  const version = stringAt(scope.version, `${where}.version`);
  const attributes = keyValuesFromJson(scope.attributes, `${where}.attributes`);
  return {
    ...(name !== undefined && {name}),
    ...(version !== undefined && version !== '' && {version}),
    ...(attributes.length > 0 && {attributes}),
  };
}

function resourceFromJson(
  value: unknown,
  where: string,
): {attributes?: OtlpKeyValue[]} | undefined {
  if (value === undefined || value === null) return undefined;
  return {attributes: keyValuesFromJson(objectAt(value, where).attributes, `${where}.attributes`)};
}

function spanFromJson(value: unknown, where: string): OtlpSpan {
  const span = objectAt(value, where);
  const traceId = idAt(span.traceId, `${where}.traceId`, 16);
  const spanId = idAt(span.spanId, `${where}.spanId`, 8);
  if (traceId === undefined || spanId === undefined) {
    throw new DecodeError(`${where} has no trace id or span id.`);
  }
  const parentSpanId = idAt(span.parentSpanId, `${where}.parentSpanId`, 8);
  const traceState = stringAt(span.traceState, `${where}.traceState`);
  const flags = enumAt(span.flags, `${where}.flags`);
  const status =
    span.status === undefined || span.status === null
      ? undefined
      : objectAt(span.status, `${where}.status`);
  const statusMessage =
    status === undefined ? undefined : stringAt(status.message, `${where}.status.message`);
  return {
    traceId,
    spanId,
    ...(traceState !== undefined && traceState !== '' && {traceState}),
    ...(parentSpanId !== undefined && {parentSpanId}),
    ...(flags !== undefined && flags !== 0 && {flags}),
    name: stringAt(span.name, `${where}.name`) ?? '',
    kind: enumAt(span.kind, `${where}.kind`) ?? 0,
    startTimeUnixNano: int64At(span.startTimeUnixNano, `${where}.startTimeUnixNano`) ?? '0',
    endTimeUnixNano: int64At(span.endTimeUnixNano, `${where}.endTimeUnixNano`) ?? '0',
    attributes: keyValuesFromJson(span.attributes, `${where}.attributes`),
    events: listAt(span.events, `${where}.events`).map((item, i) => {
      const event = objectAt(item, `${where}.events[${i}]`);
      return {
        timeUnixNano: int64At(event.timeUnixNano, `${where}.events[${i}].timeUnixNano`) ?? '0',
        name: stringAt(event.name, `${where}.events[${i}].name`) ?? '',
        attributes: keyValuesFromJson(event.attributes, `${where}.events[${i}].attributes`),
      };
    }),
    links: listAt(span.links, `${where}.links`).map((item, i) => {
      const link = objectAt(item, `${where}.links[${i}]`);
      const linkTrace = idAt(link.traceId, `${where}.links[${i}].traceId`, 16);
      const linkSpan = idAt(link.spanId, `${where}.links[${i}].spanId`, 8);
      if (linkTrace === undefined || linkSpan === undefined) {
        throw new DecodeError(`${where}.links[${i}] has no trace id or span id.`);
      }
      const linkState = stringAt(link.traceState, `${where}.links[${i}].traceState`);
      const linkFlags = enumAt(link.flags, `${where}.links[${i}].flags`);
      return {
        traceId: linkTrace,
        spanId: linkSpan,
        ...(linkState !== undefined && linkState !== '' && {traceState: linkState}),
        attributes: keyValuesFromJson(link.attributes, `${where}.links[${i}].attributes`),
        ...(linkFlags !== undefined && linkFlags !== 0 && {flags: linkFlags}),
      };
    }),
    ...(status !== undefined && {
      status: {
        ...(statusMessage !== undefined && statusMessage !== '' && {message: statusMessage}),
        code: enumAt(status.code, `${where}.status.code`) ?? 0,
      },
    }),
  };
}

function logFromJson(value: unknown, where: string): OtlpLogRecord {
  const log = objectAt(value, where);
  const timeUnixNano = int64At(log.timeUnixNano, `${where}.timeUnixNano`);
  const observedTimeUnixNano = int64At(log.observedTimeUnixNano, `${where}.observedTimeUnixNano`);
  const severityNumber = enumAt(log.severityNumber, `${where}.severityNumber`);
  const severityText = stringAt(log.severityText, `${where}.severityText`);
  const flags = enumAt(log.flags, `${where}.flags`);
  const traceId = logIdAt(log.traceId, `${where}.traceId`, 16);
  const spanId = logIdAt(log.spanId, `${where}.spanId`, 8);
  const eventName = stringAt(log.eventName, `${where}.eventName`);
  return {
    ...(timeUnixNano !== undefined && {timeUnixNano}),
    ...(observedTimeUnixNano !== undefined && {observedTimeUnixNano}),
    ...(severityNumber !== undefined && {severityNumber}),
    ...(severityText !== undefined && severityText !== '' && {severityText}),
    ...(log.body !== undefined &&
      log.body !== null && {body: anyValueFromJson(log.body, `${where}.body`)}),
    attributes: keyValuesFromJson(log.attributes, `${where}.attributes`),
    ...(flags !== undefined && flags !== 0 && {flags}),
    ...(traceId !== undefined && {traceId}),
    ...(spanId !== undefined && {spanId}),
    ...(eventName !== undefined && eventName !== '' && {eventName}),
  };
}

function tracesFromJson(value: unknown): ExportTraces {
  const request = objectAt(value, 'The trace export');
  return {
    resourceSpans: listAt(request.resourceSpans, 'resourceSpans').map((item, i) => {
      const where = `resourceSpans[${i}]`;
      const resourceSpans = objectAt(item, where);
      const resource = resourceFromJson(resourceSpans.resource, `${where}.resource`);
      const schemaUrl = stringAt(resourceSpans.schemaUrl, `${where}.schemaUrl`);
      return {
        ...(resource !== undefined && {resource}),
        scopeSpans: listAt(resourceSpans.scopeSpans, `${where}.scopeSpans`).map((scoped, j) => {
          const at = `${where}.scopeSpans[${j}]`;
          const scopeSpans = objectAt(scoped, at);
          const scope = scopeFromJson(scopeSpans.scope, `${at}.scope`);
          const scopeSchema = stringAt(scopeSpans.schemaUrl, `${at}.schemaUrl`);
          return {
            ...(scope !== undefined && {scope}),
            spans: listAt(scopeSpans.spans, `${at}.spans`).map((span, k) =>
              spanFromJson(span, `${at}.spans[${k}]`),
            ),
            ...(scopeSchema !== undefined && scopeSchema !== '' && {schemaUrl: scopeSchema}),
          };
        }),
        ...(schemaUrl !== undefined && schemaUrl !== '' && {schemaUrl}),
      };
    }),
  };
}

function logsFromJson(value: unknown): ExportLogs {
  const request = objectAt(value, 'The log export');
  return {
    resourceLogs: listAt(request.resourceLogs, 'resourceLogs').map((item, i) => {
      const where = `resourceLogs[${i}]`;
      const resourceLogs = objectAt(item, where);
      const resource = resourceFromJson(resourceLogs.resource, `${where}.resource`);
      const schemaUrl = stringAt(resourceLogs.schemaUrl, `${where}.schemaUrl`);
      return {
        ...(resource !== undefined && {resource}),
        scopeLogs: listAt(resourceLogs.scopeLogs, `${where}.scopeLogs`).map((scoped, j) => {
          const at = `${where}.scopeLogs[${j}]`;
          const scopeLogs = objectAt(scoped, at);
          const scope = scopeFromJson(scopeLogs.scope, `${at}.scope`);
          const scopeSchema = stringAt(scopeLogs.schemaUrl, `${at}.schemaUrl`);
          return {
            ...(scope !== undefined && {scope}),
            logRecords: listAt(scopeLogs.logRecords, `${at}.logRecords`).map((log, k) =>
              logFromJson(log, `${at}.logRecords[${k}]`),
            ),
            ...(scopeSchema !== undefined && scopeSchema !== '' && {schemaUrl: scopeSchema}),
          };
        }),
        ...(schemaUrl !== undefined && schemaUrl !== '' && {schemaUrl}),
      };
    }),
  };
}

// Into the record's shape.

/** The instrumentation scope a span or log came from. */
export interface Scope {
  name: string;
  version?: string;
}

/** A received span in the record's shape, before it is translated. */
export interface ReceivedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  /** Every attribute, as received. */
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  links: Link[];
  status: Status;
  scope: Scope;
}

/** A received log record, before it is attached to its span. */
export interface ReceivedLog {
  /** The log's time, else the time it was observed. */
  timeUnixNano: string;
  /** Set when the log carries span context. */
  traceId?: string;
  spanId?: string;
  /** Its event name, from the record's field or the `event.name` attribute. */
  eventName?: string;
  severityNumber?: number;
  severityText?: string;
  body?: unknown;
  /** Every attribute, as received. */
  attributes: Record<string, unknown>;
  scope: Scope;
}

/** An OTLP/JSON value as a plain value: a kvlist as an object, an array as a list. */
export function plainValue(value: OtlpAnyValue | undefined): unknown {
  if (value === undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) {
    const number = Number(value.intValue);
    return Number.isSafeInteger(number) ? number : value.intValue;
  }
  if (value.doubleValue !== undefined) {
    return typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)
      ? value.doubleValue
      : String(value.doubleValue);
  }
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(plainValue);
  if (value.kvlistValue !== undefined) return plainAttributes(value.kvlistValue.values);
  if (value.bytesValue !== undefined) return value.bytesValue;
  return null;
}

/** A key and value list as an object; a later key wins. */
export function plainAttributes(list: OtlpKeyValue[] | undefined): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const {key, value} of list ?? []) {
    attributes[key] = plainValue(value);
  }
  return attributes;
}

function scopeOf(scope: OtlpScope | undefined): Scope {
  return {
    name: scope?.name ?? '',
    ...(scope?.version !== undefined && scope.version !== '' && {version: scope.version}),
  };
}

const ZERO_ID = /^0+$/;

function spanKind(kind: number | undefined): SpanKind {
  return kind !== undefined && kind >= 0 && kind <= 5 ? (kind as SpanKind) : 0;
}

/** Every span of a trace export, in the order received. */
export function receivedSpans(request: ExportTraces): ReceivedSpan[] {
  return request.resourceSpans.flatMap(({scopeSpans}) =>
    scopeSpans.flatMap(({scope, spans}) =>
      spans.map(span => {
        const code = span.status?.code;
        return {
          traceId: span.traceId,
          spanId: span.spanId,
          ...(span.parentSpanId !== undefined &&
            !ZERO_ID.test(span.parentSpanId) && {parentSpanId: span.parentSpanId}),
          name: span.name,
          kind: spanKind(span.kind),
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: plainAttributes(span.attributes),
          events: (span.events ?? []).map(event => {
            const attributes = plainAttributes(event.attributes);
            return {
              timeUnixNano: event.timeUnixNano,
              name: event.name,
              ...(Object.keys(attributes).length > 0 && {attributes}),
            };
          }),
          links: (span.links ?? []).map(link => {
            const attributes = plainAttributes(link.attributes);
            return {
              traceId: link.traceId,
              spanId: link.spanId,
              ...(Object.keys(attributes).length > 0 && {attributes}),
            };
          }),
          status: {
            code: code === 1 || code === 2 ? code : 0,
            ...(span.status?.message !== undefined && {message: span.status.message}),
          },
          scope: scopeOf(scope),
        };
      }),
    ),
  );
}

/** Every log record of a log export, in the order received. */
export function receivedLogs(request: ExportLogs): ReceivedLog[] {
  return request.resourceLogs.flatMap(({scopeLogs}) =>
    scopeLogs.flatMap(({scope, logRecords}) =>
      logRecords.map(log => {
        const attributes = plainAttributes(log.attributes);
        const time =
          log.timeUnixNano !== undefined && log.timeUnixNano !== '0'
            ? log.timeUnixNano
            : (log.observedTimeUnixNano ?? '0');
        const eventName =
          log.eventName ??
          (typeof attributes['event.name'] === 'string' ? attributes['event.name'] : undefined);
        const withContext =
          log.traceId !== undefined &&
          log.spanId !== undefined &&
          !ZERO_ID.test(log.traceId) &&
          !ZERO_ID.test(log.spanId);
        return {
          timeUnixNano: time,
          ...(withContext && {traceId: log.traceId, spanId: log.spanId}),
          ...(eventName !== undefined && {eventName}),
          ...(log.severityNumber !== undefined &&
            log.severityNumber !== 0 && {severityNumber: log.severityNumber}),
          ...(log.severityText !== undefined && {severityText: log.severityText}),
          ...(log.body !== undefined && {body: plainValue(log.body)}),
          attributes,
          scope: scopeOf(scope),
        };
      }),
    ),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
