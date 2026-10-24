import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {chatEntryOf} from './chat.ts';
import {isTurnEvent, type Turn} from './record.ts';

const traceIdOf = (turn: Turn) => turn.events.find(isTurnEvent)!.traceId;

describe('chatEntryOf', () => {
  it('shows the text sent, the A2UI count and a turn waiting for input', () => {
    const record = readRecording('node_restaurant_finder/send_task_history_and_failed');
    const [first, second] = record.turns;
    assert.deepEqual(chatEntryOf(traceIdOf(first), first.events), {
      traceId: traceIdOf(first),
      sent: 'Top 3 Chinese restaurants in New York',
      replies: [],
      a2uiMessages: 7,
      outcome: 'waiting_for_input',
    });
    assert.deepEqual(chatEntryOf(traceIdOf(second), second.events), {
      traceId: traceIdOf(second),
      sent: 'Top 3 Chinese restaurants in New York',
      replies: [
        'The agent could not answer this request: The renderer supports A2UI v0.9.1, but this agent serves only v0.9, v1.0.',
      ],
      a2uiMessages: 0,
      outcome: 'failed',
    });
  });

  it("shows a failed turn's reason", () => {
    const [turn] = readRecording('ag2/stream_v1_0_failed').turns;
    assert.equal(chatEntryOf(traceIdOf(turn), turn.events).reason, 'The scripted model failed.');
  });

  it('shows every text reply in order, and a cancelled turn', () => {
    const [turn] = readRecording('stub_agent/cancel_a2a_1_0').turns;
    const entry = chatEntryOf(traceIdOf(turn), turn.events);
    assert.deepEqual(entry.replies, ['Working until you cancel.', 'Cancelled.']);
    assert.equal(entry.outcome, 'cancelled');
  });

  it('shows no outcome for a completed turn, and leaves blank replies out', () => {
    const turn = readRecording('strathweb_booking_wizard/send_then_stream').turns[1];
    const entry = chatEntryOf(traceIdOf(turn), turn.events);
    assert.equal(entry.outcome, undefined);
    assert.deepEqual(entry.replies, []);
    assert.equal(entry.a2uiMessages, 3);
  });

  it('marks a turn with no turn event yet as open', () => {
    const [turn] = readRecording('stub_agent/cancel_a2a_1_0').turns;
    const wireEvents = turn.events.filter(event => !isTurnEvent(event));
    const entry = chatEntryOf(traceIdOf(turn), wireEvents);
    assert.equal(entry.open, true);
    assert.equal(entry.outcome, undefined);
  });
});
