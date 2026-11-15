// The first run on windows-latest, its second pass: the points of the sub-task
// 10.2 spec's decision 16 that the first pass left open, measured with the
// launcher leaving the console once the command has started, and the exit
// codes past 255. Run with Node from the repository root after the probe is
// compiled:
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
async function startProbe({ownConsole, args = []}) {
  const child = ownConsole
    ? spawn(python, [helper, 'run', '--', probe, ...args], {stdio: ['pipe', 'pipe', 'pipe']})
    : spawn(probe, args, {stdio: ['ignore', 'pipe', 'pipe']});
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
let serial = 0;
const fresh = name => path.join(dir, `${name}-${++serial}.txt`);

const own = await startProbe({ownConsole: true});

/** Starts a command under the probe in its own console, the launcher leaving the console or not. */
async function startUnder(spectra, label, command, args, {stayAttached = false, heartbeat} = {}) {
  const outcomeFile = fresh(`${label}-outcome`);
  const start = await spectra.call(`/start?name=${label}`, {
    command,
    args,
    cwd: dir,
    reportFile: launchReport,
    outcomeFile,
    stayAttached,
    ...(heartbeat !== undefined && {heartbeat}),
  });
  return start;
}

await point('A: the launcher on a Ctrl+Break, staying on the console or leaving it', async () => {
  const results = {};
  for (const stayAttached of [true, false]) {
    const label = stayAttached ? 'stays' : 'leaves';
    const log = fresh(`a-${label}-log`);
    const heartbeat = fresh(`a-${label}-beat`);
    await startUnder(own, label, process.execPath, [path.join(dir, 'agent.mjs'), '--handler', '--log', log], {
      stayAttached,
      heartbeat,
    });
    await waitForLine(log, /up (\d+)/);
    await sleep(500);
    const tree = named((await own.call(`/count?name=${label}`)).pids);
    const sent = await own.call(`/break?name=${label}`);
    const exit = await own.call(`/exit?name=${label}&timeout=4000`);
    await sleep(500);
    const left = named((await own.call(`/count?name=${label}`)).pids);
    const beats = readLog(heartbeat);
    const beatsAfter = beats.filter(line => line.startsWith('beat') && Number(line.split(' ')[1]) > sent.at);
    results[label] = {
      tree,
      sentAt: sent.at,
      launcherExit: exit.exit,
      msFromBreakToExit: exit.exit === null ? null : exit.exit.at - sent.at,
      outcome: exit.outcome,
      leftAfterBreak: left,
      launcherSignals: beats.filter(line => line.startsWith('signal')),
      launcherBeatsAfterBreak: beatsAfter.length,
      agent: readLog(log),
    };
    await own.call(`/terminate?name=${label}`);
  }
  return results;
});

await point("B: the terminal's Ctrl+C and Spectra's Ctrl+Break, with the launcher leaving the console", async () => {
  const node = fresh('b-node');
  const py = fresh('b-python');
  await startUnder(own, 'bnode', process.execPath, [path.join(dir, 'agent.mjs'), '--handler', '--log', node]);
  await startUnder(own, 'bpython', python, [path.join(dir, 'agent.py'), '--handler', '--log', py]);
  await waitForLine(node, /up (\d+)/);
  await waitForLine(py, /up (\d+)/);
  await sleep(500);
  const before = (await own.call('/signals')).length;
  own.send('ctrl-c');
  await sleep(1500);
  const afterCtrlC = {
    spectra: (await own.call('/signals')).slice(before),
    node: readLog(node),
    python: readLog(py),
    driver: [...driverSignals],
  };
  const sent = [await own.call('/break?name=bnode'), await own.call('/break?name=bpython')];
  const exits = {
    node: await own.call('/exit?name=bnode&timeout=4000'),
    python: await own.call('/exit?name=bpython&timeout=4000'),
  };
  const afterBreak = {
    spectra: (await own.call('/signals')).slice(before),
    node: readLog(node),
    python: readLog(py),
  };
  for (const label of ['bnode', 'bpython']) await own.call(`/terminate?name=${label}`);
  return {afterCtrlC, sent, exits, afterBreak};
});

await point("C: what an agent does on Spectra's Ctrl+Break, with the launcher leaving the console", async () => {
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
    const log = npm ? path.join(dir, 'npm.log') : viaCmd ? path.join(dir, 'cmd.log') : fresh(`c-${label}`);
    if (existsSync(log)) writeFileSync(log, '');
    try {
      await startUnder(own, label, command, npm || viaCmd ? args : [...args, '--log', log]);
      const up = await waitForLine(log, /up (\d+)/, 30_000);
      await sleep(500);
      const tree = named((await own.call(`/count?name=${label}`)).pids);
      const sent = await own.call(`/break?name=${label}`);
      const exit = await own.call(`/exit?name=${label}&timeout=4000`);
      await sleep(500);
      const left = named((await own.call(`/count?name=${label}`)).pids);
      results[label] = {
        up: up?.[0] ?? null,
        tree,
        launcherExit: exit.exit?.code ?? null,
        msFromBreakToExit: exit.exit === null ? null : exit.exit.at - sent.at,
        outcome: exit.outcome,
        output: exit.output,
        leftAfterBreak: left,
        log: readLog(log),
      };
      await own.call(`/terminate?name=${label}`);
    } catch (error) {
      results[label] = {failed: String(error)};
    }
  }
  return results;
});

await point('D: exit codes past 255, through Bun', async () => {
  const exitWith = await new Promise(resolve => {
    const child = spawn(probe, ['exit-with', '3221225786'], {stdio: 'ignore'});
    child.once('exit', code => resolve(code));
  });
  return {
    bunProcessExitAsNodeSeesIt: exitWith,
    bunChildProcessOfNodeExiting: await own.call('/child-exit-code'),
    launcherOutcome: await (async () => {
      await startUnder(own, 'code', process.execPath, ['-e', 'process.exit(3221225786)']);
      return await own.call('/exit?name=code&timeout=5000');
    })(),
  };
});

await point('E: the console window closed under a Spectra that exits soon after SIGHUP', async () => {
  const quick = await startProbe({ownConsole: true, args: ['close-exit']});
  const log = fresh('e-log');
  await startUnder(quick, 'e', process.execPath, [path.join(dir, 'agent.mjs'), '--handler', '--log', log]);
  const up = Number((await waitForLine(log, /up (\d+)/))?.[1]);
  quick.send('close');
  const exit = await Promise.race([quick.exited, sleep(10_000).then(() => 'still running')]);
  await sleep(500);
  return {exit, agentRunningAfter: running(up), agent: readLog(log), output: quick.output()};
});

await point('F: a grandchild whose parent exited, alive until the job ends', async () => {
  const log = fresh('f-log');
  await startUnder(own, 'f', process.execPath, [path.join(dir, 'agent.mjs'), '--orphan', '--log', log]);
  const pid = Number((await waitForLine(log, /child (\d+)/))?.[1]);
  const exit = await own.call('/exit?name=f&timeout=5000');
  await sleep(300);
  const runningBefore = running(pid);
  const jobBefore = named((await own.call('/count?name=f')).pids);
  const terminated = await own.call('/terminate?name=f');
  return {exitOfTheCommand: exit.outcome, grandchild: pid, runningBefore, jobBefore, terminated, runningAfter: running(pid)};
});

await own.call('/quit?code=0');
console.log('\nThe second pass is done.');
process.exit(0);
