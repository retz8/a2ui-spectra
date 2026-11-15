/**
 * The first screen's variables under attach, as `attach` prints them: one
 * block of NAME=value lines on macOS and Linux, whose Copy gives POSIX
 * exports; on Windows a PowerShell block and a cmd block, each with its own
 * Copy.
 */

export type Shell = 'posix' | 'powershell' | 'cmd';

/** One block of the first screen's variables. */
export interface PasteBlock {
  caption: string;
  copyLabel: string;
  /** The lines the block shows. */
  lines: string[];
  /** What its Copy puts on the clipboard. */
  copied: string;
}

/** A variable as a line for the shell, as `attach` writes it without its comment. */
export function pasteLine(name: string, value: string, shell: Shell): string {
  switch (shell) {
    case 'posix':
      return `export ${name}=${value}`;
    case 'powershell':
      return `$env:${name} = '${value.replace(/'/g, "''")}'`;
    case 'cmd':
      return `set "${name}=${value}"`;
  }
}

const CAPTIONS: Record<Exclude<Shell, 'posix'>, string> = {
  powershell: 'In PowerShell',
  cmd: 'In cmd',
};

/** The blocks for the shells given, POSIX when none are. */
export function pasteBlocksOf(
  variables: ReadonlyArray<{name: string; value: string}>,
  shells: readonly Shell[] = ['posix'],
): PasteBlock[] {
  return shells.map(shell =>
    shell === 'posix'
      ? {
          caption: 'To see model and tool calls, set these in the agent’s shell',
          copyLabel: 'Copy the variables',
          lines: variables.map(({name, value}) => `${name}=${value}`),
          copied: variables.map(({name, value}) => pasteLine(name, value, shell)).join('\n'),
        }
      : {
          caption: CAPTIONS[shell],
          copyLabel: `Copy the variables for ${shell === 'powershell' ? 'PowerShell' : 'cmd'}`,
          lines: variables.map(({name, value}) => pasteLine(name, value, shell)),
          copied: variables.map(({name, value}) => pasteLine(name, value, shell)).join('\n'),
        },
  );
}
