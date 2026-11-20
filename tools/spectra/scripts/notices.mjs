// The binary's third-party notices, `THIRD_PARTY_NOTICES.md`, written once per build and carried
// by every package and archive of that build.
//
// It lists every npm package that contributed a file to the binary, as the tool's build, the
// viewer's build and the basic preview's build each report what they bundled: Bun's metafile of
// each of the five binaries, each input counted when it put bytes into the output, and each Vite
// build's `bundle-report.json`. For each package, its version, its licence, its licence text and
// its NOTICE file when it has one, read from the installed package. For a package that ships no
// licence text, the text kept by hand for that package and version in `licences_by_hand/`, taken
// from its source repository, with where it came from in `licences_by_hand/sources.json`; a
// bundled package with neither fails the build, and so does a text kept by hand that no bundled
// package needs, as after a version's change. Then the list kept by hand, `notices_by_hand.md`, for what no
// bundler reports: Bun's runtime and what it links, upstream's copied schemas and catalogs,
// OpenTelemetry's proto files and LiteLLM's price table. Its section on Bun is Bun's
// `LICENSE.md`, under a heading naming the Bun version, which must be the pinned one.

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';

import {BuildError, builtBinary, PLATFORMS} from './packages.mjs';

/** The Vite builds' reports, each listing files relative to its own folder. */
const REPORTS = [
  '../spectra_viewer/bundle-report.json',
  '../spectra_basic_preview/bundle-report.json',
];
const BY_HAND = 'scripts/notices_by_hand.md';
/** Licence texts kept by hand, under `<name>/<version>/`, for packages that ship none. */
const LICENCES_BY_HAND = 'scripts/licences_by_hand';
const SOURCES = path.join(LICENCES_BY_HAND, 'sources.json');
const PRICES_NOTICE = 'src/prices/NOTICE';

const LICENCE_FILE = /^(licen[cs]e|copying)([-._].*)?$/i;
const NOTICE_FILE = /^notice([-._].*)?$/i;

function readJson(file) {
  if (!existsSync(file)) {
    throw new BuildError(`${file} is missing: build the binaries first, \`yarn build:binaries\`.`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Every file the three builds report bundling, as an absolute path. */
function bundledFiles() {
  const files = new Set();
  for (const platform of PLATFORMS) {
    const metafile = readJson(`${builtBinary(platform)}.metafile.json`);
    for (const built of Object.values(metafile.outputs)) {
      for (const [input, {bytesInOutput}] of Object.entries(built.inputs)) {
        // Bun names inputs relative to the folder it ran in, this one.
        if (bytesInOutput > 0) files.add(path.resolve(input));
      }
    }
  }
  for (const report of REPORTS) {
    for (const file of readJson(report).files) {
      files.add(path.resolve(path.dirname(report), file));
    }
  }
  return files;
}

/** The folder of the installed npm package a file belongs to, or nothing outside `node_modules`. */
function packageRootOf(file) {
  const parts = file.split(path.sep);
  const at = parts.lastIndexOf('node_modules');
  if (at === -1 || at + 1 >= parts.length) return undefined;
  const width = parts[at + 1].startsWith('@') ? 2 : 1;
  return parts.slice(0, at + 1 + width).join(path.sep);
}

/** The licence a manifest states, in any of the forms npm has had. */
function licenceOf(manifest) {
  const {license, licenses} = manifest;
  if (typeof license === 'string') return license;
  if (typeof license?.type === 'string') return license.type;
  if (Array.isArray(licenses)) {
    return licenses.map(entry => (typeof entry === 'string' ? entry : entry.type)).join(' OR ');
  }
  return undefined;
}

/** The files of a folder whose names match, each with its text. */
function textsOf(root, pattern) {
  return readdirSync(root)
    .filter(name => pattern.test(name) && statSync(path.join(root, name)).isFile())
    .sort()
    .map(name => ({name, text: readFileSync(path.join(root, name), 'utf8')}));
}

function packageAt(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    root,
    name: manifest.name,
    version: manifest.version,
    licence: licenceOf(manifest),
    licences: textsOf(root, LICENCE_FILE),
    notices: textsOf(root, NOTICE_FILE),
  };
}

/** A text in a fenced block, its fence longer than any run of backticks in it. */
function fenced(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}text\n${text.replace(/\r\n/g, '\n').trimEnd()}\n${fence}`;
}

/**
 * The npm packages the three builds bundled, each by name and version, with its folder, licence
 * and texts. It reads from `tools/spectra/`; the release workflow's refusal of unpublished
 * upstream code reads it too.
 */
export function bundledPackages() {
  const packages = new Map();
  for (const root of new Set([...bundledFiles()].map(packageRootOf))) {
    if (root === undefined) continue;
    const found = packageAt(root);
    const key = `${found.name}@${found.version}`;
    if (!packages.has(key)) packages.set(key, found);
  }
  keptByHand(packages);
  const unlicensed = [...packages.values()].filter(found => found.licences.length === 0);
  if (unlicensed.length > 0) {
    throw new BuildError(
      `No licence text was found in ${unlicensed.length === 1 ? 'a bundled package' : `${unlicensed.length} bundled packages`}: ` +
        unlicensed.map(found => `${found.name} ${found.version}, at ${found.root}`).join('; '),
    );
  }
  return [...packages.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en') ||
      a.version.localeCompare(b.version, 'en', {numeric: true}),
  );
}

/**
 * Gives each bundled package that ships no licence text the texts kept by hand for its name and
 * version, each with where it came from. A text kept for a package that is not bundled at that
 * version, or that ships its own, fails the build, as does a file the sources do not name.
 */
function keptByHand(packages) {
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const unneeded = [];
  for (const [key, files] of Object.entries(sources)) {
    const found = packages.get(key);
    if (found === undefined || found.licences.length > 0) {
      unneeded.push(
        found === undefined ? `${key}, which is not bundled` : `${key}, which ships its own`,
      );
      continue;
    }
    const dir = path.join(LICENCES_BY_HAND, found.name, found.version);
    const held = existsSync(dir) ? readdirSync(dir).sort() : [];
    const named = Object.keys(files).sort();
    if (JSON.stringify(held) !== JSON.stringify(named)) {
      throw new BuildError(
        `${dir} holds ${held.join(', ') || 'nothing'}, and ${SOURCES} names ${named.join(', ')} for ${key}.`,
      );
    }
    found.licences = named.map(name => ({
      name,
      text: readFileSync(path.join(dir, name), 'utf8'),
      source: files[name],
    }));
  }
  if (unneeded.length > 0) {
    throw new BuildError(
      `${SOURCES} keeps licence texts no bundled package needs: ${unneeded.join('; ')}. Remove them, ` +
        'and keep the texts of the bundled versions that ship none.',
    );
  }
}

/** The list kept by hand, checked against the pinned Bun version and LiteLLM's notice. */
function byHand(bunVersion) {
  const text = readFileSync(BY_HAND, 'utf8');
  const headings = [...text.matchAll(/^## Bun (\S+): its LICENSE\.md at the tag bun-v(\S+)$/gm)];
  if (headings.length !== 1) {
    throw new BuildError(
      `${BY_HAND} holds ${headings.length} sections on Bun; it holds one, headed "## Bun <version>: its LICENSE.md at the tag bun-v<version>".`,
    );
  }
  const [, named, tag] = headings[0];
  if (named !== bunVersion || tag !== bunVersion) {
    throw new BuildError(
      `${BY_HAND} holds Bun's licence at ${named === tag ? named : `${named} and ${tag}`}, and the binary is built on Bun ${bunVersion}. ` +
        `Put Bun's LICENSE.md at the tag bun-v${bunVersion} in its place, whole and unchanged, under a heading naming ${bunVersion}.`,
    );
  }
  if (!text.includes(readFileSync(PRICES_NOTICE, 'utf8'))) {
    throw new BuildError(`${BY_HAND}'s section on LiteLLM's price table is not ${PRICES_NOTICE}.`);
  }
  return text;
}

/** The notices file's text, for the binary at a version, built on the pinned Bun version. */
export function thirdPartyNotices({version, bunVersion}) {
  const packages = bundledPackages();
  const sections = packages.map(found =>
    [
      `### ${found.name} ${found.version}`,
      `Licence: ${found.licence ?? 'not stated in its package.json'}`,
      ...[...found.licences, ...found.notices].flatMap(({name, text, source}) => [
        source === undefined
          ? `\`${name}\`:`
          : `\`${name}\`, kept by hand, since the package ships no licence text: ${source}.`,
        fenced(text),
      ]),
    ].join('\n\n'),
  );
  return [
    '# Third-party notices',
    `The third-party software in a2ui-spectra ${version}. Spectra's own code is licensed under the Apache License, Version 2.0, whose text is in \`LICENSE\` beside this file.`,
    '## npm packages',
    `The ${packages.length} npm packages that contributed a file to the binary, through the tool's build, the viewer's or the basic preview's, each with its version, its licence, its licence text and its NOTICE file when it has one.`,
    ...sections,
    `${byHand(bunVersion).trimEnd()}\n`,
  ].join('\n\n');
}
