import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {AgentSessionEvent, AgentSnapshot, LogEntry} from '../api.ts';
import {
  agentHeard,
  agentRead,
  lastSeqOf,
  logsHeard,
  logsRead,
  seqOf,
  sessionEventOf,
} from './agent.ts';

const restarted = (seq: number): AgentSessionEvent => ({
  type: 'agent_restarted',
  seq,
  time: '2026-11-12T09:00:00.000Z',
  cause: {kind: 'press'},
});
const exited = (seq: number): AgentSessionEvent => ({
  type: 'agent_exited',
  seq,
  time: '2026-11-12T09:00:01.000Z',
  exit: 'exited with code 1',
});

const snapshot: AgentSnapshot = {
  command: 'uv run .',
  state: {state: 'running', seq: 3},
  events: [restarted(1)],
};

describe("the agent's process", () => {
  it('is the route’s answer, with what the stream said since applied on top', () => {
    assert.deepEqual(agentRead(snapshot, []), {
      command: 'uv run .',
      state: {state: 'running', seq: 3},
      events: [restarted(1)],
    });
    const read = agentRead(snapshot, [
      {state: {state: 'restarting', seq: 5}},
      {event: restarted(4)},
    ]);
    assert.deepEqual(read.state, {state: 'restarting', seq: 5});
    assert.deepEqual(read.events, [restarted(1), restarted(4)]);
  });

  it('merges what the route and the stream both gave by their numbers', () => {
    const read = agentRead(snapshot, [{state: {state: 'starting', seq: 2}}, {event: restarted(1)}]);
    // The stream's older state does not replace the route's, and its event is held once.
    assert.deepEqual(read.state, {state: 'running', seq: 3});
    assert.deepEqual(read.events, [restarted(1)]);
  });

  it('takes a state with a higher number, and an event in its order', () => {
    const agent = agentRead(snapshot, []);
    const down = agentHeard(agent, {state: {state: 'down', seq: 7, exit: 'exited with code 1'}});
    assert.deepEqual(down.state, {state: 'down', seq: 7, exit: 'exited with code 1'});
    const withEvents = [exited(6), restarted(4)].reduce(
      (held, event) => agentHeard(held, {event}),
      down,
    );
    assert.deepEqual(
      withEvents.events.map(event => event.seq),
      [1, 4, 6],
    );
    assert.equal(agentHeard(down, {state: {state: 'running', seq: 3}}), down);
  });

  it('numbers what the route gave and what the stream said', () => {
    assert.equal(lastSeqOf(snapshot), 3);
    assert.equal(lastSeqOf({...snapshot, events: [restarted(1), exited(9)]}), 9);
    assert.equal(seqOf({state: {state: 'running', seq: 3}}), 3);
    assert.equal(seqOf({event: exited(6)}), 6);
  });

  it("gives the stream's event its type", () => {
    assert.deepEqual(
      sessionEventOf('agent_exited', {seq: 6, time: 't', exit: 'exited with code 1'}),
      {type: 'agent_exited', seq: 6, time: 't', exit: 'exited with code 1'},
    );
  });
});

describe("the agent's output", () => {
  const line = (n: number): LogEntry => ({
    n,
    time: '2026-11-12T09:00:00.000Z',
    type: 'line',
    stream: 'stderr',
    text: `line ${n}`,
  });
  const start: LogEntry = {
    n: 1,
    time: '2026-11-12T09:00:00.000Z',
    type: 'started',
    command: 'uv run .',
  };
  const held = logsRead({entries: [start, line(2), line(3)], lines: 2, cap: 1000}, []);

  it('is the route’s buffer, its lines counted and its cap kept', () => {
    assert.deepEqual(held, {entries: [start, line(2), line(3)], lines: 2, cap: 1000});
  });

  it('merges what the route and the stream both gave by number', () => {
    const read = logsRead({entries: [start, line(2), line(3)], lines: 2, cap: 1000}, [
      {entries: [line(3)], oldest: 1},
      {entries: [line(4), line(5)], oldest: 1},
    ]);
    assert.deepEqual(
      read.entries.map(entry => entry.n),
      [1, 2, 3, 4, 5],
    );
    assert.equal(read.lines, 4);
  });

  it('adds what one event carries, and drops everything below the oldest number still held', () => {
    const next = logsHeard(held, {entries: [line(4)], oldest: 3});
    assert.deepEqual(
      next.entries.map(entry => entry.n),
      [3, 4],
    );
    assert.equal(next.lines, 2);
    assert.equal(next.cap, 1000);
  });

  it('never applies the cap itself: what the event does not say has left is kept', () => {
    const many = Array.from({length: 1500}, (_, index) => line(index + 4));
    const next = logsHeard(held, {entries: many, oldest: 1});
    assert.equal(next.entries.length, 1503);
    assert.equal(next.lines, 1502);
  });
});
