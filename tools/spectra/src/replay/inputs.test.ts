import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn, TurnRecord, WireInputEvent} from '../record/turn_record.js';
import {testTurn} from '../testing/turns.js';
import {ReplayRecordError, replayInputs} from './inputs.js';

/** A test turn with its wire input's attributes changed, and its outcome. */
function turnWith(
  input: Partial<WireInputEvent['attributes']>,
  outcome: 'completed' | 'waiting_for_input' = 'completed',
  version?: string,
): Turn {
  const turn = testTurn({version});
  const [turnEvent, wireInput, ...rest] = turn.events;
  return {
    events: [
      {
        ...turnEvent,
        attributes: {...turnEvent.attributes, 'a2ui.turn.outcome': outcome},
      } as Turn['events'][number],
      {...wireInput, attributes: {...wireInput.attributes, ...input}} as WireInputEvent,
      ...rest,
    ],
  };
}

function recordOf(...turns: Turn[]): TurnRecord {
  return {version: 'v0.1', turns: turns as TurnRecord['turns']};
}

describe('replayInputs, what the driver re-sends for each recorded turn', () => {
  it("gives each turn its parts, its metadata split as recorded and the versions it offered in the record's form", () => {
    const capabilities = {
      'v0.9.1': {supportedCatalogIds: ['a']},
      '1.0': {supportedCatalogIds: ['b']},
    };
    const dataModel = {version: '1.0', surfaces: {s1: {name: 'Ada'}}};
    const record = recordOf(
      turnWith({'a2ui.wire.capabilities': capabilities, 'a2ui.wire.metadata': {source: 'planner'}}),
      turnWith({
        'a2ui.wire.message': {
          role: 'user',
          parts: [{type: 'a2ui', content: {version: '1.0', action: {name: 'go'}}}],
        },
        'a2ui.wire.capabilities': capabilities,
        'a2ui.wire.data_model': dataModel,
      }),
    );
    assert.deepEqual(replayInputs(record), [
      {
        parts: [{type: 'text', content: 'Hi'}],
        metadata: {capabilities, metadata: {source: 'planner'}},
        offeredVersions: ['v0.9.1', 'v1.0'],
        afterWaitingTurn: false,
      },
      {
        parts: [{type: 'a2ui', content: {version: '1.0', action: {name: 'go'}}}],
        metadata: {capabilities, dataModel},
        offeredVersions: ['v0.9.1', 'v1.0'],
        afterWaitingTurn: false,
      },
    ]);
  });

  it("offers the turn's protocol version when the input carried no capabilities, and nothing with neither", () => {
    const [withVersion, withNeither] = replayInputs(
      recordOf(turnWith({}, 'completed', 'v0.9.1'), turnWith({})),
    );
    assert.deepEqual(withVersion.offeredVersions, ['v0.9.1']);
    assert.deepEqual(withVersion.metadata, {});
    assert.deepEqual(withNeither.offeredVersions, []);
  });

  it('marks a turn whose recorded turn before it ended waiting for input', () => {
    const inputs = replayInputs(
      recordOf(turnWith({}, 'waiting_for_input'), turnWith({}, 'completed'), turnWith({})),
    );
    assert.deepEqual(
      inputs.map(input => input.afterWaitingTurn),
      [false, true, false],
    );
  });

  it('refuses a record whose turn has no wire input, naming the turn', () => {
    const turn = testTurn({});
    const noInput: Turn = {events: turn.events.filter(event => event.name !== 'wire_input')};
    assert.throws(
      () => replayInputs(recordOf(turnWith({}), noInput)),
      (error: unknown) => {
        assert.ok(error instanceof ReplayRecordError);
        assert.equal(
          error.message,
          'Turn 2 of the record has no wire input, so there is nothing to send for it.',
        );
        return true;
      },
    );
  });

  it('refuses a record whose turn holds more than one wire input, naming the turn and the count', () => {
    const turn = turnWith({});
    const [turnEvent, wireInput, ...rest] = turn.events;
    const twice: Turn = {
      events: [turnEvent, wireInput, {...wireInput, spanId: 'f'.repeat(16)}, ...rest],
    };
    assert.throws(
      () => replayInputs(recordOf(turnWith({}), twice)),
      (error: unknown) =>
        error instanceof ReplayRecordError &&
        error.message ===
          'Turn 2 of the record holds 2 wire inputs, and a replay sends one input a turn.',
    );
  });

  it('refuses a record whose wire input holds no message with parts, naming the turn', () => {
    for (const message of [undefined, {role: 'user'}, {role: 'user', parts: 'Hi'}]) {
      assert.throws(
        () =>
          replayInputs(
            recordOf(
              turnWith({'a2ui.wire.message': message} as Partial<WireInputEvent['attributes']>),
            ),
          ),
        (error: unknown) =>
          error instanceof ReplayRecordError &&
          error.message ===
            "Turn 1 of the record's wire input holds no message with parts, so there is nothing to send for it.",
      );
    }
  });
});
