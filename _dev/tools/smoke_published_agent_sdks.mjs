// The smoke check on the published agent SDKs: the wrappers built from this repository on the
// published latest of each language's agent SDK, as an adopter has them.
//
// A scratch environment outside the workspace for each language: in Python, a virtual
// environment holding the wrapper's wheel built from this repository and PyPI's latest
// `a2ui-agent-sdk` and `a2ui-adk`; in TypeScript, a project holding the wrapper packed from this
// repository and npm's latest `@a2ui/agent`, installed with Yarn, the TypeScript driver's build
// copied into it. The repository's install and lockfiles are left as they are. The jobs are the
// wrapper capture suite's own, under `conformance/test_data/wrapper_capture/v0_1/`, run through
// its drivers; the TypeScript jobs load the driver's copy of the pin's basic catalog, which
// neither published package carries. Spectra's receiver, built from this repository, takes what
// each driver exports, inside one turn opened around the driver's run. For each language: the
// wrapper switches on and patches, with no refusal line and no hook fault line; for each
// inference format the SDK implements, one prompt generation and one parse of a valid recorded
// reply reach the receiver as a `prompt_generation` and a `parse` event, naming the format and
// the SDK's version, the parse with its messages and no error; in Python, one toolset tool call
// reaches it the same way. Nothing is compared against an expected record. The run prints the
// versions it resolved.
//
// From the repository root, after `yarn build:all`, with `uv` on the path:
//
//     node _dev/tools/smoke_published_agent_sdks.mjs [--keep]
//
// `--keep` leaves the scratch environments in place and prints where they are. The run exits
// non-zero when a job fails a requirement, a scratch environment does not install, or the
// repository's install or lockfiles changed.
//
// The re-pin procedure, `_dev/re-pin-procedure.md`, says when it runs.

import {execFileSync, spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {REPO} from './upstream_pin.mjs';

const keep = process.argv.includes('--keep');

const SUITE = path.join(REPO, 'conformance/test_data/wrapper_capture/v0_1');
const DRIVERS = path.join(REPO, 'conformance/wrapper_driver');
const TOOL_NAME = 'send_a2ui_json_to_client';

/** The files the run must leave as they are: the repository's install and its lockfiles. */
const UNTOUCHED = ['pyproject.toml', 'uv.lock', 'package.json', 'yarn.lock'];

/** Each language: its agent SDK's packages, the formats it implements, and the jobs that run. */
const LANGUAGES = {
  python: {
    sdk: 'a2ui-agent-sdk',
    registry: 'pypi',
    packages: ['a2ui-agent-sdk', 'a2ui-adk'],
    resolved: ['a2ui-agent-sdk', 'a2ui-core', 'a2ui-adk', 'a2ui-spectra-instrumentation'],
    formats: ['direct_json', 'express', 'elemental', 'atom'],
    toolCall: 'tool_call_without_state',
  },
  typescript: {
    sdk: '@a2ui/agent',
    registry: 'npm',
    packages: ['@a2ui/agent'],
    resolved: ['@a2ui/agent', '@a2ui/web_core', 'a2ui-spectra-instrumentation'],
    formats: ['direct_json', 'express'],
    toolCall: undefined,
  },
};

const receiverModule = file => import(pathToFileURL(path.join(REPO, 'tools/spectra/dist', file)).href);
const {startReceiverListener} = await receiverModule('receiver/listener.js');
const {SpanReceiver} = await receiverModule('receiver/receiver.js');
const {CallPlacer} = await receiverModule('placement.js');
const {TurnStore} = await receiverModule('store/store.js');

const failures = [];
const scratches = [];

function digest(file) {
  return createHash('sha256').update(readFileSync(path.join(REPO, file))).digest('hex');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function scratchDir(language) {
  const dir = mkdtempSync(path.join(tmpdir(), `spectra-smoke-${language}-`));
  scratches.push(dir);
  return dir;
}

/** Runs a command to its end; on a failure, throws with its output. */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options});
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** A package's published latest on its registry. */
async function latestOf(registry, name) {
  if (registry === 'npm') {
    return (await fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`))['dist-tags'].latest;
  }
  return (await fetchJson(`https://pypi.org/pypi/${name}/json`)).info.version;
}

// The Python scratch environment: a virtual environment with the wrapper's wheel and PyPI's latest.
function installPython(latest) {
  const scratch = scratchDir('python');
  const wheels = path.join(scratch, 'wheels');
  run('uv', ['build', '--wheel', '--out-dir', wheels, path.join(REPO, 'python/a2ui_spectra_instrumentation')], {
    cwd: scratch,
  });
  const [wheel] = run('ls', [wheels]).trim().split('\n');
  run('uv', ['venv', '--quiet', path.join(scratch, '.venv')], {cwd: scratch});
  const python = path.join(scratch, '.venv/bin/python');
  run(
    'uv',
    [
      'pip',
      'install',
      '--quiet',
      '--python',
      python,
      path.join(wheels, wheel),
      ...LANGUAGES.python.packages.map(name => `${name}==${latest[name]}`),
    ],
    {cwd: scratch},
  );
  const script =
    'import importlib.metadata as m, json, platform, sys\n' +
    'found = {}\n' +
    'for name in sys.argv[1:]:\n' +
    '    try:\n' +
    '        found[name] = m.version(name)\n' +
    '    except m.PackageNotFoundError:\n' +
    '        pass\n' +
    'print(json.dumps({"Python": platform.python_version(), **found}))\n';
  const versions = JSON.parse(run(python, ['-I', '-c', script, ...LANGUAGES.python.resolved], {cwd: scratch}));
  return {
    scratch,
    versions,
    command: job => [python, ['-I', path.join(DRIVERS, 'python/driver.py'), job]],
  };
}

// The TypeScript scratch project: the wrapper packed, npm's latest, the driver's build beside them.
function installTypeScript(latest) {
  const scratch = scratchDir('typescript');
  const pack = path.join(scratch, 'a2ui-spectra-instrumentation.tgz');
  run('yarn', ['pack', '--out', pack], {cwd: path.join(REPO, 'typescript/instrumentation')});
  const driver = path.join(scratch, 'conformance/wrapper_driver/typescript');
  mkdirSync(driver, {recursive: true});
  for (const part of ['dist', 'catalogs']) {
    cpSync(path.join(DRIVERS, 'typescript', part), path.join(driver, part), {recursive: true});
  }
  const driverManifest = readJson(path.join(DRIVERS, 'typescript/package.json'));
  writeJson(path.join(scratch, 'package.json'), {
    name: 'spectra-smoke-published-agent-sdks',
    private: true,
    type: 'module',
    packageManager: readJson(path.join(REPO, 'package.json')).packageManager,
    dependencies: {
      '@a2ui/agent': latest['@a2ui/agent'],
      '@opentelemetry/api': driverManifest.dependencies['@opentelemetry/api'],
      'a2ui-spectra-instrumentation': `file:./${path.basename(pack)}`,
    },
  });
  writeFileSync(path.join(scratch, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  writeFileSync(path.join(scratch, 'yarn.lock'), '');
  run('yarn', ['install'], {cwd: scratch, env: {...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'}});
  const versions = {Node: process.versions.node};
  for (const name of LANGUAGES.typescript.resolved) {
    const manifest = path.join(scratch, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) versions[name] = readJson(manifest).version;
  }
  return {
    scratch,
    versions,
    command: job => [process.execPath, [path.join(driver, 'dist/driver.js'), job]],
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

function nowUnixNano() {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}

function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

/** Runs a driver on a job with the two variables `run` sets; resolves with its exit code and stderr. */
function runDriver([command, args], endpoint) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.join(REPO, 'conformance'),
      env: {...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf'},
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('exit', code => resolve({code, stderr}));
  });
}

/** One job run through its driver, inside one turn the receiver places it in; the turn as written. */
async function capture(command, job) {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-smoke-store-'));
  const lines = [];
  const writes = [];
  try {
    const store = await TurnStore.open(dir);
    const placer = new CallPlacer({
      onTurn: notification => {
        if (notification.type === 'turn_closed') writes.push(store.write(notification.turn));
      },
      log: line => lines.push(line),
      assemble: turn => spans.assemble(turn),
      onCallEnded: (traceId, call) => spans.takeCall(traceId, call),
    });
    const spans = new SpanReceiver({turns: placer, store, log: line => lines.push(line)});
    const listener = await startReceiverListener({
      port: await freePort(),
      onSpans: received => spans.takeSpans(received),
      onLogs: received => spans.takeLogs(received),
    });
    const traceId = hex(16);
    const spanId = hex(8);
    const start = nowUnixNano();
    let driven;
    try {
      placer.onTurn({type: 'turn_opened', traceId, spanId, startTimeUnixNano: start.toString()});
      driven = await runDriver(command(path.join(SUITE, job, 'input.json')), listener.origin);
      const turn = {
        traceId,
        spanId,
        name: 'invoke_agent',
        kind: 3,
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: nowUnixNano().toString(),
        attributes: {
          'a2ui.event.kind': 'turn',
          'gen_ai.operation.name': 'invoke_agent',
          'a2ui.turn.outcome': 'completed',
          'a2ui.turn.capture_paths': [],
          'a2ui.turn.writer.name': 'a2ui-spectra',
          'a2ui.turn.writer.version': '0.0.0',
        },
        status: {code: 1},
      };
      placer.onTurn({type: 'turn_closed', traceId, turn: {events: [turn]}});
      await Promise.all(writes);
      await spans.idle();
    } finally {
      await listener.close();
    }
    const file = (await store.list()).find(turn => turn.traceId === traceId)?.file;
    const record = file === undefined ? undefined : await store.read(file);
    return {...driven, lines, events: record?.turns.at(-1)?.events ?? []};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** What a captured job falls short of: the reasons, none when it meets every requirement. */
function shortfalls(captured, {kind, format, sdk, version, toolCall}) {
  const reasons = [];
  if (captured.code !== 0) reasons.push(`the driver exited with ${captured.code}: ${captured.stderr.trim()}`);
  const own = captured.stderr.split('\n').filter(line => line.includes('a2ui-spectra-instrumentation'));
  for (const line of own) reasons.push(`the wrapper wrote "${line.trim()}"`);
  for (const line of captured.lines) reasons.push(`the receiver wrote "${line}"`);
  const steps = captured.events.filter(event => event.attributes?.['a2ui.event.kind'] === kind);
  if (steps.length !== 1) {
    reasons.push(`${steps.length} ${kind} events reached the receiver, not one`);
    return reasons;
  }
  const [step] = steps;
  const attributes = step.attributes;
  const prefix = kind === 'parse' ? 'a2ui.parse' : 'a2ui.prompt';
  if (attributes[`${prefix}.inference_format`] !== format) {
    reasons.push(`it names the format ${attributes[`${prefix}.inference_format`]}, not ${format}`);
  }
  if (attributes['a2ui.sdk.name'] !== sdk || attributes['a2ui.sdk.version'] !== version) {
    reasons.push(`it names the SDK ${attributes['a2ui.sdk.name']} ${attributes['a2ui.sdk.version']}, not ${sdk} ${version}`);
  }
  const errors = (step.events ?? []).filter(event => event.name === 'exception');
  if (errors.length > 0 || 'error.type' in attributes || step.status?.code === 2) {
    const message = errors[0]?.attributes?.['exception.message'] ?? attributes['error.type'];
    reasons.push(`it carries an error: ${message}`);
  }
  if (kind === 'prompt_generation') {
    const section = attributes['a2ui.prompt.ui_section'];
    if (typeof section !== 'string' || section === '') reasons.push('it holds no UI section');
  } else {
    const messages = parsed(attributes['a2ui.parse.messages']);
    if (!Array.isArray(messages) || messages.length === 0) reasons.push('it holds no messages');
    if (toolCall && attributes['gen_ai.tool.name'] !== TOOL_NAME) {
      reasons.push(`it names the tool ${attributes['gen_ai.tool.name']}, not ${TOOL_NAME}`);
    }
  }
  return reasons;
}

const before = Object.fromEntries(UNTOUCHED.map(file => [file, digest(file)]));

// 1. The published latest of each language's agent SDK.
const latest = {};
for (const language of Object.values(LANGUAGES)) {
  for (const name of language.packages) latest[name] = await latestOf(language.registry, name);
}
console.log('The published latest:');
for (const [name, version] of Object.entries(latest)) console.log(`  ${name} ${version}`);

try {
  for (const [language, spec] of Object.entries(LANGUAGES)) {
    console.log(`\n${language}:`);
    let environment;
    try {
      environment = language === 'python' ? installPython(latest) : installTypeScript(latest);
    } catch (error) {
      failures.push(`${language}: the scratch environment did not install`);
      console.log(`  FAILED: the scratch environment did not install:\n${error.message}`);
      continue;
    }
    console.log(`  resolved: ${Object.entries(environment.versions).map(([name, v]) => `${name} ${v}`).join(', ')}`);
    const version = environment.versions[spec.sdk];
    const jobs = spec.formats.flatMap(format => [
      {job: `${format}_generate`, kind: 'prompt_generation', format},
      {job: `${format}_parse_response`, kind: 'parse', format},
    ]);
    if (spec.toolCall !== undefined) {
      const format = readJson(path.join(SUITE, spec.toolCall, 'input.json')).inferenceFormat;
      jobs.push({job: spec.toolCall, kind: 'parse', format, toolCall: true});
    }
    for (const job of jobs) {
      const captured = await capture(environment.command, job.job);
      const reasons = shortfalls(captured, {...job, sdk: spec.sdk, version});
      const what = job.toolCall ? 'a toolset tool call' : job.kind === 'parse' ? 'a parse' : 'a prompt generation';
      if (reasons.length === 0) {
        console.log(`  ${job.job}: ${what} in ${job.format} reached Spectra as a ${job.kind}`);
      } else {
        for (const reason of reasons) failures.push(`${language} ${job.job}: ${reason}`);
        console.log(`  ${job.job}: FAILED: ${reasons.join('; ')}`);
      }
    }
  }
} finally {
  if (keep) for (const dir of scratches) console.log(`\nThe scratch environment is kept at ${dir}`);
  else for (const dir of scratches) rmSync(dir, {recursive: true, force: true});
}

for (const file of UNTOUCHED) {
  if (digest(file) !== before[file]) failures.push(`the repository's ${file} changed`);
}

if (failures.length > 0) {
  console.log(`\nThe smoke check failed on ${failures.length} requirement(s):`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}
console.log('\nThe smoke check passed on the published agent SDKs in Python and in TypeScript.');
