#!/usr/bin/env node
/**
 * The npm launcher: the `a2ui-spectra` command of the npm package
 * `a2ui-spectra`, shipped as this one file, which imports nothing outside
 * Node's own modules and fetches nothing.
 *
 * It runs the binary held by the platform's own package, one of the five the
 * launcher's package names as optional dependencies, with the arguments as
 * given, and stays until the binary has ended; it exits with the binary's
 * exit code, or by the signal that ended it. On macOS and Linux it passes
 * SIGTERM and SIGHUP on to the binary, and holds Ctrl-C, which the terminal
 * sends the binary itself; the binary counts a stop that reaches it both
 * directly and through the launcher as one. On Windows every console event
 * reaches the binary directly, and the launcher holds Ctrl-C, Ctrl-Break and
 * the console's close.
 *
 * Where there is no binary to run, on a platform outside the five, on Linux
 * with musl, or where the platform's package is missing, it says so in one
 * line and exits 1.
 */
import {spawn} from 'node:child_process';
import {writeSync} from 'node:fs';
import {createRequire} from 'node:module';
import {constants} from 'node:os';
import path from 'node:path';

const NAME = 'a2ui-spectra';

/**
 * Set in the binary's environment, so that a stop it is sent both directly
 * and through the launcher counts as one.
 */
const MARK = 'A2UI_SPECTRA_NPM_LAUNCHER';

interface Platform {
  /** The platform's name, as its package is named after it. */
  name: string;
  /** The platform in words. */
  words: string;
  /** The binary's file name in its package. */
  binary: string;
}

/** The five platforms, by Node's platform and architecture. */
const PLATFORMS: Record<string, Platform> = {
  'darwin-arm64': {name: 'darwin-arm64', words: 'macOS arm64', binary: NAME},
  'darwin-x64': {name: 'darwin-x64', words: 'macOS x64', binary: NAME},
  'linux-x64': {name: 'linux-x64', words: 'Linux x64', binary: NAME},
  'linux-arm64': {name: 'linux-arm64', words: 'Linux arm64', binary: NAME},
  'win32-x64': {name: 'windows-x64', words: 'Windows x64', binary: `${NAME}.exe`},
};

/**
 * Says why in one line and exits 1. The line is written synchronously: a
 * write to a Windows console is asynchronous, and `process.exit` can drop it.
 */
function refuse(line: string): never {
  writeSync(2, `${NAME}: ${line}\n`);
  process.exit(1);
}

/** Whether this Linux has musl for its C library: Node's report names a glibc only on glibc. */
function onMusl(): boolean {
  // Node 22.13 and later read it, and leave the report's network part out.
  (process.report as {excludeNetwork?: boolean}).excludeNetwork = true;
  const report = process.report.getReport() as {header?: {glibcVersionRuntime?: string}};
  return report.header?.glibcVersionRuntime === undefined;
}

function supportedInWords(): string {
  const words = Object.values(PLATFORMS).map(platform => platform.words);
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The binary of this platform's package, or the line that says why there is none. */
function binaryPath(): string {
  const platform = PLATFORMS[`${process.platform}-${process.arch}`];
  if (platform === undefined) {
    refuse(
      `This platform, ${process.platform} ${process.arch}, is not supported. ` +
        `${NAME} runs on ${supportedInWords()}.`,
    );
  }
  if (process.platform === 'linux' && onMusl()) {
    refuse(`Linux with musl is not supported. ${NAME} runs on Linux with glibc.`);
  }
  const holder = `${NAME}-${platform.name}`;
  let manifest: string;
  try {
    manifest = createRequire(import.meta.url).resolve(`${holder}/package.json`);
  } catch {
    refuse(
      `${holder}, the package that holds ${NAME}'s binary for ${platform.words}, is missing. ` +
        `It is one of ${NAME}'s optional dependencies, which npm leaves out under ` +
        `--omit=optional; install ${NAME} again with its optional dependencies.`,
    );
  }
  return path.join(path.dirname(manifest), platform.binary);
}

function launch(binary: string): void {
  const child = spawn(binary, process.argv.slice(2), {
    stdio: 'inherit',
    env: {...process.env, [MARK]: '1'},
  });
  const running = () => child.exitCode === null && child.signalCode === null;
  const passOn = (signal: NodeJS.Signals) => () => {
    if (running()) child.kill(signal);
  };
  const hold = () => {};
  const handlers: Array<[NodeJS.Signals, () => void]> =
    process.platform === 'win32'
      ? [
          ['SIGINT', hold],
          ['SIGBREAK', hold],
          ['SIGHUP', hold],
        ]
      : [
          ['SIGINT', hold],
          ['SIGTERM', passOn('SIGTERM')],
          ['SIGHUP', passOn('SIGHUP')],
        ];
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const release = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };

  child.once('error', error => {
    release();
    refuse(`${binary} did not start: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    release();
    if (signal === null) {
      process.exit(code ?? 1);
    }
    // Ended the same way, or, by a signal this process outlives, with the shell's code for it.
    process.exitCode = 128 + (constants.signals[signal] ?? 0);
    process.kill(process.pid, signal);
  });
}

launch(binaryPath());
