import {type ChildProcess, spawn} from 'node:child_process';
import {constants} from 'node:os';

/** How the agent's process ended. */
export interface AgentExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Why the command could not start, when it could not. */
  error?: Error;
}

/** The time a stopped process gets before it is force-killed, as `docker stop` waits. */
export const STOP_GRACE_MS = 10_000;

/** The exit code a shell would report for this ending. */
export function exitCodeOf(exit: AgentExit): number {
  if (exit.error !== undefined) {
    return 127;
  }
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128 + (constants.signals[exit.signal] ?? 0);
  }
  return 1;
}

/** Describes an ending in words, for Spectra's own output. */
export function describeExit(exit: AgentExit): string {
  if (exit.error !== undefined) {
    return `could not start: ${exit.error.message}`;
  }
  if (exit.code !== null) {
    return `exited with code ${exit.code}`;
  }
  return `was ended by ${exit.signal ?? 'an unknown cause'}`;
}

/** The agent's command, started under `run`. */
export interface AgentProcess {
  /** Settles when the command's own process exits. */
  readonly exited: Promise<AgentExit>;
  /**
   * Stops the command and everything it started: the stop signal to its
   * process group, then a force-kill if the group outlives the grace period.
   */
  stop(): Promise<void>;
  /** Force-kills the command and everything it started, at once. */
  kill(): void;
}

const posix = process.platform !== 'win32';

export interface AgentProcessOptions {
  /** The time the stopped process gets before it is force-killed. */
  graceMs?: number;
  /** Variables added to Spectra's environment for the command: the redirection. */
  env?: Record<string, string>;
}

/**
 * Starts the command without a shell, with Spectra's environment, the
 * variables given added, and its working directory, writing to Spectra's
 * stdout and stderr, with its input closed. On POSIX systems it leads its
 * own process group.
 */
export function startAgentProcess(
  command: string,
  args: readonly string[],
  {graceMs = STOP_GRACE_MS, env = {}}: AgentProcessOptions = {},
): AgentProcess {
  const child = spawn(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: posix,
    env: {...process.env, ...env},
    cwd: process.cwd(),
  });
  const exited = new Promise<AgentExit>(resolve => {
    child.once('error', error => resolve({code: null, signal: null, error}));
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  let stopping: Promise<void> | undefined;
  return {
    exited,
    stop() {
      stopping ??= stopGroup(child, exited, graceMs);
      return stopping;
    },
    kill() {
      signalGroup(child, 'SIGKILL');
    },
  };
}

async function stopGroup(
  child: ChildProcess,
  exited: Promise<AgentExit>,
  graceMs: number,
): Promise<void> {
  if (child.pid === undefined) {
    return;
  }
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (groupAlive(child)) {
    if (Date.now() >= deadline) {
      signalGroup(child, 'SIGKILL');
      break;
    }
    await delay(50);
  }
  await exited;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (posix) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The group has already gone.
  }
}

function groupAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) {
    return false;
  }
  if (!posix) {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
