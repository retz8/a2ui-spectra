/**
 * The first screen's variables under attach, as `attach` prints them: one
 * block of NAME=value lines on macOS and Linux, whose Copy gives POSIX
 * exports; on Windows a PowerShell block and a cmd block, each with its own
 * Copy. Where each variable goes, the note `attach` prints beside it, is a
 * comment line above the variables it is said of, in every shell but cmd,
 * which has no comment `attach` writes.
 */

export type Shell = 'posix' | 'powershell' | 'cmd';

/** A variable as the API serves it: its note, where it forwards or what it is for. */
export interface Variable {
  name: string;
  value: string;
  note?: string;
}

/** A line of a block: a variable, or a note's comment, shown muted. */
export interface PasteLine {
  text: string;
  comment: boolean;
}

/** One block of the first screen's variables. */
export interface PasteBlock {
  caption: string;
  copyLabel: string;
  /** The lines the block shows. */
  lines: PasteLine[];
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

/**
 * The variables as lines, each written by `lineOf`, with each note as a
 * comment above the run of variables it is said of; none for cmd.
 */
function linesOf(
  variables: readonly Variable[],
  lineOf: (variable: Variable) => string,
  commented: boolean,
): PasteLine[] {
  return variables.flatMap((variable, index) => {
    const {note} = variable;
    const noted =
      commented && note !== undefined && (index === 0 || variables[index - 1].note !== note);
    return [
      ...(noted ? [{text: `# ${note}`, comment: true}] : []),
      {text: lineOf(variable), comment: false},
    ];
  });
}

/** The blocks for the shells given, POSIX when none are. */
export function pasteBlocksOf(
  variables: readonly Variable[],
  shells: readonly Shell[] = ['posix'],
): PasteBlock[] {
  return shells.map(shell => {
    const commented = shell !== 'cmd';
    const lines = linesOf(
      variables,
      shell === 'posix'
        ? ({name, value}) => `${name}=${value}`
        : ({name, value}) => pasteLine(name, value, shell),
      commented,
    );
    const copied = linesOf(variables, ({name, value}) => pasteLine(name, value, shell), commented)
      .map(({text}) => text)
      .join('\n');
    return shell === 'posix'
      ? {
          caption: 'To see model and tool calls, set these in the agent’s shell',
          copyLabel: 'Copy the variables',
          lines,
          copied,
        }
      : {
          caption: CAPTIONS[shell],
          copyLabel: `Copy the variables for ${shell === 'powershell' ? 'PowerShell' : 'cmd'}`,
          lines,
          copied,
        };
  });
}
