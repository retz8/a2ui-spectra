import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  agentStatusOf,
  boxNoteOf,
  composerReasonOf,
  firstScreenFormOf,
  refusalNoteOf,
  restartEnabled,
  restartTooltipOf,
} from './dev_loop.ts';

describe("the box's reason as a note", () => {
  it('drops “Can’t send · ” and capitalises what follows', () => {
    for (const [line, note] of [
      ["Can't send · the agent is starting", 'The agent is starting'],
      ["Can't send · waiting for the agent's card", "Waiting for the agent's card"],
      ["Can't send · the agent is restarting", 'The agent is restarting'],
      ["Can't send · the agent is down", 'The agent is down'],
      [
        "Can't send · the agent's card lists no interface to reach it at",
        "The agent's card lists no interface to reach it at",
      ],
      [
        "Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC",
        "The agent's card lists no A2A JSON-RPC interface, only GRPC",
      ],
      [
        "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment",
        "SPECTRA_AGENT_TOKEN is not set in Spectra's environment",
      ],
    ]) {
      assert.equal(boxNoteOf(line), note);
    }
  });

  it('shows whole the one line that does not start so', () => {
    const line =
      'The message box cannot send to this agent: its card lists A2A JSON-RPC only at version 0.2, ' +
      'and the box speaks A2A 0.3 and 1.0. Hosts pointed at the wire proxy are not affected.';
    assert.equal(boxNoteOf(line), line);
  });
});

describe("the composer's reason", () => {
  it("is the box's line, whatever the reason", () => {
    assert.equal(composerReasonOf({}), undefined);
    assert.equal(
      composerReasonOf({unavailable: "Can't send · the agent is down"}),
      "Can't send · the agent is down",
    );
  });

  it('leaves the unset header variable to its own form, and comes first when both apply', () => {
    const unsetVariables = ['SPECTRA_AGENT_TOKEN'];
    assert.equal(
      composerReasonOf({
        unavailable: "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment",
        unsetVariables,
      }),
      undefined,
    );
    assert.equal(
      composerReasonOf({unavailable: "Can't send · the agent is down", unsetVariables}),
      "Can't send · the agent is down",
    );
  });
});

describe('the note on Re-run and on the Replay rows', () => {
  const on = {connected: true, unwritten: false, replaying: false, turnOpen: false};
  const all = {
    connected: false,
    unwritten: true,
    boxReason: "Can't send · the agent is down",
    replaying: true,
    turnOpen: true,
  };

  it('is none when nothing refuses', () => {
    assert.equal(refusalNoteOf(on), undefined);
  });

  it('is the first that applies: not connected, held in memory, the box’s reason, a replay, an open turn', () => {
    assert.equal(refusalNoteOf(all), 'Not connected to Spectra');
    assert.equal(refusalNoteOf({...all, connected: true}), 'Save it as a fixture first');
    assert.equal(refusalNoteOf({...all, connected: true, unwritten: false}), 'The agent is down');
    assert.equal(refusalNoteOf({...on, replaying: true, turnOpen: true}), 'A replay is running');
    assert.equal(refusalNoteOf({...on, turnOpen: true}), 'A turn is open');
  });

  it("is off whenever the message box cannot send, with the box's reason", () => {
    assert.equal(
      refusalNoteOf({...on, boxReason: "Can't send · waiting for the agent's card"}),
      "Waiting for the agent's card",
    );
  });
});

describe("Restart's tooltip", () => {
  it('says what the press will end', () => {
    assert.equal(restartTooltipOf({connected: true, openTurns: 0}), 'Restart the agent');
    assert.equal(
      restartTooltipOf({connected: true, openTurns: 1}),
      'Restart the agent · ends the open turn',
    );
    assert.equal(
      restartTooltipOf({connected: true, openTurns: 2}),
      'Restart the agent · ends the 2 open turns',
    );
  });

  it('counts the turns a replay has not sent as its total less the turn it is on', () => {
    assert.equal(
      restartTooltipOf({connected: true, openTurns: 1, replay: {turn: 1, turns: 2}}),
      'Restart the agent · stops the replay, 1 turn not sent',
    );
    // Before its first turn opens, every turn.
    assert.equal(
      restartTooltipOf({connected: true, openTurns: 0, replay: {turn: 0, turns: 3}}),
      'Restart the agent · stops the replay, 3 turns not sent',
    );
    assert.equal(
      restartTooltipOf({connected: true, openTurns: 1, replay: {turn: 2, turns: 2}}),
      'Restart the agent · stops the replay',
    );
  });

  it('says the page is not connected, whatever is open', () => {
    assert.equal(
      restartTooltipOf({connected: false, openTurns: 2, replay: {turn: 1, turns: 2}}),
      'Restart the agent · not connected to Spectra',
    );
  });
});

describe('Restart', () => {
  it('is off in the restarting state alone, and during every card wait it is on', () => {
    for (const state of ['starting', 'waiting', 'running', 'down'] as const) {
      assert.equal(restartEnabled(true, state), true, state);
    }
    assert.equal(restartEnabled(true, 'restarting'), false);
  });

  it('is off while the page is not connected', () => {
    assert.equal(restartEnabled(false, 'running'), false);
    assert.equal(restartEnabled(false, 'down'), false);
  });
});

describe("the first screen's form", () => {
  it("is chosen by the agent's state alone", () => {
    assert.equal(firstScreenFormOf('running'), 'ready');
    assert.equal(firstScreenFormOf('starting'), 'notReady');
    assert.equal(firstScreenFormOf('waiting'), 'notReady');
    assert.equal(firstScreenFormOf('restarting'), 'notReady');
    assert.equal(firstScreenFormOf('down'), 'down');
  });
});

describe("the agent's state in the live status", () => {
  it('is nothing while the agent runs', () => {
    assert.equal(agentStatusOf({state: 'running', seq: 3}), undefined);
  });

  it('spins while starting, waiting with the reason, and restarting', () => {
    assert.deepEqual(agentStatusOf({state: 'starting', seq: 1}), {
      form: 'spinning',
      text: 'Starting the agent',
      title: 'Starting the agent',
    });
    assert.deepEqual(agentStatusOf({state: 'restarting', seq: 4}), {
      form: 'spinning',
      text: 'Restarting the agent',
      title: 'Restarting the agent',
    });
  });

  it("carries the terminal's wait line whole as the waiting form's tooltip", () => {
    const line =
      "Waiting for the agent's card at http://localhost:10002/.well-known/agent-card.json: " +
      "connection refused. Change the agent's URL with --agent-url, or agent.url in the config file.";
    assert.deepEqual(
      agentStatusOf({state: 'waiting', seq: 2, reason: 'connection refused', line}),
      {form: 'spinning', text: "Waiting for the agent's card · connection refused", title: line},
    );
    // A state that carries no line keeps its own words.
    assert.deepEqual(agentStatusOf({state: 'waiting', seq: 2, reason: 'connection refused'}), {
      form: 'spinning',
      text: "Waiting for the agent's card · connection refused",
      title: "Waiting for the agent's card · connection refused",
    });
  });

  it("carries the exit line while down, the terminal's sentence as its tooltip", () => {
    assert.deepEqual(agentStatusOf({state: 'down', seq: 5, exit: 'exited with code 1'}), {
      form: 'down',
      exit: 'exited with code 1',
      title: "The agent's process exited with code 1.",
    });
  });
});
