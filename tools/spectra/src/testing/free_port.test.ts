import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {describe, it} from 'node:test';

import {freePort} from './free_port.js';

/**
 * The lowest port a system hands to an outgoing connection or to a listener
 * on port 0, at its default setting: 32768 on Linux, 49152 on macOS.
 */
const LOWEST_SYSTEM_PICKED_PORT = 32768;

const PROCESSES = 6;
const PORTS_EACH = 150;

/** A process that takes its ports at once, prints them, and stays up until its input closes. */
function startTaker(): {child: ChildProcess; ports: Promise<number[]>} {
  const script = `
    import {freePort} from ${JSON.stringify(new URL('./free_port.js', import.meta.url).href)};
    const ports = [];
    for (let i = 0; i < ${PORTS_EACH}; i++) ports.push(await freePort());
    console.log(JSON.stringify(ports));
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let output = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  const ports = new Promise<number[]>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`A taker exited with code ${code}: ${output}`)));
    child.stdout?.on('data', () => {
      if (output.endsWith('\n')) resolve(JSON.parse(output) as number[]);
    });
  });
  return {child, ports};
}

describe('freePort', () => {
  it('gives a port the system hands to no outgoing connection and to no listener on port 0', async () => {
    const port = await freePort();
    assert.ok(port < LOWEST_SYSTEM_PICKED_PORT, `${port} is a port the system picks`);
  });

  it('gives callers that ask at once a port each', async () => {
    const ports = await Promise.all(Array.from({length: 8}, () => freePort()));
    assert.equal(new Set(ports).size, ports.length, `repeated among ${ports.join(', ')}`);
  });

  it('gives no port twice, within a process or among processes running at once', async () => {
    const takers = Array.from({length: PROCESSES}, () => startTaker());
    try {
      const ports = (await Promise.all(takers.map(taker => taker.ports))).flat();
      assert.equal(ports.length, PROCESSES * PORTS_EACH);
      const repeated = ports.filter((port, index) => ports.indexOf(port) !== index);
      assert.deepEqual([...new Set(repeated)], []);
    } finally {
      for (const {child} of takers) {
        child.removeAllListeners('exit');
        child.stdin?.end();
      }
      await Promise.all(
        takers.map(({child}) => (child.exitCode === null ? once(child, 'exit') : undefined)),
      );
    }
  });

  it('passes over a port something else listens on', async () => {
    const before = await freePort();
    const other = createServer();
    const listening = await new Promise<boolean>(resolve => {
      other.once('error', () => resolve(false));
      other.listen(before + 1, '127.0.0.1', () => resolve(true));
    });
    try {
      assert.notEqual(await freePort(), before + 1);
    } finally {
      if (listening) await new Promise(resolve => other.close(resolve));
    }
  });
});
