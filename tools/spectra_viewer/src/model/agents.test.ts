import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  agentChoicesOf,
  agentLabel,
  agentOfSelection,
  agentShownOf,
  offersPicker,
  turnsOfAgent,
} from './agents.ts';

/** Turns listed newest first, as the store lists them. */
const turns = [
  {traceId: 'a', agentName: 'CircleCI'},
  {traceId: 'b', agentName: 'Linear'},
  {traceId: 'c', agentName: 'CircleCI'},
  {traceId: 'd', agentName: 'Restaurant Agent'},
  {traceId: 'e'},
];

describe('agentShownOf', () => {
  it('shows the connected agent until another is picked', () => {
    assert.deepEqual(agentShownOf(undefined, 'Linear'), {name: 'Linear'});
    assert.deepEqual(agentShownOf({name: 'CircleCI'}, 'Linear'), {name: 'CircleCI'});
    assert.equal(agentShownOf('all', 'Linear'), 'all');
  });

  it('shows every agent when the connected agent names none', () => {
    assert.equal(agentShownOf(undefined, undefined), 'all');
  });
});

describe('turnsOfAgent', () => {
  it('keeps the turns of the agent shown, by the name on each turn', () => {
    assert.deepEqual(
      turnsOfAgent(turns, {name: 'CircleCI'}).map(turn => turn.traceId),
      ['a', 'c'],
    );
  });

  it('keeps every turn, one that names no agent among them, for every agent', () => {
    assert.equal(turnsOfAgent(turns, 'all').length, 5);
  });
});

describe('agentChoicesOf', () => {
  it('lists the connected agent first, then the others by their newest turn, with their counts', () => {
    assert.deepEqual(agentChoicesOf(turns, 'Linear'), [
      {name: 'Linear', turns: 1, connected: true},
      {name: 'CircleCI', turns: 2, connected: false},
      {name: 'Restaurant Agent', turns: 1, connected: false},
    ]);
  });

  it('lists the connected agent with no turns yet', () => {
    assert.deepEqual(agentChoicesOf([{traceId: 'a', agentName: 'CircleCI'}], 'Linear'), [
      {name: 'Linear', turns: 0, connected: true},
      {name: 'CircleCI', turns: 1, connected: false},
    ]);
  });
});

describe('offersPicker', () => {
  it('offers the picker when the turns are of more than one agent', () => {
    assert.equal(offersPicker(turns, 'Linear'), true);
  });

  it('offers none when every turn is the connected agent’s', () => {
    assert.equal(offersPicker([{traceId: 'b', agentName: 'Linear'}], 'Linear'), false);
    assert.equal(offersPicker([], 'Linear'), false);
  });

  it('offers it for a turn that names no agent, which only every agent shows', () => {
    assert.equal(
      offersPicker([{traceId: 'b', agentName: 'Linear'}, {traceId: 'e'}], 'Linear'),
      true,
    );
  });

  it('offers it when the connected agent has no turns and another has', () => {
    assert.equal(offersPicker([{traceId: 'a', agentName: 'CircleCI'}], 'Linear'), true);
  });
});

describe('agentOfSelection', () => {
  it('names the agent of a selected turn the list does not show', () => {
    assert.deepEqual(agentOfSelection(turns, {name: 'Linear'}, 'a'), {name: 'CircleCI'});
  });

  it('shows every agent for a selected turn that names none', () => {
    assert.equal(agentOfSelection(turns, {name: 'Linear'}, 'e'), 'all');
  });

  it('names none when the list shows the turn, or does not hold it', () => {
    assert.equal(agentOfSelection(turns, {name: 'Linear'}, 'b'), undefined);
    assert.equal(agentOfSelection(turns, 'all', 'a'), undefined);
    assert.equal(agentOfSelection(turns, {name: 'Linear'}, 'z'), undefined);
  });
});

describe('agentLabel', () => {
  it('names the agent shown', () => {
    assert.equal(agentLabel({name: 'Linear'}), 'Linear');
    assert.equal(agentLabel('all'), 'All agents');
  });
});
