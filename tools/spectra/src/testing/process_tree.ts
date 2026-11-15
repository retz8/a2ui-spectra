/**
 * The processes below a process, for the tests that check none of the agent's
 * tree is left: read from `ps` on macOS and Linux, and on Windows from
 * Win32_Process through PowerShell.
 */
import {execFileSync} from 'node:child_process';

/** A running process, with its parent and the name of its image. */
export interface ListedProcess {
  pid: number;
  parent: number;
  name: string;
  /** When it was created, as a Windows file time; 0 off Windows. */
  created: number;
}

/**
 * Every running process. On Windows a console's own host, conhost.exe, which
 * lives as long as its console, is left out.
 */
function processTable(): ListedProcess[] {
  const text =
    process.platform === 'win32'
      ? execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'conhost.exe' } | " +
              'ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToFileTimeUtc()) $($_.Name)" }',
          ],
          {encoding: 'utf8'},
        )
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], {encoding: 'utf8'});
  const line =
    process.platform === 'win32'
      ? /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/
      : /^\s*(\d+)\s+(\d+)\s+()(.*)$/;
  return text
    .split(/\r?\n/)
    .map(row => line.exec(row))
    .filter(match => match !== null)
    .map(([, pid, parent, created, name]) => ({
      pid: Number(pid),
      parent: Number(parent),
      name: name.trim(),
      created: Number(created || 0),
    }));
}

/**
 * Every process below the one given, children first. On Windows a parent id
 * is the creator's as it was, and ids are reused: a process created before the
 * one now holding its parent's id is not that one's child.
 */
export function descendantsOf(root: number): ListedProcess[] {
  const table = processTable();
  const byId = new Map(table.map(listed => [listed.pid, listed]));
  const children = new Map<number, ListedProcess[]>();
  for (const listed of table) {
    if (listed.pid === listed.parent) continue;
    const parent = byId.get(listed.parent);
    if (parent !== undefined && parent.created > listed.created) continue;
    children.set(listed.parent, [...(children.get(listed.parent) ?? []), listed]);
  }
  const found: ListedProcess[] = [];
  const next = [...(children.get(root) ?? [])];
  while (next.length > 0) {
    const listed = next.shift()!;
    found.push(listed);
    next.push(...(children.get(listed.pid) ?? []));
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
