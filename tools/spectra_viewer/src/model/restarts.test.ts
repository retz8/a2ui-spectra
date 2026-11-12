import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {AgentSessionEvent} from '../api.ts';
import {restartDividersOf, showsRestarts} from './restarts.ts';

const at = (minute: number) => `2026-11-12T09:${String(minute).padStart(2, '0')}:00.000Z`;
const row = (traceId: string, minute: number) => ({traceId, startTime: at(minute)});

let seq = 0;
const save = (minute: number, file = 'prompt_builder.py'): AgentSessionEvent => ({
  type: 'agent_restarted',
  seq: ++seq,
  time: at(minute),
  cause: {kind: 'save', file},
});
const press = (minute: number): AgentSessionEvent => ({
  type: 'agent_restarted',
  seq: ++seq,
  time: at(minute),
  cause: {kind: 'press'},
});
const exit = (minute: number, line = 'exited with code 1'): AgentSessionEvent => ({
  type: 'agent_exited',
  seq: ++seq,
  time: at(minute),
  exit: line,
});

/** Each divider as its text and the row it sits above, in the list's order. */
const placed = (events: AgentSessionEvent[], rows: ReturnType<typeof row>[]) =>
  restartDividersOf(events, rows).map(({text, above}) => [text, above ?? 'bottom']);

describe("the turn list's restart dividers", () => {
  // The list reads down newest first: a conversation's three turns, then an older conversation's.
  const rows = [row('c', 42), row('b', 40), row('a', 39), row('old', 5)];

  it('words a save, a press and a death', () => {
    assert.deepEqual(placed([save(41)], rows), [['Restarted · prompt_builder.py changed', 'b']]);
    assert.deepEqual(placed([press(41)], rows), [['Restarted · Restart pressed', 'b']]);
    assert.deepEqual(placed([exit(41)], rows), [['Agent exited with code 1', 'b']]);
    assert.deepEqual(placed([exit(41, 'was ended by SIGTERM')], rows), [
      ['Agent was ended by SIGTERM', 'b'],
    ]);
  });

  it('sits directly above the first turn, reading down, that started before its restart', () => {
    // Between two turn rows of a conversation, between two conversations, and above the newest turn.
    assert.deepEqual(placed([save(41)], rows)[0][1], 'b');
    assert.deepEqual(placed([save(20)], rows)[0][1], 'old');
    assert.deepEqual(placed([save(50)], rows)[0][1], 'c');
  });

  it('leaves every turn above a divider one that ran after its restart', () => {
    // A conversation whose newest turn orders it first holds an older turn than the next conversation's.
    const mixed = [row('a2', 30), row('a1', 10), row('b1', 20)];
    for (const minute of [5, 15, 25, 35]) {
      const [[, above]] = placed([press(minute)], mixed);
      const index = above === 'bottom' ? mixed.length : mixed.findIndex(r => r.traceId === above);
      for (const turn of mixed.slice(0, index)) {
        assert.ok(turn.startTime >= at(minute), `${turn.traceId} above the divider of ${minute}`);
      }
    }
  });

  it("sits at the list's bottom with no earlier turn in the list", () => {
    assert.deepEqual(placed([save(2)], rows), [
      ['Restarted · prompt_builder.py changed', 'bottom'],
    ]);
  });

  it('keeps several dividers in their order by time, the newest first', () => {
    // A save, the agent's death after it, then a press: the canvas's crash and its Restart.
    assert.deepEqual(placed([save(43), exit(44), press(45)], rows), [
      ['Restarted · Restart pressed', 'c'],
      ['Agent exited with code 1', 'c'],
      ['Restarted · prompt_builder.py changed', 'c'],
    ]);
    // Out of order in, in order out.
    assert.deepEqual(
      placed([press(45), save(41), exit(44)], rows).map(([text]) => text),
      [
        'Restarted · Restart pressed',
        'Agent exited with code 1',
        'Restarted · prompt_builder.py changed',
      ],
    );
  });

  it('draws a run of saves as one row, naming the count and the latest file', () => {
    assert.deepEqual(
      placed(
        [save(43, 'agent.py'), save(44), save(45, 'tools.py'), save(46), save(47), save(48)],
        rows,
      ),
      [['Restarted 6 times · prompt_builder.py changed last', 'c']],
    );
  });

  it('ends a run at a turn, and at any other event', () => {
    // A turn started between the second and the third save.
    assert.deepEqual(placed([save(40), save(41), save(43)], [row('c', 42), row('a', 39)]), [
      ['Restarted · prompt_builder.py changed', 'c'],
      ['Restarted 2 times · prompt_builder.py changed last', 'a'],
    ]);
    assert.deepEqual(placed([save(43), press(44), save(45), exit(46), save(47)], rows), [
      ['Restarted · prompt_builder.py changed', 'c'],
      ['Agent exited with code 1', 'c'],
      ['Restarted · prompt_builder.py changed', 'c'],
      ['Restarted · Restart pressed', 'c'],
      ['Restarted · prompt_builder.py changed', 'c'],
    ]);
  });

  it('gives a press and a death their own row, however many', () => {
    assert.equal(placed([press(43), press(44), exit(45), exit(46)], rows).length, 4);
  });

  it('draws none with no turn row', () => {
    assert.deepEqual(restartDividersOf([save(41), press(42)], []), []);
  });

  it('draws one above turns from earlier runs only', () => {
    assert.deepEqual(placed([press(41)], [row('old', 5)]), [
      ['Restarted · Restart pressed', 'old'],
    ]);
  });

  it('keys each row by its first event, so it holds as a run grows', () => {
    const first = save(43);
    const one = restartDividersOf([first], rows);
    const two = restartDividersOf([first, save(44)], rows);
    assert.equal(one[0].key, two[0].key);
  });
});

describe('whether the list draws its dividers', () => {
  it('does when it shows the connected agent or every agent, and not another agent', () => {
    assert.equal(showsRestarts({name: 'Restaurant Agent'}, 'Restaurant Agent'), true);
    assert.equal(showsRestarts('all', 'Restaurant Agent'), true);
    assert.equal(showsRestarts('all', undefined), true);
    assert.equal(showsRestarts({name: 'Another agent'}, 'Restaurant Agent'), false);
  });
});
