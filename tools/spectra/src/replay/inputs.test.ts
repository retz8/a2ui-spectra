import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn, TurnRecord, WireInputEvent} from '../record/turn_record.js';
import {testTurn} from '../testing/turns.js';
import {ReplayRecordError, replayInputs} from './inputs.js';

const V0_9_1 = 'https://a2ui.org/a2a-extension/a2ui/v0.9.1';
const V1_0 = 'https://a2ui.org/a2a-extension/a2ui/v1.0';

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
  it('gives each turn its parts, its metadata split as recorded and the versions it offered as extension URIs', () => {
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
        extensions: [V0_9_1, V1_0],
        carriesTask: false,
      },
      {
        parts: [{type: 'a2ui', content: {version: '1.0', action: {name: 'go'}}}],
        metadata: {capabilities, dataModel},
        extensions: [V0_9_1, V1_0],
        carriesTask: false,
      },
    ]);
  });

  it("offers the turn's protocol version when the input carried no capabilities, and nothing with neither", () => {
    const [withVersion, withNeither] = replayInputs(
      recordOf(turnWith({}, 'completed', 'v0.9.1'), turnWith({})),
    );
    assert.deepEqual(withVersion.extensions, [V0_9_1]);
    assert.deepEqual(withVersion.metadata, {});
    assert.deepEqual(withNeither.extensions, []);
  });

  it('marks a turn as carrying a task when the recorded turn before it ended waiting for input', () => {
    const inputs = replayInputs(
      recordOf(turnWith({}, 'waiting_for_input'), turnWith({}, 'completed'), turnWith({})),
    );
    assert.deepEqual(
      inputs.map(input => input.carriesTask),
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
});
