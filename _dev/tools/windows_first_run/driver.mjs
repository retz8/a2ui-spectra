// The first run on windows-latest: the seven points of the sub-task 10.2
// spec's decision 16, measured before anything is built on them. Run with
// Node from the repository root after the probe is compiled:
//   node _dev/tools/windows_first_run/driver.mjs
// PROBE_EXE names the compiled probe, PYTHON the Python to run the helper and
// the Python agent with. It prints one block per point, as measured.
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = process.env.PROBE_EXE;
const python = process.env.PYTHON ?? 'python';
const helper = path.resolve(here, '../../../tools/spectra/src/testing/windows_console.py');
const nodeAgent = path.join(here, 'agent.mjs');
const pythonAgent = path.join(here, 'agent.py');

const driverSignals = [];
for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP']) {
  process.on(signal, () => driverSignals.push(signal));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const print = (title, value) => console.log(`\n### ${title}\n${JSON.stringify(value, null, 2)}`);

/** The image names of running processes, by id. */
function images() {
  const names = new Map();
  for (const line of execFileSync('tasklist', ['/fo', 'csv', '/nh'], {encoding: 'utf8'}).split(/\r?\n/)) {
    const cells = line.match(/"([^"]*)"/g)?.map(cell => cell.slice(1, -1));
    if (cells !== undefined && cells.length > 1) names.set(Number(cells[1]), cells[0]);
  }
  return names;
}
const named = pids => {
  const names = images();
  return pids.map(pid => `${pid} ${names.get(pid) ?? '(gone)'}`);
};
const running = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Starts the probe as Spectra, directly or in a console of its own through the helper. */
async function startProbe({ownConsole}) {
  const child = ownConsole
    ? spawn(python, [helper, 'run', '--', probe], {stdio: ['pipe', 'pipe', 'pipe']})
    : spawn(probe, [], {stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', chunk => (output += chunk));
  child.stderr.on('data', chunk => (output += chunk));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  const deadline = Date.now() + 20_000;
  while (!/port (\d+)/.test(output)) {
    if (Date.now() > deadline) throw new Error(`The probe did not start:\n${output}`);
    await sleep(50);
  }
  const port = Number(output.match(/port (\d+)/)[1]);
  const call = async (route, body) => {
    const answer = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body !== undefined && {body: JSON.stringify(body)}),
    });
    return answer.json();
  };
  return {child, call, exited, output: () => output, send: event => child.stdin.write(`${event}\n`)};
}

function workDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'first-run-'));
  copyFileSync(nodeAgent, path.join(dir, 'agent.mjs'));
  copyFileSync(pythonAgent, path.join(dir, 'agent.py'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'first-run-agent',
      private: true,
      scripts: {
        agent: 'node agent.mjs --log npm.log',
        'agent-handler': 'node agent.mjs --log npm.log --handler',
      },
    }),
  );
  return dir;
}

async function waitForLine(file, pattern, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const match = text.match(pattern);
    if (match !== null) return match;
    await sleep(50);
  }
  return null;
}
const readLog = file => (existsSync(file) ? readFileSync(file, 'utf8').trim().split(/\r?\n/) : []);

async function point(title, run) {
  try {
    print(title, await run());
  } catch (error) {
    print(title, {failed: error instanceof Error ? error.stack : String(error)});
  }
}

const dir = workDir();
const launchReport = path.join(dir, 'launch.jsonl');
const reports = () => readLog(launchReport).filter(Boolean).map(line => JSON.parse(line));

// Point 2 first: the probe's own reading of the Job Object calls and the runner's jobs.
const direct = await startProbe({ownConsole: false});
await point('Point 2: the Job Object from the compiled binary', async () => {
  const info = await direct.call('/info');
  const start = await direct.call('/start?name=p2', {
    command: process.execPath,
    args: [path.join(dir, 'agent.mjs'), '--log', path.join(dir, 'p2.log')],
    cwd: dir,
    reportFile: launchReport,
  });
  await waitForLine(path.join(dir, 'p2.log'), /up (\d+)/);
  const count = await direct.call('/count?name=p2');
  const terminated = await direct.call('/terminate?name=p2');
  return {info, start, launcher: reports().at(-1), count, named: named(count.pids), terminated};
});

await point('Point 1: a batch-file launcher with no shell, and a refused argument', async () => {
  const log = path.join(dir, 'npm.log');
  const start = await direct.call('/start?name=p1', {
    command: 'npm',
    args: ['run', 'agent'],
    cwd: dir,
    reportFile: launchReport,
  });
  const up = await waitForLine(log, /up (\d+)/, 30_000);
  const count = await direct.call('/count?name=p1');
  const tree = named(count.pids);
  const terminated = await direct.call('/terminate?name=p1');
  const exit = await direct.call('/exit?name=p1&timeout=3000');
  const refused = await direct.call('/start?name=p1b', {
    command: 'npm',
    args: ['run', 'agent', 'a&b'],
    cwd: dir,
    reportFile: launchReport,
  });
  const refusedExit = await direct.call('/exit?name=p1b&timeout=5000');
  return {
    start,
    up: up?.[0] ?? null,
    launcher: reports().at(-2),
    tree,
    terminated,
    exit,
    refused,
    refusedLauncher: reports().at(-1),
    refusedExit,
  };
});

await point('Point 3a: ending the job ends a grandchild whose parent has exited', async () => {
  const results = {};
  for (const [label, command, args] of [
    ['node', process.execPath, [path.join(dir, 'agent.mjs'), '--orphan']],
    ['python', python, [path.join(dir, 'agent.py'), '--orphan']],
  ]) {
    const log = path.join(dir, `p3-${label}.log`);
    await direct.call(`/start?name=p3${label}`, {
      command,
      args: [...args, '--log', log],
      cwd: dir,
      reportFile: launchReport,
    });
    const child = await waitForLine(log, /child (\d+)/);
    const exit = await direct.call(`/exit?name=p3${label}&timeout=5000`);
    const pid = Number(child?.[1]);
    const before = await direct.call(`/count?name=p3${label}`);
    const terminated = await direct.call(`/terminate?name=p3${label}`);
    results[label] = {
      exitOfTheCommand: exit.exit,
      grandchild: pid,
      runningBefore: running(pid),
      jobBefore: named(before.pids),
      terminated,
      runningAfter: running(pid),
    };
  }
  return results;
});

await point('Point 3b: killing Spectra ends the whole tree', async () => {
  const victim = await startProbe({ownConsole: false});
  const log = path.join(dir, 'p3b.log');
  const start = await victim.call('/start?name=p3b', {
    command: process.execPath,
    args: [path.join(dir, 'agent.mjs'), '--child', '--log', log],
    cwd: dir,
    reportFile: launchReport,
  });
  const up = Number((await waitForLine(log, /up (\d+)/))?.[1]);
  const child = Number((await waitForLine(log, /child (\d+)/))?.[1]);
  const before = {launcher: running(start.launcherPid), agent: running(up), child: running(child)};
  victim.child.kill('SIGKILL');
  await victim.exited;
  await sleep(1000);
  const after = {launcher: running(start.launcherPid), agent: running(up), child: running(child)};
  return {before, after};
});

/** Starts an agent under a probe in its own console, and reads what one Ctrl+Break from the probe does. */
async function breakFromSpectra(spectra, label, command, args, log) {
  await spectra.call(`/start?name=${label}`, {command, args, cwd: dir, reportFile: launchReport});
  const up = await waitForLine(log, /up (\d+)/, 30_000);
  await sleep(500);
  const before = await spectra.call(`/count?name=${label}`);
  const tree = named(before.pids);
  const sent = await spectra.call(`/break?name=${label}`);
  const exit = await spectra.call(`/exit?name=${label}&timeout=4000`);
  await sleep(500);
  const after = await spectra.call(`/count?name=${label}`);
  const left = named(after.pids);
  await spectra.call(`/terminate?name=${label}`);
  return {
    up: up?.[0] ?? null,
    tree,
    sent,
    exitOfTheCommand: exit.exit,
    output: exit.output,
    leftAfterBreak: left,
    log: readLog(log),
  };
}

const own = await startProbe({ownConsole: true});
await point("Point 4: the agent's own group on Spectra's console", async () => {
  const log = path.join(dir, 'p4.log');
  await own.call('/start?name=p4', {
    command: process.execPath,
    args: [path.join(dir, 'agent.mjs'), '--handler', '--log', log],
    cwd: dir,
    reportFile: launchReport,
  });
  await waitForLine(log, /up (\d+)/);
  const launcher = reports().at(-1);
  const signalsBefore = await own.call('/signals');
  own.send('ctrl-c');
  await sleep(1500);
  const afterCtrlC = {spectra: await own.call('/signals'), agent: readLog(log)};
  const sent = await own.call('/break?name=p4');
  await sleep(1500);
  const afterBreak = {spectra: await own.call('/signals'), agent: readLog(log)};
  const exit = await own.call('/exit?name=p4&timeout=3000');
  await own.call('/terminate?name=p4');
  return {launcher, signalsBefore, afterCtrlC, sent, afterBreak, exit: exit.exit, driver: driverSignals};
});

await point("Point 5: what an agent does on Spectra's Ctrl+Break", async () => {
  const cases = [
    ['node-without-handler', process.execPath, [path.join(dir, 'agent.mjs')]],
    ['node-with-handler', process.execPath, [path.join(dir, 'agent.mjs'), '--handler']],
    ['python-without-handler', python, [path.join(dir, 'agent.py')]],
    ['python-with-handler', python, [path.join(dir, 'agent.py'), '--handler']],
    ['npm-without-handler', 'npm', ['run', 'agent']],
    ['npm-with-handler', 'npm', ['run', 'agent-handler']],
    ['cmd-node-with-handler', 'cmd', ['/d', '/c', 'node agent.mjs --handler --log cmd.log']],
    ['uv-python-with-handler', 'uv', ['run', '--no-project', '--python', python, 'agent.py', '--handler']],
  ];
  const results = {};
  for (const [label, command, args] of cases) {
    const npm = label.startsWith('npm');
    const viaCmd = label.startsWith('cmd');
    const log = path.join(dir, npm ? 'npm.log' : viaCmd ? 'cmd.log' : `p5-${label}.log`);
    if (existsSync(log)) writeFileSync(log, '');
    const fullArgs = npm || viaCmd ? args : [...args, '--log', log];
    try {
      results[label] = await breakFromSpectra(own, `p5${label}`, command, fullArgs, log);
    } catch (error) {
      results[label] = {failed: String(error)};
    }
  }
  return results;
});

await point('Point 6: the helper, one Spectra among two, and the console close', async () => {
  const other = await startProbe({ownConsole: true});
  const log = path.join(dir, 'p6.log');
  await own.call('/start?name=p6', {
    command: process.execPath,
    args: [path.join(dir, 'agent.mjs'), '--handler', '--log', log],
    cwd: dir,
    reportFile: launchReport,
  });
  await waitForLine(log, /up (\d+)/);
  const base = {own: (await own.call('/signals')).length, other: (await other.call('/signals')).length};
  own.send('ctrl-c');
  await sleep(1500);
  const afterCtrlC = {own: await own.call('/signals'), other: await other.call('/signals'), driver: [...driverSignals]};
  own.send('ctrl-break');
  await sleep(1500);
  const afterBreak = {
    own: await own.call('/signals'),
    other: await other.call('/signals'),
    driver: [...driverSignals],
    agent: readLog(log),
  };
  await own.call('/terminate?name=p6');
  own.send('close');
  const closed = await Promise.race([own.exited, sleep(10_000).then(() => 'still running')]);
  const otherAfterClose = await other.call('/signals');
  other.send('ctrl-c');
  await sleep(1000);
  const otherCtrlC = await other.call('/signals');
  await other.call('/quit?code=7');
  const otherExit = await other.exited;
  return {base, afterCtrlC, afterBreak, closed, ownOutput: own.output(), otherAfterClose, otherCtrlC, otherExit};
});

await point('Point 7: localhost from the binary to a server on 127.0.0.1', async () => {
  const server = createServer((_request, response) => response.end('on 127.0.0.1'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const fetched = await direct.call(`/fetch?url=${encodeURIComponent(`http://localhost:${port}/`)}`);
  server.close();
  return fetched;
});

await point('The launcher passes on an exit code past 255', async () => {
  await direct.call('/start?name=code', {
    command: process.execPath,
    args: ['-e', 'process.exit(3221225786)'],
    cwd: dir,
    reportFile: launchReport,
  });
  return await direct.call('/exit?name=code&timeout=5000');
});

await direct.call('/quit?code=0');
console.log('\nThe first run is done.');
process.exit(0);
