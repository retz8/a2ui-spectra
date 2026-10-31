/**
 * The prefix break: where a model call's request stops sharing its prefix
 * with the earlier call of the same model in the same conversation that
 * shares the longest prefix with it. A request is compared as segments in
 * cache order, one per tool definition, one for the system prompt, then one
 * per input message, each segment's text as the readable request shows it:
 * text as text, and a tool definition, a tool call or a tool result as its
 * JSON block. Computed when shown; the record does not carry it.
 */
import {isReadInFull, modelOf} from './model_calls.ts';
import type {ModelCallEvent} from './record.ts';

/** The part of a request a segment is. */
export type SegmentPart = 'tools' | 'system' | 'message';

export interface Segment {
  part: SegmentPart;
  /** A message's role. */
  role?: string;
  /** The segment's text, as the readable request shows it. */
  text: string;
}

/** A part as the readable request shows it: text and reasoning as text, every other part as its JSON block. */
export function partText(part: unknown): string {
  if (typeof part === 'object' && part !== null) {
    const {type, content} = part as {type?: unknown; content?: unknown};
    if ((type === 'text' || type === 'reasoning') && typeof content === 'string') return content;
  }
  return JSON.stringify(part, null, 2);
}

function partsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A message's parts' texts, joined as the readable request lays them out. */
function partsText(parts: unknown[]): string {
  return parts.map(partText).join('\n\n');
}

/** A call's request as segments in cache order. */
export function segmentsOf(call: ModelCallEvent): Segment[] {
  const {attributes} = call;
  const tools: Segment[] = partsOf(attributes['gen_ai.tool.definitions']).map(definition => ({
    part: 'tools',
    text: JSON.stringify(definition, null, 2),
  }));
  const system = partsOf(attributes['gen_ai.system_instructions']);
  const prompt: Segment[] = system.length > 0 ? [{part: 'system', text: partsText(system)}] : [];
  const messages: Segment[] = partsOf(attributes['gen_ai.input.messages']).map(message => {
    const {role, parts} = (message ?? {}) as {role?: unknown; parts?: unknown};
    return {
      part: 'message',
      ...(typeof role === 'string' && {role}),
      text: partsText(partsOf(parts)),
    };
  });
  return [...tools, ...prompt, ...messages];
}

function commonPrefix(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
}

/** How far two requests share their prefix: the segments shared whole, then the characters into the next. */
interface Shared {
  /** The index of the first segment that differs; the shorter request's length when none does. */
  segment: number;
  /** The characters shared inside that segment. */
  offset: number;
  /** Every character shared, for picking the longest. */
  chars: number;
}

function shared(earlier: readonly Segment[], current: readonly Segment[]): Shared {
  let chars = 0;
  const length = Math.min(earlier.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const a = earlier[index];
    const b = current[index];
    if (a.part === b.part && a.role === b.role && a.text === b.text) {
      chars += a.text.length;
      continue;
    }
    const offset = a.part === b.part && a.role === b.role ? commonPrefix(a.text, b.text) : 0;
    return {segment: index, offset, chars: chars + offset};
  }
  return {segment: length, offset: 0, chars};
}

/** An earlier call a call may be compared with, and the turn it is in. */
export interface Candidate {
  call: ModelCallEvent;
  /** The trace id of the turn it is in. */
  traceId: string;
}

/** The two lines around a break: the text before the differing span, the span, and the text after it. */
export type LineParts = [before: string, differing: string, after: string];

/** Where the prefix breaks inside a segment, as the marker draws it in that segment's text. */
export interface Marker {
  /** The index of the segment, among the call's segments. */
  segment: number;
  /** This call's text of the segment before the line the break is on. */
  before: string;
  earlier: LineParts;
  current: LineParts;
  /** This call's text of the segment after that line. */
  after: string;
}

/** The prefix break's sentence, in its four forms, with the call it was compared with. */
export type PrefixBreak =
  | {form: 'first'; model: string}
  /** The earlier call's whole request is a prefix of this one. */
  | {form: 'shares_earlier'; earlier: Candidate}
  /** Every segment of this call is in the earlier one. */
  | {form: 'shares_this'; earlier: Candidate}
  | {
      form: 'breaks';
      earlier: Candidate;
      part: SegmentPart;
      /** For a break in a message, its number, from 1. */
      message?: number;
      marker: Marker;
    };

/** How much of each line around a break the two lines keep on either side of the span. */
const CONTEXT = 48;
/** How much of a differing span the two lines keep. */
const SPAN = 80;

function clipStart(text: string): string {
  return text.length > CONTEXT ? `…${text.slice(text.length - CONTEXT)}` : text;
}

function clipEnd(text: string, length = CONTEXT): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

/** The break's line in each text, split around the span that differs, and this text around that line. */
export function markerOf(
  earlierText: string,
  currentText: string,
  offset: number,
  segment: number,
): Marker {
  const lineStart = currentText.lastIndexOf('\n', offset - 1) + 1;
  // The line the break is on; a difference that starts with a line break runs to the next line's end.
  const lineEnd = (text: string) => {
    let from = offset;
    while (text[from] === '\n') from += 1;
    const end = text.indexOf('\n', from);
    return end === -1 ? text.length : end;
  };
  const earlierEnd = lineEnd(earlierText);
  const currentEnd = lineEnd(currentText);
  const earlierLine = earlierText.slice(offset, earlierEnd);
  const currentLine = currentText.slice(offset, currentEnd);
  // The lines agree again after the span, at their common end.
  let suffix = 0;
  while (
    suffix < Math.min(earlierLine.length, currentLine.length) &&
    earlierLine[earlierLine.length - 1 - suffix] === currentLine[currentLine.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const pre = clipStart(currentText.slice(lineStart, offset));
  const post = clipEnd(currentLine.slice(currentLine.length - suffix));
  return {
    segment,
    before: currentText.slice(0, lineStart),
    earlier: [pre, clipEnd(earlierLine.slice(0, earlierLine.length - suffix), SPAN), post],
    current: [pre, clipEnd(currentLine.slice(0, currentLine.length - suffix), SPAN), post],
    after: currentEnd < currentText.length ? currentText.slice(currentEnd + 1) : '',
  };
}

/**
 * The prefix break of a call read in full, against the candidates: the model
 * calls read in full with the same model id as requested, in the same
 * conversation, that started before it. The longest shared prefix wins, the
 * latest call on a tie. Nothing for a call recorded raw.
 */
export function prefixBreakOf(
  call: ModelCallEvent,
  candidates: readonly Candidate[],
): PrefixBreak | undefined {
  if (!isReadInFull(call)) return undefined;
  const model = modelOf(call) ?? '';
  const current = segmentsOf(call);
  let best: {candidate: Candidate; segments: Segment[]; shared: Shared} | undefined;
  for (const candidate of candidates) {
    const segments = segmentsOf(candidate.call);
    const found = shared(segments, current);
    const later =
      best !== undefined &&
      BigInt(candidate.call.startTimeUnixNano) >= BigInt(best.candidate.call.startTimeUnixNano);
    if (
      best === undefined ||
      found.chars > best.shared.chars ||
      (found.chars === best.shared.chars && later)
    ) {
      best = {candidate, segments, shared: found};
    }
  }
  if (best === undefined) return {form: 'first', model};
  const {candidate, segments, shared: found} = best;
  // A request is a prefix of another when its segments are, its last one's text perhaps going
  // on in the other, as when a client adds a part to the last message.
  const ends = (side: readonly Segment[]) =>
    found.segment >= side.length ||
    (found.segment === side.length - 1 && found.offset === side[found.segment].text.length);
  if (ends(segments)) return {form: 'shares_earlier', earlier: candidate};
  if (ends(current)) return {form: 'shares_this', earlier: candidate};
  const segment = current[found.segment];
  const earlierSegment = segments[found.segment];
  const earlierText = earlierSegment.part === segment.part ? earlierSegment.text : '';
  const message =
    segment.part === 'message'
      ? current.slice(0, found.segment + 1).filter(item => item.part === 'message').length
      : undefined;
  return {
    form: 'breaks',
    earlier: candidate,
    part: segment.part,
    ...(message !== undefined && {message}),
    marker: markerOf(earlierText, segment.text, found.offset, found.segment),
  };
}

/** The candidates for a call: the earlier model calls read in full with its model, from this turn and the conversation's earlier turns. */
export function candidatesFor(
  call: ModelCallEvent,
  turns: ReadonlyArray<{traceId: string; calls: readonly ModelCallEvent[]}>,
): Candidate[] {
  const model = call.attributes['gen_ai.request.model'];
  if (typeof model !== 'string') return [];
  const start = BigInt(call.startTimeUnixNano);
  return turns.flatMap(({traceId, calls}) =>
    calls
      .filter(
        other =>
          other.spanId !== call.spanId &&
          isReadInFull(other) &&
          other.attributes['gen_ai.request.model'] === model &&
          BigInt(other.startTimeUnixNano) < start,
      )
      .map(other => ({call: other, traceId})),
  );
}

/** The part a break is in, as the sentence names it. */
export function partName(found: Extract<PrefixBreak, {form: 'breaks'}>): string {
  if (found.part === 'tools') return 'the tool definitions';
  if (found.part === 'system') return 'the system prompt';
  return `message ${found.message ?? 1}`;
}
