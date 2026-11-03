/** A stream's span: from openStream to its end, its chunks, and what comes after the end. */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {instrument, uninstrument} from './index.js';
import {Capture, eventsOf, goodBlock, processorOf, sdk} from './testing/support.js';

const capture = new Capture();

beforeEach(() => {
  capture.reset();
  instrument({tracerProvider: capture.provider});
});

afterEach(() => uninstrument());

describe('a stream', () => {
  it('closed: one parse, its chunks, its input the joined chunks', async () => {
    const processor = await processorOf('direct_json');
    const text = `Hi.\n${goodBlock('a')}\n`;
    const stream = processor.openStream();
    stream.feed(text.slice(0, 30));
    stream.feed(text.slice(30));
    stream.close();

    const span = capture.only();
    assert.equal(span.attributes['a2ui.parse.entry_point'], 'open_stream');
    assert.equal(span.attributes['a2ui.parse.streamed'], true);
    assert.equal(span.attributes['a2ui.parse.input'], text);
    assert.deepEqual(
      eventsOf(span, 'a2ui.parse.chunk').map(chunk => chunk['a2ui.parse.chunk.end']),
      [30, text.length],
    );
    assert.equal(span.status.code, 0);
  });

  it('ended by a feed that throws; a feed and a close after the end record nothing', async () => {
    const processor = await processorOf('direct_json');
    const stream = processor.openStream();
    assert.throws(() => stream.feed('<a2ui-json>[{"oops"}]</a2ui-json>'), sdk.ParseError);
    assert.equal(capture.spans().length, 1);
    const span = capture.only();
    assert.equal(span.attributes['error.type'], 'ParseError');
    assert.equal(eventsOf(span, 'exception').length, 1);

    assert.throws(() => stream.feed('more'), {
      constructor: Error,
      message: 'The response stream is closed.',
    });
    assert.deepEqual(stream.close(), []);
    assert.equal(capture.spans().length, 1);
    assert.equal(eventsOf(capture.only(), 'a2ui.parse.chunk').length, 1);
  });

  it('a close after the end returns nothing and records nothing', async () => {
    const processor = await processorOf('express');
    const stream = processor.openStream();
    stream.feed('<a2ui>\nsurface("e")\nroot = Text("Hi")\n</a2ui>');
    stream.close();
    assert.deepEqual(stream.close(), []);
    assert.equal(capture.spans().length, 1);
  });

  it('abandoned: its span is never ended and never exported', async () => {
    const processor = await processorOf('express');
    const stream = processor.openStream();
    stream.feed('<a2ui>\nsurface("e")\nroot = Text("Hi")\n');
    await capture.provider.forceFlush();
    assert.equal(capture.spans().length, 0);
  });
});
