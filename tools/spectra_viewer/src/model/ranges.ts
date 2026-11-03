/**
 * Which characters of a parse's input became which component, worked out
 * from the input and the inference format by a reader of that format's
 * notation. The wrappers report no ranges; a range a producer states in
 * `a2ui.parse.components` wins.
 */

import {type Block, type BlockConfig, blocksOf} from './readers/blocks.ts';
import {DIRECT_JSON_BLOCKS, readDirectJsonBlock} from './readers/direct_json.ts';
import {ATOM_BLOCKS, readAtomBlock} from './readers/atom.ts';
import {ELEMENTAL_BLOCKS, readElementalBlock} from './readers/elemental.ts';
import {EXPRESS_BLOCKS, readExpressBlock} from './readers/express.ts';
import {ANY_CATALOG, type BlockReader, type ReaderCatalog} from './readers/reading.ts';

export type InferenceFormat = 'direct_json' | 'express' | 'elemental' | 'atom';

export const FORMATS: readonly InferenceFormat[] = ['direct_json', 'express', 'elemental', 'atom'];

/** Where a component's text sits in the parse input, in UTF-16 code units; `end` exclusive. */
export interface ComponentRange {
  surfaceId: string;
  componentId: string;
  start: number;
  end: number;
}

export interface Reading {
  ranges: ComponentRange[];
  /** Where the reader stopped, when it could not finish the text, and why. */
  stoppedAt?: number;
  reason?: string;
}

export interface ReadOptions {
  /** Whether the input holds blocks in the format's tags; false for one block without tags. */
  wrapped?: boolean;
  /** The parse's messages, which give a range its surface when the text names none. */
  messages?: readonly unknown[];
  /** What the reader knows of the catalogs; without it, a capitalised name is a component. */
  catalog?: ReaderCatalog;
}

/**
 * Whether a parse's input is wrapped in the format's tags: not when the SDK
 * was told the whole text is one block, nor when the call compiled one
 * block or parsed the toolset's payload.
 */
export function isWrappedParse(attributes: Record<string, unknown>): boolean {
  const entryPoint = attributes['a2ui.parse.entry_point'];
  return (
    attributes['a2ui.parse.wrapped'] !== false &&
    entryPoint !== 'compile' &&
    entryPoint !== 'tool_call'
  );
}

/** The surface a block's components fall in when the text names none: the compile call's default. */
const DEFAULT_SURFACES: Record<InferenceFormat, string> = {
  direct_json: 'default_surface',
  express: 'default_surface',
  elemental: 'default_surface',
  atom: 'main',
};

const BLOCKS: Record<InferenceFormat, BlockConfig> = {
  direct_json: DIRECT_JSON_BLOCKS,
  express: EXPRESS_BLOCKS,
  elemental: ELEMENTAL_BLOCKS,
  atom: ATOM_BLOCKS,
};

const READERS: Record<InferenceFormat, BlockReader> = {
  direct_json: readDirectJsonBlock,
  express: readExpressBlock,
  elemental: readElementalBlock,
  atom: readAtomBlock,
};

/** The surface each component id sits in, from the parse's messages: the first message that holds it. */
function surfacesOfMessages(messages: readonly unknown[]): Map<string, string> {
  const surfaces = new Map<string, string>();
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue;
    for (const body of Object.values(message as Record<string, unknown>)) {
      if (typeof body !== 'object' || body === null) continue;
      const {surfaceId, components} = body as {surfaceId?: unknown; components?: unknown};
      if (typeof surfaceId !== 'string' || !Array.isArray(components)) continue;
      for (const component of components) {
        const id = (component as {id?: unknown})?.id;
        if (typeof id === 'string' && !surfaces.has(id)) surfaces.set(id, surfaceId);
      }
    }
  }
  return surfaces;
}

/**
 * The component ranges of a parse's input: each block read by the format's
 * reader, a component's surface the one its block names, else the one the
 * parse's messages give its id, else the format's default. Every block is
 * read; the first one the reader cannot finish says where it stopped.
 */
export function readRanges(
  input: string,
  format: InferenceFormat,
  options: ReadOptions = {},
): Reading {
  const {wrapped = true, messages = [], catalog = ANY_CATALOG} = options;
  const blocks: Block[] = wrapped
    ? blocksOf(input, BLOCKS[format])
    : [{start: 0, end: input.length, final: true}];
  const surfaces = surfacesOfMessages(messages);
  const ranges: ComponentRange[] = [];
  let stoppedAt: number | undefined;
  for (const block of blocks) {
    const reading = READERS[format](input, block.start, block.end, catalog);
    for (const found of reading.components) {
      ranges.push({
        surfaceId: found.surfaceId ?? surfaces.get(found.componentId) ?? DEFAULT_SURFACES[format],
        componentId: found.componentId,
        start: found.start,
        end: found.end,
      });
    }
    if (stoppedAt === undefined && reading.stoppedAt !== undefined) stoppedAt = reading.stoppedAt;
  }
  return {ranges, ...(stoppedAt !== undefined && {stoppedAt})};
}

/** The innermost component whose range holds an offset: the shortest of those that do. */
export function innermostAt(
  ranges: readonly ComponentRange[],
  offset: number,
): ComponentRange | undefined {
  let innermost: ComponentRange | undefined;
  for (const range of ranges) {
    if (offset < range.start || offset >= range.end) continue;
    if (innermost === undefined || range.end - range.start < innermost.end - innermost.start) {
      innermost = range;
    }
  }
  return innermost;
}

/**
 * A parse event's component ranges: the ones its producer states, else the
 * ones its format's reader works out; none when it names no format.
 */
export function rangesOfParse(
  attributes: Record<string, unknown>,
  catalog?: ReaderCatalog,
): Reading | undefined {
  const stated = attributes['a2ui.parse.components'];
  if (Array.isArray(stated)) return {ranges: stated as ComponentRange[]};
  const format = attributes['a2ui.parse.inference_format'];
  const input = attributes['a2ui.parse.input'];
  if (typeof input !== 'string' || !FORMATS.includes(format as InferenceFormat)) return undefined;
  const messages = attributes['a2ui.parse.messages'];
  return readRanges(input, format as InferenceFormat, {
    wrapped: isWrappedParse(attributes),
    ...(Array.isArray(messages) && {messages}),
    ...(catalog !== undefined && {catalog}),
  });
}
