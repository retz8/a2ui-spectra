// The libraries' packs: the files a registry receives for the six libraries, made into
// `dist/libraries/`, from `tools/spectra/`, after each npm library's build:
//
//     yarn pack:libraries
//
//     npm/   the preview core, the React, Lit and Angular preview adapters and the TypeScript
//            wrapper, each <name>-<version>.tgz, as `npm pack` writes them
//     pypi/  the Python wrapper's wheel and sdist, built by hatchling through `uv build`
//
// It takes no version: each library is packed at the version its manifest states, which must be
// the version of `src/version.ts`, as `yarn check:version` holds. Each pack is made from a copy
// outside the workspace holding its packed manifest, the root LICENSE and the library's README:
//
// - an npm library: the manifest without `private`, `scripts`, `wireit` and `devDependencies`,
//   a `workspace:` dependency on another library stated at the release's exact version; its
//   built JavaScript with its source maps, and its `.d.ts` files without their declaration maps;
// - the Python wrapper: its `pyproject.toml` and `src/`, built into the sdist, and the wheel built
//   from that sdist.
//
// `yarn check:libraries` checks the result. The release workflow publishes these files.

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {
  builtFiles,
  DROPPED_FIELDS,
  KEPT_FIELDS,
  LIBRARIES_DIR,
  libraryFiles,
  librariesPath,
  LICENSE,
  NPM_LIBRARIES,
  npmPack,
  PYTHON_LIBRARY,
  pythonSdist,
  pythonSources,
  pythonWheel,
  withoutDeclarationMap,
} from './libraries.mjs';
import {BuildError, readVersion, REPO_DIR, run, runMain} from './packages.mjs';
import {versionDifferences} from './version.mjs';

function put(from, to) {
  mkdirSync(path.dirname(to), {recursive: true});
  copyFileSync(from, to);
}

/** A dependency list as packed: a `workspace:` dependency on another library at the version. */
function releasedDependencies(dependencies, version, where) {
  const names = new Set(NPM_LIBRARIES.map(library => library.name));
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => {
      if (range.startsWith('workspace:')) {
        if (!names.has(name)) {
          throw new BuildError(`${where} depends on ${name}, a workspace package never released.`);
        }
        return [name, version];
      }
      if (/^(file|link|portal|patch):/.test(range)) {
        throw new BuildError(`${where} depends on ${name} at ${range}, inside the workspace.`);
      }
      return [name, range];
    }),
  );
}

/** An npm library's packed manifest, from its manifest in the repo. */
function packedManifest(source, version, where) {
  const unknown = Object.keys(source).filter(
    field => !KEPT_FIELDS.includes(field) && !DROPPED_FIELDS.includes(field),
  );
  if (unknown.length > 0) {
    throw new BuildError(
      `${where} has ${unknown.join(', ')}, which the packing command neither keeps nor drops.`,
    );
  }
  return Object.fromEntries(
    Object.entries(source)
      .filter(([field]) => KEPT_FIELDS.includes(field))
      .map(([field, value]) =>
        field === 'dependencies' || field === 'peerDependencies'
          ? [field, releasedDependencies(value, version, where)]
          : [field, value],
      ),
  );
}

function npmLibrary(library, version, staging) {
  const from = path.join(REPO_DIR, library.dir);
  const where = `${library.dir}/package.json`;
  const source = JSON.parse(readFileSync(path.join(from, 'package.json'), 'utf8'));
  if (source.name !== library.name) throw new BuildError(`${where} names ${source.name}.`);
  const built = builtFiles(library);
  if (built.length === 0) {
    throw new BuildError(`${library.dir}/dist holds nothing to pack: build ${library.name} first.`);
  }
  mkdirSync(staging);
  writeFileSync(
    path.join(staging, 'package.json'),
    `${JSON.stringify(packedManifest(source, version, where), null, 2)}\n`,
  );
  put(LICENSE, path.join(staging, 'LICENSE'));
  put(path.join(from, 'README.md'), path.join(staging, 'README.md'));
  for (const file of built) {
    const to = path.join(staging, file);
    if (file.endsWith('.d.ts')) {
      mkdirSync(path.dirname(to), {recursive: true});
      writeFileSync(to, withoutDeclarationMap(readFileSync(path.join(from, file), 'utf8')));
    } else {
      put(path.join(from, file), to);
    }
  }
  const expected = npmPack(library, version);
  run(
    'npm',
    ['pack', '--pack-destination', path.dirname(expected), '--ignore-scripts', '--loglevel=warn'],
    {cwd: staging, stdio: ['ignore', 'ignore', 'inherit']},
  );
  statSync(expected);
}

function pythonLibrary(version, staging) {
  const from = path.join(REPO_DIR, PYTHON_LIBRARY.dir);
  for (const file of ['pyproject.toml', 'README.md', ...pythonSources()]) {
    put(path.join(from, file), path.join(staging, file));
  }
  put(LICENSE, path.join(staging, 'LICENSE'));
  // The sdist, then the wheel built from it, into a folder of their own.
  const out = path.join(staging, '..', 'pypi-out');
  run('uv', ['build', '--no-config', '--quiet', '--out-dir', out, staging], {cwd: staging});
  const expected = [pythonSdist(version), pythonWheel(version)];
  const built = readdirSync(out)
    .filter(file => !file.startsWith('.'))
    .sort();
  const names = expected.map(file => path.basename(file)).sort();
  if (JSON.stringify(built) !== JSON.stringify(names)) {
    throw new BuildError(
      `uv build wrote ${built.join(', ') || 'nothing'}, not ${names.join(', ')}.`,
    );
  }
  for (const file of expected) copyFileSync(path.join(out, path.basename(file)), file);
}

async function main() {
  const version = readVersion();
  const differences = versionDifferences(version);
  if (differences.length > 0) {
    throw new BuildError(
      `The libraries are packed at the version of src/version.ts, ${version}:\n${differences.map(line => `- ${line}`).join('\n')}`,
    );
  }
  rmSync(librariesPath(), {recursive: true, force: true});
  for (const dir of ['npm', 'pypi']) mkdirSync(librariesPath(dir), {recursive: true});

  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-libraries-'));
  try {
    for (const library of NPM_LIBRARIES) {
      npmLibrary(library, version, path.join(scratch, library.name));
      console.log(`${library.name}: packed.`);
    }
    pythonLibrary(version, path.join(scratch, 'python'));
    console.log(`${PYTHON_LIBRARY.name}, for Python: its sdist and wheel built.`);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }

  console.log(`\nThe libraries' packs, ${version}:`);
  for (const file of libraryFiles(version)) {
    const relative = path.join(LIBRARIES_DIR, path.relative(librariesPath(), file));
    console.log(`${relative}  ${(statSync(file).size / 1e3).toFixed(1)} KB`);
  }
}

await runMain('pack:libraries', main);
