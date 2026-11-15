/**
 * The agent's launcher, on Windows under the compiled binary. Spectra starts
 * its own binary again with `LAUNCH_VARIABLE` set, detached, so that the
 * launcher leads a process group of its own; the launcher attaches to
 * Spectra's console, waits until Spectra has put it into the agent's Job
 * Object, starts the agent's command as Bun resolves it, sharing the console
 * and the process group, and exits with the command's exit code.
 */
import {loadWin32} from './win32.js';

/** The variable that makes the binary the agent's launcher: the command as JSON. */
export const LAUNCH_VARIABLE = 'A2UI_SPECTRA_LAUNCH';

/** The command the launcher starts. */
export interface Launch {
  command: string;
  args: string[];
}

/** What the launcher found as it started the command, for the first run's probe. */
export interface LaunchReport {
  attachedConsole: boolean;
  inAnyJob: boolean;
  spawnError?: string;
  pid?: number;
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

/** Reads the launch from the variable, when this process is a launcher. */
export function launchOf(env: NodeJS.ProcessEnv): Launch | undefined {
  const value = env[LAUNCH_VARIABLE];
  if (value === undefined) return undefined;
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
  onReport?: (report: LaunchReport) => void,
): Promise<number> {
  // The console's events reach the launcher's whole group; they are the agent's to act on.
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
    report.spawnError = error instanceof Error ? error.message : String(error);
    onReport?.(report);
    process.stderr.write(`${report.spawnError}\n`);
    return 1;
  }
  report.pid = child.pid;
  onReport?.(report);
  return await child.exited;
}
