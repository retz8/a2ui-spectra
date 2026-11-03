/**
 * The Direct JSON reader: a block is one message object or an array of
 * them, read as the pinned SDK's lenient JSON reader reads it, a trailing
 * comma, a raw newline or tab inside a string, and curly quotes in place of
 * straight ones allowed. A component is an object in a message body's
 * `components` array, named by its `id`; its range is the object's own text.
 */
import {closeTagOf, JSON_PAYLOAD_START, openTagOf, type BlockConfig} from './blocks.ts';
import type {BlockReading, FoundComponent} from './reading.ts';

export const DIRECT_JSON_BLOCKS: BlockConfig = {
  openTag: openTagOf('a2ui-json'),
  closeTag: closeTagOf('a2ui-json'),
  strings: new Set(['"']),
  lineComments: [],
  blockComments: [],
  payloadStart: JSON_PAYLOAD_START,
};

type Role = 'messages' | 'message' | 'body' | 'components' | 'component' | 'other';

interface Frame {
  role: Role;
  /** The body's surface, once its `surfaceId` is read. */
  surfaceId?: string;
  /** A component's id, once read. */
  id?: string;
}

class Stop extends Error {
  readonly at: number;

  constructor(at: number) {
    super(`stopped at ${at}`);
    this.at = at;
  }
}

/** Reads the block's JSON, keeping each component as its object closes. */
class Reader {
  private readonly text: string;
  private readonly end: number;
  private at: number;
  readonly found: Array<FoundComponent & {body: Frame}> = [];

  constructor(text: string, start: number, end: number) {
    this.text = text;
    this.end = end;
    this.at = start;
  }

  read(): void {
    this.skipSpace();
    const first = this.text[this.at];
    this.value(first === '[' ? 'messages' : first === '{' ? 'message' : 'other', undefined);
    this.skipSpace();
  }

  private skipSpace(): void {
    while (this.at < this.end && /\s/.test(this.text[this.at])) this.at++;
  }

  private value(role: Role, body: Frame | undefined): unknown {
    if (this.at >= this.end) throw new Stop(this.at);
    const ch = this.text[this.at];
    if (ch === '{') return this.object(role, body);
    if (ch === '[') return this.array(role, body);
    if (ch === '"') return this.string();
    // A number, true, false or null: read to the next delimiter.
    const start = this.at;
    while (this.at < this.end && !/[\s,\]}]/.test(this.text[this.at])) this.at++;
    if (this.at === start) throw new Stop(start);
    return undefined;
  }

  private object(role: Role, body: Frame | undefined): unknown {
    const start = this.at++;
    const frame: Frame = {role};
    const enclosingBody = role === 'body' ? frame : body;
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === '}') break;
      if (this.at >= this.end || this.text[this.at] !== '"') throw new Stop(this.at);
      const key = this.string();
      this.skipSpace();
      if (this.text[this.at] !== ':') throw new Stop(this.at);
      this.at++;
      this.skipSpace();
      const next = this.text[this.at];
      const valueRole: Role =
        role === 'message' && key !== 'version' && next === '{'
          ? 'body'
          : role === 'body' && key === 'components' && next === '['
            ? 'components'
            : 'other';
      const value = this.value(valueRole, enclosingBody);
      if (role === 'body' && key === 'surfaceId' && typeof value === 'string') {
        frame.surfaceId = value;
      }
      if (role === 'component' && key === 'id' && typeof value === 'string') frame.id = value;
      this.skipSpace();
      if (this.text[this.at] === ',') {
        this.at++;
        continue;
      }
      if (this.text[this.at] === '}') break;
      throw new Stop(this.at);
    }
    this.at++;
    if (role === 'component' && frame.id !== undefined && body !== undefined) {
      this.found.push({componentId: frame.id, start, end: this.at, body});
    }
    return undefined;
  }

  private array(role: Role, body: Frame | undefined): unknown {
    this.at++;
    const itemRole: Role =
      role === 'messages' ? 'message' : role === 'components' ? 'component' : 'other';
    for (;;) {
      this.skipSpace();
      if (this.text[this.at] === ']') break;
      if (this.at >= this.end) throw new Stop(this.at);
      this.value(itemRole, body);
      this.skipSpace();
      if (this.text[this.at] === ',') {
        this.at++;
        continue;
      }
      if (this.text[this.at] === ']') break;
      throw new Stop(this.at);
    }
    this.at++;
    return undefined;
  }

  private string(): string {
    const start = this.at++;
    while (this.at < this.end) {
      const ch = this.text[this.at];
      if (ch === '\\') {
        this.at += 2;
        continue;
      }
      if (ch === '"') {
        this.at++;
        return decode(this.text.slice(start, this.at));
      }
      this.at++;
    }
    // The text ends inside the string.
    throw new Stop(this.end);
  }
}

/** A JSON string's value, a raw newline or tab inside it allowed. */
function decode(literal: string): string {
  try {
    return JSON.parse(literal) as string;
  } catch {
    try {
      return JSON.parse(literal.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
    } catch {
      return literal.slice(1, -1);
    }
  }
}

function readOnce(text: string, start: number, end: number): BlockReading {
  const reader = new Reader(text, start, end);
  let stoppedAt: number | undefined;
  try {
    reader.read();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    stoppedAt = error.at;
  }
  const components = reader.found.map(({componentId, start: s, end: e, body}) => ({
    componentId,
    start: s,
    end: e,
    ...(body.surfaceId !== undefined && {surfaceId: body.surfaceId}),
  }));
  return {components, ...(stoppedAt !== undefined && {stoppedAt})};
}

/** The components of one Direct JSON block. */
export function readDirectJsonBlock(text: string, start: number, end: number): BlockReading {
  const straight = readOnce(text, start, end);
  if (straight.stoppedAt === undefined) return straight;
  // The SDK reads again with curly quotes straightened when the first read fails.
  const curly = /[“”]/.test(text.slice(start, end));
  if (!curly) return straight;
  const retried = readOnce(text.replace(/[“”]/g, '"'), start, end);
  return retried.stoppedAt === undefined ? retried : straight;
}
