import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {describeExit, exitCodeOf} from './agent_process.js';

describe("the agent's exit", () => {
  it('becomes the exit code a shell would report', () => {
    assert.equal(exitCodeOf({code: 0, signal: null}), 0);
    assert.equal(exitCodeOf({code: 3, signal: null}), 3);
    assert.equal(exitCodeOf({code: null, signal: 'SIGTERM'}), 143);
    assert.equal(exitCodeOf({code: null, signal: 'SIGKILL'}), 137);
    assert.equal(exitCodeOf({code: null, signal: null, error: new Error('ENOENT')}), 127);
  });

  it('is described in words', () => {
    assert.equal(describeExit({code: 3, signal: null}), 'exited with code 3');
    assert.equal(describeExit({code: null, signal: 'SIGTERM'}), 'was ended by SIGTERM');
    assert.equal(
      describeExit({code: null, signal: null, error: new Error('spawn x ENOENT')}),
      'could not start: spawn x ENOENT',
    );
  });
});
