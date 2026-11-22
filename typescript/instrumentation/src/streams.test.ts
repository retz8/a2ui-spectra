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

  it('fed more chunks than a span holds: keeps its first chunk and its errors', async () => {
    // OpenTelemetry's span holds 128 events by default and drops the oldest
    // past them; a reply streamed in small chunks, as Anthropic's are, feeds
    // hundreds.
    const processor = await processorOf('express');
    const rejected = '<a2ui>\nsurface("b")\nroot = Heading("Hi")\n</a2ui>\n';
    const filler = 'Some more text. '.repeat(20);
    const last = '<a2ui>\nsurface("a")\nroot = Text("Hi")\n</a2ui>\n';
    const stream = processor.openStream({afterRejectedBlock: 'continue'});
    stream.feed(rejected);
    for (const character of filler) stream.feed(character);
    stream.feed(last);
    stream.close();

    const span = capture.only();
    assert.ok(span.events.length <= 128);
    assert.equal(eventsOf(span, 'exception').length, 1);
    const ends = eventsOf(span, 'a2ui.parse.chunk').map(chunk => chunk['a2ui.parse.chunk.end']);
    assert.equal(ends[0], rejected.length);
    assert.equal(ends.at(-1), rejected.length + filler.length + last.length);
    assert.deepEqual(
      ends,
      [...ends].sort((a, b) => Number(a) - Number(b)),
    );
    const times = span.events.map(event => event.time[0] * 1e9 + event.time[1]);
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
    );
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
