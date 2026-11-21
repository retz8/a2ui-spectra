// Checks the libraries' packs that `pack:libraries` made in `dist/libraries/`, from
// `tools/spectra/`:
//
//     yarn check:libraries
//
// For every pack: it holds exactly its files, each the build's or the repo's byte for byte, and
// its `LICENSE` the root file; its manifest states the version of `src/version.ts`, the
// repository and the issues page, an adapter's the preview core at that version, and none
// carries `private`, `scripts`, `wireit`, `devDependencies` or a reference into the workspace;
// every `exports` target is in the pack; and every import in its built code resolves to a file
// in the pack or to a dependency or peer its manifest declares. Then each pack is installed
// outside the workspace and loaded: the preview core and the TypeScript wrapper by npm into one
// scratch project, each of their entry points imported under Node; each adapter by npm into a
// catalog app's project of its own, after the peers its pack states; every import of their built
// code resolved where it is installed; and the wheel by uv into a fresh environment, the Python
// wrapper imported and its OpenTelemetry entry point found.

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {builtinModules, createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  builtFiles,
  DROPPED_FIELDS,
  KEPT_FIELDS,
  LIBRARIES_DIR,
  librariesPath,
  LICENSE,
  NPM_LIBRARIES,
  npmPack,
  PREVIEW_CORE,
  PYTHON_LIBRARY,
  pythonSdist,
  pythonSources,
  pythonWheel,
  withoutDeclarationMap,
} from './libraries.mjs';
import {
  BuildError,
  ISSUES,
  NPM_BUGS,
  npmRepository,
  output,
  packedReadme,
  readmeLinkProblems,
  readVersion,
  REPO_DIR,
  REPOSITORY,
  run,
  runMain,
} from './packages.mjs';
import {Checks, metadataOf, recordOf, tarFiles, wheelHash, zipFiles} from './reading.mjs';

const ts = createRequire(import.meta.url)('typescript');

/** A file of `dist/libraries/`, as the check's lines name it. */
function shown(file) {
  return path.join(LIBRARIES_DIR, path.relative(librariesPath(), file));
}

/** Every module a built file imports: static, dynamic, re-exported, and read through `createRequire`. */
function importsOf(text) {
  const info = ts.preProcessFile(text, true, true);
  return [
    ...info.importedFiles.map(file => file.fileName),
    ...info.referencedFiles.map(file =>
      file.fileName.startsWith('.') ? file.fileName : `./${file.fileName}`,
    ),
    ...info.typeReferenceDirectives.map(file => file.fileName),
    ...[...text.matchAll(/createRequire\(import\.meta\.url\)\(\s*(['"])([^'"]+)\1\s*\)/g)].map(
      match => match[2],
    ),
  ];
}

/** The package a bare specifier names. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isNodes(specifier) {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

/**
 * Every import in a pack's built code: a relative one must name a file in the pack, a bare one a
 * dependency, a peer or Node's own. Returns the bare imports of the JavaScript, by file, for the
 * install to resolve.
 */
function checkImports(where, files, manifest, checks) {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const bare = new Map();
  for (const [name, {data}] of files) {
    const declaration = name.endsWith('.d.ts');
    if (!declaration && !/\.m?js$/.test(name)) continue;
    for (const specifier of new Set(importsOf(data.toString('utf8')))) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
        const candidates = declaration
          ? [target.replace(/\.js$/, '.d.ts').replace(/\.mjs$/, '.d.mts'), target]
          : [target];
        checks.that(
          !target.startsWith('../') && candidates.some(candidate => files.has(candidate)),
          `${where}: ${name} imports ${specifier}, which is not in the pack.`,
        );
      } else if (declaration && specifier === 'node') {
        // `/// <reference types="node" />`, Node's own types.
      } else if (isNodes(specifier)) {
        // Node's own.
      } else if (specifier.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
        checks.that(false, `${where}: ${name} imports ${specifier}, a path or a URL.`);
      } else {
        checks.that(
          declared.has(packageOf(specifier)),
          `${where}: ${name} imports ${specifier}, and ${packageOf(specifier)} is neither a dependency nor a peer.`,
        );
        if (!declaration) bare.set(name, [...(bare.get(name) ?? []), specifier]);
      }
    }
  }
  return bare;
}

/** Each `exports` target, the conditions' too. */
function exportTargets(exports) {
  if (typeof exports === 'string') return [exports];
  if (exports === null || typeof exports !== 'object') return [];
  return Object.values(exports).flatMap(exportTargets);
}

/** An npm pack's checks; returns its manifest and the bare imports of its JavaScript. */
function checkNpmPack(library, version, license, checks) {
  const file = npmPack(library, version);
  const where = shown(file);
  const from = path.join(REPO_DIR, library.dir);
  const files = new Map();
  for (const [name, entry] of tarFiles(file)) {
    if (name.startsWith('package/')) files.set(name.slice('package/'.length), entry);
    else checks.that(false, `${where} holds ${name}, outside package/.`);
  }

  // Exactly its files.
  const expected = {
    'package.json': {},
    LICENSE: {bytes: license},
    'README.md': {bytes: packedReadmeChecked(`${library.dir}/README.md`, version, where, checks)},
  };
  for (const name of builtFiles(library)) {
    const bytes = readFileSync(path.join(from, name));
    expected[name] = {
      bytes: name.endsWith('.d.ts')
        ? Buffer.from(withoutDeclarationMap(bytes.toString('utf8')))
        : bytes,
    };
  }
  checks.holds(where, files, expected);
  for (const name of files.keys()) {
    checks.that(
      !/\.test\./.test(path.posix.basename(name)) && !/(^|\/)(src|testing)\//.test(name),
      `${where} holds ${name}, a test, its support or a source file.`,
    );
    checks.that(
      !/(\.tsbuildinfo|\.d\.ts\.map)$/.test(name),
      `${where} holds ${name}, a build's own file.`,
    );
  }

  // Its manifest.
  const text = files.get('package.json')?.data.toString('utf8') ?? '{}';
  const manifest = JSON.parse(text);
  const source = JSON.parse(readFileSync(path.join(from, 'package.json'), 'utf8'));
  checks.equal(manifest.name, library.name, `${where}: the name`);
  checks.equal(manifest.version, version, `${where}: the version`);
  checks.equal(manifest.license, 'Apache-2.0', `${where}: the licence`);
  checks.equal(manifest.repository, npmRepository(library.dir), `${where}: repository`);
  checks.equal(manifest.bugs, NPM_BUGS, `${where}: bugs`);
  checks.equal(manifest.homepage, undefined, `${where}: homepage`);
  for (const field of DROPPED_FIELDS)
    checks.equal(manifest[field], undefined, `${where}: ${field}`);
  checks.equal(
    Object.keys(manifest).filter(field => !KEPT_FIELDS.includes(field)),
    [],
    `${where}: the fields beyond what an install reads`,
  );
  for (const field of KEPT_FIELDS) {
    if (['version', 'dependencies', 'peerDependencies'].includes(field)) continue;
    checks.equal(
      manifest[field],
      source[field],
      `${where}: ${field}, against ${library.dir}/package.json`,
    );
  }
  const ours = new Set(NPM_LIBRARIES.map(other => other.name));
  for (const field of ['dependencies', 'peerDependencies']) {
    checks.equal(
      manifest[field],
      source[field] &&
        Object.fromEntries(
          Object.entries(source[field]).map(([name, range]) => [
            name,
            ours.has(name) && range.startsWith('workspace:') ? version : range,
          ]),
        ),
      `${where}: ${field}`,
    );
  }
  checks.that(
    !/"(workspace|file|link|portal|patch):/.test(text),
    `${where}: its manifest refers into the workspace.`,
  );
  if (library.adapter) {
    checks.equal(
      manifest.dependencies?.[PREVIEW_CORE],
      version,
      `${where}: its dependency on ${PREVIEW_CORE}`,
    );
  }

  // Every `exports` target is in the pack.
  const targets = exportTargets(manifest.exports);
  checks.that(targets.length > 0, `${where}: its manifest exports nothing.`);
  for (const target of targets) {
    checks.that(
      target.startsWith('./') && files.has(path.posix.normalize(target)),
      `${where}: its exports target ${target} is not in the pack.`,
    );
  }

  // The JavaScript with its source maps, each carrying its sources' text; no declaration map.
  const named = new Set();
  for (const [name, {data}] of files) {
    if (name.endsWith('.d.ts')) {
      checks.that(
        !data.toString('utf8').includes('sourceMappingURL'),
        `${where}: ${name} names a declaration map.`,
      );
    }
    if (!/\.m?js$/.test(name)) continue;
    const match = /\n\/\/# sourceMappingURL=([^\n]+)\n?$/.exec(data.toString('utf8'));
    const map = match && path.posix.join(path.posix.dirname(name), match[1]);
    if (map === null || !files.has(map)) {
      checks.that(false, `${where}: ${name}'s source map is not in the pack.`);
      continue;
    }
    named.add(map);
    const {sources, sourcesContent} = JSON.parse(files.get(map).data.toString('utf8'));
    checks.that(
      Array.isArray(sources) &&
        Array.isArray(sourcesContent) &&
        sources.length > 0 &&
        sourcesContent.length === sources.length &&
        sourcesContent.every(content => typeof content === 'string'),
      `${where}: ${map} does not carry its sources' text.`,
    );
  }
  for (const name of files.keys()) {
    if (name.endsWith('.map')) {
      checks.that(named.has(name), `${where}: ${name} is named by no JavaScript file.`);
    }
  }

  return {manifest, bare: checkImports(where, files, manifest, checks)};
}

/**
 * A library's README as its pack must hold it, its relative links and images written as GitHub
 * URLs at the version's tag; a link in it that is relative, or names what the repository does
 * not hold, fails the check.
 */
function packedReadmeChecked(readme, version, where, checks) {
  const text = packedReadme(readme, version);
  for (const problem of readmeLinkProblems(text, `${where}'s README`)) checks.that(false, problem);
  return Buffer.from(text);
}

/** A wheel's METADATA or an sdist's PKG-INFO. */
function checkMetadata(where, text, version, readme, checks) {
  const {headers, body} = metadataOf(text);
  checks.equal(headers.get('Name'), [PYTHON_LIBRARY.name], `${where}: the name`);
  checks.equal(headers.get('Version'), [version], `${where}: the version`);
  checks.equal(headers.get('License-Expression'), ['Apache-2.0'], `${where}: the licence`);
  checks.equal(headers.get('License-File'), ['LICENSE'], `${where}: the licence file`);
  checks.equal(
    headers.get('Project-URL'),
    [`Repository, ${REPOSITORY}`, `Issues, ${ISSUES}`],
    `${where}: its project URLs`,
  );
  checks.equal(headers.get('Home-page'), undefined, `${where}: its homepage`);
  for (const requirement of headers.get('Requires-Dist') ?? []) {
    checks.that(
      !/\s@\s/.test(requirement),
      `${where}: it requires ${requirement}, by a direct reference.`,
    );
  }
  checks.that(body === readme, `${where}: its text is not the README.`);
}

function checkPython(version, license, checks) {
  const from = path.join(REPO_DIR, PYTHON_LIBRARY.dir);
  const readme = packedReadmeChecked(
    `${PYTHON_LIBRARY.dir}/README.md`,
    version,
    shown(pythonWheel(version)),
    checks,
  );
  const sources = Object.fromEntries(
    pythonSources().map(file => [file, {bytes: readFileSync(path.join(from, file))}]),
  );
  const module = PYTHON_LIBRARY.module;

  // The wheel: the module, with LICENSE under dist-info/licenses/.
  const wheel = pythonWheel(version);
  const where = shown(wheel);
  const entries = zipFiles(wheel);
  const info = `${module}-${version}.dist-info`;
  checks.holds(where, entries, {
    ...Object.fromEntries(
      Object.entries(sources).map(([file, want]) => [file.slice('src/'.length), want]),
    ),
    [`${info}/METADATA`]: {},
    [`${info}/WHEEL`]: {},
    [`${info}/RECORD`]: {},
    [`${info}/entry_points.txt`]: {},
    [`${info}/licenses/LICENSE`]: {bytes: license},
  });
  const wheelInfo = metadataOf(entries.get(`${info}/WHEEL`)?.data.toString('utf8') ?? '');
  checks.equal(wheelInfo.headers.get('Tag'), ['py3-none-any'], `${where}: its tag`);
  checks.equal(wheelInfo.headers.get('Root-Is-Purelib'), ['true'], `${where}: Root-Is-Purelib`);
  checkMetadata(
    where,
    entries.get(`${info}/METADATA`)?.data.toString('utf8') ?? '',
    version,
    readme.toString('utf8'),
    checks,
  );
  const record = recordOf(entries.get(`${info}/RECORD`)?.data.toString('utf8') ?? '');
  for (const [name, {data}] of entries) {
    if (name === `${info}/RECORD`) continue;
    checks.equal(record.get(name), wheelHash(data), `${where}: RECORD's hash of ${name}`);
  }

  // The sdist: pyproject.toml, README.md, LICENSE and src/, with its PKG-INFO.
  const sdist = pythonSdist(version);
  const sdistWhere = shown(sdist);
  const root = `${module}-${version}/`;
  const files = new Map();
  for (const [name, entry] of tarFiles(sdist)) {
    if (name.startsWith(root)) files.set(name.slice(root.length), entry);
    else checks.that(false, `${sdistWhere} holds ${name}, outside ${root}.`);
  }
  checks.holds(sdistWhere, files, {
    'PKG-INFO': {},
    'pyproject.toml': {bytes: readFileSync(path.join(from, 'pyproject.toml'))},
    'README.md': {bytes: readme},
    LICENSE: {bytes: license},
    ...sources,
  });
  checkMetadata(
    sdistWhere,
    files.get('PKG-INFO')?.data.toString('utf8') ?? '',
    version,
    readme.toString('utf8'),
    checks,
  );
}

function checkPacks(version, checks) {
  const license = readFileSync(LICENSE);
  const listing = dir => readdirSync(librariesPath(dir)).sort();
  checks.equal(listing(''), ['npm', 'pypi'], LIBRARIES_DIR);
  checks.equal(
    listing('npm'),
    NPM_LIBRARIES.map(library => path.basename(npmPack(library, version))).sort(),
    `${LIBRARIES_DIR}/npm`,
  );
  checks.equal(
    listing('pypi'),
    [pythonSdist(version), pythonWheel(version)].map(file => path.basename(file)).sort(),
    `${LIBRARIES_DIR}/pypi`,
  );
  const npm = NPM_LIBRARIES.map(library => ({
    library,
    ...checkNpmPack(library, version, license, checks),
  }));
  checkPython(version, license, checks);
  return npm;
}

/** What Node resolves each specifier to from a folder, by a module written there. */
function resolvedFrom(dir, specifiers, options) {
  const probe = path.join(dir, '.a2ui-spectra-resolve.mjs');
  writeFileSync(
    probe,
    'const found = {};\n' +
      'for (const specifier of process.argv.slice(2)) {\n' +
      '  try {\n' +
      '    found[specifier] = import.meta.resolve(specifier);\n' +
      '  } catch (error) {\n' +
      '    found[specifier] = {error: error.code ?? error.message};\n' +
      '  }\n' +
      '}\n' +
      'console.log(JSON.stringify(found));\n',
  );
  try {
    return JSON.parse(output(process.execPath, [probe, ...specifiers], options));
  } finally {
    rmSync(probe);
  }
}

/** An npm library installed in a scratch project: resolved from there, and loaded when it can be. */
function checkInstalled({library, manifest, bare}, version, project, options, checks) {
  const where = `${library.name}, installed`;
  const installed = path.join(project, 'node_modules');
  const dir = path.join(installed, library.name);
  checks.equal(
    JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version,
    version,
    `${where}: its version`,
  );
  // Its entry points by name, from the project.
  const subpaths = Object.keys(manifest.exports).map(key =>
    key === '.' ? library.name : `${library.name}/${key.slice(2)}`,
  );
  for (const [specifier, url] of Object.entries(resolvedFrom(project, subpaths, options))) {
    checks.that(
      typeof url === 'string' && fileURLToPath(url).startsWith(dir + path.sep),
      `${where}: ${specifier} resolves to ${JSON.stringify(url)}.`,
    );
  }
  // Every bare import of its JavaScript, from the file that imports it; a library it depends
  // on is the release's pack, not another copy.
  const byDir = new Map();
  for (const [file, specifiers] of bare) {
    const from = path.join(dir, path.dirname(file));
    byDir.set(from, [...(byDir.get(from) ?? []), ...specifiers]);
  }
  for (const [from, specifiers] of byDir) {
    for (const [specifier, url] of Object.entries(
      resolvedFrom(from, [...new Set(specifiers)], options),
    )) {
      checks.that(
        typeof url === 'string' && (url.startsWith('node:') || existsSync(fileURLToPath(url))),
        `${where}: ${specifier}, imported in ${path.relative(dir, from) || '.'}, resolves to ${JSON.stringify(url)}.`,
      );
      const other = NPM_LIBRARIES.find(each => each.name === packageOf(specifier));
      if (other === undefined || typeof url !== 'string') continue;
      checks.that(
        fileURLToPath(url).startsWith(path.join(installed, other.name) + path.sep),
        `${where}: ${specifier} resolves to another copy of ${other.name}, ${url}.`,
      );
    }
  }
  if (library.adapter) {
    console.log(`npm: ${library.name} installed, and every import of its code resolved.`);
    return;
  }
  // The preview core and the TypeScript wrapper, imported under Node.
  for (const specifier of subpaths) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', 'await import(process.argv[1]);', specifier],
      {...options, encoding: 'utf8', timeout: 60_000},
    );
    checks.that(
      result.status === 0,
      `${where}: importing ${specifier} under Node failed:\n${(result.stderr ?? '').trim()}`,
    );
  }
  console.log(`npm: ${library.name} installed, every import of its code resolved, and loaded.`);
}

/** Each pack installed outside the workspace and loaded. */
function install(version, npm, scratch, checks) {
  // Caches of their own, so that nothing installed before stands in for these packs.
  const isolated = {
    ...process.env,
    npm_config_cache: path.join(scratch, 'npm-cache'),
    UV_CACHE_DIR: path.join(scratch, 'uv-cache'),
  };
  const npmInstall = (project, specs) =>
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...specs], {
      cwd: project,
      env: isolated,
    });

  // npm, each scratch project's dependencies and peers from the registry: the preview core and
  // the TypeScript wrapper together, npm installing their peers; and each adapter in a catalog
  // app's project of its own, holding the peers the adapter's pack states, the renderer among
  // them, before the core's and the adapter's packs are added, as an adopter adds the adapter to
  // the catalog's app. The renderers of upstream's npm release of 2026-11-02 do not install in
  // one npm project together, nor the Lit or Angular adapter with npm installing its peers:
  // finding 44, `@a2ui/markdown-it` 0.2.2 asking for web core `^0.14.0`.
  const [core] = npm;
  const projects = [
    {name: 'core-and-wrapper', libraries: npm.filter(each => !each.library.adapter), first: []},
    ...npm
      .filter(each => each.library.adapter)
      .map(each => ({
        name: each.library.name,
        libraries: [each],
        first: Object.entries(each.manifest.peerDependencies ?? {}).map(
          ([name, range]) => `${name}@${range}`,
        ),
        with: [core],
      })),
  ];
  for (const project of projects) {
    const dir = path.join(scratch, project.name);
    mkdirSync(dir);
    run('npm', ['init', '--yes', '--loglevel=warn'], {cwd: dir, env: isolated, stdio: 'ignore'});
    if (project.first.length > 0) npmInstall(dir, project.first);
    npmInstall(
      dir,
      [...(project.with ?? []), ...project.libraries].map(each => npmPack(each.library, version)),
    );
    for (const each of project.libraries) {
      checkInstalled(each, version, dir, {cwd: dir, env: isolated}, checks);
    }
  }

  // uv: the wheel into a fresh environment.
  const venv = path.join(scratch, 'venv');
  run('uv', ['venv', '--no-config', '--quiet', venv], {cwd: scratch, env: isolated});
  const python =
    process.platform === 'win32'
      ? path.join(venv, 'Scripts', 'python.exe')
      : path.join(venv, 'bin', 'python');
  run(
    'uv',
    ['pip', 'install', '--no-config', '--quiet', '--python', python, pythonWheel(version)],
    {cwd: scratch, env: isolated},
  );
  const module = PYTHON_LIBRARY.module;
  const script = [
    'import importlib.metadata as metadata, json',
    `import ${module}`,
    'found = [e for e in metadata.entry_points(group="opentelemetry_instrumentor") if e.name == "a2ui"]',
    'print(json.dumps({',
    `  "version": metadata.version("${PYTHON_LIBRARY.name}"),`,
    `  "module": ${module}.__version__,`,
    '  "entryPoints": [e.value for e in found],',
    `  "loaded": len(found) == 1 and found[0].load() is ${module}.A2uiInstrumentor,`,
    '}))',
  ].join('\n');
  const loaded = JSON.parse(output(python, ['-I', '-c', script], {cwd: scratch, env: isolated}));
  const where = `${path.basename(pythonWheel(version))}, installed`;
  checks.equal(loaded.version, version, `${where}: its version`);
  checks.equal(loaded.module, version, `${where}: ${module}.__version__`);
  checks.equal(
    loaded.entryPoints,
    [`${module}:A2uiInstrumentor`],
    `${where}: its opentelemetry_instrumentor entry point`,
  );
  checks.equal(loaded.loaded, true, `${where}: the entry point loads A2uiInstrumentor`);
  console.log(
    `uv: ${path.basename(pythonWheel(version))} installed, imported, and its entry point found.`,
  );
}

function fail(checks) {
  if (checks.failures.length > 0) {
    throw new BuildError(
      `${checks.failures.length} of the checks failed:\n${checks.failures.map(f => `- ${f}`).join('\n')}`,
    );
  }
}

async function main() {
  const version = readVersion();
  if (!existsSync(librariesPath())) {
    throw new BuildError(
      `${LIBRARIES_DIR} holds no packs: make them first, \`yarn pack:libraries\`.`,
    );
  }
  const checks = new Checks();
  const npm = checkPacks(version, checks);
  fail(checks);
  console.log(`The libraries' seven files hold what they should, at ${version}.`);
  // Its real path, as Node's resolution gives it.
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-library-installs-')));
  try {
    install(version, npm, scratch, checks);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
  fail(checks);
}

await runMain('check:libraries', main);
