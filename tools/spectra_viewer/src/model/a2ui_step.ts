/**
 * What the viewer works out from the A2UI step's events when shown: the
 * retry, the model call a parse read, the parse a component came from, the
 * UI section inside a model call's request, parse errors as problems, and
 * the header's formats and catalogs. The record states what happened; none
 * of this is stored, apart from a retry or a range a producer states itself.
 */
import {catalogName} from './agent_card.ts';
import {type CallRow, callRowsOf, modelReadingOf, timedEventOf} from './call_rows.ts';
import type {KnownCatalog} from './catalogs.ts';
import {agentMessages, type AgentMessage} from './messages.ts';
import {segmentsOf} from './prefix.ts';
import {type ComponentRange, rangesOfParse} from './ranges.ts';
import type {ReaderCatalog} from './readers/reading.ts';
import {
  type InferenceFormat,
  isParse,
  isPromptGeneration,
  type ModelCallEvent,
  type ParseEvent,
  type PromptGenerationEvent,
  type TurnRecordEvent,
} from './record.ts';
import {isThrough, type Position} from './steps.ts';

/** The inference formats by the names SPEC.md uses. */
const FORMAT_NAMES: Record<InferenceFormat, string> = {
  direct_json: 'Direct JSON',
  express: 'Express',
  elemental: 'Elemental',
  atom: 'Atom',
};

export function formatNameOf(format: unknown): string | undefined {
  return typeof format === 'string'
    ? (FORMAT_NAMES[format as InferenceFormat] ?? format)
    : undefined;
}

/** The SDK an A2UI step event names, as a problem's code names it: "A2UI SDK, Python". */
export function sdkOf(event: ParseEvent | PromptGenerationEvent): string {
  const name = event.attributes['a2ui.sdk.name'];
  if (name === 'a2ui-agent-sdk') return 'A2UI SDK, Python';
  if (name === '@a2ui/agent') return 'A2UI SDK, TypeScript';
  return typeof name === 'string' && name !== '' ? name : 'A2UI SDK';
}

function start(event: TurnRecordEvent): bigint {
  return BigInt(event.startTimeUnixNano);
}

function byStart<E extends TurnRecordEvent>(events: readonly E[]): E[] {
  return [...events].sort((a, b) => (start(a) < start(b) ? -1 : start(a) > start(b) ? 1 : 0));
}

/** The turn's parses, by start time. */
export function parsesOf(events: readonly TurnRecordEvent[]): ParseEvent[] {
  return byStart(events.filter(isParse));
}

export function isFailedParse(parse: ParseEvent): boolean {
  return parse.status?.code === 2;
}

function modelRowsOf(events: readonly TurnRecordEvent[]): CallRow[] {
  return callRowsOf(events).filter(row => row.kind === 'model');
}

function rowStart(row: CallRow): bigint {
  return start(timedEventOf(row));
}

/** Every string value in a JSON value. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) stringsIn(item, found);
  }
  return found;
}

/** The texts a model call answered with: each text part, and each tool call's arguments' strings. */
function replyTextsOf(row: CallRow): string[] {
  const {event} = modelReadingOf(row);
  const messages = event.attributes['gen_ai.output.messages'];
  if (!Array.isArray(messages)) return [];
  const texts: string[] = [];
  for (const message of messages) {
    const parts = (message as {parts?: unknown})?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const {
        type,
        content,
        arguments: args,
      } = (part ?? {}) as {
        type?: unknown;
        content?: unknown;
        arguments?: unknown;
      };
      if (type === 'text' && typeof content === 'string') texts.push(content);
      if (type === 'tool_call') texts.push(...stringsIn(args));
    }
  }
  return texts;
}

/**
 * The model call each parse read, by the parse's span id and the call row's
 * id: the row whose reply text, or one of whose tool-call arguments, holds
 * the parse's input or is held in it, the latest such row started before
 * the parse when several; failing that, the latest row started before the
 * parse, unless two started at once. A parse neither rule ties stays out.
 */
export function readByOf(events: readonly TurnRecordEvent[]): Map<string, string> {
  const rows = modelRowsOf(events);
  const readBy = new Map<string, string>();
  for (const parse of parsesOf(events)) {
    const input = parse.attributes['a2ui.parse.input'];
    const parseStart = start(parse);
    const latest = (candidates: CallRow[]): CallRow | undefined =>
      [...candidates].sort((a, b) => (rowStart(a) > rowStart(b) ? -1 : 1))[0];
    if (input !== '') {
      const holding = rows.filter(row =>
        replyTextsOf(row).some(
          text => text !== '' && (text.includes(input) || input.includes(text)),
        ),
      );
      const earlier = holding.filter(row => rowStart(row) < parseStart);
      const tied = latest(earlier.length > 0 ? earlier : holding);
      if (tied !== undefined) {
        readBy.set(parse.spanId, tied.id);
        continue;
      }
    }
    const earlier = rows.filter(row => rowStart(row) < parseStart);
    const tied = latest(earlier);
    if (tied === undefined) continue;
    if (earlier.some(row => row !== tied && rowStart(row) === rowStart(tied))) continue;
    readBy.set(parse.spanId, tied.id);
  }
  return readBy;
}

export interface Retry {
  /** Counted along the chain: a failure, retry 1, a failure, retry 2. */
  attempt: number;
  /** The parse whose failure it retries, when known. */
  parseSpanId?: string;
  /** Whether the producer stated it, which wins over the inferred retry. */
  stated: boolean;
}

/**
 * The retries among the turn's model calls, by call row id: a producer's
 * stated `a2ui.retry.attempt`, with the parse its link names; else the
 * first model call that starts after a failed parse ends is that parse's
 * retry, its attempt one more than that of the call the parse read.
 */
export function retriesOf(events: readonly TurnRecordEvent[]): Map<string, Retry> {
  const rows = byStart(modelRowsOf(events).map(row => timedEventOf(row))).map(timed =>
    modelRowsOf(events).find(row => timedEventOf(row) === timed)!,
  );
  const parseIds = new Set(events.filter(isParse).map(parse => parse.spanId));
  const retries = new Map<string, Retry>();
  for (const row of rows) {
    for (const source of [...(row.proxy === undefined ? [] : [row.proxy]), ...row.spans]) {
      const attempt = source.attributes['a2ui.retry.attempt'];
      if (typeof attempt !== 'number') continue;
      const link = (source.links ?? []).find(link => parseIds.has(link.spanId));
      retries.set(row.id, {
        attempt,
        ...(link !== undefined && {parseSpanId: link.spanId}),
        stated: true,
      });
      break;
    }
  }
  const readBy = readByOf(events);
  const failed = parsesOf(events).filter(
    parse => isFailedParse(parse) && parse.endTimeUnixNano !== undefined,
  );
  const claimed = new Set<string>();
  for (const row of rows) {
    const before = failed.filter(
      parse => !claimed.has(parse.spanId) && BigInt(parse.endTimeUnixNano!) < rowStart(row),
    );
    if (before.length === 0) continue;
    for (const parse of before) claimed.add(parse.spanId);
    if (retries.has(row.id)) continue;
    const parse = before[before.length - 1];
    const readRow = readBy.get(parse.spanId);
    const previous = readRow === undefined ? undefined : retries.get(readRow);
    retries.set(row.id, {
      attempt: (previous?.attempt ?? 0) + 1,
      parseSpanId: parse.spanId,
      stated: false,
    });
  }
  return retries;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return (
      a.length === (b as unknown[]).length &&
      a.every((item, i) => deepEqual(item, (b as unknown[])[i]))
    );
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every(
      key =>
        key in b &&
        deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

/** Whether a message's body holds a component by surface and id. */
function holdsComponent(message: unknown, surfaceId: string, componentId: string): boolean {
  if (typeof message !== 'object' || message === null) return false;
  for (const body of Object.values(message as Record<string, unknown>)) {
    if (typeof body !== 'object' || body === null) continue;
    const {surfaceId: surface, components} = body as {surfaceId?: unknown; components?: unknown};
    if (surface !== surfaceId || !Array.isArray(components)) continue;
    if (components.some(component => (component as {id?: unknown} | null)?.id === componentId))
      return true;
  }
  return false;
}

function parseMessagesOf(parse: ParseEvent): unknown[] {
  const messages = parse.attributes['a2ui.parse.messages'];
  return Array.isArray(messages) ? messages : [];
}

/** The parses started before a time, latest first. */
function parsesBefore(
  events: readonly TurnRecordEvent[],
  before: bigint | undefined,
): ParseEvent[] {
  return parsesOf(events)
    .filter(parse => before === undefined || start(parse) < before)
    .reverse();
}

/** The parse a wire message came from: the latest parse started before it was sent that holds an equal message. */
export function parseOfMessage(
  events: readonly TurnRecordEvent[],
  key: string,
): ParseEvent | undefined {
  const message = agentMessages(events).find(m => m.key === key);
  if (message === undefined) return undefined;
  const sentAt = start(events[message.eventIndex]);
  return parsesBefore(events, sentAt).find(parse =>
    parseMessagesOf(parse).some(held => deepEqual(held, message.message)),
  );
}

/**
 * The parse a tree component came from, and its range in that parse's
 * input: by the wire message that defined the component, among the turn's
 * messages through a position; failing that, the latest parse started
 * before that message holding a component of the same surface and id.
 */
export function parseOfComponent(
  events: readonly TurnRecordEvent[],
  surfaceId: string,
  componentId: string,
  through?: Position,
  catalog?: ReaderCatalog,
): {parse: ParseEvent; range?: ComponentRange} | undefined {
  const messages = agentMessages(events).filter(
    message => through === undefined || isThrough(message, through),
  );
  const defining: AgentMessage | undefined = [...messages]
    .reverse()
    .find(message => holdsComponent(message.message, surfaceId, componentId));
  let parse = defining === undefined ? undefined : parseOfMessage(events, defining.key);
  if (parse === undefined) {
    const sentAt = defining === undefined ? undefined : start(events[defining.eventIndex]);
    parse = parsesBefore(events, sentAt).find(candidate =>
      parseMessagesOf(candidate).some(held => holdsComponent(held, surfaceId, componentId)),
    );
  }
  if (parse === undefined) return undefined;
  const ranges = rangesOfParse(parse.attributes, catalog)?.ranges ?? [];
  const range = [...ranges]
    .reverse()
    .find(range => range.surfaceId === surfaceId && range.componentId === componentId);
  return {parse, ...(range !== undefined && {range})};
}

/** Where a prompt generation's UI section sits in a model call's request: the segment and the offsets in its text. */
export interface UiSection {
  segment: number;
  start: number;
  end: number;
  generation: PromptGenerationEvent;
}

/** Every occurrence of every prompt generation's section text in a call's request, by segment and offset. */
export function uiSectionsOf(
  events: readonly TurnRecordEvent[],
  call: ModelCallEvent,
): UiSection[] {
  const generations = byStart(events.filter(isPromptGeneration)).filter(
    generation =>
      typeof generation.attributes['a2ui.prompt.ui_section'] === 'string' &&
      generation.attributes['a2ui.prompt.ui_section'] !== '',
  );
  const sections: UiSection[] = [];
  segmentsOf(call).forEach((segment, index) => {
    for (const generation of generations) {
      const text = generation.attributes['a2ui.prompt.ui_section']!;
      for (
        let at = segment.text.indexOf(text);
        at >= 0;
        at = segment.text.indexOf(text, at + text.length)
      ) {
        sections.push({segment: index, start: at, end: at + text.length, generation});
      }
    }
  });
  return sections.sort((a, b) => a.segment - b.segment || a.start - b.start);
}

/** A problem of the A2UI step, as its block reads: the sentence, the code line, and the block's range to show. */
export interface StepProblem {
  sentence: string;
  code: string;
  range?: {start: number; end: number};
}

function exceptionsOf(event: ParseEvent | PromptGenerationEvent) {
  return (event.events ?? []).filter(spanEvent => spanEvent.name === 'exception');
}

/**
 * A parse's errors as problems: one per `exception` span event — the error
 * that ended the parse "stopped on this block", a block a stream read past
 * "rejected this block and read on" — and, for a failed parse that states
 * none, one for its status.
 */
export function parseProblemsOf(parse: ParseEvent): StepProblem[] {
  const sdk = sdkOf(parse);
  const exceptions = exceptionsOf(parse);
  if (exceptions.length === 0) {
    if (!isFailedParse(parse)) return [];
    const message = parse.status?.message;
    const type = parse.attributes['error.type'] ?? 'error';
    return [
      {
        sentence:
          message !== undefined && message !== ''
            ? `The parse failed: ${message}`
            : 'The parse failed.',
        code: `${type} · ${sdk}`,
      },
    ];
  }
  const streamed = parse.attributes['a2ui.parse.streamed'] === true;
  const chunks = (parse.events ?? []).filter(spanEvent => spanEvent.name === 'a2ui.parse.chunk');
  return exceptions.map(exception => {
    const attributes = exception.attributes ?? {};
    const readOn =
      streamed && chunks.some(chunk => BigInt(chunk.timeUnixNano) > BigInt(exception.timeUnixNano));
    const message = attributes['exception.message'] ?? parse.status?.message ?? '';
    const type = attributes['exception.type'] ?? parse.attributes['error.type'] ?? 'error';
    const blockStart = attributes['a2ui.parse.block.start'];
    const blockEnd = attributes['a2ui.parse.block.end'];
    const placed = typeof blockStart === 'number' && typeof blockEnd === 'number';
    const lead = readOn
      ? 'The stream rejected this block and read on'
      : placed
        ? 'The parse stopped on this block'
        : 'The parse stopped';
    return {
      sentence: `${lead}: ${message}`,
      code: `${type} · ${sdk}`,
      ...(placed && {range: {start: blockStart, end: blockEnd}}),
    };
  });
}

/** A failed prompt generation as its problem reads; nothing for one that succeeded. */
export function generationProblemOf(generation: PromptGenerationEvent): StepProblem | undefined {
  if (generation.status?.code !== 2) return undefined;
  const [exception] = exceptionsOf(generation);
  const message = exception?.attributes?.['exception.message'] ?? generation.status.message ?? '';
  const type =
    generation.attributes['error.type'] ?? exception?.attributes?.['exception.type'] ?? 'error';
  return {
    sentence: `The SDK could not write the prompt's UI section: ${message}`,
    code: `${type} · ${sdkOf(generation)}`,
  };
}

/** How many problems the A2UI step's events hold: the listing's `a2uiStepErrors`. */
export function a2uiStepErrorsOf(events: readonly TurnRecordEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (isParse(event)) count += parseProblemsOf(event).length;
    else if (isPromptGeneration(event) && generationProblemOf(event) !== undefined) count += 1;
  }
  return count;
}

/**
 * The header's quiet line's parts for the A2UI step: the inference formats
 * the turn's prompt generations and parses used, then the catalogs its
 * prompt generations were made on, each once, in order of first use.
 */
export function stepHeaderPartsOf(
  events: readonly TurnRecordEvent[],
  catalogs: readonly KnownCatalog[] = [],
): string[] {
  const formats: string[] = [];
  const named: string[] = [];
  for (const event of byStart(events)) {
    if (isParse(event)) {
      const format = formatNameOf(event.attributes['a2ui.parse.inference_format']);
      if (format !== undefined && !formats.includes(format)) formats.push(format);
    } else if (isPromptGeneration(event)) {
      const format = formatNameOf(event.attributes['a2ui.prompt.inference_format']);
      if (format !== undefined && !formats.includes(format)) formats.push(format);
      for (const ref of event.attributes['a2ui.prompt.catalogs'] ?? []) {
        const name = catalogName(ref.catalogId, catalogs);
        const shown = name.endsWith(ref.protocolVersion) ? name : `${name} ${ref.protocolVersion}`;
        if (!named.includes(shown)) named.push(shown);
      }
    }
  }
  return [...formats, ...named];
}
