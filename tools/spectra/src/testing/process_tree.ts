/**
 * The processes below a process, for the tests that check none of the agent's
 * tree is left: read from `ps` on macOS and Linux, and on Windows from
 * Win32_Process through PowerShell.
 */
import {execFileSync} from 'node:child_process';

/**
 * Every running process's id with its parent's. On Windows a console's own
 * host, conhost.exe, which lives as long as its console, is left out.
 */
function processTable(): Array<[number, number]> {
  const text =
    process.platform === 'win32'
      ? execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'conhost.exe' } | " +
              'ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
          {encoding: 'utf8'},
        )
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid='], {encoding: 'utf8'});
  return text
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/).map(Number))
    .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isFinite));
}

/** The ids of every process below the one given, children first. */
export function descendantsOf(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, parent] of processTable()) {
    if (pid === parent) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const found: number[] = [];
  const next = [...(children.get(root) ?? [])];
  while (next.length > 0) {
    const pid = next.shift()!;
    found.push(pid);
    next.push(...(children.get(pid) ?? []));
  }
  return found;
}

/** Whether the process with that id is running. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
