/**
 * The agent's process tree on Windows, under the compiled binary. The
 * command starts through the launcher, Spectra's own binary started again
 * detached, so that it leads a process group of its own, which the terminal's
 * Ctrl-C does not reach; Spectra puts the launcher into a Job Object before it
 * starts the command, so every process the command starts is in the job, one
 * whose parent has exited included, and the job ends them all when Spectra's
 * handle to it closes, however Spectra ends. A stop asks the group with a
 * console Ctrl-Break, waits the grace, then ends the job.
 */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import type {AgentExit, AgentProcess, AgentStop} from '../agent_process.js';
import {LAUNCH_VARIABLE, type LaunchOutcome} from './launcher.js';
import type {Win32} from './win32.js';

/** A temporary diagnostic of the tree's handling, on stderr, while the Windows suite is brought up. */
const debug = process.env.A2UI_SPECTRA_TREE_DEBUG === '1';
const trace = (line: string) => {
  if (debug) process.stderr.write(`tree: ${line}\n`);
};

/** The exit code a process the job ends exits with. */
const ENDED_EXIT_CODE = 1;

export interface AgentTreeOptions {
  graceMs: number;
  /** The command's whole environment. */
  env: Record<string, string>;
  output: 'inherit' | 'stderr';
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Buffer) => void;
}

/** Spectra's own line for a command the launcher could not start. */
export function failureText(
  failure: {message: string; code?: string},
  args: readonly string[],
): string {
  if (/cmd\.exe special character/.test(failure.message)) {
    const index = Number(/args\[(\d+)\]/.exec(failure.message)?.[1] ?? '0');
    // args[0] is the command itself; Bun counts the command's own arguments from 1.
    const argument = index === 0 ? undefined : args[index - 1];
    const held = argument === undefined ? undefined : /["%&|<>^\r\n]/.exec(argument)?.[0];
    const what =
      argument === undefined
        ? "the command's name holds a character"
        : `its argument ${JSON.stringify(argument)} holds ${JSON.stringify(held ?? '')}`;
    return (
      `${what} that cmd.exe reads as its own, and the command is a batch file, which runs through cmd.exe. ` +
      'Spectra does not escape arguments for cmd.exe: start the program the batch file starts, ' +
      'or a script that passes the argument itself'
    );
  }
  return failure.message;
}

/** Starts the command's tree through the launcher, in a Job Object of its own. */
export function startAgentTree(
  win32: Win32,
  command: string,
  args: readonly string[],
  {graceMs, env, output, onOutput}: AgentTreeOptions,
): AgentProcess {
  const piped = onOutput !== undefined || output === 'stderr';
  const reportFile = path.join(
    tmpdir(),
    `a2ui-spectra-launch-${randomBytes(8).toString('hex')}.json`,
  );
  let job: bigint;
  try {
    job = win32.createJob();
  } catch (error) {
    return failed(error instanceof Error ? error : new Error(String(error)));
  }
  const launcher = spawn(process.execPath, [], {
    detached: true,
    windowsHide: true,
    stdio: ['pipe', piped ? 'pipe' : 'inherit', piped ? 'pipe' : 'inherit'],
    env: {...env, [LAUNCH_VARIABLE]: JSON.stringify({command, args, reportFile})},
    cwd: process.cwd(),
  });
  if (onOutput !== undefined) {
    launcher.stdout?.on('data', (chunk: Buffer) => onOutput('stdout', chunk));
    launcher.stderr?.on('data', (chunk: Buffer) => onOutput('stderr', chunk));
  } else if (output === 'stderr') {
    launcher.stdout?.pipe(process.stderr, {end: false});
    launcher.stderr?.pipe(process.stderr, {end: false});
  }

  /** Whether Spectra has asked the tree to stop, and when it ended the job, after how long. */
  let asked = false;
  let ended: {afterMs?: number} | undefined;
  let jobOpen = true;
  let assignError: Error | undefined;
  if (launcher.pid !== undefined) {
    try {
      win32.assignToJob(job, launcher.pid);
    } catch (error) {
      assignError = error instanceof Error ? error : new Error(String(error));
      launcher.kill();
    }
    // The launcher starts the command once it is in the job.
    if (assignError === undefined) launcher.stdin?.end('go\n');
    trace(
      `launcher ${launcher.pid} assigned: ${assignError?.message ?? 'yes'}; in the job: ${safely(() => win32.processInJob(launcher.pid!, job))}`,
    );
  } else {
    trace('launcher has no pid at spawn');
  }

  const exited = new Promise<AgentExit>(resolve => {
    launcher.once('error', error => resolve({code: null, signal: null, error}));
    launcher.once('exit', code => {
      const outcome = readOutcome(reportFile);
      if (assignError !== undefined || (outcome !== undefined && 'failure' in outcome)) {
        resolve({
          code: null,
          signal: null,
          error:
            assignError ??
            new Error(failureText((outcome as {failure: {message: string}}).failure, args)),
        });
        return;
      }
      resolve({
        // The launcher's own exit code is cut to eight bits; the command's is in the outcome.
        code: outcome?.exitCode ?? code,
        signal: null,
        ...(ended !== undefined
          ? {ending: {kind: 'ended' as const, ...ended}}
          : asked
            ? {ending: {kind: 'asked' as const}}
            : {}),
      });
    });
  });
  const outputEnded = new Promise<void>(resolve => {
    launcher.once('error', () => resolve());
    launcher.once('close', () => resolve());
  });

  const alive = (): boolean => {
    if (!jobOpen) return false;
    try {
      return win32.activeProcesses(job) > 0;
    } catch {
      return false;
    }
  };
  const endJob = (afterMs?: number): void => {
    if (!jobOpen) return;
    ended ??= afterMs === undefined ? {} : {afterMs};
    try {
      win32.terminateJob(job, ENDED_EXIT_CODE);
    } catch {
      // The job's processes have all gone.
    }
  };
  const closeJob = (): void => {
    if (!jobOpen) return;
    jobOpen = false;
    win32.closeHandle(job);
  };

  let stopping: Promise<AgentStop> | undefined;
  return {
    exited,
    outputEnded,
    stop() {
      stopping ??= (async (): Promise<AgentStop> => {
        if (launcher.pid === undefined || assignError !== undefined) {
          await exited;
          closeJob();
          return {forceKilled: false};
        }
        asked = true;
        trace(
          `stop of ${launcher.pid}: active ${safely(() => win32.activeProcesses(job))}, ids ${safely(() => win32.processIds(job).join(' '))}`,
        );
        // Without a console to share there is no asking: the job is ended at once.
        const sent = win32.sendConsoleEvent('ctrl-break', launcher.pid);
        trace(`ctrl-break to ${launcher.pid} sent: ${sent}`);
        const deadline = Date.now() + (sent ? graceMs : 0);
        let forceKilled = false;
        while (alive()) {
          if (Date.now() >= deadline) {
            endJob(sent ? graceMs : undefined);
            forceKilled = sent;
            break;
          }
          await delay(50);
        }
        trace(`stop of ${launcher.pid} waited: active ${safely(() => win32.activeProcesses(job))}`);
        await exited;
        closeJob();
        return {forceKilled};
      })();
      return stopping;
    },
    kill() {
      endJob();
    },
  };
}

/** An agent process for a command that could not start at all. */
function failed(error: Error): AgentProcess {
  const exited = Promise.resolve<AgentExit>({code: null, signal: null, error});
  return {
    exited,
    outputEnded: Promise.resolve(),
    stop: () => Promise.resolve({forceKilled: false}),
    kill: () => {},
  };
}

/** The launcher's outcome, once, removing the file; nothing when the launcher wrote none. */
function readOutcome(file: string): LaunchOutcome | undefined {
  try {
    const outcome = JSON.parse(readFileSync(file, 'utf8')) as LaunchOutcome;
    rmSync(file, {force: true});
    return outcome;
  } catch {
    return undefined;
  }
}

function safely(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
