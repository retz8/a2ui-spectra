/**
 * The stand-in registries, `scripts/stand_ins.mjs`, outside a release run: refusing to start
 * while another process holds their ports, which would otherwise answer in their place.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/stand_ins.mjs', import.meta.url));

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

/**
 * A server answering every request `200`, as stand-ins left running from before do; none when
 * another process holds the port already, which holds it as well.
 */
async function holdPort(port: number): Promise<Server | undefined> {
  const server = createServer((_request, response) => response.end('{}'));
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve(undefined) : reject(error),
    );
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Runs the script, the test's servers answering meanwhile. */
async function standIns(
  ...args: string[]
): Promise<{status: number | null; stdout: string; stderr: string}> {
  const child = spawn(process.execPath, [SCRIPT, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const timer = setTimeout(() => child.kill(), 60_000);
  const status = await new Promise<number | null>(resolve => child.on('close', resolve));
  clearTimeout(timer);
  return {status, stdout, stderr};
}

describe('the stand-in registries', () => {
  it('refuse to serve while other processes hold their ports, naming each port', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spectra-stand-ins-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'npm', 'storage'), {recursive: true});
    mkdirSync(path.join(dir, 'pypi', 'packages'), {recursive: true});
    const held = [await holdPort(4873), await holdPort(8080)];
    try {
      const result = await standIns('serve', dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /^stand-ins serve: .*4873.*8080.*$/m);
      assert.equal(result.stdout, '');
      assert.ok(!existsSync(path.join(dir, 'pids.json')), 'no stand-in is started');
    } finally {
      await standIns('stop', dir);
      for (const server of held) {
        if (server !== undefined) await new Promise(resolve => server.close(resolve));
      }
    }
  });
});
