import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {describeExit, forceKilledLine, startAgentProcess} from './agent_process.js';

const posix = process.platform !== 'win32';

describe("the agent's exit", () => {
  it('is described in words', () => {
    assert.equal(describeExit({code: 3, signal: null}), 'exited with code 3');
    assert.equal(describeExit({code: null, signal: 'SIGTERM'}), 'was ended by SIGTERM');
    assert.equal(
      describeExit({code: null, signal: null, error: new Error('spawn x ENOENT')}),
      'could not start: spawn x ENOENT',
    );
  });
});

describe("the agent's stop", () => {
  it('says when the grace ran out, in seconds', () => {
    assert.equal(
      forceKilledLine(),
      "The agent's process did not stop within 10 seconds, so it was force-killed.",
    );
    assert.equal(
      forceKilledLine(1000),
      "The agent's process did not stop within 1 second, so it was force-killed.",
    );
  });

  it('reports no force-kill for a process that stops on the stop signal', async () => {
    const agent = startAgentProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      output: 'stderr',
    });
    assert.deepEqual(await agent.stop(), {forceKilled: false});
    assert.equal((await agent.exited).signal, 'SIGTERM');
  });

  it('force-kills a process that outlives the grace, and reports it', {skip: !posix}, async () => {
    const agent = startAgentProcess(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => {}); process.stdout.write('up\\n'); setInterval(() => {}, 1000)",
      ],
      {graceMs: 300, output: 'stderr'},
    );
    // The handler is in place once the process has written.
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(await agent.stop(), {forceKilled: true});
    assert.equal((await agent.exited).signal, 'SIGKILL');
  });

  it('reports no force-kill for a command that could not start', async () => {
    const agent = startAgentProcess('a2ui-spectra-test-no-such-command', [], {output: 'stderr'});
    assert.ok((await agent.exited).error);
    assert.deepEqual(await agent.stop(), {forceKilled: false});
  });
});
