/**
 * The Atom reader: S-expressions, read as the pinned SDK's reader reads
 * them, `;` and `#` comments to the end of a line, commas whitespace, a
 * missing closing parenthesis supplied at the end. A form whose head is a
 * component's name is a component, nested in its parent; its id is its
 * `:id`, else `root` for the first root of a block when nothing claims it,
 * else `node_N`, counted from 0 across the text in document order, skipping
 * every id the text states. A bare string or symbol in a container's child
 * position, directly, in a positional `[...]` or in a `(:children ...)`
 * form, is a text component of its own, named the same way, unless it is
 * empty, its parent's catalog has no text component, or it is the id of a
 * component already compiled into the same message, which the parent, an
 * ancestor and a later sibling are not yet; under an explicit `:children
 * [...]` or `:child` keyword it is a reference. A `(surface "id")` or
 * `(updateComponents "id")` header opens the surface its forms fall in.
 */
import {closeTagOf, EXPRESS_PAYLOAD_START, openTagOf, type BlockConfig} from './blocks.ts';
import {
  ANY_CATALOG,
  type BlockReading,
  type FoundComponent,
  type ReaderCatalog,
} from './reading.ts';

export const ATOM_BLOCKS: BlockConfig = {
  openTag: openTagOf('a2ui'),
  closeTag: closeTagOf('a2ui'),
  strings: new Set(["'", '"']),
  lineComments: [';;', '#'],
  blockComments: [],
  payloadStart: EXPRESS_PAYLOAD_START,
};

type Node =
  | {kind: 'form'; items: Node[]; start: number; end: number; bracket: '(' | '['}
  | {kind: 'string'; value: string; start: number; end: number}
  | {kind: 'keyword'; name: string; start: number; end: number}
  | {kind: 'symbol'; text: string; start: number; end: number};

class Stop extends Error {
  readonly at: number;

  constructor(at: number) {
    super(`stopped at ${at}`);
    this.at = at;
  }
}

/** Reads the forms of a block; a form left open at the end is closed there. */
function readForms(text: string, start: number, end: number): Node[] {
  const roots: Node[] = [];
  const stack: Array<Node & {kind: 'form'}> = [];
  const push = (node: Node) =>
    (stack.length === 0 ? roots : stack[stack.length - 1].items).push(node);
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ';' || (ch === '#' && (i + 1 >= end || /\s/.test(text[i + 1])))) {
      while (i < end && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '(' || ch === '[') {
      const form: Node & {kind: 'form'} = {
        kind: 'form',
        items: [],
        start: i,
        end: i + 1,
        bracket: ch,
      };
      push(form);
      stack.push(form);
      i++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      const form = stack.pop();
      if (form !== undefined) form.end = i + 1;
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      const chars: string[] = [];
      let closed = false;
      while (j < end) {
        if (text[j] === '\\' && j + 1 < end) {
          chars.push(text[j + 1]);
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          closed = true;
          j++;
          break;
        }
        chars.push(text[j]);
        j++;
      }
      if (!closed) throw new Stop(i);
      push({kind: 'string', value: chars.join(''), start: i, end: j});
      i = j;
      continue;
    }
    if (ch === ':') {
      let j = i + 1;
      while (j < end && /[\w-]/.test(text[j])) j++;
      if (j === i + 1) throw new Stop(i);
      let name = text.slice(i + 1, j);
      if (text[j] === ':') j++;
      // A `:key=value` keyword carries its value with it.
      if (text[j] === '=') {
        const eq = j;
        while (j < end && !/[\s,()[\]]/.test(text[j])) j++;
        name = text.slice(i + 1, eq);
      }
      push({kind: 'keyword', name, start: i, end: j});
      i = j;
      continue;
    }
    let j = i;
    while (j < end && !/[\s()"[\],:]/.test(text[j])) j++;
    if (j === i) throw new Stop(i);
    push({kind: 'symbol', text: text.slice(i, j), start: i, end: j});
    i = j;
  }
  while (stack.length > 0) stack.pop()!.end = end;
  return roots;
}

const SURFACE_HEADS = new Set(['surface', 'createSurface', 'updateComponents']);
const SKIPPED_HEADS = new Set([
  'updateDataModel',
  'deleteSurface',
  'callFunction',
  'data',
  'template',
]);
const CHILD_KEYS = new Set(['root', 'child', 'children', 'component']);
/** The keywords that open a component's `(:children ...)` form of children. */
const COMPONENT_CHILD_KEYS = new Set(['children', 'child']);
/** The heads that are never a component's: the message and data forms. */
const RESERVED_HEADS = new Set([
  'data',
  'dataModel',
  'set!',
  'surface',
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callFunction',
]);
/** A token Python's reader takes as a literal, not a symbol. */
const LITERAL = /^(?:true|false|null|-?\d+|-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)$/;

/** A string's value or a symbol's text: what Python's reader gives as a `str`. */
function textOf(node: Node): string | undefined {
  return node.kind === 'string' ? node.value : node.kind === 'symbol' ? node.text : undefined;
}

/** A form's first `:name` keyword's value, when it is a string or a symbol. */
function keywordTextOf(form: Node & {kind: 'form'}, name: string): string | undefined {
  for (let i = 1; i < form.items.length - 1; i++) {
    const item = form.items[i];
    if (item.kind === 'keyword' && item.name === name) return textOf(form.items[i + 1]);
  }
  return undefined;
}

/** A bare string or symbol: what a container's child position wraps in a text component. */
function isBareString(node: Node): boolean {
  if (node.kind === 'string') return true;
  return node.kind === 'symbol' && node.text !== '...' && !LITERAL.test(node.text);
}

function headOf(node: Node): string | undefined {
  if (node.kind !== 'form' || node.bracket !== '(') return undefined;
  const first = node.items[0];
  return first?.kind === 'symbol' ? first.text.replace(/^[`']|[`']$/g, '') : undefined;
}

/** A header's surface: its `:id` or `:surfaceId`, else its first positional string. */
function surfaceOfHeader(form: Node & {kind: 'form'}, fallback: string): string {
  let positional: string | undefined;
  for (let i = 1; i < form.items.length; i++) {
    const item = form.items[i];
    if (item.kind === 'keyword') {
      const value = form.items[i + 1];
      if ((item.name === 'id' || item.name === 'surfaceId') && value?.kind === 'string')
        return value.value;
      i++;
      continue;
    }
    if (item.kind === 'string' && positional === undefined) positional = item.value;
  }
  return positional ?? fallback;
}

/** The components of one Atom block. */
export function readAtomBlock(
  text: string,
  start: number,
  end: number,
  catalog: ReaderCatalog = ANY_CATALOG,
): BlockReading {
  const components: FoundComponent[] = [];
  let roots: Node[];
  let stoppedAt: number | undefined;
  try {
    roots = readForms(text, start, end);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    stoppedAt = error.at;
    roots = readForms(text, start, error.at);
  }
  /** The catalog a form names with `:catalogId`. */
  const catalogIdOf = (form: Node & {kind: 'form'}) => keywordTextOf(form, 'catalogId');
  const isComponentForm = (node: Node): boolean => {
    const head = headOf(node);
    return (
      head !== undefined &&
      !RESERVED_HEADS.has(head) &&
      catalog.isComponent(head, catalogIdOf(node as Node & {kind: 'form'}))
    );
  };
  // Every id the text states is kept from the counter.
  const reserved = new Set<string>();
  const collect = (node: Node) => {
    if (node.kind !== 'form') return;
    node.items.forEach((item, index) => {
      const value = node.items[index + 1];
      if (
        item.kind === 'keyword' &&
        (item.name === 'id' || item.name === 'functionCallId') &&
        value !== undefined &&
        textOf(value) !== undefined
      ) {
        reserved.add(textOf(value)!);
      }
      collect(item);
    });
  };
  roots.forEach(collect);
  let counter = 0;
  let used = new Set<string>();
  // The components whose forms are compiled whole: a bare string naming one is a reference.
  let compiled = new Set<string>();
  let surfaceId: string | undefined;
  const nextId = () => {
    for (;;) {
      const candidate = `node_${counter++}`;
      if (!used.has(candidate) && !reserved.has(candidate)) return candidate;
    }
  };
  const assignId = (explicit: string | undefined, isRoot: boolean) => {
    const id =
      explicit ?? (isRoot && !used.has('root') && !reserved.has('root') ? 'root' : nextId());
    used.add(id);
    return id;
  };
  const found = (id: string, node: Node) => {
    components.push({
      componentId: id,
      start: node.start,
      end: node.end,
      ...(surfaceId !== undefined && {surfaceId}),
    });
  };
  const component = (form: Node & {kind: 'form'}, isRoot: boolean) => {
    const head = headOf(form)!;
    const catalogId = catalogIdOf(form);
    const id = assignId(keywordTextOf(form, 'id'), isRoot);
    found(id, form);
    const container = catalog.isContainer(head, catalogId);
    const wraps = catalog.wrapsBareStrings(head, catalogId) === true;
    // Python's `_auto_wrap_text_child`, the string trimmed.
    const wrap = (item: Node) => {
      const text = textOf(item)!.trim();
      if (text === '' || compiled.has(text) || !wraps) return;
      const child = assignId(undefined, false);
      found(child, item);
      compiled.add(child);
    };
    const addChildItems = (items: readonly Node[], wrapStrings: boolean) => {
      for (const item of items) {
        if (item.kind === 'form') {
          if (item.items.length > 0 && isCompiledForm(item)) component(item, false);
        } else if (isBareString(item) && wrapStrings) wrap(item);
      }
    };
    for (let i = 1; i < form.items.length; i++) {
      const item = form.items[i];
      if (item.kind === 'keyword') {
        const value = form.items[i + 1];
        i++;
        if (value === undefined || item.name === 'id' || item.name === 'catalogId') continue;
        if (value.kind !== 'form' || headOf(value) === 'template') continue;
        if (item.name === 'children') {
          // An explicit child list: its strings are references.
          addChildItems(isComponentForm(value) ? [value] : value.items, false);
        } else if (isComponentForm(value)) {
          component(value as Node & {kind: 'form'}, false);
        } else {
          nestedForms(value);
        }
        continue;
      }
      if (item.kind === 'form') {
        if (item.items.length === 0) continue;
        const first = item.items[0];
        const head = headOf(item);
        if (
          first.kind === 'keyword' &&
          item.items.length > 1 &&
          COMPONENT_CHILD_KEYS.has(first.name)
        ) {
          let contents = item.items.slice(1);
          const only = contents[0];
          if (
            contents.length === 1 &&
            only.kind === 'form' &&
            only.items.length > 0 &&
            !isComponentForm(only)
          ) {
            contents = only.items;
          }
          addChildItems(contents, true);
        } else if (
          head !== undefined &&
          (SKIPPED_HEADS.has(head) || head.toLowerCase() === 'event')
        ) {
          continue;
        } else if (isComponentForm(item)) {
          component(item as Node & {kind: 'form'}, false);
        } else if (container !== true && head !== undefined) {
          continue;
        } else if (item.bracket === '(' && head !== undefined) {
          continue;
        } else {
          addChildItems(item.items, true);
        }
        continue;
      }
      if (container === true && isBareString(item)) wrap(item);
    }
    compiled.add(id);
  };
  /** A form a child list compiles: a component's, or any form whose head is a symbol. */
  const isCompiledForm = (node: Node & {kind: 'form'}): boolean => {
    const head = headOf(node);
    return head !== undefined && !SKIPPED_HEADS.has(head) && isComponentForm(node);
  };
  /** The component forms nested in a value, each compiled where it sits. */
  const nestedForms = (node: Node) => {
    if (node.kind !== 'form') return;
    const head = headOf(node);
    if (head !== undefined && (SKIPPED_HEADS.has(head) || head.toLowerCase() === 'event')) return;
    if (isComponentForm(node)) {
      component(node as Node & {kind: 'form'}, false);
      return;
    }
    if (node.bracket === '[' || head === undefined)
      for (const item of node.items) nestedForms(item);
  };
  const block = (header: (Node & {kind: 'form'}) | undefined) => {
    used = new Set();
    compiled = new Set();
    surfaceId = header === undefined ? undefined : surfaceOfHeader(header, 'main');
  };

  let open = false;
  for (const root of roots) {
    const head = headOf(root);
    if (head !== undefined && SURFACE_HEADS.has(head)) {
      block(root as Node & {kind: 'form'});
      open = true;
      const form = root as Node & {kind: 'form'};
      for (let i = 1; i < form.items.length; i++) {
        const item = form.items[i];
        if (item.kind === 'keyword') {
          const value = form.items[i + 1];
          i++;
          if (value?.kind === 'form' && CHILD_KEYS.has(item.name)) {
            const trees = isComponentForm(value) ? [value] : value.items;
            for (const tree of trees)
              if (isComponentForm(tree)) component(tree as Node & {kind: 'form'}, true);
          }
          continue;
        }
        if (isComponentForm(item)) component(item as Node & {kind: 'form'}, true);
      }
      continue;
    }
    if (head !== undefined && SKIPPED_HEADS.has(head)) {
      open = false;
      continue;
    }
    if (isComponentForm(root)) {
      if (!open) {
        block(undefined);
        open = true;
      }
      component(root as Node & {kind: 'form'}, true);
    }
  }
  return {components, ...(stoppedAt !== undefined && {stoppedAt})};
}
