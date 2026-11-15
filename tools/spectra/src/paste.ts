/**
 * The lines Spectra prints for the developer to paste into the agent's shell:
 * a POSIX `export` on macOS and Linux, and on Windows a PowerShell block and a
 * cmd block, each labelled by a comment its own shell takes.
 */

/** A shell the printed lines are written for. */
export type Shell = 'posix' | 'powershell' | 'cmd';

/** The shells a platform's lines are written for, in the order they are printed. */
export function shellsOf(platform: NodeJS.Platform = process.platform): Shell[] {
  return platform === 'win32' ? ['powershell', 'cmd'] : ['posix'];
}

/** The label each Windows shell's block opens with, as a comment that shell takes. */
export const SHELL_LABELS: Readonly<Record<Exclude<Shell, 'posix'>, string>> = {
  powershell: '# In PowerShell:',
  cmd: 'rem In cmd:',
};

/**
 * One variable as a line for the shell, with a comment where the shell takes
 * one after a command: POSIX and PowerShell. A cmd `set` takes everything
 * after `=` as the value, so it carries none.
 */
export function pasteLine(name: string, value: string, shell: Shell, comment?: string): string {
  const after = comment === undefined ? '' : `  # ${comment}`;
  switch (shell) {
    case 'posix':
      return `export ${name}=${value}${after}`;
    case 'powershell':
      return `$env:${name} = '${value.replaceAll("'", "''")}'${after}`;
    case 'cmd':
      return `set "${name}=${value}"`;
  }
}

/**
 * The lines for every shell of the platform: on macOS and Linux the lines as
 * they are; on Windows each shell's block under its label, a blank line between.
 */
export function pasteBlocks(
  linesFor: (shell: Shell) => string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const shells = shellsOf(platform);
  if (shells.length === 1 && shells[0] === 'posix') return linesFor('posix');
  return shells.flatMap((shell, index) => [
    ...(index > 0 ? [''] : []),
    SHELL_LABELS[shell as Exclude<Shell, 'posix'>],
    ...linesFor(shell),
  ]);
}
