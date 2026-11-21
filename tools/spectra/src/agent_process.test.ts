import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {describeExit, forceKilledLine, startAgentProcess} from './agent_process.js';
import {freePort} from './testing/free_port.js';
import {binary, SpectraProcess, STOPPED_CODE} from './testing/spectra_process.js';

const posix = process.platform !== 'win32';

/**
 * On Windows the agent's tree is the compiled binary's alone: there the stop
 * cases run the script as the agent under the binary's `run`, ask Spectra to
 * stop, and read what it said; the script writes its pid to the file named
 * by its first argument.
 */
async function stoppedUnderTheBinary(
  script: string,
): Promise<{output: string; code: number | null; pid: number}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-stop-'));
  try {
    const pidFile = path.join(dir, 'pid');
    const spectra = new SpectraProcess([
      'run',
      '--agent-url',
      `http://127.0.0.1:${await freePort()}`,
      '--port',
      String(await freePort()),
      '--proxy-port',
      String(await freePort()),
      '--model-proxy-port',
      String(await freePort()),
      '--receiver-port',
      String(await freePort()),
      '--no-open',
      '--',
      process.execPath,
      '-e',
      `require('fs').writeFileSync(process.argv[1], String(process.pid)); ${script}`,
      pidFile,
    ]);
    await spectra.waitFor(/Waiting for the agent's card/);
    const deadline = Date.now() + 10_000;
    while (!existsSync(pidFile) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const pid = Number(readFileSync(pidFile, 'utf8'));
    spectra.requestStop();
    const {code} = await spectra.exited;
    return {output: spectra.output, code, pid};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the agent's exit", () => {
  it('is described in words', () => {
    assert.equal(describeExit({code: 3, signal: null}), 'exited with code 3');
    assert.equal(describeExit({code: null, signal: 'SIGTERM'}), 'was ended by SIGTERM');
    assert.equal(
      describeExit({code: null, signal: null, error: new Error('spawn x ENOENT')}),
      'could not start: spawn x ENOENT',
    );
  });

  it('is described in words for an end Spectra caused on Windows, with no signal name', () => {
    assert.equal(
      describeExit({code: 0, signal: null, ending: {kind: 'asked'}}),
      'ended when Spectra asked it to stop',
    );
    assert.equal(
      describeExit({code: 1, signal: null, ending: {kind: 'ended', afterMs: 10_000}}),
      'was ended by Spectra after 10 seconds',
    );
    assert.equal(
      describeExit({code: 1, signal: null, ending: {kind: 'ended'}}),
      'was ended by Spectra',
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

  it(
    'reports no force-kill for a process that stops on the stop signal',
    {skip: !posix && binary === undefined, timeout: 30_000},
    async () => {
      if (!posix) {
        const {output, code, pid} = await stoppedUnderTheBinary('setInterval(() => {}, 1000)');
        assert.equal(code, STOPPED_CODE, output);
        assert.doesNotMatch(output, /force-killed/);
        assert.equal(isAlive(pid), false);
        return;
      }
      const agent = startAgentProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        output: 'stderr',
      });
      assert.deepEqual(await agent.stop(), {forceKilled: false});
      assert.equal((await agent.exited).signal, 'SIGTERM');
    },
  );

  it(
    'force-kills a process that outlives the grace, and reports it',
    {skip: !posix && binary === undefined, timeout: 30_000},
    async () => {
      if (!posix) {
        // The binary's grace is the ten seconds a stop waits.
        const {output, code, pid} = await stoppedUnderTheBinary(
          "process.on('SIGBREAK', () => {}); setInterval(() => {}, 1000)",
        );
        assert.equal(code, STOPPED_CODE, output);
        assert.match(output, new RegExp(forceKilledLine().replace(/[.]/g, '\\.')));
        assert.equal(isAlive(pid), false);
        return;
      }
      let up: () => void = () => {};
      const written = new Promise<void>(resolve => (up = resolve));
      const agent = startAgentProcess(
        process.execPath,
        [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write('up\\n'); setInterval(() => {}, 1000)",
        ],
        {
          graceMs: 300,
          onOutput: (stream, chunk) => stream === 'stdout' && chunk.includes('up') && up(),
        },
      );
      // The handler is in place once the process has written.
      await written;
      assert.deepEqual(await agent.stop(), {forceKilled: true});
      assert.equal((await agent.exited).signal, 'SIGKILL');
    },
  );

  it('reports no force-kill for a command that could not start', async () => {
    const agent = startAgentProcess('a2ui-spectra-test-no-such-command', [], {output: 'stderr'});
    assert.ok((await agent.exited).error);
    assert.deepEqual(await agent.stop(), {forceKilled: false});
  });
});
