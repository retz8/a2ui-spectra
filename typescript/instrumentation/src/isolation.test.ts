/** A failure inside the wrapper never reaches the agent: the SDK returns and throws as it would, and one warning line is written. */

import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {instrument, uninstrument} from './index.js';
import {faultyProvider, processorOf, sdk, Warnings} from './testing/support.js';

afterEach(() => uninstrument());

describe('a fault inside a hook', () => {
  it("leaves the SDK's return as it is, with one warning", async () => {
    const processor = await processorOf('express');
    const text = 'surface("e")\nroot = Text("Hi")';
    const unhooked = processor.parser.compile(text);
    const warnings = new Warnings();
    try {
      instrument({tracerProvider: faultyProvider()});
      assert.deepEqual(processor.parser.compile(text), unhooked);
      const lines = await warnings.settled();
      assert.equal(lines.length, 1);
      assert.match(lines[0], /the compile hook failed \(Error: injected\)/);
    } finally {
      warnings.stop();
    }
  });

  it('leaves the exception the SDK throws as it is, with one warning', async () => {
    const processor = await processorOf('direct_json');
    const text = '<a2ui-json>[{"oops"}]</a2ui-json>';
    let unhooked: unknown;
    try {
      processor.parseResponse(text);
    } catch (error) {
      unhooked = error;
    }
    const warnings = new Warnings();
    try {
      instrument({tracerProvider: faultyProvider()});
      assert.throws(
        () => processor.parseResponse(text),
        (error: unknown) =>
          error instanceof sdk.ParseError && error.message === (unhooked as Error).message,
      );
      const lines = await warnings.settled();
      assert.equal(lines.length, 1);
      assert.match(lines[0], /the parseResponse hook failed/);
    } finally {
      warnings.stop();
    }
  });
});
