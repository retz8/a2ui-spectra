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
    pending: new Map(),
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
    row('d', {conversationId: 'other', outcome: 'completed', input: {text: 'Show me a card'}}),
    row('b', {
      conversationId: 'c',
      outcome: 'waiting_for_input',
      input: {text: 'Book a table for 2'},
    }),
    row('a', {
      conversationId: 'c',
      outcome: 'completed',
      input: {text: 'Top 3 Italian restaurants'},
    }),
  ];
  const box = {conversations: [{conversationId: 'c', turns: ['a', 'b']}]};
  const continues = {
    kind: 'continues',
    conversationId: 'c',
    title: 'Top 3 Italian restaurants',
    outcome: 'waiting_for_input',
  };

  it("continues the box's conversation in view, named by its first message, with its newest turn's outcome", () => {
    assert.deepEqual(composerOf({...stateOf(box), turns}, {traceId: 'b'}), {target: continues});
  });

  it('continues the conversation whichever of its turns is in view', () => {
    assert.deepEqual(composerOf({...stateOf(box), turns}, {traceId: 'a'}), {target: continues});
  });

  it("takes the newest turn's outcome from any host in the box's conversation", () => {
    const later = row('e', {conversationId: 'c', outcome: 'failed', input: {text: 'Again'}});
    assert.deepEqual(composerOf({...stateOf(box), turns: [later, ...turns]}, {traceId: 'a'}), {
      target: {...continues, outcome: 'failed'},
    });
  });

  it('starts a new conversation for a conversation the box did not start', () => {
    assert.deepEqual(composerOf({...stateOf(box), turns}, {traceId: 'd'}), {
      target: {kind: 'notStarted'},
    });
  });

  it('starts a new conversation when one was asked for, or with no turn in view', () => {
    assert.deepEqual(composerOf({...stateOf(box), turns}, {traceId: 'b', startsNew: true}), {
      target: {kind: 'new'},
    });
    assert.deepEqual(composerOf(stateOf({conversations: []}), {}), {target: {kind: 'new'}});
  });

  it('does not continue a box turn whose agent named no conversation, and waits while it is open', () => {
    const open = {
      ...stateOf({conversations: [{turns: ['f'], openTurn: 'f'}]}),
      turns: [row('f', {open: true, input: {text: 'Hi'}})],
    };
    assert.deepEqual(composerOf(open, {traceId: 'f'}), {
      waiting: 'A turn is open',
      target: {kind: 'unnamed'},
    });
    const closed = {
      ...stateOf({conversations: [{turns: ['f']}]}),
      turns: [row('f', {outcome: 'failed', input: {text: 'Hi'}})],
    };
    assert.deepEqual(composerOf(closed, {traceId: 'f'}), {target: {kind: 'unnamed'}});
  });

  it('waits only in the conversation whose turn is open', () => {
    const state = {
      ...stateOf({
        conversations: [
          {conversationId: 'c', turns: ['a', 'b']},
          {conversationId: 'g', turns: ['g1'], openTurn: 'g1'},
        ],
      }),
      turns: [row('g1', {conversationId: 'g', open: true, input: {text: 'Hello'}}), ...turns],
    };
    assert.deepEqual(composerOf(state, {traceId: 'g1'}), {
      waiting: 'A turn is open',
      target: {kind: 'continues', conversationId: 'g', title: 'Hello', open: true},
    });
    assert.deepEqual(composerOf(state, {traceId: 'b'}), {target: continues});
  });

  it('waits while Spectra is not connected', () => {
    assert.deepEqual(composerOf({...stateOf(box), turns, connected: false}, {traceId: 'b'}), {
      waiting: 'Not connected to Spectra',
      target: continues,
    });
  });

  it("gives the box's reason when it cannot send to the agent", () => {
    assert.deepEqual(
      composerOf(stateOf({conversations: [], unavailable: 'No JSON-RPC interface.'}), {}),
      {unavailable: 'No JSON-RPC interface.', target: {kind: 'new'}},
    );
  });

  it("refuses to send while a header's variable is not set, keeping the field and naming the variable", () => {
    const refusing: MessageBoxState = {
      ...box,
      unavailable: "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment",
      unsetVariables: ['SPECTRA_AGENT_TOKEN'],
    };
    assert.deepEqual(composerOf({...stateOf(refusing), turns}, {traceId: 'b'}), {
      refused: ['SPECTRA_AGENT_TOKEN'],
      target: continues,
    });
  });
});
