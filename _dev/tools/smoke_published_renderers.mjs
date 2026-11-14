// The smoke check on the published renderers: Spectra's React, Lit and Angular sample pages,
// each built on the published latest of its renderer and of web core, as an adopter has them.
//
// A scratch project outside the workspace holds Spectra's preview core and adapters packed from
// this repository, the three sample pages' sources beside them, and the renderers and web core
// from npm at their latest, installed with Yarn. The repository's install and lockfile are left
// as they are. Spectra, built from the repository on the pin's web core, attaches to the stub
// agent's canned conversation and uses each page in turn. For each page: it loads and answers
// Spectra with the catalogs it claims, so the sample catalog's v0.9.1 surface is routed to it;
// it draws that surface; it reports no error; and one press comes back as the action. No v1.0
// envelope key is involved. The run prints the versions it resolved.
//
// From the repository root, after `yarn build:all`, with Playwright's Chromium installed and the
// sample pages' ports, 9831 to 9833, free:
//
//     node _dev/tools/smoke_published_renderers.mjs [--keep]
//
// `--keep` leaves the scratch project in place and prints where it is. SPECTRA_BINARY, when it
// names a compiled binary, runs the binary in place of `tools/spectra/dist/cli.js`. The run
// exits non-zero when a page fails a requirement or the scratch project does not install.
//
// The re-pin procedure, `_dev/re-pin-procedure.md`, says when it runs.

import {execFileSync, spawn} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {REPO} from './upstream_pin.mjs';

const keep = process.argv.includes('--keep');

/** The sample pages, each with its renderer and the adapter it is built with. */
const SAMPLES = [
  {name: 'react', renderer: '@a2ui/react', adapter: 'a2ui-spectra-preview-react'},
  {name: 'lit', renderer: '@a2ui/lit', adapter: 'a2ui-spectra-preview-lit'},
  {name: 'angular', renderer: '@a2ui/angular', adapter: 'a2ui-spectra-preview-angular'},
];

/** Spectra's preview packages, packed from the repository: the core and the three adapters. */
const PACKS = [
  {name: 'a2ui-spectra-preview', dir: 'typescript/preview/core'},
  {name: 'a2ui-spectra-preview-react', dir: 'typescript/preview/react'},
  {name: 'a2ui-spectra-preview-lit', dir: 'typescript/preview/lit'},
  {name: 'a2ui-spectra-preview-angular', dir: 'typescript/preview/angular'},
];

/** The sample pages' development dependencies the dev server does not need. */
const LINT_AND_BUILD_TOOLS = ['eslint', 'eslint-plugin-react-hooks', 'gts', 'prettier', 'wireit'];

/** What is not copied from a sample's folder. */
const NOT_COPIED = new Set([
  'node_modules',
  'dist',
  '.wireit',
  '.angular',
  '.a2ui-spectra',
  'eslint.config.mjs',
  'tsconfig.tsbuildinfo',
]);

const {chromium} = await import(
  pathToFileURL(path.join(REPO, 'node_modules/playwright/index.mjs')).href
);

const failures = [];
const children = new Set();

function stop(child) {
  // A dev server is its group's leader, so its own children stop with it.
  try {
    if (child.spawnargs[0] === 'yarn') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
  children.delete(child);
}

function stopAll() {
  for (const child of [...children]) stop(child);
}

process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll();
    process.exit(1);
  });
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Starts a process with its output collected; resolves once its output matches, if a pattern is given. */
function start(command, args, {cwd, env, ready, group = false, timeoutMs = 180_000, label}) {
  const child = spawn(command, args, {
    cwd,
    env: {...process.env, ...env},
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: group,
  });
  children.add(child);
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => (child.output += chunk.toString('utf8')));
  }
  if (ready === undefined) return Promise.resolve(child);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(check);
      reject(new Error(`${label} did not get ready in time:\n${child.output}`));
    }, timeoutMs);
    const check = setInterval(() => {
      if (ready.test(child.output)) {
        clearTimeout(deadline);
        clearInterval(check);
        resolve(child);
      }
    }, 100);
    child.once('exit', code => {
      clearTimeout(deadline);
      clearInterval(check);
      reject(new Error(`${label} exited with ${code}:\n${child.output}`));
    });
  });
}

/** Resolves once a URL answers with a success. */
async function answers(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`${label} did not answer at ${url}.`);
    await sleep(500);
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** A package's installed version, as a workspace of the scratch project resolves it. */
function installedVersion(scratch, workspace, name) {
  for (const dir of [path.join(scratch, workspace), scratch]) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return readJson(manifest).version;
  }
  return undefined;
}

// 1. npm's latest of web core and of each renderer.
const latest = {};
for (const name of ['@a2ui/web_core', ...SAMPLES.map(sample => sample.renderer)]) {
  latest[name] = execFileSync('npm', ['view', name, 'version'], {encoding: 'utf8'}).trim();
}
console.log("npm's latest:");
for (const [name, version] of Object.entries(latest)) console.log(`  ${name} ${version}`);

// 2. The scratch project: the packed preview packages, the sample pages' sources, the shared catalog.
const scratch = mkdtempSync(path.join(tmpdir(), 'spectra-smoke-'));
const packs = path.join(scratch, 'packs');
mkdirSync(packs);
for (const pack of PACKS) {
  execFileSync('yarn', ['pack', '--out', path.join(packs, `${pack.name}.tgz`)], {
    cwd: path.join(REPO, pack.dir),
    stdio: 'ignore',
  });
}
cpSync(path.join(REPO, 'samples/preview/catalog.json'), path.join(scratch, 'catalog.json'));
for (const sample of SAMPLES) {
  const from = path.join(REPO, 'samples/preview', sample.name);
  const to = path.join(scratch, sample.name);
  cpSync(from, to, {recursive: true, filter: source => !NOT_COPIED.has(path.basename(source))});
  const manifest = readJson(path.join(to, 'package.json'));
  manifest.scripts = {dev: manifest.scripts.dev};
  delete manifest.wireit;
  manifest.dependencies['@a2ui/web_core'] = latest['@a2ui/web_core'];
  manifest.dependencies[sample.renderer] = latest[sample.renderer];
  manifest.dependencies[sample.adapter] = `file:../packs/${sample.adapter}.tgz`;
  for (const tool of LINT_AND_BUILD_TOOLS) delete manifest.devDependencies?.[tool];
  writeJson(path.join(to, 'package.json'), manifest);
}
writeJson(path.join(scratch, 'package.json'), {
  name: 'spectra-smoke-published-renderers',
  private: true,
  packageManager: readJson(path.join(REPO, 'package.json')).packageManager,
  workspaces: SAMPLES.map(sample => sample.name),
  // The adapters' own dependency on the core, as packed.
  resolutions: {'a2ui-spectra-preview': 'file:./packs/a2ui-spectra-preview.tgz'},
});
writeFileSync(path.join(scratch, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
writeFileSync(path.join(scratch, 'yarn.lock'), '');
console.log(`\nThe scratch project: ${scratch}`);
try {
  execFileSync('yarn', ['install'], {
    cwd: scratch,
    env: {...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error(`The scratch project did not install:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  if (!keep) rmSync(scratch, {recursive: true, force: true});
  process.exit(1);
}

// 3. The stub agent's canned conversation, which answers in the sample catalog when offered it.
const agentPort = await freePort();
await start(
  process.execPath,
  [path.join(REPO, 'conformance/dist/stub_agent/stub_agent.js'), '--port', String(agentPort), '--canned-a2ui'],
  {cwd: REPO, ready: /Spectra stub agent at/, label: 'The stub agent', timeoutMs: 30_000},
);

const spectraCommand = process.env.SPECTRA_BINARY
  ? [path.resolve(process.env.SPECTRA_BINARY)]
  : [process.execPath, path.join(REPO, 'tools/spectra/dist/cli.js')];

const browser = await chromium.launch();
try {
  for (const sample of SAMPLES) {
    const dir = path.join(scratch, sample.name);
    const pageUrl = readJson(path.join(dir, 'a2ui-spectra.json')).preview[0];
    console.log(`\n${sample.name}: ${sample.renderer} ${installedVersion(scratch, sample.name, sample.renderer)}, @a2ui/web_core ${installedVersion(scratch, sample.name, '@a2ui/web_core')}`);
    const failed = reason => {
      failures.push(`${sample.name}: ${reason}`);
      console.log(`  FAILED: ${reason}`);
    };
    let server;
    let spectra;
    let page;
    let store;
    try {
      server = await start('yarn', ['dev'], {cwd: dir, group: true, label: `The ${sample.name} page's dev server`});
      await answers(pageUrl, `The ${sample.name} page`);
      console.log(`  the page loads at ${pageUrl}`);
      const port = await freePort();
      const [command, ...prefix] = spectraCommand;
      store = mkdtempSync(path.join(tmpdir(), 'spectra-smoke-store-'));
      spectra = await start(
        command,
        [
          ...prefix,
          'attach',
          `http://127.0.0.1:${agentPort}`,
          '--config',
          path.join(dir, 'a2ui-spectra.json'),
          '--port',
          String(port),
          '--proxy-port',
          String(await freePort()),
          '--model-proxy-port',
          String(await freePort()),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
        ],
        {cwd: store, ready: /The viewer is at /, label: 'Spectra', timeoutMs: 30_000},
      );
      page = await browser.newPage({viewport: {width: 1440, height: 900}});
      await page.goto(`http://127.0.0.1:${port}`);
      await page.getByRole('textbox', {name: 'Message the agent'}).fill('Hi');
      await page.getByRole('button', {name: 'Send', exact: true}).click();

      // The page answered with its claims: the sample catalog's surface is routed to it, named in the Preview pane's header.
      await page.locator(`span[title="${pageUrl}"]`).waitFor({timeout: 60_000});
      console.log('  it answers Spectra with the catalogs it claims: the surface is routed to it');
      const frame = page.frameLocator(`iframe[title="Preview page ${pageUrl}"]`);
      const slider = frame.locator('input[type="range"]');
      await slider.waitFor({timeout: 60_000});
      console.log("  it draws the sample catalog's v0.9.1 surface");

      // No error from the page: the turn's check state counts the page's reports while it is in view.
      const header = page.locator('header').filter({has: page.getByRole('heading', {level: 1})});
      await header.getByText(/^(No problems|\d+ problems?)/).first().waitFor({timeout: 30_000});
      await sleep(1500);
      const state = (await header.getByText(/^(No problems|\d+ problems?)/).first().textContent()) ?? '';
      if (!state.startsWith('No problems')) failed(`the page reported an error: the turn reads "${state}"`);
      else console.log('  it reports no error');

      // One press comes back as the action.
      await frame.getByRole('button', {name: 'Set the volume'}).click();
      await page.getByText('Action “setVolume”').waitFor({timeout: 30_000});
      console.log('  one press comes back as the action');
    } catch (error) {
      failed(error instanceof Error ? error.message.split('\n')[0] : String(error));
      if (server !== undefined && server.output) console.log(server.output.split('\n').slice(-20).join('\n'));
    } finally {
      await page?.close();
      if (spectra !== undefined) stop(spectra);
      if (server !== undefined) stop(server);
      if (store !== undefined) rmSync(store, {recursive: true, force: true});
      // The dev server's port goes free before the next page's.
      await sleep(1000);
    }
  }
} finally {
  await browser.close();
  stopAll();
  if (keep) console.log(`\nThe scratch project is kept at ${scratch}`);
  else rmSync(scratch, {recursive: true, force: true});
}

if (failures.length > 0) {
  console.log(`\nThe smoke check failed on ${failures.length} page(s):`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}
console.log('\nThe smoke check passed on the React, Lit and Angular sample pages.');
