// The install check: an adopter's install of the binary, each command as the root README's
// install section writes it, from the stand-in registries a release run's publishing steps left,
// or against npm, PyPI and GitHub themselves. One install a run, from any folder:
//
//     node tools/spectra/scripts/install_check.mjs <install> --from <stand-ins|registries> [options]
//
//     npx       the README's npx command, under the Node and npm on PATH
//     uvx       the README's uvx command, under the uv on PATH
//     script    the README's install script command: on macOS and Linux the shell script's,
//               through /bin/sh; on Windows the PowerShell script's, through the PowerShell
//               --shell names, powershell.exe or pwsh.exe
//
//     --from stand-ins        the npm registry and the Python index that A2UI_SPECTRA_STAND_IN_NPM
//                             and A2UI_SPECTRA_STAND_IN_PYPI_INDEX name, as `stand_ins.mjs serve`
//                             sets them; for the script, a stand-in for GitHub here, serving the
//                             commit's install script at the path the README's command names, a
//                             releases list holding the one release, and the release's files from
//                             --github-files <dir>, the script command's raw GitHub origin
//                             changed to the stand-in's
//     --from registries       npm, PyPI and GitHub themselves, nothing substituted
//     --install-dir <dir>     where the script installs, in place of its default folder
//
// Each install runs in a fresh folder outside the checkout, with an empty npm cache and an empty
// uv cache of its own and no user configuration, the registries named by environment alone, and
// the check's own arguments added to the README's command. It must pass three points:
//
// - `--version` prints the committed version.
// - One turn under `run`: Spectra launches the stub agent holding its canned A2UI conversation,
//   the browser not opened; one message is sent through the message box's API; the turn closes
//   waiting for input and carries the canned surface's A2UI messages. Through npx and uvx the
//   turn runs through the channel's own command, and after the script through the installed
//   binary.
// - The stop, as a user at a terminal stops it: a Ctrl-C to the foreground process group on
//   macOS and Linux, and a console Ctrl-C on Windows, through the tests' console helper. The
//   command exits within STOP_BOUND_MS, and the stub agent's process is gone within
//   GONE_BOUND_MS after.
//
// Then, on macOS and Windows, every installed binary must carry no download mark,
// `com.apple.quarantine` on macOS and the `Zone.Identifier` stream on Windows, after a mark
// written on a scratch file in the same folder was read back. macOS's `spctl --status` is printed
// first, and not asserted. The run prints the Node, npm and uv versions it resolved. The stub
// agent is the conformance workspace's, built.

import {spawn, spawnSync} from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual, parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

import {
  binaryName,
  BuildError,
  NAME,
  PLATFORMS,
  readVersion,
  REPO_DIR,
  REPOSITORY,
  runMain,
  TOOL_DIR,
} from './packages.mjs';

export const README = path.join(REPO_DIR, 'README.md');
/** The root README's install section, by its heading. */
export const INSTALL_HEADING = '## Install';
/** Raw GitHub's origin, which the two script commands name. */
export const RAW_GITHUB = 'https://raw.githubusercontent.com';
/** The repository, `owner/repo`. */
const REPO = new URL(REPOSITORY).pathname.slice(1);

const STUB_AGENT = path.join(REPO_DIR, 'conformance', 'dist', 'stub_agent', 'stub_agent.js');
const CONSOLE_HELPER = path.join(TOOL_DIR, 'src', 'testing', 'windows_console.py');

/** How long the command has to exit after the Ctrl-C. */
export const STOP_BOUND_MS = 30_000;
/** How long the stub agent's process has to be gone after the command exited. */
export const GONE_BOUND_MS = 10_000;
/** How long the install, a download from an empty cache, has to bring the agent's card. */
const START_BOUND_MS = 180_000;

const windows = process.platform === 'win32';
const macos = process.platform === 'darwin';

/**
 * The install section's four commands, each by how it is written: the npx and uvx commands, and
 * the shell script's and the PowerShell script's.
 */
export const COMMAND_KINDS = {
  npx: command => /^npx\s/.test(command),
  uvx: command => /^uvx\s/.test(command),
  sh: command => /^curl\s.*\|\s*sh$/.test(command),
  powershell: command => /^irm\s.*\|\s*iex$/.test(command),
};

/**
 * The root README's install commands: every line of every fenced block in the section under
 * `## Install`, up to the next heading of its level or above, each one of the four kinds and
 * each kind once.
 */
export function installCommands(text) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, at) => (line.trim() === INSTALL_HEADING ? [at] : []));
  if (starts.length !== 1) {
    throw new BuildError(
      `README.md holds ${starts.length} sections \`${INSTALL_HEADING}\`, not one.`,
    );
  }
  const end = lines.findIndex((line, at) => at > starts[0] && /^#{1,2} /.test(line));
  const commands = [];
  let fenced = false;
  for (const line of lines.slice(starts[0] + 1, end === -1 ? undefined : end)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (fenced && line.trim() !== '') commands.push(line.trim());
  }
  if (fenced) throw new BuildError("README.md's install section leaves a code block open.");
  const found = {};
  for (const command of commands) {
    const kinds = Object.keys(COMMAND_KINDS).filter(kind => COMMAND_KINDS[kind](command));
    if (kinds.length !== 1) {
      throw new BuildError(
        `README.md's install section holds \`${command}\`, which is none of its four commands.`,
      );
    }
    if (found[kinds[0]] !== undefined) {
      throw new BuildError(`README.md's install section holds two ${kinds[0]} commands.`);
    }
    found[kinds[0]] = command;
  }
  const missing = Object.keys(COMMAND_KINDS).filter(kind => found[kind] === undefined);
  if (missing.length > 0) {
    throw new BuildError(`README.md's install section holds no ${missing.join(', ')} command.`);
  }
  return found;
}

/** The words of the npx or uvx command, which run without a shell, as written. */
export function commandWords(command) {
  const words = command.split(/\s+/);
  const odd = words.filter(word => !/^[\w@./:=+-]+$/.test(word));
  if (odd.length > 0) {
    throw new BuildError(`\`${command}\` holds ${odd.join(' ')}, which needs a shell.`);
  }
  return words;
}

/** The raw GitHub URL a script command names. */
export function scriptUrl(command) {
  const urls = command.match(/https?:\/\/\S+/g) ?? [];
  if (urls.length !== 1 || !urls[0].startsWith(`${RAW_GITHUB}/`)) {
    throw new BuildError(`\`${command}\` names no one script on raw GitHub, ${RAW_GITHUB}.`);
  }
  return new URL(urls[0]);
}

/** A script command as run from the stand-ins: its raw GitHub origin changed to the stand-in's. */
export function fromStandIn(command, origin) {
  scriptUrl(command);
  return command.replace(RAW_GITHUB, origin);
}

/** The file of the commit a raw GitHub path on main names, from the repository's root. */
export function scriptFile(pathname) {
  const prefix = `/${REPO}/main/`;
  const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  if (!/^scripts\/public\/install\.(sh|ps1)$/.test(relative)) {
    throw new BuildError(`${pathname} names no install script on ${REPO}'s main.`);
  }
  return path.join(REPO_DIR, ...relative.split('/'));
}

/**
 * The stand-in for GitHub: at the paths the script commands name, the commit's install scripts;
 * the releases list, holding the one release; and that release's files, from the folder.
 * Resolves with its origin, the requests it took and its close.
 */
export async function githubStandIn({filesDir, version, commands}) {
  const tag = `v${version}`;
  const scripts = new Map(
    commands.map(command => {
      const {pathname} = scriptUrl(command);
      return [pathname, scriptFile(pathname)];
    }),
  );
  const list = /^\/repos\/([^/]+\/[^/]+)\/releases\?per_page=100&page=(\d+)$/;
  const download = `/${REPO}/releases/download/${tag}/`;
  const requests = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    const answer = (status, type, body) =>
      response.writeHead(status, {'content-type': type}).end(body);
    if (request.method !== 'GET') return answer(404, 'text/plain', 'Not found.\n');
    if (scripts.has(url)) {
      return answer(200, 'text/plain; charset=utf-8', readFileSync(scripts.get(url)));
    }
    const page = list.exec(url);
    if (page !== null && page[1] === REPO) {
      const releases = page[2] === '1' ? [{tag_name: tag, draft: false, prerelease: false}] : [];
      return answer(200, 'application/json; charset=utf-8', JSON.stringify(releases, null, 2));
    }
    const name = url.startsWith(download) ? url.slice(download.length) : '';
    if (/^[\w.-]+$/.test(name) && existsSync(path.join(filesDir, name))) {
      return answer(200, 'application/octet-stream', readFileSync(path.join(filesDir, name)));
    }
    return answer(404, 'text/plain', 'Not found.\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** The canned surface's A2UI messages, as the stub agent sends them to the message box. */
export const CANNED_SURFACE = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'greeting',
      catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      sendDataModel: true,
    },
  },
  {
    version: '1.0',
    updateComponents: {
      surfaceId: 'greeting',
      components: [
        {id: 'root', component: 'Column', children: ['question', 'name', 'greet', 'greeting']},
        {id: 'question', component: 'Text', text: "What's your name?"},
        {id: 'name', component: 'TextField', label: 'Your name', value: {'@path': '/name'}},
        {
          id: 'greet',
          component: 'Button',
          child: 'greet_label',
          action: {event: {name: 'greet', context: {name: {'@path': '/name'}}}},
        },
        {id: 'greet_label', component: 'Text', text: 'Greet me'},
        {id: 'greeting', component: 'Text', text: {'@path': '/greeting'}},
      ],
    },
  },
  {version: '1.0', updateDataModel: {surfaceId: 'greeting', value: {greeting: 'Hello!', name: ''}}},
];

/** The A2UI messages a recorded turn's wire outputs carry, in order. */
export function a2uiMessagesOf(turn) {
  return turn.events
    .filter(event => event.attributes['a2ui.event.kind'] === 'wire_output')
    .flatMap(event => event.attributes['a2ui.wire.message'].parts)
    .filter(part => part.type === 'a2ui')
    .flatMap(part => (Array.isArray(part.content) ? part.content : [part.content]));
}

// The machine.

function hostPlatform() {
  const host = PLATFORMS.find(p => p.os === process.platform && p.cpu === process.arch);
  if (host === undefined) {
    throw new BuildError(`The install check runs on the five platforms, not this one.`);
  }
  return host;
}

/** What a command printed, both streams, or why it could not run; it never fails the check. */
function printed(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', windowsHide: true, ...options});
  if (result.error) return `${command} could not start: ${result.error.message}`;
  return `${result.stdout}${result.stderr}`.trim();
}

/** The file a program name resolves to on PATH, as a shell finds it, PATHEXT's on Windows. */
function onPath(name, env) {
  const exts = windows ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  for (const dir of (env[pathKey] ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, `${name}${ext}`);
      if (existsSync(file) && lstatSync(file).isFile()) return file;
    }
  }
  throw new BuildError(`${name} is not on PATH.`);
}

/** A PowerShell script run by Windows PowerShell, as started from Windows, and its output. */
function powershell(script) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'),
  );
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {encoding: 'utf8', env, windowsHide: true},
  );
  if (result.error || result.status !== 0) {
    throw new BuildError(
      `PowerShell failed on ${script}: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function quotedForPowerShell(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The Python that runs the tests' console helper on Windows, a real interpreter's path. */
function consolePython() {
  const result = spawnSync(
    'uv',
    [
      'run',
      '--no-project',
      '--python',
      '3.12',
      'python',
      '-c',
      'import sys; print(sys.executable)',
    ],
    {encoding: 'utf8', cwd: tmpdir(), windowsHide: true},
  );
  if (result.error || result.status !== 0) {
    throw new BuildError(`uv found no Python 3.12: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

/** Every process whose command line holds all the texts, by id, as `ps` or Win32_Process lists it. */
function processesWith(texts) {
  const rows = windows
    ? powershell(
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
      )
    : printed('ps', ['-A', '-ww', '-o', 'pid=,args=']);
  const wanted = texts.map(text => (windows ? text.toLowerCase() : text));
  return rows
    .split(/\r?\n/)
    .map(row => /^\s*(\d+)\s+(.*)$/.exec(row))
    .filter(match => match !== null && Number(match[1]) !== process.pid)
    .filter(([, , line]) =>
      wanted.every(text => (windows ? line.toLowerCase() : line).includes(text)),
    )
    .map(([, pid, line]) => ({pid: Number(pid), line: line.trim()}));
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function eventually(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return check();
}

function within(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise(resolve => (timer = setTimeout(() => resolve('timeout'), ms))),
  ]);
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

/**
 * A command started as a user at a terminal starts it: on macOS and Linux leading a process
 * group of its own, which stands for the terminal's foreground group; on Windows in a console of
 * its own, through the tests' console helper.
 */
function started(argv, {cwd, env, python}) {
  const child = windows
    ? spawn(python, [CONSOLE_HELPER, 'run', '--', ...argv], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    : spawn(argv[0], argv.slice(1), {cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
  const run = {output: '', stdout: '', listeners: new Set()};
  for (const [stream, name] of [
    [child.stdout, 'stdout'],
    [child.stderr, 'stderr'],
  ]) {
    stream.setEncoding('utf8').on('data', chunk => {
      run.output += chunk;
      if (name === 'stdout') run.stdout += chunk;
      for (const listener of run.listeners) listener();
    });
  }
  run.exited = new Promise(resolve => {
    child.once('error', error => {
      run.output += `${argv[0]} could not start: ${error.message}\n`;
      resolve({code: null, signal: null});
    });
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  run.ended = false;
  void run.exited.then(() => {
    run.ended = true;
    for (const listener of run.listeners) listener();
  });
  run.waitFor = (pattern, ms) =>
    new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        run.listeners.delete(check);
      };
      const check = () => {
        if (pattern.test(run.output)) {
          done();
          resolve();
        } else if (run.ended) {
          done();
          reject(new BuildError(`${argv[0]} exited before ${pattern}:\n${run.output.trim()}`));
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new BuildError(`No ${pattern} within ${ms / 1000} s:\n${run.output.trim()}`));
      }, ms);
      run.listeners.add(check);
      check();
    });
  run.ctrlC = () => {
    if (windows) child.stdin.write('ctrl-c\n');
    else process.kill(-child.pid, 'SIGINT');
  };
  run.kill = () => {
    try {
      // On Windows the helper's Job Object ends whatever the command started.
      if (windows) child.kill();
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already ended.
    }
  };
  return run;
}

async function getJson(url) {
  const response = await fetch(url);
  return {status: response.status, body: await response.json()};
}

// The three points.

async function expectVersion(argv, options, version) {
  const run = started([...argv, '--version'], options);
  const exit = await within(run.exited, START_BOUND_MS);
  if (exit === 'timeout') {
    run.kill();
    throw new BuildError(`${argv.join(' ')} --version did not exit:\n${run.output.trim()}`);
  }
  if (exit.code !== 0 || run.stdout.trim() !== version) {
    throw new BuildError(
      `${argv.join(' ')} --version exited with ${exit.code ?? exit.signal} and printed ${JSON.stringify(run.stdout.trim())}, not ${version}:\n${run.output.trim()}`,
    );
  }
  console.log(`--version printed ${version}.`);
}

/** One turn under `run`, then the stop; resolves with what the stop took. */
async function turnAndStop(argv, options) {
  const [agentPort, port, proxyPort, modelProxyPort, receiverPort] = await Promise.all(
    Array.from({length: 5}, freePort),
  );
  const run = started(
    [
      ...argv,
      'run',
      ...['--agent-url', `http://127.0.0.1:${agentPort}`, '--port', String(port)],
      ...['--proxy-port', String(proxyPort), '--model-proxy-port', String(modelProxyPort)],
      ...['--receiver-port', String(receiverPort), '--no-open'],
      ...['--', process.execPath, STUB_AGENT, '--port', String(agentPort), '--canned-a2ui'],
    ],
    options,
  );
  let stubs = [];
  try {
    await run.waitFor(/The agent's card answered: Spectra stub agent\./, START_BOUND_MS);
    // The stub agent, and every process whose command line carries its command.
    stubs = processesWith([STUB_AGENT, `--port ${agentPort} --canned-a2ui`]);
    if (stubs.length === 0) {
      throw new BuildError(`No process of the stub agent was found:\n${run.output.trim()}`);
    }

    // The turn, through the message box's API.
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(`${base}/api/message-box/messages`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({text: 'Hello'}),
    });
    const sent = await response.json();
    if (response.status !== 200 || typeof sent.traceId !== 'string') {
      throw new BuildError(`The message box answered ${response.status}: ${JSON.stringify(sent)}`);
    }
    const closed = await eventually(async () => {
      const {body} = await getJson(`${base}/api/turns`);
      return body.turns.some(turn => turn.traceId === sent.traceId && turn.open === undefined);
    }, 30_000);
    if (!closed) throw new BuildError(`The turn ${sent.traceId} did not close within 30 s.`);
    const {body: record} = await getJson(`${base}/api/turns/${sent.traceId}`);
    const turn = record.turns.at(-1);
    const turnEvent = turn.events.find(event => event.attributes['a2ui.event.kind'] === 'turn');
    const outcome = turnEvent?.attributes['a2ui.turn.outcome'];
    if (turnEvent?.traceId !== sent.traceId || outcome !== 'waiting_for_input') {
      throw new BuildError(`The turn closed ${outcome}, not waiting_for_input.`);
    }
    const messages = a2uiMessagesOf(turn);
    if (!isDeepStrictEqual(messages, CANNED_SURFACE)) {
      throw new BuildError(
        `The turn carries other A2UI messages than the canned surface's:\n${JSON.stringify(messages, null, 2)}`,
      );
    }
    console.log(
      `The turn closed waiting for input, with the canned surface's ${messages.length} A2UI messages.`,
    );

    // The stop.
    const stopped = Date.now();
    run.ctrlC();
    const exit = await within(run.exited, STOP_BOUND_MS);
    if (exit === 'timeout') {
      throw new BuildError(
        `The command did not exit within ${STOP_BOUND_MS / 1000} s of the Ctrl-C:\n${run.output.trim()}`,
      );
    }
    const exitedIn = Date.now() - stopped;
    const gone = await eventually(() => stubs.every(stub => !isRunning(stub.pid)), GONE_BOUND_MS);
    if (!gone) {
      const left = stubs.filter(stub => isRunning(stub.pid));
      throw new BuildError(
        `The stub agent's process is left ${GONE_BOUND_MS / 1000} s after the command exited: ${left.map(stub => `${stub.pid}, ${stub.line}`).join('; ')}\n${run.output.trim()}`,
      );
    }
    const forced = /Forcing the agent's process to stop/.test(run.output);
    console.log(
      `The Ctrl-C: the command exited with ${exit.code ?? exit.signal} after ${(exitedIn / 1000).toFixed(1)} s, and the stub agent's process is gone${forced ? ', forced' : ''}.`,
    );
    return {exitedIn, exit: exit.code ?? exit.signal, forced};
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(run.output.trim());
    throw error;
  } finally {
    if (!run.ended) {
      run.kill();
      await within(run.exited, 10_000);
    }
    for (const stub of stubs) {
      if (isRunning(stub.pid)) {
        try {
          process.kill(stub.pid, 'SIGKILL');
        } catch {
          // Already ended.
        }
      }
    }
  }
}

// The download mark.

export const MARK = macos ? 'com.apple.quarantine' : 'Zone.Identifier';

/** Whether a file's first bytes are an executable's on this platform: Mach-O, or PE. */
function isExecutable(file) {
  const head = Buffer.alloc(4);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, head, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  if (windows) return head.subarray(0, 2).toString('latin1') === 'MZ';
  return ['cffaedfe', 'cafebabe'].includes(head.toString('hex'));
}

/** Every installed binary under the folders: a file, not a link, of the binary's name. */
export function binariesUnder(dirs, name) {
  const found = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name === name && isExecutable(file)) found.push(file);
    }
  };
  for (const dir of dirs) if (existsSync(dir)) walk(dir);
  return found;
}

function writeMark(file) {
  if (macos) {
    const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};a2ui-spectra install check;`;
    printed('xattr', ['-w', MARK, value, file]);
    return value;
  }
  const value = '[ZoneTransfer]\r\nZoneId=3';
  powershell(
    `Set-Content -LiteralPath ${quotedForPowerShell(file)} -Stream ${MARK} -Value ${quotedForPowerShell(value)}`,
  );
  return value;
}

function readMark(file) {
  if (macos) {
    const result = spawnSync('xattr', ['-p', MARK, file], {encoding: 'utf8'});
    return result.status === 0 ? result.stdout.trim() : undefined;
  }
  const streams = marksOf(file);
  if (!streams.includes(MARK)) return undefined;
  return powershell(
    `Get-Content -LiteralPath ${quotedForPowerShell(file)} -Stream ${MARK} -Raw`,
  ).trim();
}

/** A file's extended attributes on macOS, or its streams on Windows, by name. */
function marksOf(file) {
  const text = macos
    ? printed('xattr', [file])
    : powershell(
        `Get-Item -LiteralPath ${quotedForPowerShell(file)} -Stream * | ForEach-Object { $_.Stream }`,
      );
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/** Fails when an installed binary carries the download mark, after a mark read back beside it. */
export function expectNoMark(binaries) {
  if (binaries.length === 0) throw new BuildError('No installed binary was found.');
  for (const binary of binaries) {
    const scratch = path.join(path.dirname(binary), `.a2ui-spectra-mark-check-${process.pid}`);
    writeFileSync(scratch, "The install check's scratch file.\n");
    try {
      const value = writeMark(scratch);
      const back = readMark(scratch);
      if (back !== value.trim()) {
        throw new BuildError(
          `A ${MARK} written on a scratch file in ${path.dirname(binary)} read back as ${JSON.stringify(back)}, not ${JSON.stringify(value)}.`,
        );
      }
    } finally {
      rmSync(scratch, {force: true});
    }
    const marks = marksOf(binary);
    if (marks.includes(MARK)) {
      throw new BuildError(`${binary} carries the download mark, ${MARK}.`);
    }
    console.log(
      `${binary}: no ${MARK}, after one written beside it read back; ${macos ? 'its extended attributes' : 'its streams'}: ${marks.join(', ') || 'none'}.`,
    );
  }
}

// The installs.

/** The environment of an install: this one's, without what would choose a registry or a cache. */
function adopterEnv(scratch) {
  const kept = Object.entries(process.env).filter(([key]) => {
    const name = key.toUpperCase();
    return !['A2UI_SPECTRA_', 'NPM_CONFIG_', 'UV_'].some(prefix => name.startsWith(prefix));
  });
  const npmrc = path.join(scratch, 'npmrc');
  writeFileSync(npmrc, '');
  return {
    ...Object.fromEntries(kept),
    npm_config_cache: path.join(scratch, 'npm-cache'),
    npm_config_userconfig: npmrc,
    UV_CACHE_DIR: path.join(scratch, 'uv-cache'),
    UV_TOOL_DIR: path.join(scratch, 'uv-tools'),
    UV_NO_CONFIG: '1',
  };
}

function standInVariable(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new BuildError(`${name} names no stand-in; start them with \`stand_ins.mjs serve\`.`);
  }
  return value;
}

/** The folder the script installs into by default, as each script computes it. */
function defaultInstallDir(env) {
  if (windows) return path.join(env.LOCALAPPDATA, 'Programs', NAME, 'bin');
  return env.XDG_BIN_HOME || path.join(env.HOME ?? homedir(), '.local', 'bin');
}

function runToEnd(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => (output += chunk));
    child.on('error', error => reject(new BuildError(`${argv[0]} could not start: ${error}`)));
    child.on('close', code => resolve({code, output}));
  });
}

/** The install script's command, run as written in its shell, from the stand-in for GitHub. */
async function installByScript({command, from, githubFiles, installDir, shell, env, version}) {
  let standIn;
  if (from === 'stand-ins') {
    if (githubFiles === undefined) throw new BuildError('--from stand-ins needs --github-files.');
    standIn = await githubStandIn({
      filesDir: path.resolve(githubFiles),
      version,
      commands: [command],
    });
    command = fromStandIn(command, standIn.origin);
    env = {
      ...env,
      A2UI_SPECTRA_GITHUB_URL: standIn.origin,
      A2UI_SPECTRA_GITHUB_API_URL: standIn.origin,
    };
  }
  if (installDir !== undefined) env = {...env, A2UI_SPECTRA_INSTALL_DIR: installDir};
  if (shell === 'powershell.exe') {
    // Windows PowerShell composes its own module path, as when started from Windows.
    env = Object.fromEntries(
      Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'),
    );
  }
  const argv = windows
    ? [shell, '-NoProfile', '-NonInteractive', '-Command', command]
    : ['/bin/sh', '-c', command];
  console.log(`${argv.join(' ')}`);
  try {
    const {code, output} = await runToEnd(argv, env);
    console.log(output.trim());
    if (code !== 0) throw new BuildError(`The install script exited with ${code}.`);
    if (!/SHA-256 checksum verified\./.test(output)) {
      throw new BuildError("The install script did not verify the archive's checksum.");
    }
  } finally {
    await standIn?.close();
  }
}

async function main({install, from, githubFiles, installDir, shell}) {
  const host = hostPlatform();
  const version = readVersion();
  const commands = installCommands(readFileSync(README, 'utf8'));
  if (!['npx', 'uvx', 'script'].includes(install)) {
    throw new BuildError(`Name an install: npx, uvx or script, not ${install}.`);
  }
  if (!['stand-ins', 'registries'].includes(from)) {
    throw new BuildError('--from takes stand-ins or registries.');
  }
  if (install === 'script' && windows !== ['powershell.exe', 'pwsh.exe'].includes(shell)) {
    throw new BuildError(
      windows
        ? 'On Windows the script runs under --shell powershell.exe or --shell pwsh.exe.'
        : '--shell is for Windows; the shell script runs through /bin/sh.',
    );
  }
  if (!existsSync(STUB_AGENT)) {
    throw new BuildError(`${STUB_AGENT} is not built: build the conformance workspace first.`);
  }

  const shellNote = shell === undefined ? '' : `, under ${shell}`;
  const title = `${install}${shellNote} on ${host.words}, from ${from === 'stand-ins' ? 'the stand-ins' : 'npm, PyPI and GitHub'}`;
  console.log(`The install check: ${title}.`);
  const versions = [
    `Node ${printed('node', ['--version'])}`,
    // On Windows npm is a batch file, which runs through the shell.
    `npm ${windows ? printed('npm --version', [], {shell: true}) : printed('npm', ['--version'])}`,
    printed('uv', ['--version']),
  ];
  console.log(`Resolved: ${versions.join(', ')}.`);
  if (macos) console.log(`spctl --status: ${printed('spctl', ['--status'])}`);

  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-install-check-'));
  const cwd = path.join(scratch, 'work');
  mkdirSync(cwd);
  const env = adopterEnv(scratch);
  const python = windows ? consolePython() : undefined;
  const options = {cwd, env, python};
  const began = Date.now();
  let installed;
  let argv;
  try {
    if (install === 'npx' || install === 'uvx') {
      const words = commandWords(commands[install]);
      if (from === 'stand-ins') {
        if (install === 'npx')
          env.npm_config_registry = standInVariable('A2UI_SPECTRA_STAND_IN_NPM');
        else env.UV_DEFAULT_INDEX = standInVariable('A2UI_SPECTRA_STAND_IN_PYPI_INDEX');
      }
      console.log(`${commands[install]}, from ${cwd}`);
      argv = [windows ? onPath(words[0], env) : words[0], ...words.slice(1)];
    } else {
      const dir = installDir === undefined ? defaultInstallDir(env) : path.resolve(installDir);
      installed = path.join(dir, binaryName(host));
      rmSync(installed, {force: true});
      await installByScript({
        command: windows ? commands.powershell : commands.sh,
        from,
        githubFiles,
        installDir,
        shell,
        env,
        version,
      });
      if (!existsSync(installed)) throw new BuildError(`The script installed no ${installed}.`);
      argv = [installed];
    }
    await expectVersion(argv, options, version);
    const stop = await turnAndStop(argv, options);
    let marks = 'not asserted on Linux';
    if (macos || windows) {
      const binaries =
        installed !== undefined
          ? [installed]
          : binariesUnder(
              install === 'npx' ? [env.npm_config_cache] : [env.UV_CACHE_DIR, env.UV_TOOL_DIR],
              binaryName(host),
            );
      expectNoMark(binaries);
      marks = `no ${MARK} on ${binaries.length} binar${binaries.length === 1 ? 'y' : 'ies'}`;
    }
    const took = ((Date.now() - began) / 1000).toFixed(1);
    const line = `${title}: passed in ${took} s. ${versions.join(', ')}. --version printed ${version}; the turn closed waiting for input with the canned surface; the Ctrl-C ended the command with ${stop.exit} after ${(stop.exitedIn / 1000).toFixed(1)} s and the stub agent${stop.forced ? ', forced' : ''}; ${marks}.`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
  } finally {
    if (installed !== undefined && installDir === undefined) rmSync(installed, {force: true});
    rmSync(scratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 500});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMain('install check', async () => {
    const {values, positionals} = parseArgs({
      options: {
        from: {type: 'string'},
        'github-files': {type: 'string'},
        'install-dir': {type: 'string'},
        shell: {type: 'string'},
      },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length !== 1 || values.from === undefined) {
      throw new BuildError(
        'Run it as `node install_check.mjs <npx|uvx|script> --from <stand-ins|registries>`.',
      );
    }
    await main({
      install: positionals[0],
      from: values.from,
      githubFiles: values['github-files'],
      installDir: values['install-dir'],
      shell: values.shell,
    });
  });
}
