import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  fixtureLines,
  liveRecordLine,
  liveTurnLine,
  nothingReachedLine,
  recordLine,
  summaryLine,
  turnLine,
} from './replay_report.js';

const miss = {
  code: 'REPLAY_MISS' as const,
  message:
    'A model call matched nothing in the record: POST /v1beta/models/gemini-3.6-flash:streamGenerateContent.',
};
const outcome = {
  code: 'OUTCOME_DIFFERS' as const,
  message: 'The turn ended failed; the record ended completed.',
};

describe('the result lines', () => {
  it('names a replayed turn by its number, its verdict and its reasons', () => {
    assert.equal(
      turnLine({turn: 1, turns: 2, verdict: 'passed', reasons: [], unconsumed: 0}),
      'turn 1 of 2: passed',
    );
    assert.equal(
      turnLine({turn: 2, turns: 2, verdict: 'failed', reasons: [miss, outcome], unconsumed: 0}),
      `turn 2 of 2: failed (${miss.message} ${outcome.message})`,
    );
  });

  it('counts the recorded calls a turn never asked for', () => {
    assert.equal(
      turnLine({turn: 1, turns: 1, verdict: 'passed', reasons: [], unconsumed: 1}),
      'turn 1 of 1: passed; 1 of the recorded calls was not asked for',
    );
    assert.equal(
      turnLine({turn: 1, turns: 1, verdict: 'failed', reasons: [miss], unconsumed: 2}),
      `turn 1 of 1: failed (${miss.message}); 2 of the recorded calls were not asked for`,
    );
  });

  it('says a turn was not sent, with the reason', () => {
    assert.equal(
      turnLine({turn: 2, turns: 3, notSent: 'The wire proxy could not be reached: ECONNREFUSED.'}),
      'turn 2 of 3: not sent (The wire proxy could not be reached: ECONNREFUSED.)',
    );
  });

  it('closes a record with its verdict and the folder its turns landed in', () => {
    assert.equal(
      recordLine('fixtures/greet-ada.json', 'passed', '.a2ui-spectra/turns/ctx-1'),
      'fixtures/greet-ada.json: passed; the replayed turns are in .a2ui-spectra/turns/ctx-1',
    );
    assert.equal(
      recordLine('fixtures/greet-ada.json', 'failed'),
      'fixtures/greet-ada.json: failed',
    );
  });

  it('names a live turn by its number and its outcome, where a verdict sits', () => {
    assert.equal(liveTurnLine({turn: 1, turns: 2, outcome: 'completed'}), 'turn 1 of 2: completed');
    assert.equal(
      liveTurnLine({turn: 2, turns: 2, outcome: 'waiting_for_input'}),
      'turn 2 of 2: waiting for input',
    );
    assert.equal(
      liveTurnLine({turn: 2, turns: 3, notSent: 'The agent exited with code 1.'}),
      'turn 2 of 3: not sent (The agent exited with code 1.)',
    );
  });

  it('closes a live record with how many of its turns were sent, and the folder they landed in', () => {
    assert.equal(
      liveRecordLine(
        'fixtures/greet-ada.json',
        [
          {turn: 1, turns: 2, outcome: 'completed'},
          {turn: 2, turns: 2, outcome: 'failed'},
        ],
        '.a2ui-spectra/turns/ctx-1',
      ),
      'fixtures/greet-ada.json: 2 of 2 turns sent; the replayed turns are in .a2ui-spectra/turns/ctx-1',
    );
    assert.equal(
      liveRecordLine('fixtures/greet-ada.json', [{turn: 1, turns: 1, notSent: 'Stopped.'}]),
      'fixtures/greet-ada.json: 0 of 1 turn sent',
    );
  });

  it('gives a passing fixture one line, with its unasked calls when any', () => {
    assert.deepEqual(
      fixtureLines({
        name: 'greet-ada',
        verdict: 'passed',
        turns: [
          {turn: 1, turns: 2, verdict: 'passed', reasons: [], unconsumed: 0},
          {turn: 2, turns: 2, verdict: 'passed', reasons: [], unconsumed: 0},
        ],
        folder: '.a2ui-spectra/turns/ctx-1',
      }),
      ['greet-ada: passed'],
    );
    assert.deepEqual(
      fixtureLines({
        name: 'nested/copy',
        verdict: 'passed',
        turns: [
          {turn: 1, turns: 2, verdict: 'passed', reasons: [], unconsumed: 1},
          {turn: 2, turns: 2, verdict: 'passed', reasons: [], unconsumed: 2},
        ],
        folder: '.a2ui-spectra/turns/ctx-2',
      }),
      ['nested/copy: passed; 3 of the recorded calls were not asked for'],
    );
  });

  it("puts a failed fixture's failing turns and its folder under its line", () => {
    assert.deepEqual(
      fixtureLines({
        name: 'greet-ada',
        verdict: 'failed',
        turns: [
          {turn: 1, turns: 3, verdict: 'passed', reasons: [], unconsumed: 0},
          {turn: 2, turns: 3, verdict: 'failed', reasons: [miss], unconsumed: 1},
          {turn: 3, turns: 3, notSent: 'Spectra is stopping.'},
        ],
        folder: '.a2ui-spectra/turns/ctx-1',
      }),
      [
        'greet-ada: failed',
        `  turn 2 of 3: failed (${miss.message}); 1 of the recorded calls was not asked for`,
        '  turn 3 of 3: not sent (Spectra is stopping.)',
        '  the replayed turns are in .a2ui-spectra/turns/ctx-1',
      ],
    );
  });

  it('fails a fixture that could not be replayed with its reason, and marks one not run', () => {
    assert.deepEqual(
      fixtureLines({name: 'notes', failed: 'The file is not JSON: Unexpected token.'}),
      ['notes: failed (The file is not JSON: Unexpected token.)'],
    );
    assert.deepEqual(
      fixtureLines({name: 'later', notRun: "The agent's process exited with code 1."}),
      ["later: not run (The agent's process exited with code 1.)"],
    );
  });

  it('sums the fixtures up', () => {
    const passed = {
      name: 'a',
      verdict: 'passed' as const,
      turns: [{turn: 1, turns: 1, verdict: 'passed' as const, reasons: [], unconsumed: 0}],
    };
    assert.equal(summaryLine([passed]), '1 fixture: 1 passed');
    assert.equal(
      summaryLine([passed, {name: 'b', failed: 'x'}, {name: 'c', verdict: 'failed', turns: []}]),
      '3 fixtures: 1 passed, 2 failed',
    );
    assert.equal(
      summaryLine([passed, {name: 'b', failed: 'x'}, {name: 'c', notRun: 'y'}]),
      '3 fixtures: 1 passed, 1 failed, 1 not run',
    );
    assert.equal(summaryLine([{name: 'b', failed: 'x'}]), '1 fixture: 0 passed, 1 failed');
  });

  it('warns when nothing reached the proxies', () => {
    assert.equal(
      nothingReachedLine('fixtures/greet-ada.json'),
      'No model call and no tool call reached the proxies while fixtures/greet-ada.json replayed, and none of its recorded calls was asked for. ' +
        'An agent already running needs the variables Spectra prints set in its shell, and an agent that hardcodes its model or tool endpoints is not redirected.',
    );
  });
});
