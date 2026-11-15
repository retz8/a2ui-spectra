// What the six libraries' packs are, for the packing command, `pack_libraries.mjs`, its check,
// `check_libraries.mjs`, and the two smoke checks under `_dev/tools/` that install them: each
// library's folder, the files a registry receives, and the built files a pack holds.

import {readdirSync} from 'node:fs';
import path from 'node:path';

import {REPO_DIR, TOOL_DIR} from './packages.mjs';

/** Where the packs are made, under the tool's folder. */
export const LIBRARIES_DIR = 'dist/libraries';

/** The five npm libraries, by name and folder from the repository's root. */
export const NPM_LIBRARIES = [
  {name: 'a2ui-spectra-preview', dir: 'typescript/preview/core'},
  {name: 'a2ui-spectra-preview-react', dir: 'typescript/preview/react', adapter: true},
  {name: 'a2ui-spectra-preview-lit', dir: 'typescript/preview/lit', adapter: true},
  {name: 'a2ui-spectra-preview-angular', dir: 'typescript/preview/angular', adapter: true},
  {name: 'a2ui-spectra-instrumentation', dir: 'typescript/instrumentation'},
];

/** The preview core, which each adapter states at the release's version. */
export const PREVIEW_CORE = NPM_LIBRARIES[0].name;

/** The Python wrapper, its distribution's name, its folder and its module. */
export const PYTHON_LIBRARY = {
  name: 'a2ui-spectra-instrumentation',
  dir: 'python/a2ui_spectra_instrumentation',
  module: 'a2ui_spectra_instrumentation',
};

/** What an npm library's packed manifest keeps of its manifest in the repo, in the repo's order. */
export const KEPT_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'repository',
  'bugs',
  'keywords',
  'type',
  'engines',
  'exports',
  'files',
  'sideEffects',
  'dependencies',
  'peerDependencies',
];

/** What it drops; a field in neither list stops the packing command. */
export const DROPPED_FIELDS = ['private', 'scripts', 'wireit', 'devDependencies'];

/** The root `LICENSE`, which every pack carries. */
export const LICENSE = path.join(REPO_DIR, 'LICENSE');

export function librariesPath(...parts) {
  return path.join(TOOL_DIR, LIBRARIES_DIR, ...parts);
}

/** An npm library's pack, as `npm pack` names it. */
export function npmPack(library, version) {
  return librariesPath('npm', `${library.name}-${version}.tgz`);
}

export function pythonWheel(version) {
  return librariesPath('pypi', `${PYTHON_LIBRARY.module}-${version}-py3-none-any.whl`);
}

export function pythonSdist(version) {
  return librariesPath('pypi', `${PYTHON_LIBRARY.module}-${version}.tar.gz`);
}

/** The seven files, as their paths. */
export function libraryFiles(version) {
  return [
    ...NPM_LIBRARIES.map(library => npmPack(library, version)),
    pythonWheel(version),
    pythonSdist(version),
  ];
}

/** Every file under a folder, as paths relative to it with `/`, the folders `skip` names passed over. */
export function filesUnder(dir, skip = () => false, prefix = '') {
  return readdirSync(path.join(dir, prefix), {withFileTypes: true})
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap(entry => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return skip(relative) ? [] : filesUnder(dir, skip, relative);
      return entry.isFile() ? [relative] : [];
    });
}

/** The built files a pack holds: the JavaScript, its source maps and the `.d.ts` files. */
const BUILT = /\.(js|mjs|js\.map|mjs\.map|d\.ts)$/;

/**
 * An npm library's built files that its pack holds, as paths under its folder: everything of
 * those kinds under `dist/`, except the tests and the tests' support in `dist/testing/`.
 */
export function builtFiles(library) {
  const dist = path.join(REPO_DIR, library.dir, 'dist');
  return filesUnder(dist, dir => dir === 'testing')
    .filter(file => BUILT.test(file) && !/\.test\./.test(path.posix.basename(file)))
    .map(file => `dist/${file}`);
}

/** The Python wrapper's module files, as paths under its folder: `src/` without bytecode. */
export function pythonSources() {
  const dir = path.join(REPO_DIR, PYTHON_LIBRARY.dir);
  return filesUnder(path.join(dir, 'src'), folder => path.posix.basename(folder) === '__pycache__')
    .filter(file => !file.endsWith('.pyc'))
    .map(file => `src/${file}`);
}

/** A `.d.ts` file as a pack holds it: without the line naming its declaration map. */
export function withoutDeclarationMap(text) {
  return text.replace(/\n\/\/# sourceMappingURL=[^\n]*\.d\.ts\.map\n?$/, '\n');
}
