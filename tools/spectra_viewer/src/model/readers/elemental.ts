/**
 * The Elemental reader: HTML-like markup, read as the pinned SDK's DOM
 * builder reads it. A `<body id="…">` is a surface; a `<ui-…>` tag is a
 * component, nested in its parent, named by its `id` attribute or, without
 * one, `comp_N`, counted from 1 in document order within its body. A
 * component's range runs from its start tag to its end tag, or to the `/>`
 * of a self-closing tag; a tag that is never closed ends at its start tag.
 * The text of a `<script>` and a comment is skipped.
 */
import {closeTagOf, EXPRESS_PAYLOAD_START, openTagOf, type BlockConfig} from './blocks.ts';
import type {BlockReading, FoundComponent} from './reading.ts';

export const ELEMENTAL_BLOCKS: BlockConfig = {
  openTag: openTagOf('a2ui'),
  closeTag: closeTagOf('a2ui'),
  strings: new Set(["'", '"', '`']),
  lineComments: ['//', '<!--'],
  blockComments: [],
  payloadStart: EXPRESS_PAYLOAD_START,
};

const TAG_PREFIX = 'ui-';

interface Open {
  tag: string;
  start: number;
  /** The end of the start tag. */
  startTagEnd: number;
  component?: FoundComponent;
}

/** The attributes of a start tag, read from after its name up to `>` or `/>`; the position after the tag. */
function readStartTag(
  text: string,
  at: number,
  end: number,
): {attributes: Map<string, string>; selfClosing: boolean; after: number} | undefined {
  const attributes = new Map<string, string>();
  let i = at;
  for (;;) {
    while (i < end && /\s/.test(text[i])) i++;
    if (i >= end) return undefined;
    if (text[i] === '>') return {attributes, selfClosing: false, after: i + 1};
    if (text.startsWith('/>', i)) return {attributes, selfClosing: true, after: i + 2};
    const nameStart = i;
    while (i < end && !/[\s=>/]/.test(text[i])) i++;
    if (i === nameStart) {
      i++;
      continue;
    }
    const name = text.slice(nameStart, i).toLowerCase();
    while (i < end && /\s/.test(text[i])) i++;
    if (text[i] !== '=') {
      attributes.set(name, '');
      continue;
    }
    i++;
    while (i < end && /\s/.test(text[i])) i++;
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1);
      if (close < 0 || close >= end) return undefined;
      attributes.set(name, text.slice(i + 1, close));
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < end && !/[\s>]/.test(text[i]) && !text.startsWith('/>', i)) i++;
      attributes.set(name, text.slice(valueStart, i));
    }
  }
}

/** The components of one Elemental block. */
export function readElementalBlock(text: string, start: number, end: number): BlockReading {
  const components: FoundComponent[] = [];
  const stack: Open[] = [];
  let surfaceId: string | undefined;
  let counter = 0;
  let i = start;
  const closeTo = (index: number) => {
    // Every open tag above `index` ends at its start tag.
    while (stack.length > index) {
      const open = stack.pop()!;
      if (open.component !== undefined) open.component.end = open.startTagEnd;
    }
  };
  while (i < end) {
    const lt = text.indexOf('<', i);
    if (lt < 0 || lt >= end) break;
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      if (close < 0 || close >= end) return {components, stoppedAt: lt};
      i = close + 3;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const gt = text.indexOf('>', lt);
      if (gt < 0 || gt >= end) return {components, stoppedAt: lt};
      const tag = text
        .slice(lt + 2, gt)
        .trim()
        .toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].tag !== tag) index--;
      if (index >= 0) {
        closeTo(index + 1);
        const open = stack.pop()!;
        if (open.component !== undefined) open.component.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    const nameStart = lt + 1;
    let nameEnd = nameStart;
    while (nameEnd < end && /[A-Za-z0-9_:-]/.test(text[nameEnd])) nameEnd++;
    if (nameEnd === nameStart) {
      i = lt + 1;
      continue;
    }
    const tag = text.slice(nameStart, nameEnd).toLowerCase();
    const startTag = readStartTag(text, nameEnd, end);
    if (startTag === undefined) return {components, stoppedAt: lt};
    const {attributes, selfClosing, after} = startTag;
    i = after;
    if (tag === 'script' || tag === 'style') {
      const close = text.toLowerCase().indexOf(`</${tag}`, i);
      if (close < 0 || close >= end) return {components, stoppedAt: lt};
      const gt = text.indexOf('>', close);
      i = gt < 0 || gt >= end ? end : gt + 1;
      continue;
    }
    if (tag === 'body') {
      closeTo(0);
      surfaceId = attributes.get('id') || undefined;
      counter = 0;
    }
    let component: FoundComponent | undefined;
    if (tag.startsWith(TAG_PREFIX)) {
      const id = attributes.get('id') || `comp_${++counter}`;
      component = {
        componentId: id,
        start: lt,
        end: after,
        ...(surfaceId !== undefined && {surfaceId}),
      };
      components.push(component);
    }
    if (selfClosing || tag === 'link' || tag === 'meta' || tag === 'br') continue;
    stack.push({tag, start: lt, startTagEnd: after, component});
  }
  closeTo(0);
  return {components};
}
