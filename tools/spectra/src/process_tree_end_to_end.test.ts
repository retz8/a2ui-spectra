/**
 * The agent's process tree under `run`, from outside: the stub agent started
 * directly, through an npm script and through `uv run`, each started,
 * restarted and ended with no process of its tree left; and each of
 * Spectra's stops ending the tree, Spectra exiting with 128 plus the stop's
 * number. On Windows the tree is the binary's alone, and so is a batch file
 * such as npm's.
 */
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {constants, tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import type {AgentSnapshot} from './agent_supervisor.js';
import {freePort} from './testing/free_port.js';
import {getJson, postJson} from './testing/live_api.js';
import {descendantsOf, isRunning} from './testing/process_tree.js';
import {binary, SpectraProcess} from './testing/spectra_process.js';
import {stubScript} from './testing/stub_agent.js';

const windows = process.platform === 'win32';
const treeHandled = !windows || binary !== undefined;
const TIMEOUT = 90_000;

/** Spectra's stops on this platform: on Windows Ctrl-C, Ctrl-Break and the console window's close. */
const STOPS: NodeJS.Signals[] = windows
  ? ['SIGINT', 'SIGBREAK', 'SIGHUP']
  : ['SIGINT', 'SIGTERM', 'SIGHUP'];

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-tree-'));
  dirs.push(dir);
  return dir;
}

/** The ways the stub agent is launched: its command for its port, given the working directory. */
const LAUNCHES: Array<[string, (port: number, cwd: string) => string[]]> = [
  ['directly', port => [process.execPath, stubScript, '--port', String(port), '--canned-a2ui']],
  [
    'through an npm script',
    (port, cwd) => {
      writeFileSync(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'stub-agent',
          private: true,
          scripts: {agent: `node ${JSON.stringify(stubScript)} --port ${port} --canned-a2ui`},
        }),
      );
      return ['npm', 'run', 'agent'];
    },
  ],
  [
    'through uv run',
    port => [
      'uv',
      'run',
      '--no-project',
      'node',
      stubScript,
      '--port',
      String(port),
      '--canned-a2ui',
    ],
  ],
];

async function startRun(command: (port: number, cwd: string) => string[]) {
  const cwd = freshDir();
  const [agentPort, port, proxyPort, modelProxyPort, receiverPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const spectra = new SpectraProcess(
    [
      'run',
      '--agent-url',
      `http://localhost:${agentPort}`,
      '--port',
      String(port),
      '--proxy-port',
      String(proxyPort),
      '--model-proxy-port',
      String(modelProxyPort),
      '--receiver-port',
      String(receiverPort),
      '--no-open',
      '--',
      ...command(agentPort, cwd),
    ],
    cwd,
  );
  await spectra.waitFor(/The agent's card answered: Spectra stub agent\./, 60_000);
  return {spectra, base: `http://127.0.0.1:${port}`};
}

/**
 * Spectra's own process: on Windows the binary's first process below the
 * console helper, which runs under the venv's python.exe, itself a launcher
 * of the real Python, the agent's launcher being the binary again below it.
 */
function spectraPidOf(spectra: SpectraProcess): number {
  if (!windows) return spectra.pid!;
  const image = path.basename(binary!).toLowerCase();
  const found = descendantsOf(spectra.pid!).find(listed => listed.name.toLowerCase() === image);
  assert.ok(found, `No ${image} below the console helper.`);
  return found.pid;
}

/** The processes of the agent's tree: everything below Spectra. */
function agentTreeOf(spectra: SpectraProcess): number[] {
  return descendantsOf(spectraPidOf(spectra)).map(listed => listed.pid);
}

async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return check();
}

async function agentOf(base: string): Promise<AgentSnapshot> {
  return (await getJson<AgentSnapshot>(`${base}/api/agent`)).body;
}

describe(`the agent's process tree, ${binary ? 'the binary' : 'under Node'}`, () => {
  for (const [how, command] of LAUNCHES) {
    it(
      `starts, restarts and ends the stub agent launched ${how}, leaving none of its tree`,
      {timeout: TIMEOUT, skip: !treeHandled},
      async () => {
        const {spectra, base} = await startRun(command);
        const first = agentTreeOf(spectra);
        assert.ok(first.length > 0, `No process below Spectra:\n${spectra.output}`);
        const running = await agentOf(base);
        assert.equal(running.state.state, 'running');

        await postJson(`${base}/api/agent/restart`, {});
        await spectra.waitFor(/Restarting the agent: Restart was pressed in the viewer\./);
        const deadline = Date.now() + 60_000;
        let again = await agentOf(base);
        while (!(again.state.state === 'running' && again.state.seq > running.state.seq)) {
          assert.ok(Date.now() < deadline, `The agent did not run again:\n${spectra.output}`);
          await new Promise(resolve => setTimeout(resolve, 200));
          again = await agentOf(base);
        }
        assert.ok(
          await eventually(() => first.every(pid => !isRunning(pid))),
          `A process of the first launch's tree is left: ${first.filter(isRunning).join(', ')}`,
        );
        const second = agentTreeOf(spectra);
        assert.ok(second.length > 0);

        spectra.requestStop();
        await spectra.exited;
        assert.ok(
          await eventually(() => second.every(pid => !isRunning(pid))),
          `A process of the second launch's tree is left: ${second.filter(isRunning).join(', ')}`,
        );
      },
    );
  }

  for (const stop of STOPS) {
    it(
      `stops on ${stop}, ending the agent's tree, and exits with 128 plus its number`,
      {timeout: TIMEOUT, skip: !treeHandled},
      async () => {
        const {spectra} = await startRun(LAUNCHES[0][1]);
        const tree = agentTreeOf(spectra);
        assert.ok(tree.length > 0);
        spectra.signal(stop);
        const {code} = await spectra.exited;
        assert.equal(code, 128 + (constants.signals[stop] ?? 0), spectra.output);
        assert.ok(
          await eventually(() => tree.every(pid => !isRunning(pid))),
          `A process of the agent's tree is left: ${tree.filter(isRunning).join(', ')}`,
        );
      },
    );
  }
});
