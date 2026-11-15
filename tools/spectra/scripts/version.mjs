// The release's version: set in `src/version.ts`, and carried by the seven released packages
// alone. From `tools/spectra/`:
//
//     yarn set:version <version>    writes the version into every place that carries it, then
//                                   brings the root `uv.lock` along with `uv lock`
//     yarn check:version            fails when a place states another version than
//                                   `src/version.ts`
//
// The places: `src/version.ts` and this package's `package.json`, for the binary; the
// `package.json` of the preview core, of the React, Lit and Angular preview adapters and of the
// TypeScript wrapper; the Python wrapper's `pyproject.toml` and its `version.py`. A version is
// three numbers. The workspace packages that are never published state `0.0.0`, and neither
// command reads them.

import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {BuildError, readVersion, REPO_DIR, run, runMain, VERSION_PATTERN} from './packages.mjs';

/** An npm manifest's top-level `version`. */
const NPM_VERSION = /^ {2}"version": "([^"]*)",?$/m;

/**
 * Every place that carries the version, from the repository's root: its file, and the pattern
 * whose one match holds the version, within the part of the file `within` picks.
 */
export const VERSION_PLACES = [
  {file: 'tools/spectra/src/version.ts', pattern: /^export const VERSION = '([^']*)';$/m},
  {file: 'tools/spectra/package.json', pattern: NPM_VERSION},
  {file: 'typescript/preview/core/package.json', pattern: NPM_VERSION},
  {file: 'typescript/preview/react/package.json', pattern: NPM_VERSION},
  {file: 'typescript/preview/lit/package.json', pattern: NPM_VERSION},
  {file: 'typescript/preview/angular/package.json', pattern: NPM_VERSION},
  {file: 'typescript/instrumentation/package.json', pattern: NPM_VERSION},
  {
    file: 'python/a2ui_spectra_instrumentation/pyproject.toml',
    pattern: /^version = "([^"]*)"$/m,
    within: projectTable,
  },
  {
    file: 'python/a2ui_spectra_instrumentation/src/a2ui_spectra_instrumentation/version.py',
    pattern: /^__version__ = "([^"]*)"$/m,
  },
];

/** A `pyproject.toml`'s `[project]` table, as its start and end in the text. */
function projectTable(text, file) {
  const start = /^\[project\]$/m.exec(text);
  if (start === null) throw new BuildError(`${file} has no [project] table.`);
  const next = /^\[/m.exec(text.slice(start.index + start[0].length));
  const end = next === null ? text.length : start.index + start[0].length + next.index;
  return [start.index, end];
}

/** The place's one match: the version it states, and where the version sits in the text. */
function matchIn(place, text) {
  const [start, end] = place.within?.(text, place.file) ?? [0, text.length];
  const matches = [...text.slice(start, end).matchAll(new RegExp(place.pattern.source, 'dgm'))];
  if (matches.length !== 1) {
    throw new BuildError(
      `${place.file}: the line that states the version is found ${matches.length} times, not once.`,
    );
  }
  const [match] = matches;
  const version = match[1];
  const at = start + match.indices[1][0];
  if (place.file.endsWith('package.json') && JSON.parse(text).version !== version) {
    throw new BuildError(`${place.file}'s top-level version is not the line the command reads.`);
  }
  return {version, at};
}

/** Each place with the version it states. */
export function statedVersions() {
  return VERSION_PLACES.map(place => {
    const text = readFileSync(path.join(REPO_DIR, place.file), 'utf8');
    return {file: place.file, version: matchIn(place, text).version};
  });
}

/** Each place that states another version than `src/version.ts`, as a line. */
export function versionDifferences(version = readVersion()) {
  return statedVersions()
    .filter(place => place.version !== version)
    .map(place => `${place.file} states ${place.version}, not ${version}.`);
}

function set(version) {
  if (version === undefined || !VERSION_PATTERN.test(version)) {
    throw new BuildError(`Give the version as three numbers, as 0.1.0, not ${version ?? 'none'}.`);
  }
  for (const place of VERSION_PLACES) {
    const file = path.join(REPO_DIR, place.file);
    const text = readFileSync(file, 'utf8');
    const {version: was, at} = matchIn(place, text);
    writeFileSync(file, text.slice(0, at) + version + text.slice(at + was.length));
    console.log(`${place.file}: ${was} -> ${version}`);
  }
  // The root lockfile records the Python wrapper's version, which `uv sync --locked` holds to.
  run('uv', ['lock', '--quiet'], {cwd: REPO_DIR});
  console.log('uv.lock: brought along.');
}

function check() {
  const version = readVersion();
  const differences = versionDifferences(version);
  if (differences.length > 0) {
    throw new BuildError(
      `${differences.length} of the places that carry the version differ from src/version.ts:\n${differences.map(line => `- ${line}`).join('\n')}\nSet it in every place with \`yarn set:version ${version}\`.`,
    );
  }
  console.log(`The ${VERSION_PLACES.length} places that carry the version state ${version}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, version, ...rest] = process.argv.slice(2);
  await runMain(`${mode ?? 'version'}:version`, () => {
    if (mode === 'set' && rest.length === 0) return set(version);
    if (mode === 'check' && version === undefined) return check();
    throw new BuildError('Run it as `node scripts/version.mjs set <version>` or `check`.');
  });
}
