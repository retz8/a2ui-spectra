import {agentUrlOf, parseCommandLine, toolProxyPorts, UsageError} from './args.js';
import {ConfigError, loadConfig} from './config.js';
import {helpText} from './help.js';
import {type Output, statusToStderr} from './output.js';
import {prepareReplay, prepareTest} from './replay_command.js';
import {type HeadlessWork, runSession} from './session.js';
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
      return usage(error, out);
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
    case 'run': {
      let config;
      try {
        config = await loadConfig({cwd: process.cwd(), path: commandLine.options.config});
      } catch (error) {
        if (error instanceof ConfigError) {
          out.error(error.message);
          return 1;
        }
        throw error;
      }
      let agentUrl;
      let toolPorts;
      try {
        agentUrl = agentUrlOf(commandLine.options, config, commandLine.name);
        toolPorts = toolProxyPorts(commandLine.options, config.tools.length, commandLine.name);
      } catch (error) {
        if (error instanceof UsageError) {
          return usage(error, out);
        }
        throw error;
      }
      const {port, open, allowedHosts, ...rest} = commandLine.options;
      return runSession(
        {...rest, agentUrl, config, toolPorts, viewer: {port, open, allowedHosts}},
        commandLine.name === 'run'
          ? {command: commandLine.command, args: commandLine.args}
          : undefined,
        out,
        viewerDir,
      );
    }
    case 'replay':
    case 'test': {
      // The status lines go to stderr; stdout carries the result lines alone.
      const headlessOut = statusToStderr(out);
      let config;
      try {
        config = await loadConfig({cwd: process.cwd(), path: commandLine.options.config});
      } catch (error) {
        if (error instanceof ConfigError) {
          headlessOut.error(error.message);
          return 1;
        }
        throw error;
      }
      let agentUrl;
      let toolPorts;
      let work: HeadlessWork | number;
      try {
        work =
          commandLine.name === 'replay'
            ? await prepareReplay(
                commandLine.file,
                commandLine.modelLive,
                process.cwd(),
                headlessOut,
              )
            : await prepareTest(commandLine.folder, config, process.cwd(), headlessOut);
        agentUrl = agentUrlOf(commandLine.options, config, commandLine.name);
        toolPorts = toolProxyPorts(commandLine.options, config.tools.length, commandLine.name);
      } catch (error) {
        if (error instanceof UsageError) {
          return usage(error, headlessOut);
        }
        throw error;
      }
      if (typeof work === 'number') {
        return work;
      }
      return runSession(
        {...commandLine.options, agentUrl, config, toolPorts},
        commandLine.command,
        headlessOut,
        viewerDir,
        work,
      );
    }
  }
}

function usage(error: UsageError, out: Output): number {
  out.error(error.message);
  out.error(`Run '${NAME} ${error.topic === undefined ? '' : `${error.topic} `}--help' for usage.`);
  return 2;
}
