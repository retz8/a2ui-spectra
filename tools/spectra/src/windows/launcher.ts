/**
 * The agent's launcher, on Windows under the compiled binary. Spectra starts
 * its own binary again with `LAUNCH_VARIABLE` set, detached, so that the
 * launcher leads a process group of its own; the launcher attaches to
 * Spectra's console, waits until Spectra has put it into the agent's Job
 * Object, starts the agent's command as Bun resolves it, sharing the console
 * and the process group, then leaves the console, so that the console's
 * events reach the agent's processes and not it. It writes the command's exit
 * code, read from the command's own process since Bun 1.4.4 cuts an exit code
 * to its low eight bits both in a child's code and in process.exit, or why the
 * command could not start, to the launch's report file, and exits.
 */
import {writeFileSync} from 'node:fs';

import {loadWin32} from './win32.js';

/** The variable that makes the binary the agent's launcher: the launch as JSON. */
export const LAUNCH_VARIABLE = 'A2UI_SPECTRA_LAUNCH';

/** What the launcher starts, and where it writes the outcome. */
export interface Launch {
  command: string;
  args: string[];
  /** The file the launcher writes a `LaunchOutcome` to. */
  reportFile?: string;
}

/** How the command ended, or why it could not start, as Bun.spawn said. */
export type LaunchOutcome = {exitCode: number} | {failure: {message: string; code?: string}};

/** What the launcher found as it started the command, for the first run's probe. */
export interface LaunchReport {
  attachedConsole: boolean;
  inAnyJob: boolean;
  spawnError?: string;
  pid?: number;
}

export interface LauncherOptions {
  onReport?: (report: LaunchReport) => void;
  /** Stays on the console after the command starts, as the first run's probe compares. */
  stayAttached?: boolean;
}

/** The part of Bun.spawn used here. */
interface BunSubprocess {
  readonly pid: number;
  readonly exited: Promise<number>;
}
interface BunGlobal {
  spawn(
    cmd: string[],
    options: {
      stdio: ['ignore', 'inherit', 'inherit'];
      env: Record<string, string | undefined>;
      cwd: string;
      windowsHide: boolean;
    },
  ): BunSubprocess;
}

/** The launch, when this process is the compiled binary started as a launcher on Windows. */
export function launchOf(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Launch | undefined {
  const value = env[LAUNCH_VARIABLE];
  if (value === undefined || platform !== 'win32' || process.versions.bun === undefined) {
    return undefined;
  }
  return JSON.parse(value) as Launch;
}

/** Resolves true once Spectra writes to stdin, false if stdin ends first. */
function waitForGo(): Promise<boolean> {
  return new Promise(resolve => {
    process.stdin.once('data', () => resolve(true));
    process.stdin.once('end', () => resolve(false));
    process.stdin.once('error', () => resolve(false));
  });
}

/** Runs the launcher; resolves with the exit code it exits with. */
export async function runLauncher(
  launch: Launch,
  {onReport, stayAttached = false}: LauncherOptions = {},
): Promise<number> {
  // Until it leaves the console, the console's events reach the launcher; they are the agent's.
  for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP'] as const) {
    process.on(signal, () => {});
  }
  const win32 = await loadWin32();
  const attachedConsole = win32?.attachParentConsole() ?? false;
  if (!(await waitForGo())) {
    return 1;
  }
  process.stdin.pause();
  const env: Record<string, string | undefined> = {...process.env};
  delete env[LAUNCH_VARIABLE];
  const bun = (globalThis as unknown as {Bun: BunGlobal}).Bun;
  const report: LaunchReport = {attachedConsole, inAnyJob: win32?.inAnyJob() ?? false};
  const write = (outcome: LaunchOutcome) => {
    if (launch.reportFile !== undefined) writeFileSync(launch.reportFile, JSON.stringify(outcome));
  };
  let child: BunSubprocess;
  try {
    child = bun.spawn([launch.command, ...launch.args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
      cwd: process.cwd(),
      // Without Spectra's console the command would get a console window of its own.
      windowsHide: !attachedConsole,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as {code?: unknown}).code;
    report.spawnError = message;
    onReport?.(report);
    write({failure: {message, ...(typeof code === 'string' && {code})}});
    if (launch.reportFile === undefined) process.stderr.write(`${message}\n`);
    return 1;
  }
  // Opened before Bun reaps the command, so that its whole exit code can be read.
  let handle: bigint | undefined;
  try {
    handle = win32?.openProcess(child.pid);
  } catch {
    handle = undefined;
  }
  if (attachedConsole && !stayAttached) win32?.freeConsole();
  if (process.env.A2UI_SPECTRA_TREE_DEBUG === '1') {
    process.stderr.write(
      `launcher ${process.pid}: attached ${attachedConsole}, in a job ${report.inAnyJob}, started ${child.pid}\n`,
    );
  }
  report.pid = child.pid;
  onReport?.(report);
  const cut = await child.exited;
  const exitCode = (handle === undefined ? undefined : win32?.exitCodeOf(handle)) ?? cut;
  write({exitCode});
  return exitCode;
}
