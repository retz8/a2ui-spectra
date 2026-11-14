/**
 * The Express reader: statements of `name = Type(args)`, read by the pinned
 * SDK's grammar, newlines and `;` insignificant, `#`, `//` and `--` running
 * to the end of a line and a block comment opened by a slash and a star. A
 * component is a call
 * of a component's name: assigned to a variable, its id is the variable's
 * name; written inline as a property's value, its id is its parent's id,
 * the property and, in a list, its index, as `card_children_0`; written
 * inline where no property names it, `_inline_N`, counted as the parse's
 * SDK counts: Python the components named so, TypeScript every inline
 * component. An `id=` argument wins. Positional arguments fill the
 * properties in the order the catalog gives, a call's `catalogId=` choosing
 * the catalog, a check or a list made only of checks taken out first. A
 * name starting with `@` is a system function. A `surface(…)` statement
 * opens the scope its later statements fall in. A component's range runs
 * from the variable's name, when it has one, to the closing parenthesis of
 * its call.
 */
import {closeTagOf, EXPRESS_PAYLOAD_START, openTagOf, type BlockConfig} from './blocks.ts';
import {
  ANY_CATALOG,
  type BlockReading,
  type FoundComponent,
  type ReaderCatalog,
} from './reading.ts';

export const EXPRESS_BLOCKS: BlockConfig = {
  openTag: openTagOf('a2ui'),
  closeTag: closeTagOf('a2ui'),
  strings: new Set(['"']),
  lineComments: ['#', '//', '--'],
  blockComments: [['/*', '*/']],
  payloadStart: EXPRESS_PAYLOAD_START,
};

type TokenKind = 'ident' | 'path' | 'string' | 'number' | 'check' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
  /** A string's value. */
  value?: string;
  start: number;
  end: number;
}

interface CallNode {
  kind: 'call';
  name: string;
  args: Array<{key?: string; value: ExprNode}>;
  start: number;
  end: number;
}
interface ListNode {
  kind: 'list';
  items: ExprNode[];
}
interface MapNode {
  kind: 'map';
  entries: Array<{key: string; value: ExprNode}>;
}
interface CheckNode {
  kind: 'check';
  args: ExprNode[];
}
interface OtherNode {
  kind: 'other';
  /** A string's value. */
  value?: string;
}
type ExprNode = CallNode | ListNode | MapNode | CheckNode | OtherNode;

interface Statement {
  /** The assigned variable, for an assignment. */
  name?: string;
  value: ExprNode;
  start: number;
  end: number;
}

class Stop extends Error {
  readonly at: number;

  constructor(at: number) {
    super(`stopped at ${at}`);
    this.at = at;
  }
}

/** A number literal the SDKs refuse: one that is not finite as a double, such as `1e999`. */
class OutOfRange extends Error {
  readonly at: number;

  constructor(at: number) {
    super(`number out of range at ${at}`);
    this.at = at;
  }
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const PATH_PART = /[A-Za-z0-9_/]/;
/** The grammar's `NUMBER`: a sign, digits with an optional fraction or a fraction alone, an exponent. */
const NUMBER = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

/** The block's tokens up to its end, or up to the first text the lexer cannot read. */
function tokenize(text: string, start: number, end: number): {tokens: Token[]; stoppedAt?: number} {
  const tokens: Token[] = [];
  let i = start;
  while (i < end) {
    const ch = text[i];
    if (/\s/.test(ch) || ch === ';') {
      i++;
      continue;
    }
    if (ch === '#' || text.startsWith('//', i) || text.startsWith('--', i)) {
      while (i < end && text[i] !== '\n') i++;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      if (close < 0 || close >= end) return {tokens, stoppedAt: i};
      i = close + 2;
      continue;
    }
    if (ch === '"' || (ch === 'r' && text[i + 1] === '"')) {
      const raw = ch === 'r';
      const open = raw ? i + 1 : i;
      const triple = text.startsWith('"""', open);
      let j = open + (triple ? 3 : 1);
      const chars: string[] = [];
      let closed = false;
      while (j < end) {
        if (!raw && text[j] === '\\' && j + 1 < end) {
          chars.push(unescape(text[j + 1]));
          j += 2;
          continue;
        }
        if (triple ? text.startsWith('"""', j) : text[j] === '"') {
          j += triple ? 3 : 1;
          closed = true;
          break;
        }
        chars.push(text[j]);
        j++;
      }
      if (!closed) return {tokens, stoppedAt: i};
      tokens.push({
        kind: 'string',
        text: text.slice(i, j),
        value: chars.join(''),
        start: i,
        end: j,
      });
      i = j;
      continue;
    }
    if (ch === '$') {
      let j = i + 1;
      while (j < end && PATH_PART.test(text[j])) j++;
      tokens.push({kind: 'path', text: text.slice(i, j), start: i, end: j});
      i = j;
      continue;
    }
    if (ch === '?' && i + 1 < end && IDENT_START.test(text[i + 1])) {
      let j = i + 1;
      while (j < end && IDENT_PART.test(text[j])) j++;
      tokens.push({kind: 'check', text: text.slice(i, j), start: i, end: j});
      i = j;
      continue;
    }
    // A system function's name, from v1.0: `@` and an identifier, as `@index`.
    if (IDENT_START.test(ch) || (ch === '@' && i + 1 < end && IDENT_START.test(text[i + 1]))) {
      let j = i + 1;
      while (j < end && IDENT_PART.test(text[j])) j++;
      tokens.push({kind: 'ident', text: text.slice(i, j), start: i, end: j});
      i = j;
      continue;
    }
    const number = NUMBER.exec(text.slice(i, end));
    if (number !== null) {
      const j = i + number[0].length;
      tokens.push({kind: 'number', text: number[0], start: i, end: j});
      i = j;
      continue;
    }
    if ('()[]{},=:'.includes(ch)) {
      tokens.push({kind: 'punct', text: ch, start: i, end: i + 1});
      i++;
      continue;
    }
    return {tokens, stoppedAt: i};
  }
  return {tokens};
}

function unescape(ch: string): string {
  return ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch;
}

/** Parses the tokens into statements; stops, keeping the statements read, where it cannot go on. */
class Parser {
  private readonly tokens: Token[];
  /** Where the text the tokens cover ends: the next statement would start there. */
  private readonly textEnd: number;
  private at = 0;
  /** Whether a number out of range is read as any other. */
  private lenient = false;
  readonly statements: Statement[] = [];

  constructor(tokens: Token[], textEnd: number) {
    this.tokens = tokens;
    this.textEnd = textEnd;
  }

  /**
   * Reads every statement. A statement holding a number out of range is
   * dropped, as TypeScript's visitor drops it, or stops the reader, as
   * Python's visitor refuses the whole block.
   */
  parse(dropOutOfRange: boolean): void {
    while (this.at < this.tokens.length) {
      const first = this.at;
      try {
        this.statements.push(this.statement());
      } catch (error) {
        if (!(error instanceof OutOfRange)) throw error;
        if (!dropOutOfRange) throw new Stop(error.at);
        // Read the statement again, taking the number as any other, to know where it ends.
        this.at = first;
        this.lenient = true;
        try {
          this.statement();
        } finally {
          this.lenient = false;
        }
      }
    }
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.at + offset];
  }

  private here(): number {
    return this.peek()?.start ?? this.textEnd;
  }

  private expect(text: string): Token {
    const token = this.peek();
    if (token === undefined || token.kind !== 'punct' || token.text !== text) {
      throw new Stop(this.here());
    }
    this.at++;
    return token;
  }

  private statement(): Statement {
    const first = this.peek()!;
    const second = this.peek(1);
    if (
      (first.kind === 'ident' || first.kind === 'path') &&
      second?.kind === 'punct' &&
      second.text === '='
    ) {
      this.at += 2;
      const value = this.expression();
      return {name: first.text, value, start: first.start, end: this.lastEnd()};
    }
    const value = this.expression();
    return {value, start: first.start, end: this.lastEnd()};
  }

  private lastEnd(): number {
    return this.tokens[this.at - 1]?.end ?? this.textEnd;
  }

  private expression(): ExprNode {
    const token = this.peek();
    if (token === undefined) throw new Stop(this.here());
    if (token.kind === 'string') {
      this.at++;
      return {kind: 'other', value: token.value};
    }
    if (token.kind === 'number') {
      this.at++;
      if (!this.lenient && !Number.isFinite(Number(token.text))) throw new OutOfRange(token.start);
      return {kind: 'other'};
    }
    if (token.kind === 'path') {
      this.at++;
      return {kind: 'other'};
    }
    if (token.kind === 'check') {
      this.at++;
      const next = this.peek();
      return {
        kind: 'check',
        args: next?.kind === 'punct' && next.text === '(' ? this.checkArgs() : [],
      };
    }
    if (token.kind === 'ident') {
      this.at++;
      const next = this.peek();
      if (next?.kind === 'punct' && next.text === '(') return this.call(token);
      return {kind: 'other'};
    }
    if (token.text === '[') return this.list();
    if (token.text === '{') return this.map();
    throw new Stop(token.start);
  }

  private call(name: Token): CallNode {
    this.expect('(');
    const args: CallNode['args'] = [];
    for (;;) {
      const token = this.peek();
      if (token === undefined) throw new Stop(this.here());
      if (token.kind === 'punct' && token.text === ')') break;
      const next = this.peek(1);
      if (token.kind === 'ident' && next?.kind === 'punct' && next.text === '=') {
        this.at += 2;
        args.push({key: token.text, value: this.expression()});
      } else {
        args.push({value: this.expression()});
      }
      const after = this.peek();
      if (after?.kind === 'punct' && after.text === ',') {
        this.at++;
        continue;
      }
      if (after?.kind === 'punct' && after.text === ')') break;
      throw new Stop(this.here());
    }
    const close = this.expect(')');
    return {kind: 'call', name: name.text, args, start: name.start, end: close.end};
  }

  /** A check's parenthesised arguments, each an expression. */
  private checkArgs(): ExprNode[] {
    this.expect('(');
    const args: ExprNode[] = [];
    for (;;) {
      const token = this.peek();
      if (token === undefined) throw new Stop(this.here());
      if (token.kind === 'punct' && token.text === ')') break;
      args.push(this.expression());
      const after = this.peek();
      if (after?.kind === 'punct' && after.text === ',') {
        this.at++;
        continue;
      }
      if (after?.kind === 'punct' && after.text === ')') break;
      throw new Stop(this.here());
    }
    this.expect(')');
    return args;
  }

  private list(): ListNode {
    this.expect('[');
    const items: ExprNode[] = [];
    for (;;) {
      const token = this.peek();
      if (token === undefined) throw new Stop(this.here());
      if (token.kind === 'punct' && token.text === ']') break;
      items.push(this.expression());
      const after = this.peek();
      if (after?.kind === 'punct' && after.text === ',') {
        this.at++;
        continue;
      }
      if (after?.kind === 'punct' && after.text === ']') break;
      throw new Stop(this.here());
    }
    this.expect(']');
    return {kind: 'list', items};
  }

  private map(): MapNode {
    this.expect('{');
    const entries: MapNode['entries'] = [];
    for (;;) {
      const token = this.peek();
      if (token === undefined) throw new Stop(this.here());
      if (token.kind === 'punct' && token.text === '}') break;
      if (token.kind !== 'ident' && token.kind !== 'string') throw new Stop(token.start);
      this.at++;
      this.expect(':');
      entries.push({key: token.value ?? token.text, value: this.expression()});
      const after = this.peek();
      if (after?.kind === 'punct' && after.text === ',') {
        this.at++;
        continue;
      }
      if (after?.kind === 'punct' && after.text === '}') break;
      throw new Stop(this.here());
    }
    this.expect('}');
    return {kind: 'map', entries};
  }
}

/** The surface a `surface(…)` statement opens: its first positional string, else its `surfaceId=`. */
function surfaceOf(call: CallNode): string | undefined {
  const named = call.args.find(arg => arg.key === 'surfaceId')?.value;
  const positional = call.args.find(arg => arg.key === undefined)?.value;
  for (const value of [positional, named]) {
    if (value?.kind === 'other' && typeof value.value === 'string') return value.value;
  }
  return undefined;
}

/** A call's string argument of a name, as `id=` or `catalogId=`. */
function stringArgOf(call: CallNode, key: string): string | undefined {
  const value = call.args.find(arg => arg.key === key)?.value;
  return value?.kind === 'other' && typeof value.value === 'string' ? value.value : undefined;
}

/** The catalog a call names with `catalogId=`. */
function catalogIdOf(call: CallNode): string | undefined {
  return stringArgOf(call, 'catalogId');
}

/** The `id=` argument of a call, when it is a string. */
function explicitIdOf(call: CallNode): string | undefined {
  return stringArgOf(call, 'id');
}

/** A check, or a list made only of checks: the SDKs take it out of a call's arguments. */
function isCheckExpression(value: ExprNode): boolean {
  if (value.kind === 'check') return true;
  return value.kind === 'list' && value.items.length > 0 && value.items.every(isCheckExpression);
}

/** The checks a check expression holds. */
function checksIn(value: ExprNode): CheckNode[] {
  return value.kind === 'check'
    ? [value]
    : value.kind === 'list'
      ? value.items.flatMap(checksIn)
      : [];
}

/** The components of one Express block. */
export function readExpressBlock(
  text: string,
  start: number,
  end: number,
  catalog: ReaderCatalog = ANY_CATALOG,
): BlockReading {
  const {tokens, stoppedAt: lexStop} = tokenize(text, start, end);
  const parser = new Parser(tokens, lexStop ?? end);
  let stoppedAt: number | undefined = lexStop;
  try {
    parser.parse(catalog.sdk === 'typescript');
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    stoppedAt = error.at;
  }
  const components: FoundComponent[] = [];
  let surfaceId: string | undefined;
  let inlineCounter = 0;

  const nested = (
    parentId: string | undefined,
    parentProp: string | undefined,
    value: ExprNode,
    listIndex?: number,
  ) => {
    if (value.kind === 'call') {
      if (!value.name.startsWith('@') && catalog.isComponent(value.name, catalogIdOf(value))) {
        // TypeScript counts every inline component, Python those it names `_inline_N`.
        if (catalog.sdk === 'typescript') inlineCounter++;
        let id: string;
        if (parentId !== undefined && parentProp !== undefined) {
          id =
            listIndex === undefined
              ? `${parentId}_${parentProp}`
              : `${parentId}_${parentProp}_${listIndex}`;
        } else {
          if (catalog.sdk === 'python') inlineCounter++;
          id = `_inline_${inlineCounter}`;
        }
        id = explicitIdOf(value) ?? id;
        components.push({
          componentId: id,
          start: value.start,
          end: value.end,
          ...(surfaceId !== undefined && {surfaceId}),
        });
        argsOf(id, value);
      } else {
        // A helper's or a function's arguments: an inline component in them has no property naming it.
        for (const arg of value.args) nested(undefined, undefined, arg.value);
      }
      return;
    }
    if (value.kind === 'check') {
      for (const arg of value.args) nested(undefined, undefined, arg);
      return;
    }
    if (value.kind === 'list') {
      value.items.forEach((item, index) => nested(parentId, parentProp, item, index));
      return;
    }
    if (value.kind === 'map') {
      for (const entry of value.entries) nested(undefined, undefined, entry.value);
    }
  };
  // The compilers read a call's positional arguments, then its keyword ones, then its checks.
  const argsOf = (id: string, call: CallNode) => {
    const order = catalog.propertyOrder(call.name, catalogIdOf(call));
    const checks: CheckNode[] = [];
    let positional = 0;
    for (const arg of call.args) {
      if (arg.key !== undefined) continue;
      if (isCheckExpression(arg.value)) {
        checks.push(...checksIn(arg.value));
        continue;
      }
      nested(id, order?.[positional], arg.value);
      positional++;
    }
    for (const arg of call.args) {
      if (arg.key === undefined || arg.key === 'id' || arg.key === 'catalogId') continue;
      if (isCheckExpression(arg.value)) {
        checks.push(...checksIn(arg.value));
        continue;
      }
      nested(id, arg.key, arg.value);
    }
    for (const check of checks) nested(undefined, undefined, check);
  };

  for (const statement of parser.statements) {
    const {name, value} = statement;
    if (value.kind !== 'call') continue;
    if (name === undefined) {
      if (value.name === 'surface') {
        surfaceId = surfaceOf(value);
      } else if (value.name !== 'deleteSurface') {
        nested(undefined, undefined, value);
      }
      continue;
    }
    if (
      name.startsWith('$') ||
      value.name.startsWith('@') ||
      !catalog.isComponent(value.name, catalogIdOf(value))
    ) {
      nested(undefined, undefined, value);
      continue;
    }
    const id = explicitIdOf(value) ?? name;
    components.push({
      componentId: id,
      start: statement.start,
      end: statement.end,
      ...(surfaceId !== undefined && {surfaceId}),
    });
    argsOf(id, value);
  }
  return {components, ...(stoppedAt !== undefined && {stoppedAt})};
}
