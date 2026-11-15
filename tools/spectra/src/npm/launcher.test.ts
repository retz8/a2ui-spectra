/**
 * The npm launcher, run by Node as npm runs it, against this platform's
 * binary laid out as its platform package: the binary SPECTRA_BINARY names,
 * or under Node a stand-in script that runs Spectra under Node, on macOS and
 * Linux. Under Node on Windows, where no script stands in for a binary, the
 * cases that run the binary are skipped.
 */
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {constants, tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {freePort} from '../testing/free_port.js';
import {descendantsOf} from '../testing/process_tree.js';
import {binary, type Exit, SpectraProcess, workingDir} from '../testing/spectra_process.js';
import {VERSION} from '../version.js';

const windows = process.platform === 'win32';
const binaryFile = binary !== undefined && binary !== '' ? path.resolve(binary) : undefined;
const runsBinary = binaryFile !== undefined || !windows;
const TIMEOUT = 60_000;

const launcherScript = fileURLToPath(new URL('./launcher.js', import.meta.url));
const cliScript = fileURLToPath(new URL('../cli.js', import.meta.url));

/** The five platforms, by Node's platform and architecture: the package's name and the words. */
const PLATFORMS: Record<string, [string, string]> = {
  'darwin-arm64': ['darwin-arm64', 'macOS arm64'],
  'darwin-x64': ['darwin-x64', 'macOS x64'],
  'linux-x64': ['linux-x64', 'Linux x64'],
  'linux-arm64': ['linux-arm64', 'Linux arm64'],
  'win32-x64': ['windows-x64', 'Windows x64'],
};
const host = PLATFORMS[`${process.platform}-${process.arch}`];
const SUPPORTED = 'macOS arm64, macOS x64, Linux x64, Linux arm64 and Windows x64';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, {recursive: true, force: true});
});

function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/**
 * The launcher's package laid out in a fresh `node_modules`, with this
 * platform's package beside it when `withBinary`, as npm installs them.
 * Returns the launcher's script.
 */
function layOut({withBinary}: {withBinary: boolean}): string {
  if (host === undefined) {
    throw new Error(`The launcher's tests run on the five platforms, not ${process.platform}.`);
  }
  const root = mkdtempSync(path.join(tmpdir(), 'spectra-npm-'));
  roots.push(root);
  const own = path.join(root, 'node_modules', 'a2ui-spectra');
  mkdirSync(path.join(own, 'bin'), {recursive: true});
  writeFileSync(
    path.join(own, 'package.json'),
    JSON.stringify({name: 'a2ui-spectra', version: VERSION, type: 'module'}),
  );
  const launcher = path.join(own, 'bin', 'a2ui-spectra.js');
  copyFileSync(launcherScript, launcher);
  if (withBinary) {
    const name = `a2ui-spectra-${host[0]}`;
    const holder = path.join(root, 'node_modules', name);
    mkdirSync(holder);
    writeFileSync(path.join(holder, 'package.json'), JSON.stringify({name, version: VERSION}));
    const file = path.join(holder, windows ? 'a2ui-spectra.exe' : 'a2ui-spectra');
    if (binaryFile !== undefined) {
      copyFileSync(binaryFile, file);
    } else {
      writeFileSync(
        file,
        `#!/bin/sh\nexec ${shellQuoted(process.execPath)} ${shellQuoted(cliScript)} "$@"\n`,
      );
    }
    chmodSync(file, 0o755);
  }
  return launcher;
}

let laidOut: string | undefined;
/** The launcher with this platform's package, laid out once for the cases that share it. */
function installed(): string {
  laidOut ??= layOut({withBinary: true});
  return laidOut;
}

/** The launcher run by Node with these arguments, leading a process group of its own. */
function launched(
  launcher: string,
  args: string[],
  {nodeArgs = [], cwd}: {nodeArgs?: string[]; cwd?: string} = {},
): SpectraProcess {
  return new SpectraProcess(
    args,
    cwd ?? workingDir(),
    {},
    {command: [process.execPath, ...nodeArgs, launcher], ownGroup: true},
  );
}

async function ports(): Promise<string[]> {
  const [port, proxyPort, modelProxyPort, receiverPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  return [
    '--port',
    String(port),
    '--proxy-port',
    String(proxyPort),
    '--model-proxy-port',
    String(modelProxyPort),
    '--receiver-port',
    String(receiverPort),
    '--no-open',
  ];
}

/** Spectra attached, through the launcher, to an agent that never answers, once it waits for the card. */
async function attached(): Promise<SpectraProcess> {
  const spectra = launched(installed(), [
    'attach',
    `http://localhost:${await freePort()}`,
    ...(await ports()),
  ]);
  await spectra.waitFor(/Waiting for the agent's card/);
  return spectra;
}

/**
 * Spectra running, through the launcher, an agent that takes two seconds to
 * stop, once the agent has started.
 */
async function runningSlowAgent(): Promise<SpectraProcess> {
  const cwd = workingDir();
  // A file of its own, since Spectra prints the command it starts.
  writeFileSync(
    path.join(cwd, 'slow_agent.mjs'),
    [
      "process.on('SIGTERM', () => {",
      "  console.log('The agent is stopping.');",
      "  setTimeout(() => { console.log('The agent has stopped.'); process.exit(0); }, 2000);",
      '});',
      'const marked = process.env.A2UI_SPECTRA_NPM_LAUNCHER !== undefined;',
      "console.log(marked ? 'The agent has started, marked.' : 'The agent has started.');",
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );
  const spectra = launched(
    installed(),
    [
      'run',
      '--agent-url',
      `http://localhost:${await freePort()}`,
      ...(await ports()),
      '--',
      process.execPath,
      'slow_agent.mjs',
    ],
    {cwd},
  );
  await spectra.waitFor(/The agent has started/);
  return spectra;
}

function codeOf(signal: NodeJS.Signals): number {
  return 128 + (constants.signals[signal] ?? 0);
}

function count(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
}

function timeout(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

/**
 * A module run before the launcher that makes Node report another platform,
 * and on Linux a C library: glibc's, or none, as on musl.
 */
function pretending(platform: string, arch: string, glibc = true): string[] {
  const root = mkdtempSync(path.join(tmpdir(), 'spectra-npm-platform-'));
  roots.push(root);
  const file = path.join(root, 'pretend.mjs');
  writeFileSync(
    file,
    [
      `Object.defineProperty(process, 'platform', {value: ${JSON.stringify(platform)}});`,
      `Object.defineProperty(process, 'arch', {value: ${JSON.stringify(arch)}});`,
      `const report = {header: ${glibc ? "{glibcVersionRuntime: '2.39'}" : '{}'}};`,
      "Object.defineProperty(process, 'report', {value: {excludeNetwork: false, getReport: () => report}});",
    ].join('\n'),
  );
  return ['--import', pathToFileURL(file).href];
}

async function refusal(nodeArgs: string[]): Promise<Exit & {stderr: string}> {
  const spectra = launched(layOut({withBinary: false}), ['--version'], {nodeArgs});
  const exit = await spectra.exited;
  return {...exit, stderr: spectra.stderr};
}

describe('the npm launcher', () => {
  it(
    "runs this platform's binary, with the arguments as given",
    {timeout: TIMEOUT, skip: !runsBinary},
    async () => {
      const spectra = launched(installed(), ['--version']);
      const exit = await spectra.exited;
      assert.deepEqual(exit, {code: 0, signal: null}, spectra.output);
      assert.equal(spectra.stdout, `${VERSION}\n`);
    },
  );

  it("hands back the binary's exit code", {timeout: TIMEOUT, skip: !runsBinary}, async () => {
    const usage = launched(installed(), ['attach', '--no-such-option']);
    assert.equal((await usage.exited).code, 2, usage.output);
    assert.match(usage.stderr, /--no-such-option/);
    const config = launched(installed(), ['attach', '--config', 'nowhere.json']);
    assert.equal((await config.exited).code, 1, config.output);
    assert.match(config.stderr, /nowhere\.json does not exist/);
  });

  if (windows) {
    for (const stop of ['SIGINT', 'SIGBREAK', 'SIGHUP'] as const) {
      it(
        `holds the console's ${stop}, which reaches the binary itself, and stays until it has stopped`,
        {timeout: TIMEOUT, skip: !runsBinary},
        async () => {
          const spectra = await attached();
          spectra.signalGroup(stop);
          const exit = await spectra.exited;
          assert.deepEqual(exit, {code: codeOf(stop), signal: null}, spectra.output);
          assert.equal(count(spectra.output, /Stopping\./), 1, spectra.output);
        },
      );
    }
  } else {
    for (const stop of ['SIGTERM', 'SIGHUP'] as const) {
      it(
        `passes ${stop} on, and stays until the binary has stopped`,
        {timeout: TIMEOUT},
        async () => {
          const spectra = await attached();
          spectra.signal(stop);
          const exit = await spectra.exited;
          assert.deepEqual(exit, {code: codeOf(stop), signal: null}, spectra.output);
          assert.equal(count(spectra.output, /Stopping\./), 1, spectra.output);
        },
      );

      it(
        `counts ${stop} sent to the process group once, though it reaches the binary twice`,
        {timeout: TIMEOUT},
        async () => {
          const spectra = await runningSlowAgent();
          spectra.signalGroup(stop);
          const exit = await spectra.exited;
          assert.deepEqual(exit, {code: codeOf(stop), signal: null}, spectra.output);
          assert.match(spectra.output, /The agent has stopped\./);
          assert.doesNotMatch(spectra.output, /Forcing the agent's process to stop/);
          assert.doesNotMatch(spectra.output, /The agent has started, marked/);
        },
      );
    }

    it('holds a Ctrl-C sent to it alone, without passing it on', {timeout: TIMEOUT}, async () => {
      const spectra = await attached();
      spectra.signal('SIGINT');
      assert.equal(await Promise.race([spectra.exited, timeout(1500)]), 'timeout');
      assert.doesNotMatch(spectra.output, /Stopping/);
      spectra.signal('SIGTERM');
      assert.equal((await spectra.exited).code, codeOf('SIGTERM'), spectra.output);
    });

    it(
      "holds the terminal's Ctrl-C, which reaches the binary itself, and stays until it has stopped",
      {timeout: TIMEOUT},
      async () => {
        const spectra = await runningSlowAgent();
        spectra.signalGroup('SIGINT');
        const exit = await spectra.exited;
        assert.deepEqual(exit, {code: codeOf('SIGINT'), signal: null}, spectra.output);
        assert.match(spectra.output, /The agent has stopped\./);
        assert.doesNotMatch(spectra.output, /Forcing the agent's process to stop/);
      },
    );

    it('ends by the signal that ended the binary', {timeout: TIMEOUT}, async () => {
      const spectra = await attached();
      const [child] = descendantsOf(spectra.pid!);
      assert.ok(child !== undefined, "The launcher's binary is found below it.");
      process.kill(child.pid, 'SIGKILL');
      assert.deepEqual(await spectra.exited, {code: null, signal: 'SIGKILL'});
    });
  }

  it('refuses a platform outside the five, naming it and the five', async () => {
    for (const [platform, arch] of [
      ['freebsd', 'x64'],
      ['win32', 'arm64'],
      ['linux', 'ia32'],
    ]) {
      const exit = await refusal(pretending(platform, arch));
      assert.equal(exit.code, 1);
      assert.equal(
        exit.stderr,
        `a2ui-spectra: This platform, ${platform} ${arch}, is not supported. ` +
          `a2ui-spectra runs on ${SUPPORTED}.\n`,
      );
    }
  });

  it('refuses Linux with musl', async () => {
    for (const arch of ['x64', 'arm64']) {
      const exit = await refusal(pretending('linux', arch, false));
      assert.equal(exit.code, 1);
      assert.equal(
        exit.stderr,
        'a2ui-spectra: Linux with musl is not supported. a2ui-spectra runs on Linux with glibc.\n',
      );
    }
  });

  it("refuses when this platform's package is missing, saying how to install it", async () => {
    assert.ok(host !== undefined);
    const exit = await refusal([]);
    assert.equal(exit.code, 1);
    assert.equal(
      exit.stderr,
      `a2ui-spectra: a2ui-spectra-${host[0]}, the package that holds a2ui-spectra's binary ` +
        `for ${host[1]}, is missing. It is one of a2ui-spectra's optional dependencies, which ` +
        'npm leaves out under --omit=optional; install a2ui-spectra again with its optional ' +
        'dependencies.\n',
    );
  });
});
