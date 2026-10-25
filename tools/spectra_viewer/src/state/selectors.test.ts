import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedTurn, MessageBoxState} from '../api.ts';
import {composerOf} from './selectors.ts';
import type {SpectraState} from './spectra.ts';

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

describe('composerOf', () => {
  const row = (traceId: string, fields: Partial<ListedTurn> = {}): ListedTurn => ({
    traceId,
    startTime: '2026-10-24T09:00:00.000Z',
    ...fields,
  });
  const turns = [
    row('b', {outcome: 'waiting_for_input', input: {text: 'Book a table for 2'}}),
    row('a', {outcome: 'waiting_for_input', input: {text: 'Top 3 Italian restaurants'}}),
  ];

  it("continues the box's conversation, named by its first message, with its newest turn's outcome", () => {
    assert.deepEqual(composerOf({...stateOf({conversationId: 'c', turns: ['a', 'b']}), turns}), {
      continues: {title: 'Top 3 Italian restaurants', outcome: 'waiting_for_input'},
    });
  });

  it('starts a new conversation when the box has sent nothing', () => {
    assert.deepEqual(composerOf(stateOf({})), {});
  });

  it('waits while a turn is open or Spectra is not connected', () => {
    const open = {
      ...stateOf({turns: ['a'], openTurn: 'a'}),
      turns: [row('a', {open: true, input: {text: 'Hi'}})],
    };
    assert.deepEqual(composerOf(open), {
      waiting: 'A turn is open',
      continues: {title: 'Hi', open: true},
    });
    assert.deepEqual(composerOf({...stateOf({}), connected: false}), {
      waiting: 'Not connected to Spectra',
    });
  });

  it("gives the box's reason when it cannot send to the agent", () => {
    assert.deepEqual(composerOf(stateOf({unavailable: 'No JSON-RPC interface.'})), {
      unavailable: 'No JSON-RPC interface.',
    });
  });
});
