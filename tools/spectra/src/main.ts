import {parseCommandLine, UsageError} from './args.js';
import {helpText} from './help.js';
import type {Output} from './output.js';
import {runSession} from './session.js';
import {NAME, VERSION} from './version.js';

/** Runs the command line and resolves with the exit code. */
export async function main(
  argv: readonly string[],
  out: Output,
  viewerDir: string,
): Promise<number> {
  let commandLine;
  try {
    commandLine = parseCommandLine(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      out.error(error.message);
      out.error(
        `Run '${NAME} ${error.topic === undefined ? '' : `${error.topic} `}--help' for usage.`,
      );
      return 2;
    }
    throw error;
  }
  switch (commandLine.name) {
    case 'help':
      out.print(helpText(commandLine.topic));
      return 0;
    case 'version':
      out.print(VERSION);
      return 0;
    case 'attach':
      return runSession(commandLine.options, undefined, out, viewerDir);
    case 'run':
      return runSession(
        commandLine.options,
        {command: commandLine.command, args: commandLine.args},
        out,
        viewerDir,
      );
  }
}
