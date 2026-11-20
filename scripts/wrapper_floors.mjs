// The wrappers' floor run: the floors each wrapper's manifest states for OpenTelemetry and
// `wrapt`, read from the two manifests, never written here.
//
// From the repository root, in a checkout that is thrown away, as CI's floor job does:
//
//     node scripts/wrapper_floors.mjs hold     # before `yarn install` and `uv sync`
//     node scripts/wrapper_floors.mjs check    # after them
//
// `hold` holds the TypeScript wrapper's packages at their floors: a root `resolutions` entry for
// each of its OpenTelemetry dependencies, and its peer's floor as the `@opentelemetry/api` the
// wrapper and the TypeScript driver install. The Python wrapper's floors are held by uv itself,
// under `UV_RESOLUTION=lowest-direct`, which takes the lowest version each manifest admits.
//
// `check` fails unless what is installed is each floor, in `node_modules` and in the Python
// environment, and prints them.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const WRAPPER = 'typescript/instrumentation/package.json';
const DRIVER = 'conformance/wrapper_driver/typescript/package.json';
const PYTHON_WRAPPER = 'python/a2ui_spectra_instrumentation/pyproject.toml';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/** The lowest version a range of the forms the manifests use admits: `^x.y.z` or `>=x.y.z …`. */
function floorOf(name, range) {
  const match = /^(?:\^|>=)\s*(\d+\.\d+(?:\.\d+)?(?:[ab]\d+)?)/.exec(range.trim());
  if (!match) throw new Error(`${name}: ${range} states no floor this script reads.`);
  return match[1];
}

/** The TypeScript wrapper's OpenTelemetry packages: its dependencies' floors and its peer's. */
function typescriptFloors() {
  const manifest = readJson(WRAPPER);
  const pick = (section = {}) =>
    Object.entries(section)
      .filter(([name]) => name.startsWith('@opentelemetry/'))
      .map(([name, range]) => ({name, range, floor: floorOf(name, range)}));
  return {dependencies: pick(manifest.dependencies), peers: pick(manifest.peerDependencies)};
}

/** The Python wrapper's OpenTelemetry distributions and `wrapt`, each with its floor. */
function pythonFloors() {
  const text = readFileSync(PYTHON_WRAPPER, 'utf8');
  const block = /^dependencies = \[\n([\s\S]*?)^\]/m.exec(text)?.[1] ?? '';
  return [...block.matchAll(/"([A-Za-z0-9_.-]+)\s*([^"]*)"/g)]
    .filter(([, name]) => name.startsWith('opentelemetry-') || name === 'wrapt')
    .map(([, name, range]) => ({name, range, floor: floorOf(name, range)}));
}

function hold() {
  const {dependencies, peers} = typescriptFloors();
  const root = readJson('package.json');
  for (const {name, range, floor} of dependencies) root.resolutions[`${name}@npm:${range}`] = floor;
  writeJson('package.json', root);
  for (const path of [WRAPPER, DRIVER]) {
    const manifest = readJson(path);
    for (const {name, floor} of peers) {
      const section = [manifest.dependencies, manifest.devDependencies].find(s => s && name in s);
      if (!section) throw new Error(`${path} installs no ${name} of its own to hold at the floor.`);
      section[name] = floor;
    }
    writeJson(path, manifest);
  }
  for (const {name, floor} of [...dependencies, ...peers]) console.log(`held: ${name} ${floor}`);
}

function check() {
  const failures = [];
  const report = (name, floor, installed) => {
    console.log(`${name}: the floor ${floor}, installed ${installed}`);
    if (installed !== floor) failures.push(`${name} is at ${installed}, not its floor ${floor}`);
  };
  const {dependencies, peers} = typescriptFloors();
  for (const {name, floor} of [...dependencies, ...peers]) {
    // The copy the wrapper's own code resolves: its own `node_modules` first, then the root's.
    let installed = 'nothing';
    for (const base of ['typescript/instrumentation/node_modules', 'node_modules']) {
      try {
        installed = readJson(`${base}/${name}/package.json`).version;
        break;
      } catch {
        // Not in this folder.
      }
    }
    report(name, floor, installed);
  }
  const python = pythonFloors();
  const installed = JSON.parse(
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'import importlib.metadata as m, json, sys; print(json.dumps({n: m.version(n) for n in sys.argv[1:]}))',
        ...python.map(({name}) => name),
      ],
      {encoding: 'utf8'},
    ),
  );
  for (const {name, floor} of python) report(name, floor, installed[name]);
  if (failures.length) {
    for (const failure of failures) console.error(`wrapper_floors: ${failure}.`);
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === 'hold') hold();
else if (command === 'check') check();
else {
  console.error('wrapper_floors: hold or check.');
  process.exit(1);
}
