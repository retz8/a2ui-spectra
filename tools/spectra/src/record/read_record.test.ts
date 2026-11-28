import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {NewerRecordError, readRecord, RecordReadError} from './read_record.js';

const TURN_EVENT = {attributes: {'a2ui.event.kind': 'turn'}};

/** The reader's refusal of a text, which must be its own error and not one thrown from inside it. */
function refusalOf(text: string): string {
  try {
    readRecord(text);
  } catch (error) {
    assert.ok(
      error instanceof RecordReadError,
      `expected the reader's refusal, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    return error.message;
  }
  return assert.fail('expected the reader to refuse the text');
}

describe('readRecord', () => {
  it('reads a record of the version this release reads', () => {
    const record = readRecord(JSON.stringify({version: 'v0.1', turns: [{events: [TURN_EVENT]}]}));
    assert.equal(record.version, 'v0.1');
    assert.equal(record.turns.length, 1);
  });

  it('refuses what is not JSON, not an object, of no version it reads, or without turns', () => {
    assert.match(refusalOf('notes'), /^The file is not JSON: /);
    assert.equal(refusalOf('[]'), 'The file is not a turn record v0.1: it is not an object.');
    assert.equal(
      refusalOf(JSON.stringify({turns: [{events: [TURN_EVENT]}]})),
      'The file is not a turn record v0.1: its version is missing.',
    );
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1.0', turns: [{events: [TURN_EVENT]}]})),
      'The file is not a turn record v0.1: its version is v0.1.0.',
    );
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: []})),
      'The file is not a turn record v0.1: it has no turns.',
    );
  });

  it('refuses a record of a newer version with the newer line', () => {
    assert.throws(
      () => readRecord(JSON.stringify({version: 'v0.2', turns: [{events: [TURN_EVENT]}]})),
      (error: unknown) =>
        error instanceof NewerRecordError &&
        error.message ===
          'The file is a turn record v0.2, newer than this Spectra reads: it reads v0.1. Upgrade a2ui-spectra to read it.',
    );
  });

  it('refuses a turn that is no object, has no events or has no turn event', () => {
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: [null]})),
      'The file is not a turn record v0.1: turn 1 has no events.',
    );
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: [{events: [TURN_EVENT]}, {}]})),
      'The file is not a turn record v0.1: turn 2 has no events.',
    );
    assert.equal(
      refusalOf(
        JSON.stringify({
          version: 'v0.1',
          turns: [{events: [{attributes: {'a2ui.event.kind': 'wire_input'}}]}],
        }),
      ),
      'The file is not a turn record v0.1: turn 1 has no turn event.',
    );
  });

  it('refuses an event that is no object, or whose attributes are none, with its place', () => {
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: [{events: [{attributes: null}]}]})),
      'The file is not a turn record v0.1: event 1 of turn 1 is not an event.',
    );
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: [{events: [TURN_EVENT, null]}]})),
      'The file is not a turn record v0.1: event 2 of turn 1 is not an event.',
    );
    assert.equal(
      refusalOf(
        JSON.stringify({
          version: 'v0.1',
          turns: [{events: [TURN_EVENT]}, {events: [TURN_EVENT, {name: 'chat'}, 'chat']}],
        }),
      ),
      'The file is not a turn record v0.1: event 2 of turn 2 is not an event.',
    );
    assert.equal(
      refusalOf(JSON.stringify({version: 'v0.1', turns: [{events: [TURN_EVENT, []]}]})),
      'The file is not a turn record v0.1: event 2 of turn 1 is not an event.',
    );
    assert.equal(
      refusalOf(
        JSON.stringify({version: 'v0.1', turns: [{events: [TURN_EVENT, {attributes: []}]}]}),
      ),
      'The file is not a turn record v0.1: event 2 of turn 1 is not an event.',
    );
  });
});
