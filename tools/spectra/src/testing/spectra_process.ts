/**
 * Spectra as a separate process, for the tests that check it from outside.
 * It runs under Node by default. When SPECTRA_BINARY names a compiled
 * binary, it runs the binary instead.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

/** The binary under test, when one is named. */
export const binary = process.env.SPECTRA_BINARY;
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
  output = '';
  readonly exited: Promise<Exit>;
  readonly #child: ChildProcess;
  #listeners: Array<() => void> = [];

  /**
   * Spectra starts in `cwd`, by default a fresh directory, where it creates
   * its store, with these variables added to its environment.
   */
  constructor(args: string[], cwd: string = workingDir(), env: Record<string, string> = {}) {
    const [command, ...prefix] = spectraCommand;
    this.#child = spawn(command, [...prefix, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: {...process.env, ...env},
    });
    for (const stream of [this.#child.stdout, this.#child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        this.output += chunk;
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

  signal(signal: NodeJS.Signals): void {
    this.#child.kill(signal);
  }
}

const running = new Set<SpectraProcess>();
after(() => {
  for (const spectra of running) spectra.signal('SIGKILL');
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

export async function finished(args: string[], cwd?: string): Promise<Exit & {output: string}> {
  const spectra = new SpectraProcess(args, cwd);
  const exit = await spectra.exited;
  return {...exit, output: spectra.output};
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address !== null
          ? resolve(address.port)
          : reject(new Error('No port.')),
      );
    });
  });
}
