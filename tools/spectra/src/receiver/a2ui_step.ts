/**
 * The A2UI step's spans, read by `a2ui.event.kind` before any dialect, from
 * whoever sent them: the wrapper, a native hook in an A2UI SDK, or an agent
 * reporting its own step. The record's names for the kind are copied, each
 * parsed from its JSON text where the record holds an array or an object,
 * and left out when the value does not fit the record's shape. A span
 * missing a required attribute of its kind is written as a framework span.
 */
import {isRecord} from '../model_proxy/genai.js';
import type {SpanEvent} from '../record/turn_record.js';
import {parsedJson} from './genai.js';
import type {ReceivedSpan} from './otlp.js';

export type A2uiStepKind = 'prompt_generation' | 'parse';

/** A record value read off a span, or nothing when it does not fit. */
type Fit = (value: unknown) => unknown;

const INFERENCE_FORMATS = new Set(['direct_json', 'express', 'elemental', 'atom']);
const ENTRY_POINTS = new Set(['parse_response', 'open_stream', 'compile', 'tool_call']);
const PROTOCOL_VERSION = /^v[0-9]+\.[0-9]+(\.[0-9]+)?$/;

const text: Fit = value => (typeof value === 'string' ? value : undefined);
const flag: Fit = value => (typeof value === 'boolean' ? value : undefined);
const offset: Fit = value =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

function oneOf(values: ReadonlySet<string>): Fit {
  return value => (typeof value === 'string' && values.has(value) ? value : undefined);
}

/** A value the record holds as an array or an object, parsed from its JSON text. */
function json(fits: (parsed: unknown) => boolean): Fit {
  return value => {
    const parsed = parsedJson(value);
    return fits(parsed) ? parsed : undefined;
  };
}

/** Whether an object has exactly the fields allowed, the required ones among them, each fitting. */
function hasFields(
  value: unknown,
  fields: Readonly<Record<string, Fit>>,
  required: readonly string[],
): boolean {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).every(key => key in fields) &&
    required.every(key => key in value) &&
    Object.entries(value).every(([key, item]) => fields[key](item) !== undefined)
  );
}

const protocolVersion: Fit = value =>
  typeof value === 'string' && PROTOCOL_VERSION.test(value) ? value : undefined;

function isCatalogs(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(item =>
      hasFields(item, {catalogId: text, protocolVersion}, ['catalogId', 'protocolVersion']),
    )
  );
}

function isComponentRanges(value: unknown): boolean {
  const fields = {surfaceId: text, componentId: text, start: offset, end: offset};
  return Array.isArray(value) && value.every(item => hasFields(item, fields, Object.keys(fields)));
}

function isErrorDetails(value: unknown): boolean {
  const fields = {path: text, code: text, message: text, surfaceId: text};
  return (
    Array.isArray(value) &&
    value.every(item => hasFields(item, fields, ['path', 'code', 'message']))
  );
}

/** The names each kind defines that a producer writes, with how each is read. */
const NAMES: Readonly<Record<A2uiStepKind, Readonly<Record<string, Fit>>>> = {
  prompt_generation: {
    'a2ui.prompt.ui_section': text,
    'a2ui.prompt.inference_format': oneOf(INFERENCE_FORMATS),
    'a2ui.prompt.catalogs': json(isCatalogs),
    'a2ui.sdk.name': text,
    'a2ui.sdk.version': text,
    'gen_ai.tool.name': text,
    'error.type': text,
  },
  parse: {
    'a2ui.parse.input': text,
    'a2ui.parse.entry_point': oneOf(ENTRY_POINTS),
    'a2ui.parse.wrapped': flag,
    'a2ui.parse.streamed': flag,
    'a2ui.parse.inference_format': oneOf(INFERENCE_FORMATS),
    'a2ui.parse.catalogs': json(isCatalogs),
    'a2ui.parse.messages': json(Array.isArray),
    'a2ui.parse.components': json(isComponentRanges),
    'a2ui.sdk.name': text,
    'a2ui.sdk.version': text,
    'gen_ai.tool.name': text,
    'gen_ai.tool.call.id': text,
    'gen_ai.tool.call.result': json(isRecord),
    'error.type': text,
  },
};

/** The kind a span of the A2UI step names itself, or nothing for any other span. */
export function a2uiStepKindOf(span: ReceivedSpan): A2uiStepKind | undefined {
  const kind = span.attributes['a2ui.event.kind'];
  return kind === 'prompt_generation' || kind === 'parse' ? kind : undefined;
}

/** The required names of a kind, a prompt generation's section only when it did not fail. */
function requiredNames(kind: A2uiStepKind, span: ReceivedSpan): string[] {
  if (kind === 'parse') return ['a2ui.parse.input', 'a2ui.parse.entry_point'];
  return [
    ...(span.status.code === 2 ? [] : ['a2ui.prompt.ui_section']),
    'a2ui.prompt.inference_format',
    'a2ui.prompt.catalogs',
  ];
}

/** A span of the A2UI step read into its kind's names, with the required ones it lacks. */
export interface A2uiStepReading {
  kind: A2uiStepKind;
  names: Record<string, unknown>;
  missing: string[];
}

/** Reads a span of the A2UI step, or nothing for any other span. */
export function readA2uiStep(span: ReceivedSpan): A2uiStepReading | undefined {
  const kind = a2uiStepKindOf(span);
  if (kind === undefined) return undefined;
  const names: Record<string, unknown> = {};
  for (const [name, fit] of Object.entries(NAMES[kind])) {
    const value = fit(span.attributes[name]);
    if (value !== undefined) names[name] = value;
  }
  const missing = requiredNames(kind, span).filter(name => !(name in names));
  return {kind, names, missing};
}

/** The section text of a well-formed prompt generation, which places it by text; nothing for any other span. */
export function sectionTextOf(span: ReceivedSpan): string | undefined {
  const reading = readA2uiStep(span);
  if (reading?.kind !== 'prompt_generation' || reading.missing.length > 0) return undefined;
  const section = reading.names['a2ui.prompt.ui_section'];
  return typeof section === 'string' && section !== '' ? section : undefined;
}

const EXCEPTION_NAMES: Readonly<Record<string, Fit>> = {
  'exception.type': text,
  'exception.message': text,
  'exception.stacktrace': text,
  'a2ui.parse.block.start': offset,
  'a2ui.parse.block.end': offset,
  'a2ui.parse.error.details': json(isErrorDetails),
};

/**
 * A span's events as the record holds them: each passes as received, but
 * the record's names on an `exception` event are read as on the span, and an
 * `a2ui.parse.chunk` event keeps its end alone, or is left out when the end
 * does not fit.
 */
export function fittedSpanEvents(events: readonly SpanEvent[]): SpanEvent[] {
  return events.flatMap((event): SpanEvent[] => {
    if (event.name === 'a2ui.parse.chunk') {
      const end = offset(event.attributes?.['a2ui.parse.chunk.end']);
      return end === undefined ? [] : [{...event, attributes: {'a2ui.parse.chunk.end': end}}];
    }
    if (event.name !== 'exception' || event.attributes === undefined) return [event];
    const attributes = {...event.attributes};
    for (const [name, fit] of Object.entries(EXCEPTION_NAMES)) {
      if (!(name in attributes)) continue;
      const value = fit(attributes[name]);
      if (value === undefined) delete attributes[name];
      else attributes[name] = value;
    }
    return [{...event, attributes}];
  });
}
