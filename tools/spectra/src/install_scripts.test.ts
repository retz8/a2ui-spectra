/**
 * The install scripts, `scripts/public/install.sh` and `scripts/public/install.ps1`, run as an
 * adopter runs them, against two local stand-ins for GitHub: one serving the releases list, named
 * by `A2UI_SPECTRA_GITHUB_API_URL`, and one serving the script itself and the release's files,
 * named by `A2UI_SPECTRA_GITHUB_URL`. One case table holds both scripts' cases, with upstream's
 * test of its own scripts, `scripts/test_install_cli.sh` at the pin, as the reference for them.
 *
 * On macOS and Linux the shell script runs: every case under `/bin/sh`, and the good install also
 * under `dash` and `bash` where the machine has them. On Windows the PowerShell script runs, every
 * case under `powershell.exe` and again under `pwsh.exe`; the user's `Path` is read before those
 * cases and written back after. Every case runs the script piped, as the README's commands do,
 * and the good install also from a file.
 *
 * The release's archive is built here, in the release archives' shape, from this platform's
 * binary: the one SPECTRA_BINARY names, or under Node on macOS and Linux a stand-in script that
 * runs Spectra under Node. Under Node on Windows, where no script stands in for a binary, the
 * cases that run the installed binary are skipped.
 */
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {binary} from './testing/spectra_process.js';
import {VERSION} from './version.js';

const windows = process.platform === 'win32';
const binaryFile = binary !== undefined && binary !== '' ? path.resolve(binary) : undefined;
const runsBinary = binaryFile !== undefined || !windows;
const TIMEOUT = 180_000;

const SCRIPT = windows ? 'install.ps1' : 'install.sh';
const SCRIPT_FILE = fileURLToPath(new URL(`../../../scripts/public/${SCRIPT}`, import.meta.url));
const LICENSE_FILE = fileURLToPath(new URL('../../../LICENSE', import.meta.url));
const README_FILE = fileURLToPath(new URL('../README.md', import.meta.url));
const CLI_SCRIPT = fileURLToPath(new URL('./cli.js', import.meta.url));

const DEFAULT_REPO = 'retz8/a2ui-spectra';
const TAG = `v${VERSION}`;
/** The five platforms, by Node's platform and architecture, as the archives name them. */
const TARGETS: Record<string, string> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'win32-x64': 'windows-x64',
};
const target = TARGETS[`${process.platform}-${process.arch}`];
const BINARY_NAME = windows ? 'a2ui-spectra.exe' : 'a2ui-spectra';
const archiveName = (platform: string) =>
  `a2ui-spectra-v${VERSION}-${platform}${platform.startsWith('windows') ? '.zip' : '.tar.gz'}`;
const ARCHIVE = archiveName(target ?? 'unknown');

const roots: string[] = [];
function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// --- The stand-ins -------------------------------------------------------------------------------

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
}

const release = (tag: string, {draft = false, prerelease = false} = {}): Release => ({
  tag_name: tag,
  draft,
  prerelease,
});

/** What the stand-ins serve, set by each case. */
interface Serving {
  /** The repository, `owner/repo`, whose releases they serve. */
  repo: string;
  /** The releases list's pages, from page 1; a page past them is empty. */
  pages: Release[][];
  /** A page of the list that fails, as GitHub's does when rate limited. */
  failingPage?: number;
  /** The files of the release tagged `v<version>`, by name. */
  files: Record<string, Buffer>;
}

let serving: Serving;

interface StandIn {
  url: string;
  requests: string[];
  server: Server;
}

interface Answer {
  status: number;
  type?: string;
  body: string | Buffer;
}

const NOT_FOUND: Answer = {status: 404, type: 'application/json', body: '{"message":"Not Found"}'};

async function standIn(answer: (url: string) => Answer): Promise<StandIn> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push(url);
    const {status, type, body} = request.method === 'GET' ? answer(url) : NOT_FOUND;
    response.writeHead(status, {'content-type': type ?? 'application/octet-stream'});
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {url: `http://127.0.0.1:${port}`, requests, server};
}

/** GitHub's REST API: the releases list alone. */
function answerApi(url: string): Answer {
  const match = /^\/repos\/([^/]+\/[^/]+)\/releases\?per_page=100&page=(\d+)$/.exec(url);
  if (match === null || match[1] !== serving.repo) return NOT_FOUND;
  const page = Number(match[2]);
  if (page === serving.failingPage) {
    return {status: 403, type: 'application/json', body: '{"message":"API rate limit exceeded"}'};
  }
  return {
    status: 200,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify(serving.pages[page - 1] ?? [], null, 2),
  };
}

/** GitHub's web origin and raw GitHub: the script, and the release's files. */
function answerFiles(url: string): Answer {
  if (url === `/scripts/public/${SCRIPT}`) {
    return {status: 200, type: 'text/plain; charset=utf-8', body: readFileSync(SCRIPT_FILE)};
  }
  const prefix = `/${serving.repo}/releases/download/${TAG}/`;
  if (!url.startsWith(prefix)) return NOT_FOUND;
  const file = serving.files[url.slice(prefix.length)];
  return file === undefined ? NOT_FOUND : {status: 200, body: file};
}

let api: StandIn;
let files: StandIn;

// --- The release ---------------------------------------------------------------------------------

let archive: Buffer;
let checksums: Buffer;

/** The release archive, flat, as the packaging command makes it: the binary, the licence, the notices and the README. */
function buildArchive(): Buffer {
  const staged = freshDir('spectra-install-archive-');
  const binaryPath = path.join(staged, BINARY_NAME);
  if (binaryFile !== undefined) {
    copyFileSync(binaryFile, binaryPath);
  } else if (!windows) {
    const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    writeFileSync(
      binaryPath,
      `#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(CLI_SCRIPT)} "$@"\n`,
    );
  } else {
    writeFileSync(binaryPath, 'No binary stands in under Node on Windows.\n');
  }
  chmodSync(binaryPath, 0o755);
  copyFileSync(LICENSE_FILE, path.join(staged, 'LICENSE'));
  writeFileSync(
    path.join(staged, 'THIRD_PARTY_NOTICES.md'),
    "# Third-party notices\n\nThe install scripts' test archive.\n",
  );
  copyFileSync(README_FILE, path.join(staged, 'README.md'));
  const names = [BINARY_NAME, 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'];
  const out = path.join(freshDir('spectra-install-release-'), ARCHIVE);
  const [command, args]: [string, string[]] = windows
    ? // Windows' own bsdtar, which writes a zip for a .zip name.
      [
        path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
        ['-a', '-c', '-f', out, '-C', staged, ...names],
      ]
    : ['tar', ['-czf', out, '-C', staged, ...names]];
  const result = spawnSync(command, args, {encoding: 'utf8'});
  assert.equal(result.status, 0, `${command} did not make the archive: ${result.stderr}`);
  return readFileSync(out);
}

/** checksums.txt in sha256sum's format, listing the five archives, this platform's verifying. */
function checksumsFor(archiveHash: string, {missing = false} = {}): Buffer {
  return Buffer.from(
    Object.values(TARGETS)
      .map(archiveName)
      .filter(name => !(missing && name === ARCHIVE))
      .sort()
      .map(name => `${name === ARCHIVE ? archiveHash : sha256(Buffer.from(name))}  ${name}\n`)
      .join(''),
  );
}

/** The release as published: one tag, its archive and checksums.txt. */
function published(): Serving {
  return {
    repo: DEFAULT_REPO,
    pages: [[release(TAG)]],
    files: {[ARCHIVE]: archive, 'checksums.txt': checksums},
  };
}

// --- The interpreters and the two forms ----------------------------------------------------------

type Form = 'piped' | 'from a file';

interface Interpreter {
  name: string;
  argv(form: Form, scriptUrl: string): string[];
}

function onPath(name: string): string | undefined {
  const found = spawnSync('/bin/sh', ['-c', `command -v ${name}`], {encoding: 'utf8'});
  return found.status === 0 ? found.stdout.trim() : undefined;
}

function shell(name: string, file: string): Interpreter {
  return {
    name,
    argv: (form, scriptUrl) =>
      form === 'piped'
        ? ['/bin/sh', '-c', 'curl -fsSL "$1" | "$2"', 'sh', scriptUrl, file]
        : [file, SCRIPT_FILE],
  };
}

function powershell(name: string): Interpreter {
  return {
    name,
    argv: (form, scriptUrl) =>
      form === 'piped'
        ? [name, '-NoProfile', '-NonInteractive', '-Command', `irm ${scriptUrl} | iex`]
        : [
            name,
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            SCRIPT_FILE,
          ],
  };
}

/** Every interpreter of this platform; the first runs every case. */
function interpreters(): Interpreter[] {
  if (windows) return [powershell('powershell.exe'), powershell('pwsh.exe')];
  const found = [shell('/bin/sh', '/bin/sh')];
  for (const name of ['dash', 'bash']) {
    const file = onPath(name);
    if (file !== undefined) found.push(shell(name, file));
  }
  return found;
}

// --- Running a script ----------------------------------------------------------------------------

/** The stub `uname`, which answers STUB_UNAME_S and STUB_UNAME_M when they are set. */
let stubs: string;
/** A stub `ldd` that reports musl, as musl's own does. */
let muslStubs: string;

function writeStubs(): void {
  stubs = freshDir('spectra-install-stubs-');
  const uname = onPath('uname') ?? '/usr/bin/uname';
  writeFileSync(
    path.join(stubs, 'uname'),
    [
      '#!/bin/sh',
      'case "${1:-}" in',
      '  -s) if [ -n "${STUB_UNAME_S:-}" ]; then echo "$STUB_UNAME_S"; exit 0; fi ;;',
      '  -m) if [ -n "${STUB_UNAME_M:-}" ]; then echo "$STUB_UNAME_M"; exit 0; fi ;;',
      'esac',
      `exec '${uname}' "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(path.join(stubs, 'uname'), 0o755);
  muslStubs = freshDir('spectra-install-musl-');
  writeFileSync(
    path.join(muslStubs, 'ldd'),
    '#!/bin/sh\necho "musl libc (x86_64)" >&2\necho "Version 1.2.5" >&2\nexit 1\n',
  );
  chmodSync(path.join(muslStubs, 'ldd'), 0o755);
}

interface Run {
  code: number | null;
  output: string;
  installDir: string;
  home: string;
  /** The requests each stand-in took, the script's own left out. */
  apiRequests: string[];
  fileRequests: string[];
}

interface RunOptions {
  env?: Record<string, string | undefined>;
  installDir?: string;
  musl?: boolean;
}

function commandOutput(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{code: number | null; output: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.on('error', error => reject(new Error(`${argv[0]} could not start: ${error.message}`)));
    child.on('close', code => resolve({code, output}));
  });
}

/** The script run by the interpreter in the form, against the stand-ins. */
async function install(
  interpreter: Interpreter,
  form: Form,
  {env = {}, installDir, musl = false}: RunOptions = {},
): Promise<Run> {
  const dir = installDir ?? path.join(freshDir('spectra-install-to-'), 'bin');
  const home = freshDir('spectra-install-home-');
  const base: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('A2UI_SPECTRA_')) base[key] = value;
  }
  const full: NodeJS.ProcessEnv = {
    ...base,
    A2UI_SPECTRA_GITHUB_URL: files.url,
    A2UI_SPECTRA_GITHUB_API_URL: api.url,
    A2UI_SPECTRA_INSTALL_DIR: dir,
  };
  if (!windows) {
    full.PATH = [...(musl ? [muslStubs] : []), stubs, process.env.PATH ?? ''].join(path.delimiter);
    full.HOME = home;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete full[key];
    else full[key] = value;
  }
  api.requests.length = 0;
  files.requests.length = 0;
  const scriptPath = `/scripts/public/${SCRIPT}`;
  const {code, output} = await commandOutput(
    interpreter.argv(form, `${files.url}${scriptPath}`),
    full,
  );
  return {
    code,
    output,
    installDir: dir,
    home,
    apiRequests: [...api.requests],
    fileRequests: files.requests.filter(url => url !== scriptPath),
  };
}

// --- The user's Path, on Windows -----------------------------------------------------------------

interface UserPath {
  exists: boolean;
  kind?: string;
  value?: string;
}

/** A PowerShell command run by whichever PowerShell this machine has, pwsh first. */
function powershellOutput(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  for (const exe of ['pwsh.exe', 'powershell.exe']) {
    const result = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      env,
      windowsHide: true,
    });
    if (result.error !== undefined) continue;
    assert.equal(result.status, 0, `${exe} failed: ${result.stderr}`);
    return result.stdout;
  }
  throw new Error('Neither pwsh.exe nor powershell.exe is on this machine.');
}

function readUserPath(): UserPath {
  return JSON.parse(
    powershellOutput(
      [
        "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')",
        "if ($key -and ($key.GetValueNames() -contains 'Path')) {",
        "  @{exists = $true; kind = $key.GetValueKind('Path').ToString();",
        "    value = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)} | ConvertTo-Json -Compress",
        '} else { \'{"exists":false}\' }',
      ].join('\n'),
    ),
  ) as UserPath;
}

function writeUserPath(saved: UserPath): void {
  powershellOutput(
    [
      '$saved = $env:SPECTRA_TEST_USER_PATH | ConvertFrom-Json',
      "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
      'try {',
      "  if ($saved.exists) { $key.SetValue('Path', $saved.value, [Microsoft.Win32.RegistryValueKind]$saved.kind) }",
      "  else { $key.DeleteValue('Path', $false) }",
      '} finally { $key.Dispose() }',
    ].join('\n'),
    {...process.env, SPECTRA_TEST_USER_PATH: JSON.stringify(saved)},
  );
}

/** How many of the user's Path entries name the folder. */
function timesOnUserPath(dir: string): number {
  return (readUserPath().value ?? '')
    .split(';')
    .filter(entry => entry.replace(/[\\/]+$/, '').toLowerCase() === dir.toLowerCase()).length;
}

// --- What a run must show ------------------------------------------------------------------------

/**
 * The output read past line breaks and spacing, which a PowerShell's error view may wrap, and
 * past the bar PowerShell 7's concise view starts a wrapped message's lines with.
 */
function says(run: Run, text: string): boolean {
  const flat = (s: string) =>
    s
      .replaceAll('_x000D__x000A_', '')
      .replace(/\r?\n[ \t]*\|[ \t]?/g, ' ')
      .replace(/\s+/g, '');
  return flat(run.output).includes(flat(text));
}

function assertSays(run: Run, text: string): void {
  assert.ok(says(run, text), `The output does not say "${text}":\n${run.output}`);
}

/** A good install: the binary alone in the folder, printing its version, and the PATH handled. */
function assertInstalled(run: Run): void {
  assert.equal(run.code, 0, run.output);
  assert.deepEqual(readdirSync(run.installDir), [BINARY_NAME], run.output);
  if (runsBinary) {
    const printed = spawnSync(path.join(run.installDir, BINARY_NAME), ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(printed.stdout, `${VERSION}\n`, printed.stderr);
  }
  if (windows) {
    assert.equal(timesOnUserPath(run.installDir), 1, run.output);
  } else {
    assertSays(run, `${run.installDir} is not currently in your PATH`);
    assertSays(run, `export PATH="${run.installDir}:$PATH"`);
    assert.deepEqual(readdirSync(run.home), [], 'No file under HOME is written.');
  }
}

/** A refusal: a failing exit, the message, and nothing installed. */
function assertRefused(run: Run, ...texts: string[]): void {
  assert.notEqual(run.code, 0, run.output);
  for (const text of texts) assertSays(run, text);
  assert.ok(
    !existsSync(run.installDir) || readdirSync(run.installDir).length === 0,
    `Nothing is installed:\n${run.output}`,
  );
}

const downloads = (repo: string, ...names: string[]) =>
  names.map(name => `/${repo}/releases/download/${TAG}/${name}`);
const listPage = (repo: string, page: number) =>
  `/repos/${repo}/releases?per_page=100&page=${page}`;

// --- The cases -----------------------------------------------------------------------------------

const SH = 'install.sh';
const PS1 = 'install.ps1';

interface Case {
  name: string;
  /** The scripts it is a case of. */
  scripts: readonly string[];
  /** The good install: under every interpreter, piped and from a file. */
  everywhere?: boolean;
  /** Whether it runs the installed binary. */
  runsBinary?: boolean;
  run(interpreter: Interpreter, form: Form): Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'refuses an operating system other than macOS and Linux',
    scripts: [SH],
    async run(interpreter, form) {
      const run = await install(interpreter, form, {env: {STUB_UNAME_S: 'Solaris'}});
      assertRefused(
        run,
        "Error: Unsupported operating system 'Solaris'.",
        `irm https://raw.githubusercontent.com/${DEFAULT_REPO}/main/scripts/public/install.ps1 | iex`,
      );
    },
  },
  {
    name: 'installs the release, its checksum verified',
    scripts: [SH, PS1],
    everywhere: true,
    runsBinary: true,
    async run(interpreter, form) {
      const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: VERSION}});
      assertInstalled(run);
      assertSays(run, 'SHA-256 checksum verified.');
      assertSays(run, `Successfully installed a2ui-spectra (${TAG})`);
      assert.deepEqual(run.apiRequests, []);
      assert.deepEqual(run.fileRequests, downloads(DEFAULT_REPO, ARCHIVE, 'checksums.txt'));
    },
  },
  {
    name: 'stops on a checksum mismatch',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      serving.files['checksums.txt'] = checksumsFor('0'.repeat(64));
      const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: VERSION}});
      assertRefused(run, `Cryptographic checksum mismatch for ${ARCHIVE}!`);
    },
  },
  {
    name: 'stops when checksums.txt does not list the archive',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      serving.files['checksums.txt'] = checksumsFor('', {missing: true});
      const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: VERSION}});
      assertRefused(run, `${ARCHIVE} not found in checksums.txt!`);
    },
  },
  {
    name: 'stops when checksums.txt is missing, naming the bypass',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      delete serving.files['checksums.txt'];
      const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: VERSION}});
      assertRefused(run, 'Failed to download checksums.txt from', 'A2UI_SPECTRA_SKIP_CHECKSUM');
    },
  },
  {
    name: 'installs with no checksums.txt under A2UI_SPECTRA_SKIP_CHECKSUM=1, with a warning',
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      delete serving.files['checksums.txt'];
      const run = await install(interpreter, form, {
        env: {A2UI_SPECTRA_VERSION: VERSION, A2UI_SPECTRA_SKIP_CHECKSUM: '1'},
      });
      assertInstalled(run);
      assertSays(run, 'A2UI_SPECTRA_SKIP_CHECKSUM=1 set; skipping checksum verification.');
      assert.deepEqual(run.fileRequests, downloads(DEFAULT_REPO, ARCHIVE));
    },
  },
  {
    name: 'installs the latest release, passing over other tags and pre-releases',
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      serving.pages = [
        [
          release('a2ui-core-v0.4.0'),
          release('v9.9.9-rc.1', {prerelease: true}),
          release(TAG),
          release('v0.0.1'),
        ],
      ];
      const run = await install(interpreter, form);
      assertInstalled(run);
      assertSays(run, `Downloading a2ui-spectra (${TAG}) for ${target}...`);
      assert.deepEqual(run.apiRequests, [listPage(DEFAULT_REPO, 1)]);
    },
  },
  {
    name: 'refuses an architecture it has no binary for',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      if (windows) {
        const run = await install(interpreter, form, {env: {PROCESSOR_ARCHITECTURE: 'x86'}});
        assertRefused(run, 'Unsupported Windows architecture: x86.');
      } else {
        const run = await install(interpreter, form, {env: {STUB_UNAME_M: 'i686'}});
        assertRefused(run, "Error: Unsupported architecture 'i686'.");
      }
    },
  },
  {
    name: `takes the version as ${VERSION} or ${TAG}`,
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      for (const version of [VERSION, TAG]) {
        const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: version}});
        assertInstalled(run);
        assertSays(run, `Downloading a2ui-spectra (${TAG}) for ${target}...`);
      }
    },
  },
  {
    name: 'reads the releases list page by page, and stops at an empty page',
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      const first = [
        release('python/a2ui-core/v0.5.0'),
        release('v9.9.9-rc.1', {prerelease: true}),
        release('v9.9.9', {draft: true}),
      ];
      serving.pages = [first, [release(TAG)]];
      const found = await install(interpreter, form);
      assertInstalled(found);
      assert.deepEqual(found.apiRequests, [listPage(DEFAULT_REPO, 1), listPage(DEFAULT_REPO, 2)]);

      serving.pages = [first];
      const none = await install(interpreter, form);
      assertRefused(
        none,
        windows
          ? `No eligible 'v*' release found in repository ${DEFAULT_REPO}.`
          : `Error: No eligible stable 'v*' release found in repository '${DEFAULT_REPO}'.`,
      );
      assert.deepEqual(none.apiRequests, [listPage(DEFAULT_REPO, 1), listPage(DEFAULT_REPO, 2)]);
    },
  },
  {
    name: 'says so when the releases list cannot be read, on the first page or a later one',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      const failure = windows
        ? 'Could not resolve latest release:'
        : 'Error: Could not query the GitHub releases API (possibly rate limited or network failure).';
      serving.failingPage = 1;
      const first = await install(interpreter, form);
      assertRefused(first, failure, 'A2UI_SPECTRA_VERSION');
      assert.deepEqual(first.apiRequests, [listPage(DEFAULT_REPO, 1)]);

      serving.pages = [[release('v9.9.9-rc.1', {prerelease: true})]];
      serving.failingPage = 2;
      const later = await install(interpreter, form);
      assertRefused(later, failure, 'A2UI_SPECTRA_VERSION');
      assert.deepEqual(later.apiRequests, [listPage(DEFAULT_REPO, 1), listPage(DEFAULT_REPO, 2)]);
    },
  },
  {
    name: 'refuses a malformed version, downloading nothing',
    scripts: [SH, PS1],
    async run(interpreter, form) {
      for (const version of [
        '../0.9.9',
        '0.9.9/../../evil',
        '0.9..9',
        'not-a-version',
        '1.2',
        '0.9.9;rm',
        `cli-v${VERSION}`,
      ]) {
        const run = await install(interpreter, form, {env: {A2UI_SPECTRA_VERSION: version}});
        assertRefused(run, 'Invalid');
        assert.deepEqual(run.fileRequests, [], `${version}:\n${run.output}`);
      }
    },
  },
  {
    name: 'refuses Linux with musl, in one line',
    scripts: [SH],
    async run(interpreter, form) {
      const run = await install(interpreter, form, {env: {STUB_UNAME_S: 'Linux'}, musl: true});
      assertRefused(run);
      assert.equal(
        run.output,
        'Error: musl-based Linux (e.g. Alpine) is not supported; the a2ui-spectra binary requires glibc.\n',
      );
    },
  },
  {
    name: 'refuses Windows on arm64, from a 64-bit process or a 32-bit one',
    scripts: [PS1],
    async run(interpreter, form) {
      for (const env of [
        {PROCESSOR_ARCHITECTURE: 'ARM64'},
        {PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'ARM64'},
      ]) {
        const run = await install(interpreter, form, {env});
        assertRefused(
          run,
          'Unsupported Windows architecture: ARM64. The a2ui-spectra binary requires an x64 host.',
        );
        assert.deepEqual(run.apiRequests, []);
        assert.deepEqual(run.fileRequests, []);
      }
    },
  },
  {
    name: "reads the releases list and the release's files from the two origins it is given",
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      const repo = 'someone/elsewhere';
      serving.repo = repo;
      const run = await install(interpreter, form, {env: {A2UI_SPECTRA_REPO: repo}});
      assertInstalled(run);
      assertSays(run, `Resolving latest a2ui-spectra release from ${files.url}/${repo}...`);
      assert.deepEqual(run.apiRequests, [listPage(repo, 1)]);
      assert.deepEqual(run.fileRequests, downloads(repo, ARCHIVE, 'checksums.txt'));
    },
  },
  {
    name: windows
      ? "installs over an earlier install, adding the folder to the user's Path once"
      : 'installs over an earlier install',
    scripts: [SH, PS1],
    runsBinary: true,
    async run(interpreter, form) {
      const installDir = path.join(freshDir('spectra-install-again-'), 'bin');
      for (let time = 0; time < 2; time++) {
        const run = await install(interpreter, form, {
          env: {A2UI_SPECTRA_VERSION: VERSION},
          installDir,
        });
        assertInstalled(run);
      }
    },
  },
];

describe('the install scripts', () => {
  let savedUserPath: UserPath | undefined;

  before(async () => {
    assert.ok(
      target !== undefined,
      `The install scripts run on the five platforms, not ${process.platform} ${process.arch}.`,
    );
    if (windows) savedUserPath = readUserPath();
    else writeStubs();
    archive = buildArchive();
    checksums = checksumsFor(sha256(archive));
    [api, files] = await Promise.all([standIn(answerApi), standIn(answerFiles)]);
  });

  after(async () => {
    if (savedUserPath !== undefined) writeUserPath(savedUserPath);
    await Promise.all(
      [api, files].map(
        each =>
          new Promise(resolve =>
            each === undefined ? resolve(undefined) : each.server.close(resolve),
          ),
      ),
    );
    for (const root of roots) rmSync(root, {recursive: true, force: true});
  });

  const all = interpreters();
  for (const testCase of CASES) {
    if (!testCase.scripts.includes(SCRIPT)) continue;
    const under = windows || testCase.everywhere ? all : all.slice(0, 1);
    const forms: Form[] = testCase.everywhere ? ['piped', 'from a file'] : ['piped'];
    for (const interpreter of under) {
      for (const form of forms) {
        it(
          `${testCase.name} (${SCRIPT} under ${interpreter.name}, ${form})`,
          {timeout: TIMEOUT, skip: testCase.runsBinary === true && !runsBinary},
          async () => {
            serving = published();
            await testCase.run(interpreter, form);
          },
        );
      }
    }
  }
});
