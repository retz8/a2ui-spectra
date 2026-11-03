/**
 * The blocks of a format in a model's reply, found as the pinned agent
 * SDKs' block lexers find them: between the format's open and close tags,
 * a close tag inside a string literal or a block comment not counting; the
 * rest of the text one unfinished block when the close tag never comes; and
 * at most one block recovered when a close tag appears with no open tag
 * before it, a fenced body or a line that starts a payload. Each block's
 * range is its body as the SDK hands it on: whitespace, one Markdown fence
 * and the backticks at its edges stripped.
 */

export interface BlockConfig {
  /** Matches an open tag at the search position, sticky. */
  openTag: RegExp;
  /** Matches a close tag at the search position, sticky. */
  closeTag: RegExp;
  /** The characters that open a string literal. */
  strings: ReadonlySet<string>;
  /** The markers that start a comment running to the end of its line. */
  lineComments: readonly string[];
  /** Pairs of markers that open and close a block comment. */
  blockComments: readonly [string, string][];
  /** Matches, at a line's start, the first line of a payload with no tags around it. */
  payloadStart: RegExp;
}

export interface Block {
  /** The body's range in the text, the edges stripped as the SDK strips them. */
  start: number;
  end: number;
  /** False when the close tag never came and the rest of the text is the block. */
  final: boolean;
}

const LEADING_FENCE = /^```[a-zA-Z0-9_-]*\s*/;
const TRAILING_FENCE = /\s*```[a-zA-Z0-9_-]*$/;
const OPEN_FENCE = /^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?\n?/gm;
const CLOSING_FENCE_END = /\r?\n?[ \t]*```[ \t]*\r?\n?$/;

export const EXPRESS_PAYLOAD_START =
  /^[ \t]*(?:surface\s*\(|deleteSurface\s*\(|\$[a-zA-Z0-9_/]*\s*=(?!=)|[a-zA-Z_][a-zA-Z0-9_]*\s*=(?!=))/gm;
export const JSON_PAYLOAD_START = /^[ \t]*(?:\[\s*(?:\{|\]|$)|\{\s*(?:"|\}|$))/gm;

/** A sticky, case-insensitive matcher of a tag, from its name: `a2ui` gives `<a2ui>` and `<a2ui attr>`. */
export function openTagOf(name: string): RegExp {
  return new RegExp(`<${name}(?:\\s[^>]*)?>`, 'iy');
}

export function closeTagOf(name: string): RegExp {
  return new RegExp(`</${name}\\s*>`, 'iy');
}

function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/** The first match of a sticky pattern at or after `from` that starts before `end`. */
function searchFrom(
  pattern: RegExp,
  text: string,
  from: number,
  end: number,
): RegExpExecArray | null {
  const global = new RegExp(pattern.source, pattern.flags.replace('y', 'g'));
  global.lastIndex = from;
  const match = global.exec(text);
  return match !== null && match.index < end ? match : null;
}

/**
 * The range of a block's body as the SDK cleans it: whitespace trimmed, one
 * Markdown fence removed at each end, then the backticks at the edges, and
 * trimmed again. A body of nothing but backticks is empty.
 */
export function cleanedRange(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  const trim = () => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
  };
  trim();
  const leading = LEADING_FENCE.exec(text.slice(s, e));
  if (leading !== null) s += leading[0].length;
  const trailing = TRAILING_FENCE.exec(text.slice(s, e));
  if (trailing !== null) e -= trailing[0].length;
  trim();
  if (text.slice(s, e).replace(/`/g, '') === '') return [s, s];
  while (s < e && text[s] === '`') s++;
  while (e > s && text[e - 1] === '`') e--;
  trim();
  return [s, e];
}

/**
 * Scans a block's body from `start` for the close tag outside strings and
 * block comments; the close tag's start and end, or none when the body runs
 * to `end`.
 */
function scanBlock(
  config: BlockConfig,
  text: string,
  start: number,
  end: number,
): [number, number] | undefined {
  let i = start;
  let state: 'code' | 'string' | 'comment' | 'blockComment' = 'code';
  let delimiter = '';
  let triple = false;
  let blockClose = '';
  while (i < end) {
    if (state === 'code') {
      const close = matchAt(config.closeTag, text, i);
      if (close !== null) return [i, close.index + close[0].length];
      const ch = text[i];
      if (config.strings.has(ch)) {
        if (i + 2 < end && text.slice(i, i + 3) === ch.repeat(3)) {
          delimiter = ch.repeat(3);
          triple = true;
          i += 3;
        } else {
          delimiter = ch;
          triple = false;
          i += 1;
        }
        state = 'string';
        continue;
      }
      const block = config.blockComments.find(([open]) => text.startsWith(open, i));
      if (block !== undefined) {
        i += block[0].length;
        blockClose = block[1];
        state = 'blockComment';
        continue;
      }
      const comment = config.lineComments.find(marker => text.startsWith(marker, i));
      if (comment !== undefined) {
        i += comment.length;
        state = 'comment';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'string') {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (triple ? text.startsWith(delimiter, i) : text[i] === delimiter) {
        i += delimiter.length;
        state = 'code';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'comment') {
      const close = matchAt(config.closeTag, text, i);
      if (close !== null) return [i, close.index + close[0].length];
      if (text[i] === '\n' || text[i] === '\r') state = 'code';
      i++;
      continue;
    }
    // A close tag inside a block comment does not end the block.
    if (text.startsWith(blockClose, i)) {
      i += blockClose.length;
      state = 'code';
      continue;
    }
    i++;
  }
  return undefined;
}

/**
 * At most one block closed by a close tag whose open tag was left out, in
 * the text from `start` up to `end`: a fenced body, else a payload from the
 * first line that starts one. The block and where the text goes on after
 * its close tag, or none.
 */
function recoverUnmatchedClose(
  config: BlockConfig,
  text: string,
  start: number,
  end: number,
): {block: Block; next: number} | undefined {
  const segment = text.slice(start, end);
  if (searchFrom(config.closeTag, segment, 0, segment.length) === null) return undefined;
  const fences = [...segment.matchAll(OPEN_FENCE)];
  for (let index = 0; index < fences.length; index += 2) {
    const fence = fences[index];
    const fenceEnd = fence.index + fence[0].length;
    const close = scanBlock(config, segment, fenceEnd, segment.length);
    if (close === undefined) continue;
    const [closeStart, closeEnd] = close;
    const body = segment.slice(fenceEnd, closeStart);
    const stripped = body.replace(CLOSING_FENCE_END, '');
    if (new RegExp(OPEN_FENCE.source, 'm').test(stripped)) continue;
    const [s, e] = cleanedRange(text, start + fenceEnd, start + fenceEnd + stripped.length);
    if (s === e) continue;
    return {block: {start: s, end: e, final: true}, next: start + closeEnd};
  }
  let searchStart = 0;
  for (let pair = 0; pair + 1 < fences.length; pair += 2) {
    const second = fences[pair + 1];
    if (scanBlock(config, segment, second.index + second[0].length, segment.length) === undefined)
      break;
    searchStart = second.index + second[0].length;
  }
  const payload = new RegExp(config.payloadStart.source, 'gm');
  payload.lastIndex = searchStart;
  const statement = payload.exec(segment);
  if (statement === null) return undefined;
  const close = scanBlock(config, segment, statement.index, segment.length);
  if (close === undefined) return undefined;
  const [closeStart, closeEnd] = close;
  const [s, e] = cleanedRange(text, start + statement.index, start + closeStart);
  if (s === e) return undefined;
  return {block: {start: s, end: e, final: true}, next: start + closeEnd};
}

/** The blocks of a text, in order. */
export function blocksOf(text: string, config: BlockConfig): Block[] {
  const blocks: Block[] = [];
  const n = text.length;
  let i = 0;
  let recovered = false;
  while (i < n) {
    const open = searchFrom(config.openTag, text, i, n);
    const searchEnd = open === null ? n : open.index;
    if (!recovered && searchEnd > i) {
      const recovery = recoverUnmatchedClose(config, text, i, searchEnd);
      if (recovery !== undefined) {
        recovered = true;
        blocks.push(recovery.block);
        i = recovery.next;
        continue;
      }
    }
    if (open === null) break;
    const bodyStart = open.index + open[0].length;
    const close = scanBlock(config, text, bodyStart, n);
    if (close === undefined) {
      const [s, e] = cleanedRange(text, bodyStart, n);
      blocks.push({start: s, end: e, final: false});
      return blocks;
    }
    const [s, e] = cleanedRange(text, bodyStart, close[0]);
    blocks.push({start: s, end: e, final: true});
    i = close[1];
  }
  return blocks;
}
