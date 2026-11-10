import {type ChildProcess, spawn} from 'node:child_process';

/** How the agent's process ended. */
export interface AgentExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Why the command could not start, when it could not. */
  error?: Error;
}

/** The time a stopped process gets before it is force-killed, as `docker stop` waits. */
export const STOP_GRACE_MS = 10_000;

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

/** How a stop went. */
export interface AgentStop {
  /** Whether the group outlived the grace period and was force-killed. */
  forceKilled: boolean;
}

/** What the terminal says when a stop ran out its grace period. */
export function forceKilledLine(graceMs: number = STOP_GRACE_MS): string {
  const seconds = graceMs / 1000;
  return (
    `The agent's process did not stop within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}, ` +
    'so it was force-killed.'
  );
}

/** The agent's command, started under `run`. */
export interface AgentProcess {
  /** Settles when the command's own process exits. */
  readonly exited: Promise<AgentExit>;
  /**
   * Stops the command and everything it started: the stop signal to its
   * process group, then a force-kill if the group outlives the grace period.
   * Resolves once the group has gone, or has been force-killed, with whether
   * the grace ran out.
   */
  stop(): Promise<AgentStop>;
  /** Force-kills the command and everything it started, at once. */
  kill(): void;
  /**
   * Settles when both of the command's streams have ended, when they are
   * handed to `onOutput`: at once when it could not start, and not while
   * something it started still holds them open.
   */
  readonly outputEnded: Promise<void>;
}

const posix = process.platform !== 'win32';

export interface AgentProcessOptions {
  /** The time the stopped process gets before it is force-killed. */
  graceMs?: number;
  /** Variables added to Spectra's environment for the command: the redirection. */
  env?: Record<string, string>;
  /** Where the command's output goes: Spectra's own stdout and stderr, or both to its stderr. */
  output?: 'inherit' | 'stderr';
  /**
   * Takes each chunk the command writes, as it arrives, with the stream it
   * was written to, in place of `output`: both streams are piped, and
   * nothing is written for the command.
   */
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Buffer) => void;
}

/**
 * Starts the command without a shell, with Spectra's environment, the
 * variables given added, and its working directory, writing to Spectra's
 * stdout and stderr, or to its stderr alone, or to the taker of its output,
 * with its input closed. On POSIX systems it leads its own process group.
 */
export function startAgentProcess(
  command: string,
  args: readonly string[],
  {graceMs = STOP_GRACE_MS, env = {}, output = 'inherit', onOutput}: AgentProcessOptions = {},
): AgentProcess {
  const piped = onOutput !== undefined || output === 'stderr';
  const child = spawn(command, args, {
    stdio: piped ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    detached: posix,
    env: {...process.env, ...env},
    cwd: process.cwd(),
  });
  if (onOutput !== undefined) {
    child.stdout?.on('data', (chunk: Buffer) => onOutput('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => onOutput('stderr', chunk));
  } else if (output === 'stderr') {
    child.stdout?.pipe(process.stderr, {end: false});
    child.stderr?.pipe(process.stderr, {end: false});
  }
  const exited = new Promise<AgentExit>(resolve => {
    child.once('error', error => resolve({code: null, signal: null, error}));
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  const outputEnded = new Promise<void>(resolve => {
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
  let stopping: Promise<AgentStop> | undefined;
  return {
    exited,
    outputEnded,
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
): Promise<AgentStop> {
  if (child.pid === undefined) {
    return {forceKilled: false};
  }
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  let forceKilled = false;
  while (groupAlive(child)) {
    if (Date.now() >= deadline) {
      signalGroup(child, 'SIGKILL');
      forceKilled = true;
      break;
    }
    await delay(50);
  }
  await exited;
  return {forceKilled};
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
