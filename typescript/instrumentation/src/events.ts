/**
 * The A2UI step's events: the open event, and the span each one becomes when it ends.
 *
 * Every hooked call is synchronous, so a stack holds the open event. The
 * outermost hooked call opens one, and a hooked call made while one is open
 * opens none: it tells the open one what it did instead. A stream's event is
 * kept with its stream object and is the open event only while its `feed` or
 * `close` runs.
 *
 * An event is kept in memory while it is open and becomes one span when it
 * ends, with the start time, parent and span events it recorded on the way. An
 * event that never ends, such as an abandoned stream's, is never exported.
 */

import {
  type Attributes,
  type Context,
  context as otelContext,
  type HrTime,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

import {className, logger, messageOf} from './log.js';
import {AGENT_SDK} from './package.js';
import type {Active} from './state.js';
import type {InferenceFormat} from './table.js';

/** A block's range in the input: start inclusive, end exclusive, in UTF-16 code units. */
export type Block = readonly [number, number];

/** A catalog in the record's shape. */
export interface RecordCatalog {
  catalogId: string;
  protocolVersion: string;
}

const stack: Event[] = [];

/** The open event, if a hooked call is running. */
export function current(): Event | undefined {
  return stack[stack.length - 1];
}

export function enter(event: Event): void {
  stack.push(event);
}

export function leave(event: Event): void {
  const index = stack.lastIndexOf(event);
  if (index >= 0) stack.splice(index);
}

/** Now, from the monotonic clock, so the span events keep their order. */
export function now(): HrTime {
  const millis = performance.timeOrigin + performance.now();
  const seconds = Math.floor(millis / 1000);
  const nanos = Math.min(999_999_999, Math.round((millis - seconds * 1000) * 1e6));
  return [seconds, nanos];
}

/** A protocol version in the record's form: `v0.9`, `v0.9.1`, `v1.0`. */
export function recordVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

/** The catalogs a parser or a prompt generator holds, in the record's shape. */
export function catalogsOf(owner: unknown): RecordCatalog[] | undefined {
  const catalogs = (owner as {catalogs?: unknown} | null | undefined)?.catalogs;
  if (!Array.isArray(catalogs)) return undefined;
  const shaped: RecordCatalog[] = [];
  for (const catalog of catalogs as unknown[]) {
    const {id, protocolVersion} = (catalog ?? {}) as {id?: unknown; protocolVersion?: unknown};
    if (typeof id !== 'string' || typeof protocolVersion !== 'string') return undefined;
    shaped.push({catalogId: id, protocolVersion: recordVersion(protocolVersion)});
  }
  return shaped.length > 0 ? shaped : undefined;
}

/**
 * The SDK's structured details of an error, as it gives them: a `details`
 * array whose every item is an object. Other details, such as the ids a
 * duplicate-id error carries, are not structured details.
 */
function errorDetails(error: unknown): object[] {
  const details = (error as {details?: unknown} | null | undefined)?.details;
  if (!Array.isArray(details)) return [];
  const items = details as unknown[];
  if (!items.every(detail => typeof detail === 'object' && detail !== null)) return [];
  return items.map(detail => ({...(detail as object)}));
}

function stackOf(error: unknown): string {
  const trace = (error as {stack?: unknown} | null | undefined)?.stack;
  return typeof trace === 'string' ? trace : '';
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

interface SpanEventRecord {
  name: string;
  attributes: Attributes;
  time: HrTime;
}

/** How an error reached the event: returned as an `ErrorPart`, or thrown. */
export type Surfaced = 'returned' | 'thrown';

/** One event of the A2UI step, open from its outermost call to its end. */
export abstract class Event {
  abstract readonly kind: 'parse' | 'prompt_generation';
  readonly start: HrTime = now();
  /** The span current when the event opened is its parent. */
  readonly parent: Context = otelContext.active();
  format: InferenceFormat | undefined;
  catalogs: RecordCatalog[] | undefined;
  protected readonly spanEvents: SpanEventRecord[] = [];
  /** The errors recorded as `exception` span events, in order. */
  protected readonly errors: unknown[] = [];
  /** How many `checkTopology` calls are running. */
  wholeTree = 0;
  /** The errors seen leaving `checkTopology`: they belong to no block. */
  protected readonly afterEveryBlock = new WeakSet<object>();
  ended = false;

  constructor(readonly active: Active) {}

  // What hooked calls nested in the event tell it. A prompt generation's event
  // takes only a generator's format and catalogs.

  adoptParser(_parser: unknown): void {}

  adoptGenerator(_generator: unknown): void {}

  noteCompile(_text: unknown): void {}

  startWholeTree(): void {
    this.wholeTree += 1;
  }

  finishWholeTree(_returned: boolean): void {
    this.wholeTree -= 1;
  }

  /** An error left `checkTopology`, the check of whole trees. */
  escapedWholeTree(error: unknown): void {
    if (isObject(error)) this.afterEveryBlock.add(error);
  }

  noteMarkChecked(): void {}

  /** The block an error belongs to. */
  protected place(_error: unknown, _surfaced: Surfaced): Block | undefined {
    return undefined;
  }

  /** An error was placed in a block, its range in these attributes. */
  protected placed(_attributes: Attributes, _block: Block): void {}

  /** Whether an error left `checkTopology`, so it belongs to no block. */
  protected isAfterEveryBlock(error: unknown): boolean {
    return isObject(error) && this.afterEveryBlock.has(error);
  }

  /** Records an error as one `exception` span event, once. */
  record(error: unknown, surfaced: Surfaced): void {
    if (this.errors.includes(error)) return;
    const block = this.place(error, surfaced);
    this.errors.push(error);
    const attributes: Attributes = {
      'exception.type': className(error),
      'exception.message': messageOf(error),
      'exception.stacktrace': stackOf(error),
    };
    if (block !== undefined) {
      attributes['a2ui.parse.block.start'] = block[0];
      attributes['a2ui.parse.block.end'] = block[1];
      this.placed(attributes, block);
    }
    const details = errorDetails(error);
    if (details.length > 0) attributes['a2ui.parse.error.details'] = JSON.stringify(details);
    this.spanEvents.push({name: 'exception', attributes, time: now()});
  }

  /** The outermost call threw: the error is recorded and the event ends. */
  fail(error: unknown): void {
    this.record(error, 'thrown');
    this.end();
  }

  /** The span's attributes, or nothing when the event cannot be stated. */
  protected abstract attributes(): Attributes | undefined;

  /** Ends the event without a span. */
  abandon(why?: string): void {
    this.ended = true;
    if (why !== undefined) logger.debug(`a2ui-spectra-instrumentation: ${why}`);
  }

  /** Ends the event, writing it as one span. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const attributes = this.attributes();
    if (attributes === undefined) return;
    if (this.errors.length > 0) attributes['error.type'] = className(this.errors[0]);
    const span = this.active
      .tracer()
      .startSpan(
        this.kind,
        {kind: SpanKind.INTERNAL, attributes, startTime: this.start},
        this.parent,
      );
    for (const {name, attributes: eventAttributes, time} of this.spanEvents) {
      span.addEvent(name, eventAttributes, time);
    }
    if (this.errors.length > 0) {
      span.setStatus({code: SpanStatusCode.ERROR, message: messageOf(this.errors[0])});
    }
    span.end(now());
  }

  protected sdk(): Attributes {
    return {'a2ui.sdk.name': AGENT_SDK, 'a2ui.sdk.version': this.active.sdkVersion};
  }
}

/** Stands open for a call the wrapper does not record, so the calls nested in it record nothing either. */
export class Silent extends Event {
  readonly kind = 'parse';
  override ended = true;

  override startWholeTree(): void {}

  override finishWholeTree(): void {}

  override escapedWholeTree(): void {}

  override record(): void {}

  override fail(): void {}

  override end(): void {}

  protected attributes(): undefined {
    return undefined;
  }
}

/** A `prompt_generation`: the UI section a prompt generator wrote. */
export class PromptEvent extends Event {
  readonly kind = 'prompt_generation';
  uiSection: string | undefined;

  override adoptGenerator(generator: unknown): void {
    if (this.format !== undefined) return;
    this.format = this.active.generatorFormat(generator);
    if (this.format !== undefined) this.catalogs = catalogsOf(generator);
  }

  takeSection(section: unknown): void {
    if (typeof section === 'string') this.uiSection = section;
    this.end();
  }

  protected attributes(): Attributes | undefined {
    if (this.format === undefined || this.catalogs === undefined) {
      logger.debug(
        'a2ui-spectra-instrumentation: a prompt generation is not recorded: its inference format or catalogs are unknown',
      );
      return undefined;
    }
    if (this.errors.length === 0 && this.uiSection === undefined) {
      logger.debug(
        'a2ui-spectra-instrumentation: a prompt generation is not recorded: it produced no section',
      );
      return undefined;
    }
    const attributes: Attributes = {'a2ui.event.kind': this.kind};
    if (this.errors.length === 0 && this.uiSection !== undefined) {
      attributes['a2ui.prompt.ui_section'] = this.uiSection;
    }
    attributes['a2ui.prompt.inference_format'] = this.format;
    attributes['a2ui.prompt.catalogs'] = JSON.stringify(this.catalogs);
    return {...attributes, ...this.sdk()};
  }
}

/** A `parse`: one outermost call to a public parsing entry point. */
export class ParseEvent extends Event {
  readonly kind = 'parse';
  readonly input: string;
  wrapped = true;
  /** A stream's chunks, its parser, and how far its input reaches. */
  streamed = false;
  private readonly chunks: string[] = [];
  private fed = 0;
  streamParser: unknown;
  /** Each message's JSON text, in order. */
  private readonly messages: string[] = [];
  /** The block being compiled, and where the search for the next one starts. */
  private currentBlock: Block | undefined;
  private cursor = 0;
  /** How many blocks a stream has finished: each a `checkTopology` that returned. */
  private finished = 0;
  /** How many rejected blocks a stream has caught, each noted at its `markChecked`. */
  private rejected = 0;
  /** The blocks done when each rejection was caught, oldest first, until its error surfaces. */
  private readonly notes: number[] = [];
  /** A stream's placed errors: each one's attributes and the block located when it surfaced. */
  private readonly located: Array<{attributes: Attributes; block: Block}> = [];

  constructor(
    active: Active,
    readonly entryPoint: 'parse_response' | 'open_stream' | 'compile',
    input: unknown = '',
  ) {
    super(active);
    this.input = typeof input === 'string' ? input : '';
  }

  override adoptParser(parser: unknown): void {
    if (this.format === undefined) this.format = this.active.parserFormat(parser);
    if (this.catalogs === undefined) this.catalogs = catalogsOf(parser);
  }

  // The block rule.

  /** A block is handed to `compile`: for a whole text, it is the current block, found in the input. */
  override noteCompile(text: unknown): void {
    if (this.streamed || typeof text !== 'string') return;
    const found = this.input.indexOf(text, this.cursor);
    if (found < 0) {
      this.currentBlock = undefined;
      return;
    }
    this.cursor = found + text.length;
    this.currentBlock = [found, this.cursor];
  }

  override startWholeTree(): void {
    super.startWholeTree();
    this.currentBlock = undefined;
  }

  override finishWholeTree(returned: boolean): void {
    super.finishWholeTree(returned);
    if (returned && this.streamed && this.wholeTree === 0) this.finished += 1;
  }

  /** A stream catches a rejected block: the blocks it had done then are noted. */
  override noteMarkChecked(): void {
    if (!this.streamed || this.wholeTree > 0) return;
    this.notes.push(this.finished + this.rejected);
    this.rejected += 1;
  }

  protected override place(error: unknown, surfaced: Surfaced): Block | undefined {
    const afterEveryBlock = this.isAfterEveryBlock(error);
    if (!this.streamed) return afterEveryBlock ? undefined : this.currentBlock;
    // A returned error takes the oldest note; a thrown one ends the stream, and
    // its note is the last, made as the stream failed.
    const note = surfaced === 'thrown' ? this.notes.pop() : this.notes.shift();
    if (surfaced === 'thrown') this.notes.length = 0;
    if (afterEveryBlock) return undefined;
    const text = this.text();
    if (!this.wrapped) return [0, text.length];
    return this.rejectedBlock(error, text) ?? this.nextBlock(text, note);
  }

  protected override placed(attributes: Attributes, block: Block): void {
    if (this.streamed) this.located.push({attributes, block});
  }

  /**
   * States each of a stream's errors' blocks whole, in the stream's whole input.
   *
   * An error is located when it surfaces, in the input fed so far, where a
   * block rejected while it arrives is cut where the input then ended, and a
   * `rawContent` may hold only the part of the block compiled so far. Its
   * range becomes the block of the whole input, as `unwrap` finds it, that
   * holds the located start.
   */
  private stateBlocksWhole(): void {
    if (this.located.length === 0) return;
    const text = this.text();
    const blocks: Block[] = this.wrapped ? this.unwrappedBlocks(text) : [[0, text.length]];
    for (const {attributes, block} of this.located) {
      const [start, end] = block;
      const whole =
        blocks.find(([from, to]) => from <= start && start < to) ??
        blocks.find(([from, to]) => from < end && start < to);
      if (whole === undefined) continue;
      attributes['a2ui.parse.block.start'] = whole[0];
      attributes['a2ui.parse.block.end'] = Math.max(whole[1], end);
    }
  }

  /** The block the error carries as `rawContent`, found in the input after the last error's block. */
  private rejectedBlock(error: unknown, text: string): Block | undefined {
    const raw = (error as {rawContent?: unknown} | null | undefined)?.rawContent;
    if (typeof raw !== 'string' || raw.trim() === '') return undefined;
    const block = raw.trim();
    const found = text.indexOf(block, this.cursor);
    if (found < 0) return undefined;
    this.cursor = found + block.length;
    return [found, this.cursor];
  }

  /**
   * The block after those the stream had done, among those `unwrap` finds in the input fed so far.
   *
   * The last block found stands in when there are fewer.
   */
  private nextBlock(text: string, note: number | undefined): Block | undefined {
    const blocks = this.unwrappedBlocks(text);
    if (blocks.length === 0) return undefined;
    const done = note ?? this.finished + this.rejected;
    const block = blocks[Math.min(done, blocks.length - 1)];
    this.cursor = Math.max(this.cursor, block[1]);
    return block;
  }

  /** Each block the parser's `unwrap` finds in the text. */
  private unwrappedBlocks(text: string): Block[] {
    const unwrap = (this.streamParser as {unwrap?: unknown} | null | undefined)?.unwrap;
    if (typeof unwrap !== 'function') return [];
    const parts = (unwrap as (content: string) => unknown).call(this.streamParser, text);
    if (!Array.isArray(parts)) return [];
    const blocks: Block[] = [];
    let cursor = 0;
    for (const part of parts as unknown[]) {
      const raw = (part as {type?: unknown; a2uiRaw?: unknown} | null | undefined) ?? {};
      if (raw.type !== 'a2ui' || typeof raw.a2uiRaw !== 'string') continue;
      const found = text.indexOf(raw.a2uiRaw, cursor);
      if (found < 0) continue;
      cursor = found + raw.a2uiRaw.length;
      blocks.push([found, cursor]);
    }
    return blocks;
  }

  // A stream.

  feed(chunk: unknown): void {
    if (typeof chunk !== 'string') return;
    this.chunks.push(chunk);
    this.fed += chunk.length;
    this.spanEvents.push({
      name: 'a2ui.parse.chunk',
      attributes: {'a2ui.parse.chunk.end': this.fed},
      time: now(),
    });
  }

  text(): string {
    return this.streamed ? this.chunks.join('') : this.input;
  }

  // What the calls return.

  takeMessages(messages: unknown): void {
    if (!Array.isArray(messages)) return;
    for (const message of messages as unknown[]) this.messages.push(JSON.stringify(message));
  }

  /** The parts a call returned: their messages, and the errors a stream read past. */
  takeParts(parts: unknown): void {
    if (!Array.isArray(parts)) return;
    for (const part of parts as unknown[]) {
      const {type, a2ui, error} = (part ?? {}) as {type?: unknown; a2ui?: unknown; error?: unknown};
      if (type === 'a2ui') this.takeMessages(a2ui);
      else if (type === 'error' && error !== undefined) this.record(error, 'returned');
    }
  }

  override fail(error: unknown): void {
    this.takeParts((error as {partialResults?: unknown} | null | undefined)?.partialResults);
    super.fail(error);
  }

  protected attributes(): Attributes {
    this.stateBlocksWhole();
    const attributes: Attributes = {
      'a2ui.event.kind': this.kind,
      'a2ui.parse.input': this.text(),
      'a2ui.parse.entry_point': this.entryPoint,
    };
    if (!this.wrapped) attributes['a2ui.parse.wrapped'] = false;
    if (this.streamed) attributes['a2ui.parse.streamed'] = true;
    if (this.format !== undefined) attributes['a2ui.parse.inference_format'] = this.format;
    if (this.catalogs !== undefined) {
      attributes['a2ui.parse.catalogs'] = JSON.stringify(this.catalogs);
    }
    attributes['a2ui.parse.messages'] = `[${this.messages.join(',')}]`;
    return {...attributes, ...this.sdk()};
  }
}
