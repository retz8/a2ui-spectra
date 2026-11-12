import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedTurn, MessageBoxState} from '../api.ts';
import {agentNameOf, composerOf, liveStatusOf, refusalInputOf} from './selectors.ts';
import {NO_FIXTURES} from './fixtures.ts';
import type {SpectraState} from './spectra.ts';

function stateOf(
  box: MessageBoxState,
  parts: Partial<
    Pick<SpectraState, 'live' | 'closed' | 'records' | 'agent' | 'connected' | 'context'>
  > = {},
): SpectraState {
  return {
    loaded: true,
    turns: [],
    live: new Map(),
    closed: new Map(),
    records: new Map(),
    pending: new Map(),
    fixtures: NO_FIXTURES,
    replayTurns: new Map(),
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

describe('the composer while the box cannot send', () => {
  const box: MessageBoxState = {
    conversations: [{conversationId: 'c', turns: ['a']}],
    unavailable: "Can't send · the agent is down",
  };
  const turns: ListedTurn[] = [
    {traceId: 'a', conversationId: 'c', startTime: '2026-11-12T09:00:00.000Z', input: {text: 'Hi'}},
  ];

  it("carries the box's reason and keeps where it would send", () => {
    assert.deepEqual(composerOf({...stateOf(box), turns}, {traceId: 'a'}), {
      unavailable: "Can't send · the agent is down",
      target: {kind: 'continues', conversationId: 'c', title: 'Hi'},
    });
  });

  it("carries the reason beside a replay and an open turn, for the line to show the box's first", () => {
    const view = composerOf(
      {
        ...stateOf({
          ...box,
          conversations: [{conversationId: 'c', turns: ['a'], openTurn: 'a'}],
          replay: {source: 'x.json', mode: 'live', turn: 1, turns: 2},
        }),
        turns,
      },
      {traceId: 'a'},
    );
    assert.equal(view.unavailable, "Can't send · the agent is down");
    assert.equal(view.replaying, true);
    assert.equal(view.waiting, 'A turn is open');
  });

  it("leaves an unset header variable to its own form, and puts the box's other reason before it", () => {
    const unsetVariables = ['SPECTRA_AGENT_TOKEN'];
    const variable = composerOf(
      stateOf({
        conversations: [],
        unavailable: "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment",
        unsetVariables,
      }),
      {},
    );
    assert.deepEqual(variable, {refused: unsetVariables, target: {kind: 'new'}});
    const down = composerOf(
      stateOf({conversations: [], unavailable: "Can't send · the agent is down", unsetVariables}),
      {},
    );
    assert.equal(down.unavailable, "Can't send · the agent is down");
  });
});

describe("the live status's order", () => {
  const replay = {source: 'x.json', mode: 'live' as const, turn: 1, turns: 2};
  const down = {
    command: 'uv run .',
    state: {state: 'down' as const, seq: 4, exit: 'exited with code 1'},
    events: [],
  };

  it('puts not connected before everything', () => {
    const state = stateOf({conversations: [], replay}, {connected: false, agent: down});
    assert.deepEqual(liveStatusOf(state), {form: 'down'});
  });

  it("puts the agent's state, while it is not running, before a replay", () => {
    const box = {conversations: [], replay};
    assert.deepEqual(liveStatusOf(stateOf(box, {connected: true, agent: down})), {
      form: 'agentDown',
      exit: 'exited with code 1',
      title: "The agent's process exited with code 1.",
    });
    for (const [state, text] of [
      [{state: 'restarting', seq: 5}, 'Restarting the agent'],
      [{state: 'starting', seq: 6}, 'Starting the agent'],
      [
        {state: 'waiting', seq: 7, reason: 'connection refused'},
        "Waiting for the agent's card · connection refused",
      ],
    ] as const) {
      assert.deepEqual(liveStatusOf(stateOf(box, {connected: true, agent: {...down, state}})), {
        form: 'agentSpinning',
        text,
        title: text,
      });
    }
  });

  it('puts a replay before capturing, the agent running', () => {
    const running = {...down, state: {state: 'running' as const, seq: 8}};
    assert.equal(
      liveStatusOf(stateOf({conversations: [], replay}, {connected: true, agent: running})).form,
      'replaying',
    );
    assert.deepEqual(
      liveStatusOf(stateOf({conversations: []}, {connected: true, agent: running})),
      {
        form: 'capturing',
      },
    );
  });
});

describe("the agent's name", () => {
  const context = {
    agentUrl: 'http://localhost:10002',
    mode: 'run' as const,
    proxyAddress: 'http://127.0.0.1:9821',
    fixturesFolder: 'a2ui-spectra-fixtures',
  };
  const agent = {
    command: 'uv run .',
    state: {state: 'waiting' as const, seq: 2, reason: 'x'},
    events: [],
  };

  it('is the command, until a card has answered', () => {
    assert.deepEqual(agentNameOf({context, agent}), {text: 'uv run .', isCommand: true});
  });

  it("is the latest card's name once any card has answered, kept while the agent is not running", () => {
    assert.deepEqual(
      agentNameOf({
        context: {...context, agentName: 'Restaurant Agent', a2aVersions: ['0.3']},
        agent,
      }),
      {text: 'Restaurant Agent', isCommand: false},
    );
    // A card that names no agent has still answered.
    assert.deepEqual(agentNameOf({context: {...context, a2aVersions: ['0.3']}, agent}), {
      text: 'The agent',
      isCommand: false,
    });
  });

  it('is never a command under attach, where Spectra did not start the agent', () => {
    assert.deepEqual(agentNameOf({context: {...context, mode: 'attach'}}), {
      text: 'The agent',
      isCommand: false,
    });
  });
});

describe('what Re-run and the Replay rows are judged by', () => {
  it('reads the connection, the box’s reason, a replay and an open turn off the store', () => {
    assert.deepEqual(refusalInputOf(stateOf({conversations: []}), false), {
      connected: true,
      unwritten: false,
      replaying: false,
      turnOpen: false,
    });
    const busy = {
      ...stateOf(
        {
          conversations: [],
          unavailable: "Can't send · the agent is down",
          replay: {source: 'x.json', mode: 'recorded' as const, turn: 1, turns: 1},
        },
        {connected: false},
      ),
      turns: [{traceId: 'a', startTime: '2026-11-12T09:00:00.000Z', open: true as const}],
    };
    assert.deepEqual(refusalInputOf(busy, true), {
      connected: false,
      unwritten: true,
      boxReason: "Can't send · the agent is down",
      replaying: true,
      turnOpen: true,
    });
  });
});
