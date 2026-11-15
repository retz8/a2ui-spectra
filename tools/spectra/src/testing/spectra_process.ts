/**
 * Spectra as a separate process, for the tests that check it from outside.
 * It runs under Node by default. When SPECTRA_BINARY names a compiled
 * binary, it runs the binary instead. On Windows it runs in a console of its
 * own, through the tests' console helper, which sends it the console's events
 * as the terminal would: a stop is a console Ctrl-C there, and a SIGTERM
 * elsewhere.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

/** The binary under test, when one is named. */
export const binary = process.env.SPECTRA_BINARY;

const windows = process.platform === 'win32';

/** The console helper and the workspace's Python, which runs it, on Windows. */
const consoleHelper = fileURLToPath(
  new URL('../../src/testing/windows_console.py', import.meta.url),
);
const python = fileURLToPath(new URL('../../../../.venv/Scripts/python.exe', import.meta.url));

/** How a test asks Spectra to stop, as a user does: SIGTERM, and on Windows a console Ctrl-C. */
export const STOP_SIGNAL: NodeJS.Signals = windows ? 'SIGINT' : 'SIGTERM';

/** The code Spectra exits with after that stop: 128 plus the stop's number. */
export const STOPPED_CODE = 128 + (windows ? 2 : 15);

/** The console event the helper sends for a signal, on Windows. */
const CONSOLE_EVENTS: Partial<Record<NodeJS.Signals, string>> = {
  SIGINT: 'ctrl-c',
  SIGBREAK: 'ctrl-break',
  SIGHUP: 'close',
};
const spectraCommand: [string, ...string[]] =
  binary === undefined || binary === ''
    ? [process.execPath, fileURLToPath(new URL('../cli.js', import.meta.url))]
    : [path.resolve(binary)];

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Spectra running as a process, with its stdout and stderr collected. */
export class SpectraProcess {
  /** Both streams, in arrival order. */
  output = '';
  stdout = '';
  stderr = '';
  readonly exited: Promise<Exit>;
  readonly #child: ChildProcess;
  #listeners: Array<() => void> = [];

  /**
   * Spectra starts in `cwd`, by default a fresh directory, where it creates
   * its store, with these variables added to its environment.
   */
  constructor(args: string[], cwd: string = workingDir(), env: Record<string, string> = {}) {
    const [command, ...prefix] = spectraCommand;
    this.#child = windows
      ? spawn(python, [consoleHelper, 'run', '--', command, ...prefix, ...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
          env: {...process.env, ...env},
        })
      : spawn(command, [...prefix, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd,
          env: {...process.env, ...env},
        });
    for (const [stream, name] of [
      [this.#child.stdout, 'stdout'],
      [this.#child.stderr, 'stderr'],
    ] as const) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        this.output += chunk;
        this[name] += chunk;
        for (const listener of this.#listeners) listener();
      });
    }
    this.exited = new Promise(resolve => {
      this.#child.once('exit', (code, signal) => resolve({code, signal}));
      this.#child.once('error', error => {
        this.output += `Spectra could not start: ${error.message}\n`;
        resolve({code: null, signal: null});
      });
    });
    running.add(this);
    void this.exited.then(() => running.delete(this));
  }

  /** Resolves with the first match of the pattern in the output so far. */
  waitFor(pattern: RegExp, timeoutMs = 15_000): Promise<RegExpMatchArray> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const match = this.output.match(pattern);
        if (match !== null) {
          done();
          resolve(match);
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`No ${pattern} in Spectra's output:\n${this.output}`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.#listeners = this.#listeners.filter(l => l !== check);
      };
      this.#listeners.push(check);
      check();
    });
  }

  /**
   * Sends Spectra a signal; on Windows a console event through the helper,
   * and SIGKILL ends the helper, whose Job Object ends Spectra.
   */
  /** The process the test started: Spectra, or on Windows the console helper that runs it. */
  get pid(): number | undefined {
    return this.#child.pid;
  }

  signal(signal: NodeJS.Signals): void {
    if (!windows || signal === 'SIGKILL') {
      this.#child.kill(signal);
      return;
    }
    const event = CONSOLE_EVENTS[signal];
    if (event === undefined) throw new Error(`Windows has no console event for ${signal}.`);
    this.#child.stdin?.write(`${event}\n`);
  }

  /** Asks Spectra to stop, as a user does: SIGTERM, or a console Ctrl-C on Windows. */
  requestStop(): void {
    this.signal(STOP_SIGNAL);
  }

  /**
   * Stops Spectra as a user does, so that it stops the agent it launched: the
   * stop signal, then a second one, which forces the agent's process group,
   * then a force-kill of Spectra itself when it still has not gone. An agent
   * left behind would hold the pipes Spectra gave it, and the test run open.
   */
  async stop(): Promise<void> {
    const gone = (ms: number) =>
      new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), ms);
        void this.exited.then(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    this.requestStop();
    if (await gone(3000)) return;
    this.signal('SIGINT');
    if (await gone(2000)) return;
    this.signal('SIGKILL');
    await this.exited;
  }
}

const running = new Set<SpectraProcess>();
after(async () => {
  await Promise.all([...running].map(spectra => spectra.stop()));
});

const workingDirs: string[] = [];
after(() => {
  for (const dir of workingDirs) rmSync(dir, {recursive: true, force: true});
});

/** A fresh working directory for one Spectra process. */
export function workingDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-cwd-'));
  workingDirs.push(dir);
  return dir;
}

export async function finished(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<Exit & {output: string; stdout: string; stderr: string}> {
  const spectra = new SpectraProcess(args, cwd, env);
  const exit = await spectra.exited;
  return {...exit, output: spectra.output, stdout: spectra.stdout, stderr: spectra.stderr};
}
