import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import ts from 'typescript';

// The rule of text levels: a component styles its text with the stylesheet's
// named roles, the `type-*` utilities, and colours an icon or a dot with a
// `tone-*` one. A raw size, weight, typeface, capitals or text colour class
// outside them breaks the rule.

const SRC = fileURLToPath(new URL('.', import.meta.url));

const RAW = [
  // A size.
  /^text-(xs|sm|base|lg|[2-9]?xl)$/,
  /^text-\[\d+(\.\d+)?(px|rem|em)\]$/,
  // A weight.
  /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^font-\[\d+\]$/,
  // A typeface.
  /^font-(sans|mono|serif)$/,
  // Capitals and their tracking.
  /^(uppercase|lowercase|capitalize|normal-case)$/,
  /^tracking-/,
  // A text colour.
  /^text-(foreground|muted-foreground|muted-strong|muted|brand|brand-on|brand-soft|problem|problem-soft|success|claude|gemini|primary|primary-foreground|secondary|secondary-foreground|accent|accent-foreground|popover-foreground|card-foreground|destructive|white|black|inherit|current|transparent)(\/\d+)?$/,
  /^text-[a-z]+-\d{2,3}(\/\d+)?$/,
  /^text-\[(#|var\(|rgb|hsl)/,
];

// A link and a piece of code quoted in a sentence take the size of their line;
// where the element stands as its own line, a size class beside the role sets it.
const SIZED_INLINE = /(^|\s)(type-link|type-code-inline)(\s|$)/;
const SIZE = /^text-(xs|sm)$/;

// Where a raw class stands for something other than text, and why.
const EXCEPTIONS: {file: string; token: string; why: string}[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// The class tokens of every string in the file: literals, template literals' text and JSX attribute values.
function stringsOf(path: string): {text: string; line: number}[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: {text: string; line: number}[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({
        text: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// A token without its variants: `hover:`, `disabled:`, `[&>span]:` and the like.
function baseOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    else if (token[i] === ']') depth--;
    else if (token[i] === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, '');
}

describe('the rule of text levels', () => {
  it('styles text with the named roles alone', () => {
    const breaks: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path);
      for (const {text, line} of stringsOf(path)) {
        for (const token of text.split(/\s+/)) {
          const base = baseOf(token);
          if (!RAW.some(pattern => pattern.test(base))) continue;
          if (SIZE.test(token) && SIZED_INLINE.test(text)) continue;
          if (EXCEPTIONS.some(e => e.file === file && e.token === token)) continue;
          breaks.push(`${file}:${line} ${token}`);
        }
      }
    }
    assert.deepEqual(breaks, []);
  });

  it('states a reason for every exception, and each is still in use', () => {
    for (const e of EXCEPTIONS) {
      assert.notEqual(e.why, '');
      const used = stringsOf(join(SRC, e.file)).some(({text}) =>
        text.split(/\s+/).includes(e.token),
      );
      assert.ok(used, `${e.file} ${e.token} is no longer used`);
    }
  });
});
