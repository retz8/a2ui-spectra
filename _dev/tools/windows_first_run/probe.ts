/**
 * The first run's stand-in for Spectra, compiled with Bun on the Windows
 * runner. With the launch variable set it is the agent's launcher, as the
 * binary is. Otherwise it plays Spectra: it serves a small HTTP API on
 * 127.0.0.1 through which the driver has it start a command in a Job Object
 * through the launcher, send the launcher's group a Ctrl+Break, count and
 * end the job, fetch a URL, and say which console events it received. Its
 * first line on stdout is `port <n>`.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {constants} from 'node:os';

import {
  LAUNCH_VARIABLE,
  launchOf,
  runLauncher,
} from '../../../tools/spectra/src/windows/launcher.js';
import {loadWin32} from '../../../tools/spectra/src/windows/win32.js';

const launch = launchOf(process.env);
if (launch !== undefined) {
  const reportFile = process.env.PROBE_LAUNCH_REPORT;
  const code = await runLauncher(launch, report => {
    if (reportFile !== undefined) appendFileSync(reportFile, `${JSON.stringify(report)}\n`);
  });
  process.exit(code);
}

const win32 = await loadWin32();
if (win32 === undefined) throw new Error('No Win32 calls: not the compiled binary on Windows.');

const signals: Array<{signal: string; at: number}> = [];
for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP'] as const) {
  process.on(signal, () => signals.push({signal, at: Date.now()}));
}

interface Started {
  job: bigint;
  launcher: ChildProcess;
  output: string;
  exit?: {code: number | null; signal: string | null; at: number};
  assignError?: string;
}
const started = new Map<string, Started>();

const bun = (globalThis as unknown as {Bun: {which(name: string, options?: object): string | null}})
  .Bun;

const info = {
  pid: process.pid,
  execPath: process.execPath,
  inAnyJobAtStart: win32.inAnyJob(),
  sigbreak: constants.signals.SIGBREAK,
  sigint: constants.signals.SIGINT,
  sighup: constants.signals.SIGHUP,
  whichNpm: bun.which('npm'),
  whichNode: bun.which('node'),
  whichUv: bun.which('uv'),
};

const server = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => (body += chunk));
  request.on('end', () => {
    void handle(request.url ?? '/', body).then(
      result => {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify(result, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ));
      },
      (error: unknown) => {
        response.writeHead(500, {'content-type': 'application/json'});
        response.end(JSON.stringify({error: error instanceof Error ? error.message : String(error)}));
      },
    );
  });
});

async function handle(url: string, body: string): Promise<unknown> {
  const {pathname, searchParams} = new URL(url, 'http://probe');
  const name = searchParams.get('name') ?? 'agent';
  const entry = started.get(name);
  switch (pathname) {
    case '/info':
      return {...info, inAnyJobNow: win32!.inAnyJob()};
    case '/signals':
      return signals;
    case '/start': {
      const {command, args, cwd, reportFile} = JSON.parse(body) as {
        command: string;
        args: string[];
        cwd: string;
        reportFile: string;
      };
      const job = win32!.createJob();
      const launcher = spawn(process.execPath, [], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          [LAUNCH_VARIABLE]: JSON.stringify({command, args}),
          PROBE_LAUNCH_REPORT: reportFile,
        },
        cwd,
        windowsHide: true,
      });
      const record: Started = {job, launcher, output: ''};
      started.set(name, record);
      launcher.stdout?.on('data', (chunk: Buffer) => (record.output += chunk.toString('utf8')));
      launcher.stderr?.on('data', (chunk: Buffer) => (record.output += chunk.toString('utf8')));
      launcher.once('exit', (code, signal) => (record.exit = {code, signal, at: Date.now()}));
      await new Promise<void>((resolve, reject) => {
        launcher.once('spawn', () => resolve());
        launcher.once('error', reject);
      });
      try {
        win32!.assignToJob(job, launcher.pid!);
      } catch (error) {
        record.assignError = error instanceof Error ? error.message : String(error);
      }
      launcher.stdin?.end('go\n');
      return {launcherPid: launcher.pid, assignError: record.assignError};
    }
    case '/break':
      return {sent: win32!.sendConsoleEvent('ctrl-break', entry!.launcher.pid!), at: Date.now()};
    case '/count':
      return {active: win32!.activeProcesses(entry!.job), pids: win32!.processIds(entry!.job)};
    case '/terminate': {
      win32!.terminateJob(entry!.job, 1);
      await new Promise(resolve => setTimeout(resolve, 500));
      return {active: win32!.activeProcesses(entry!.job), pids: win32!.processIds(entry!.job)};
    }
    case '/exit': {
      const timeout = Number(searchParams.get('timeout') ?? '5000');
      const deadline = Date.now() + timeout;
      while (entry!.exit === undefined && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return {exit: entry!.exit ?? null, output: entry!.output};
    }
    case '/close': {
      win32!.closeHandle(entry!.job);
      started.delete(name);
      return {closed: true};
    }
    case '/running':
      return {running: win32!.processRunning(Number(searchParams.get('pid')))};
    case '/fetch': {
      const target = searchParams.get('url')!;
      const at = Date.now();
      try {
        const answer = await fetch(target);
        return {status: answer.status, text: await answer.text(), ms: Date.now() - at};
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error), ms: Date.now() - at};
      }
    }
    case '/quit':
      setTimeout(() => process.exit(Number(searchParams.get('code') ?? '0')), 50);
      return {quitting: true};
    default:
      throw new Error(`No route ${pathname}`);
  }
}

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`port ${typeof address === 'object' && address !== null ? address.port : 0}\n`);
});
