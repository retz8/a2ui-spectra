import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {MessageBoxState} from '../api.ts';
import {chatEntryOf} from '../model/chat.ts';
import {isTurnEvent, type Turn, type TurnRecord, type WireEvent} from '../model/record.ts';
import {readRecording} from '../testing/recordings.ts';
import {boxChatOf} from './selectors.ts';
import type {RecordState, SpectraState} from './spectra.ts';

const traceIdOf = (turn: Turn) => turn.events.find(isTurnEvent)!.traceId;

function stateOf(
  box: MessageBoxState,
  parts: Partial<Pick<SpectraState, 'live' | 'closed' | 'records'>> = {},
): SpectraState {
  return {
    loaded: true,
    turns: [],
    live: new Map(),
    closed: new Map(),
    records: new Map(),
    box,
    ...parts,
  };
}

const loaded = (record: TurnRecord): RecordState => ({record});

describe('boxChatOf', () => {
  const conversation = readRecording('node_restaurant_finder/send_task_history_and_failed');
  const [first, second] = conversation.turns;
  const failed = readRecording('ag2/stream_v1_0_failed');
  const [failedTurn] = failed.turns;

  it('shows each turn the box sent, in order, one that names no conversation included', () => {
    const state = stateOf(
      {turns: [traceIdOf(failedTurn), traceIdOf(first)], conversationId: 'ctx'},
      {
        records: new Map([[traceIdOf(failedTurn), loaded(failed)]]),
        closed: new Map([[traceIdOf(first), first]]),
      },
    );
    const needs: string[] = [];
    assert.deepEqual(boxChatOf(state, needs), {
      entries: [
        chatEntryOf(traceIdOf(failedTurn), failedTurn.events),
        chatEntryOf(traceIdOf(first), first.events),
      ],
      loading: false,
    });
    assert.deepEqual(needs, []);
  });

  it("reads the newest turn's record, which holds the conversation's earlier turns", () => {
    const box = {turns: [traceIdOf(first), traceIdOf(second)]};
    const needs: string[] = [];
    assert.deepEqual(boxChatOf(stateOf(box), needs), {entries: [], loading: true});
    assert.deepEqual(needs, [traceIdOf(second)]);

    const records = new Map([[traceIdOf(second), loaded(conversation)]]);
    const after: string[] = [];
    assert.deepEqual(
      boxChatOf(stateOf(box, {records}), after).entries.map(entry => entry.traceId),
      [traceIdOf(first), traceIdOf(second)],
    );
    assert.deepEqual(after, []);
  });

  it('shows an open turn from the live stream, and leaves out a turn whose record failed to read', () => {
    const open = {
      traceId: traceIdOf(second),
      startTime: '2026-10-24T09:00:00.000Z',
      events: second.events.filter((event): event is WireEvent => !isTurnEvent(event)),
    };
    const state = stateOf(
      {turns: [traceIdOf(first), traceIdOf(second)], openTurn: traceIdOf(second)},
      {
        live: new Map([[open.traceId, open]]),
        records: new Map([[traceIdOf(first), {error: 'Not found.'}]]),
      },
    );
    const needs: string[] = [];
    const {entries, loading} = boxChatOf(state, needs);
    assert.deepEqual(
      entries.map(entry => [entry.traceId, entry.open]),
      [[traceIdOf(second), true]],
    );
    assert.equal(loading, false);
    assert.deepEqual(needs, []);
  });
});
