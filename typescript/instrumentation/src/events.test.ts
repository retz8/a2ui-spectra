/** One event per outermost call, and the block an error belongs to. */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {instrument, uninstrument} from './index.js';
import {
  CATALOG_ID,
  Capture,
  eventsOf,
  goodBlock,
  messagesOf,
  processorOf,
  rangeOf,
  sdk,
} from './testing/support.js';

const capture = new Capture();

beforeEach(() => {
  capture.reset();
  instrument({tracerProvider: capture.provider});
});

afterEach(() => uninstrument());

function blockOf(attributes: Record<string, unknown>): [unknown, unknown] | undefined {
  return 'a2ui.parse.block.start' in attributes
    ? [attributes['a2ui.parse.block.start'], attributes['a2ui.parse.block.end']]
    : undefined;
}

describe('one event per outermost call', () => {
  it('parseResponse over compile and the state is one parse', async () => {
    const processor = await processorOf('direct_json');
    const text = `Here it is.\n${goodBlock('a')}`;
    const parts = processor.parseResponse(text);

    const span = capture.only();
    assert.equal(span.name, 'parse');
    assert.equal(span.attributes['a2ui.event.kind'], 'parse');
    assert.equal(span.attributes['a2ui.parse.entry_point'], 'parse_response');
    assert.equal(span.attributes['a2ui.parse.input'], text);
    assert.equal(span.attributes['a2ui.parse.inference_format'], 'direct_json');
    assert.deepEqual(JSON.parse(span.attributes['a2ui.parse.catalogs'] as string), [
      {catalogId: CATALOG_ID, protocolVersion: 'v1.0'},
    ]);
    const messages = parts.flatMap(part => (part.type === 'a2ui' ? part.a2ui : []));
    assert.deepEqual(JSON.parse(span.attributes['a2ui.parse.messages'] as string), messages);
    assert.equal(span.attributes['a2ui.sdk.name'], '@a2ui/agent');
    assert.equal(span.attributes['a2ui.sdk.version'], '0.1.0');
    assert.equal(span.instrumentationScope.name, 'a2ui-spectra-instrumentation');
  });

  it('a compile called on its own is one parse, its entry point compile', async () => {
    const processor = await processorOf('express');
    processor.parser.compile('surface("e")\nroot = Text("Hello")');

    const span = capture.only();
    assert.equal(span.attributes['a2ui.parse.entry_point'], 'compile');
    assert.equal(span.attributes['a2ui.parse.inference_format'], 'express');
    assert.equal(span.attributes['a2ui.parse.wrapped'], undefined);
  });

  it("the A2A path, the parser's parseResponse called directly, is one parse", async () => {
    const processor = await processorOf('express');
    const text = '<a2ui>\nsurface("e")\nroot = Text("Hello")\n</a2ui>';
    processor.parser.parseResponse(text, {wrapped: true});

    const span = capture.only();
    assert.equal(span.attributes['a2ui.parse.entry_point'], 'parse_response');
    assert.equal(span.attributes['a2ui.parse.input'], text);
  });

  it('an unwrapped text says so', async () => {
    const processor = await processorOf('express');
    processor.parseResponse('surface("e")\nroot = Text("Hello")', {wrapped: false});

    assert.equal(capture.only().attributes['a2ui.parse.wrapped'], false);
  });

  it("a third party's Parser subclass through parseResponse is a parse with no format", async () => {
    const {catalogs} = await processorOf('direct_json');
    class LineParser extends sdk.Parser {
      readonly catalogs = catalogs;
      unwrap(content: string) {
        return [{type: 'a2ui' as const, a2uiRaw: content, isFinal: true}];
      }
      compile(content: string) {
        return JSON.parse(content) as never;
      }
      decompile(): string {
        return '';
      }
      wrap(): string {
        return '';
      }
      hasFormatContent(): boolean {
        return true;
      }
    }
    const text = messagesOf('t', [{id: 'root', component: 'Text', text: 'Hi'}]);
    new LineParser().parseResponse(text);

    const span = capture.only();
    assert.equal(span.attributes['a2ui.parse.input'], text);
    assert.equal(span.attributes['a2ui.parse.inference_format'], undefined);
    assert.equal(JSON.parse(span.attributes['a2ui.parse.messages'] as string).length, 2);
  });

  it("a prompt generation is the section the generator wrote, with the generator's format", async () => {
    const processor = await processorOf('express');
    const section = processor.promptSnippet;

    const span = capture.only();
    assert.equal(span.name, 'prompt_generation');
    assert.equal(span.attributes['a2ui.prompt.ui_section'], section);
    assert.equal(span.attributes['a2ui.prompt.inference_format'], 'express');
    assert.deepEqual(JSON.parse(span.attributes['a2ui.prompt.catalogs'] as string), [
      {catalogId: CATALOG_ID, protocolVersion: 'v1.0'},
    ]);
  });

  it('a failed prompt generation has no section, and its error', async () => {
    const v09 = await new sdk.InMemoryCatalogProvider(
      {catalogId: 'https://example.com/a.json', components: {}},
      '0.9',
    ).load();
    const v091 = await new sdk.InMemoryCatalogProvider(
      {catalogId: 'https://example.com/b.json', components: {}},
      '0.9.1',
    ).load();
    const processor = new sdk.A2uiRequestProcessor(
      [v09, v091],
      undefined,
      new sdk.DirectJsonFormatFactory(),
    );
    assert.throws(() => processor.promptSnippet, sdk.A2uiCatalogError);

    const span = capture.only();
    assert.equal(span.attributes['a2ui.prompt.ui_section'], undefined);
    assert.equal(span.attributes['error.type'], 'A2uiCatalogError');
    assert.equal(eventsOf(span, 'exception').length, 1);
  });
});

describe('the block an error belongs to', () => {
  it('a whole text: the block being compiled', async () => {
    const processor = await processorOf('direct_json');
    const bad = '[{"version": "1.0", oops}]';
    const text = `${goodBlock('a')}\nThen:\n<a2ui-json>${bad}</a2ui-json>`;
    assert.throws(() => processor.parseResponse(text), sdk.ParseError);

    const span = capture.only();
    const [error] = eventsOf(span, 'exception');
    assert.equal(error['exception.type'], 'ParseError');
    assert.ok(typeof error['exception.stacktrace'] === 'string');
    assert.deepEqual(blockOf(error), rangeOf(text, bad));
    // The messages of the block before it, which the error carries.
    assert.equal(JSON.parse(span.attributes['a2ui.parse.messages'] as string).length, 2);
    assert.equal(span.status.code, 2);
  });

  it('an error that leaves checkTopology belongs to no block', async () => {
    const processor = await processorOf('direct_json');
    const text = `<a2ui-json>${messagesOf('a', [
      {id: 'root', component: 'Column', children: ['missing']},
    ])}</a2ui-json>`;
    assert.throws(() => processor.parseResponse(text), sdk.A2uiIntegrityError);

    const [error] = eventsOf(capture.only(), 'exception');
    assert.equal(error['exception.type'], 'A2uiIntegrityError');
    assert.equal(blockOf(error), undefined);
  });

  it('a stream: the block the error carries as rawContent, stated whole', async () => {
    const processor = await processorOf('express');
    const first = 'surface("a")\nroot = Text("Hi")';
    const rejected = 'surface("b")\nroot = Heading("Hi")\nother = Text("Bye")';
    const text = `<a2ui>\n${first}\n</a2ui>\n<a2ui>\n${rejected}\n</a2ui>\n`;
    // The second chunk ends after the refused statement, inside its block.
    const cut = text.indexOf('other =');
    const stream = processor.openStream({afterRejectedBlock: 'continue'});
    const parts = [...stream.feed(text.slice(0, cut)), ...stream.feed(text.slice(cut))];
    stream.close();
    const [error] = parts.filter(part => part.type === 'error');
    assert.ok(error);

    const [event] = eventsOf(capture.only(), 'exception');
    assert.equal(event['exception.type'], 'A2uiCompilationValidationError');
    assert.deepEqual(blockOf(event), rangeOf(text, rejected));
  });

  it('a stream: by the blocks done when the stream caught the error, noted at markChecked', async () => {
    const processor = await processorOf('direct_json');
    const bad = '[{"version": "1.0", oops}]';
    const good = goodBlock('b');
    // One chunk holds the rejected block and a block that finishes after it.
    const text = `<a2ui-json>${bad}</a2ui-json>\n${good}\n`;
    const stream = processor.openStream({afterRejectedBlock: 'continue'});
    stream.feed(text);
    stream.close();

    const span = capture.only();
    const [event] = eventsOf(span, 'exception');
    assert.equal(event['exception.type'], 'ParseError');
    assert.deepEqual(blockOf(event), rangeOf(text, bad));
    assert.equal(JSON.parse(span.attributes['a2ui.parse.messages'] as string).length, 2);
  });

  it('a stream: a block its own check rejects while a message arrives, after a block finishing in the same chunk, stated whole', async () => {
    const processor = await processorOf('direct_json');
    const first = messagesOf('a', [{id: 'root', component: 'Text', text: 'Hi'}]);
    const rejected = messagesOf('b', [
      {id: 'root', component: 'Column', children: ['title']},
      {id: 'title', component: 'Text', text: 'One'},
      {id: 'title', component: 'Text', text: 'Two'},
    ]);
    const text = `<a2ui-json>${first}</a2ui-json>\n<a2ui-json>${rejected}</a2ui-json>\n`;
    // The first chunk ends inside the first block; the second finishes it and
    // ends inside the second, after its repeated id.
    const second = text.indexOf('"Two"}') + '"Two"}'.length;
    const stream = processor.openStream({afterRejectedBlock: 'continue'});
    stream.feed(text.slice(0, 20));
    const parts = stream.feed(text.slice(20, second));
    stream.feed(text.slice(second));
    stream.close();
    assert.ok(parts.some(part => part.type === 'error'));

    const [event] = eventsOf(capture.only(), 'exception');
    assert.equal(event['exception.type'], 'A2uiIntegrityError');
    assert.deepEqual(blockOf(event), rangeOf(text, rejected));
    // The repeated ids are not structured details.
    assert.equal(event['a2ui.parse.error.details'], undefined);
  });
});
