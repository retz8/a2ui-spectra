import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {wrapperCaptureRecords} from '../testing/recordings.ts';
import type {ReaderCatalog} from './readers/reading.ts';
import {
  type ComponentRange,
  type InferenceFormat,
  innermostAt,
  isWrappedParse,
  rangesOfParse,
  readRanges,
} from './ranges.ts';

const FORMATS: InferenceFormat[] = ['direct_json', 'express', 'elemental', 'atom'];

interface ParseCase {
  name: string;
  format: InferenceFormat;
  input: string;
  wrapped: boolean;
  messages: unknown[];
  failed: boolean;
}

/** Every parse of the suite's expected records that names its inference format. */
function parseCases(): ParseCase[] {
  return wrapperCaptureRecords().flatMap(({name, record}) =>
    record.turns.flatMap(turn =>
      turn.events.flatMap((event): ParseCase[] => {
        const attributes = event.attributes as Record<string, unknown>;
        if (attributes['a2ui.event.kind'] !== 'parse') return [];
        const format = attributes['a2ui.parse.inference_format'];
        if (!FORMATS.includes(format as InferenceFormat)) return [];
        return [
          {
            name,
            format: format as InferenceFormat,
            input: attributes['a2ui.parse.input'] as string,
            wrapped: isWrappedParse(attributes),
            messages: (attributes['a2ui.parse.messages'] as unknown[] | undefined) ?? [],
            failed: event.status?.code === 2,
          },
        ];
      }),
    ),
  );
}

function keyOf(surfaceId: string, componentId: string): string {
  return `${surfaceId} / ${componentId}`;
}

/** The components the SDK's messages hold, by surface and id, each with its type. */
function componentsOf(messages: readonly unknown[]): Map<string, string> {
  const components = new Map<string, string>();
  for (const message of messages) {
    for (const body of Object.values(message as Record<string, unknown>)) {
      if (typeof body !== 'object' || body === null || !('components' in body)) continue;
      const {surfaceId, components: list} = body as {surfaceId: string; components: unknown[]};
      for (const component of list) {
        const {id, component: type} = component as {id: string; component: string};
        components.set(keyOf(surfaceId, id), type);
      }
    }
  }
  return components;
}

/** Elemental's tag of a component type: `TextInput` is `ui-text-input`. */
function tagOf(type: string): string {
  return `ui-${type.replace(/(.)([A-Z][a-z]+)/g, '$1-$2').toLowerCase()}`;
}

/** What a component's own text starts with and ends with, in each notation. */
const SHAPES: Record<InferenceFormat, {opens: (type: string) => RegExp; closes: RegExp}> = {
  direct_json: {opens: () => /^\{/, closes: /\}$/},
  express: {
    opens: type => new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*)?${type}\\s*\\(`),
    closes: /\)$/,
  },
  elemental: {
    opens: type => new RegExp(`^<${tagOf(type)}[\\s/>]`),
    closes: /(\/>|<\/ui-[a-z-]+>)$/,
  },
  atom: {opens: type => new RegExp(`^\\(${type}[\\s)]`), closes: /\)$/},
};

describe("the wrapper capture suite's texts", () => {
  const cases = parseCases();
  for (const format of FORMATS) {
    describe(format, () => {
      const ofFormat = cases.filter(c => c.format === format);
      it('has cases', () => {
        assert.ok(ofFormat.length > 0);
      });
      for (const c of ofFormat) {
        it(`${c.name}: names the components the SDK produced, each range its own text`, () => {
          const reading = readRanges(c.input, c.format, {wrapped: c.wrapped, messages: c.messages});
          const expected = componentsOf(c.messages);
          const found = new Map(reading.ranges.map(r => [keyOf(r.surfaceId, r.componentId), r]));
          for (const [key, type] of expected) {
            const range = found.get(key);
            assert.ok(
              range !== undefined,
              `${key} not found among ${[...found.keys()].join(', ')}`,
            );
            const text = c.input.slice(range.start, range.end);
            assert.match(text, SHAPES[format].opens(type), `${key}: ${JSON.stringify(text)}`);
            assert.match(text, SHAPES[format].closes, `${key}: ${JSON.stringify(text)}`);
            if (format === 'direct_json') {
              assert.equal((JSON.parse(text) as {id: string}).id, range.componentId);
            }
          }
          // A parse that produced every message of its text names every component the reader finds.
          if (!c.failed) {
            assert.deepEqual([...found.keys()].sort(), [...expected.keys()].sort());
          }
        });
      }
    });
  }
});

/** A reader's catalog for the hand-written texts: the basic catalog's containers and argument order. */
const CATALOG: ReaderCatalog = {
  isComponent: name => /^[A-Z]/.test(name) && name !== 'Event' && name !== '_template',
  propertyOrder: name =>
    ({Card: ['child'], Column: ['children', 'justify'], Row: ['children'], Text: ['text']})[name],
  isContainer: name => ['Card', 'Column', 'Row', 'Button'].includes(name),
};

/** Each range as `surface / id: text`. */
function shown(input: string, ranges: readonly ComponentRange[]): string[] {
  return ranges.map(r => `${r.surfaceId} / ${r.componentId}: ${input.slice(r.start, r.end)}`);
}

describe('the readers on hand-written texts', () => {
  it('nests inline Express components under their parent, the innermost one under the pointer', () => {
    const input = '<a2ui>\nsurface("s")\nroot = Card(Column([Text("a"), Text("b")]))\n</a2ui>';
    const {ranges} = readRanges(input, 'express', {catalog: CATALOG});
    assert.deepEqual(shown(input, ranges), [
      's / root: root = Card(Column([Text("a"), Text("b")]))',
      's / root_child: Column([Text("a"), Text("b")])',
      's / root_child_children_0: Text("a")',
      's / root_child_children_1: Text("b")',
    ]);
    const at = (text: string) => input.indexOf(text);
    assert.equal(innermostAt(ranges, at('Text("b")'))?.componentId, 'root_child_children_1');
    assert.equal(innermostAt(ranges, at('Column'))?.componentId, 'root_child');
    assert.equal(innermostAt(ranges, at('root ='))?.componentId, 'root');
    assert.equal(innermostAt(ranges, at('surface')), undefined);
    assert.equal(innermostAt(ranges, input.length), undefined);
  });

  it('names an inline Express component under a helper `_inline_N`, and lets `id=` win', () => {
    const input = 'root = Column([_template($/items, Text($/name))], id="list")';
    const {ranges} = readRanges(input, 'express', {wrapped: false, catalog: CATALOG});
    assert.deepEqual(
      ranges.map(r => r.componentId),
      ['list', '_inline_1'],
    );
  });

  it('places each Express component in the surface its block opened last', () => {
    const input = 'surface("a")\nroot = Text("x")\nsurface("b")\nroot = Text("y")';
    const {ranges} = readRanges(input, 'express', {wrapped: false});
    assert.deepEqual(
      ranges.map(r => `${r.surfaceId} / ${r.componentId}`),
      ['a / root', 'b / root'],
    );
  });

  it('keeps the components read before a Direct JSON text breaks off, and says where it stopped', () => {
    const input =
      '<a2ui-json>\n[{"version":"1.0","createSurface":{"surfaceId":"s","components":[' +
      '{"id":"a","component":"Text"},{"id":"b","compo';
    const {ranges, stoppedAt} = readRanges(input, 'direct_json');
    assert.deepEqual(shown(input, ranges), ['s / a: {"id":"a","component":"Text"}']);
    assert.equal(stoppedAt, input.length);
  });

  it('keeps the Express statements read before a syntax error, and says where it stopped', () => {
    const input = 'root = Column([a, b])\na = Text("a"\nb = Text("b")';
    const {ranges, stoppedAt} = readRanges(input, 'express', {wrapped: false});
    assert.deepEqual(
      ranges.map(r => r.componentId),
      ['root'],
    );
    // The reader stops where `b` follows `"a"` with no comma or closing parenthesis.
    assert.equal(stoppedAt, input.indexOf('b = Text("b")'));
  });

  it('strips a Markdown fence from a block, as the SDK does', () => {
    const input = '<a2ui>\n```express\nroot = Text("a")\n```\n</a2ui>';
    const {ranges} = readRanges(input, 'express');
    assert.deepEqual(shown(input, ranges), ['default_surface / root: root = Text("a")']);
  });

  it('recovers one block closed with no open tag before it', () => {
    const express = 'The card:\nroot = Text("a")\n</a2ui>\nDone.';
    assert.deepEqual(shown(express, readRanges(express, 'express').ranges), [
      'default_surface / root: root = Text("a")',
    ]);
    const json =
      'The card:\n[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"a","component":"Text"}]}}]\n</a2ui-json>';
    assert.deepEqual(shown(json, readRanges(json, 'direct_json').ranges), [
      's / a: {"id":"a","component":"Text"}',
    ]);
  });

  it('reads nothing from a wrapped text with no block', () => {
    assert.deepEqual(readRanges('Just prose, no UI.', 'express'), {ranges: []});
  });

  it('names Elemental components without an id `comp_N`, counted within their body', () => {
    const input =
      '<a2ui>\n<body id="s">\n<ui-column>\n<ui-text text="a"/>\n<ui-text text="b"></ui-text>\n</ui-column>\n</body>\n</a2ui>';
    const {ranges} = readRanges(input, 'elemental');
    assert.deepEqual(shown(input, ranges), [
      's / comp_1: <ui-column>\n<ui-text text="a"/>\n<ui-text text="b"></ui-text>\n</ui-column>',
      's / comp_2: <ui-text text="a"/>',
      's / comp_3: <ui-text text="b"></ui-text>',
    ]);
  });

  it('ends an Elemental tag that is never closed at its start tag', () => {
    const input =
      '<body id="s"><ui-column id="c"><ui-text id="a" text="a"><ui-text id="b" text="b"/></ui-column></body>';
    const {ranges} = readRanges(input, 'elemental', {wrapped: false});
    assert.deepEqual(shown(input, ranges), [
      's / c: <ui-column id="c"><ui-text id="a" text="a"><ui-text id="b" text="b"/></ui-column>',
      's / a: <ui-text id="a" text="a">',
      's / b: <ui-text id="b" text="b"/>',
    ]);
  });

  it('names Atom components `root` then `node_N`, a bare string child a text component, skipping stated ids', () => {
    const input = '(Card (Column "hello" (Text :id "node_1" :text "x") (Text :text "y")))';
    const {ranges} = readRanges(input, 'atom', {wrapped: false, catalog: CATALOG});
    assert.deepEqual(shown(input, ranges), [
      'main / root: (Card (Column "hello" (Text :id "node_1" :text "x") (Text :text "y")))',
      'main / node_0: (Column "hello" (Text :id "node_1" :text "x") (Text :text "y"))',
      'main / node_2: "hello"',
      'main / node_1: (Text :id "node_1" :text "x")',
      'main / node_3: (Text :text "y")',
    ]);
  });

  it('places Atom forms in the surface their header names, the second root `node_N`', () => {
    const input =
      '(surface "s"\n  (Text :text "a")\n  (Text :text "b"))\n(updateComponents "t" (Text :text "c"))';
    const {ranges} = readRanges(input, 'atom', {wrapped: false});
    assert.deepEqual(
      ranges.map(r => `${r.surfaceId} / ${r.componentId}`),
      ['s / root', 's / node_0', 't / root'],
    );
  });

  it('lets a stated range list win over the readers', () => {
    const stated = [{surfaceId: 's', componentId: 'x', start: 0, end: 3}];
    const attributes = {
      'a2ui.parse.input': 'root = Text("a")',
      'a2ui.parse.entry_point': 'compile',
      'a2ui.parse.inference_format': 'express',
      'a2ui.parse.components': stated,
    };
    assert.deepEqual(rangesOfParse(attributes), {ranges: stated});
    const read = rangesOfParse({...attributes, 'a2ui.parse.components': undefined});
    assert.deepEqual(
      read?.ranges.map(r => r.componentId),
      ['root'],
    );
    const unknown = {
      ...attributes,
      'a2ui.parse.components': undefined,
      'a2ui.parse.inference_format': undefined,
    };
    assert.equal(rangesOfParse(unknown), undefined);
  });
});
