// What happened upstream since the pin, as facts: it compares and judges nothing. From the
// repository root, with a clone of upstream's repository that holds its history back to the pin:
//
//     node scripts/upstream_readings.mjs --upstream <clone>
//
// It reads the pin, the copies and the packages from `vendor/a2ui/upstream-pin.json`, and prints,
// as Markdown, first the packages a registry carries in a version newer than the one Spectra uses,
// and those whose version upstream's source has moved past its registry's latest, then six readings:
//
//   1. the commits since the pin, as a count and a list per area Spectra takes from;
//   2. each copied file, unchanged or differing between the pin and upstream's main;
//   3. each upstream package's latest on its registry, with its date, beside the version Spectra
//      uses and the versions the pin's source and upstream main's source state;
//   4. `specification/versions.json` at upstream's main, against the pin's;
//   5. each OpenTelemetry package the two wrappers' manifests state, and `wrapt`, its latest beside
//      the version the lockfile resolves, and the OpenTelemetry ranges ADK states;
//   6. the documentation site's `--a2-accent` at upstream's main, light and dark, beside the
//      viewer's `--brand`.
//
// Under GitHub Actions it also writes the Markdown to the job's summary, and the first part as a
// notice.

import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = 'origin/main';

// The areas of upstream Spectra takes from, as path prefixes in upstream's repository.
const AREAS = [
  ['The specification', ['specification/']],
  ['The catalogs', ['catalogs/']],
  ['The conformance data', ['conformance/']],
  [
    'The TypeScript core, renderers and agent SDK',
    ['typescript/core/', 'typescript/renderers/', 'typescript/agents/'],
  ],
  ['The Python packages', ['python/']],
  [
    'The three core samples',
    [
      'samples/agent/adk/restaurant_finder/',
      'samples/agent/adk/custom-components-example/',
      'samples/agent/node/restaurant_finder/',
    ],
  ],
  ['The sample clients', ['samples/client/']],
  [
    "Upstream's install scripts and their test",
    [
      'scripts/public/install_cli.sh',
      'scripts/public/install_cli.ps1',
      'scripts/test_install_cli.sh',
    ],
  ],
];

// The protocol versions Spectra supports.
const SUPPORTED_VERSIONS = ['v0.9', 'v0.9.1', 'v1.0'];

const args = process.argv.slice(2);
const at = args.indexOf('--upstream');
if (at === -1 || args[at + 1] === undefined) {
  console.error('Run it as `node scripts/upstream_readings.mjs --upstream <clone>`.');
  process.exit(2);
}
const upstream = path.resolve(args[at + 1]);
const pin = JSON.parse(readFileSync(path.join(REPO, 'vendor/a2ui/upstream-pin.json'), 'utf8'));

const lines = [];
const say = (text = '') => lines.push(text);
const short = commit => commit.slice(0, 9);
const code = text => `\`${text}\``;

function git(gitArgs, {encoding = 'utf8'} = {}) {
  return execFileSync('git', ['-C', upstream, ...gitArgs], {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A file's bytes at a commit, or null when the commit has no such file. */
function fileAt(commit, file) {
  try {
    return git(['show', `${commit}:${file}`], {encoding: 'buffer'});
  } catch {
    return null;
  }
}

function commitsSince(paths) {
  const out = git(['log', '--format=%h %cs %s', `${pin.pin.commit}..${REF}`, '--', ...paths]);
  return out.split('\n').filter(Boolean);
}

async function fetchJson(url) {
  const response = await fetch(url, {headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** Each version of an npm package in `yarn.lock`. */
function yarnLockVersions(name) {
  const lock = readFileSync(path.join(REPO, 'yarn.lock'), 'utf8');
  const found = [];
  for (const block of lock.split(/\n\n/)) {
    if (!block.split('\n')[0].startsWith(`"${name}@`)) continue;
    const version = /\n {2}version: (.+)/.exec(block)?.[1];
    if (version) found.push(version);
  }
  return found;
}

/** Each version of a Python package in `uv.lock`. */
function uvLockVersions(name) {
  const lock = readFileSync(path.join(REPO, 'uv.lock'), 'utf8');
  const found = [];
  for (const block of lock.split(/\n\[\[package\]\]\n/)) {
    if (!block.startsWith(`name = "${name}"\n`)) continue;
    const version = /\nversion = "(.+)"/.exec(block)?.[1];
    if (version) found.push(version);
  }
  return found;
}

const numbers = version => version.split('.').map(Number);
/** Plain `x.y.z` versions compared; anything else is not compared. */
const plain = version => /^\d+\.\d+\.\d+$/.test(version);
function compare(a, b) {
  const [x, y] = [numbers(a), numbers(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
const newest = versions => versions.filter(plain).sort(compare).at(-1);

/** Whether a plain `x.y.z` version lies in a range of `^`, `>=` and `<` comparators. */
function inRange(version, range) {
  return range.split(/\s+/).every(part => {
    if (part.startsWith('^')) {
      const floor = part.slice(1);
      const [major, minor] = numbers(floor);
      const next = major > 0 ? `${major + 1}.0.0` : `0.${minor + 1}.0`;
      return compare(version, floor) >= 0 && compare(version, next) < 0;
    }
    if (part.startsWith('>=')) return compare(version, part.slice(2)) >= 0;
    if (part.startsWith('<')) return compare(version, part.slice(1)) < 0;
    return version === part;
  });
}

/** The version a package's manifest states at a commit of upstream. */
function sourceVersion(pkg, commit) {
  if (pkg.registry === 'npm') {
    const file = fileAt(commit, `${pkg.upstreamPath}/package.json`);
    return file ? JSON.parse(file.toString('utf8')).version : null;
  }
  const file = fileAt(commit, `${pkg.upstreamPath}/pyproject.toml`);
  if (!file) return null;
  return /^version = "(.+)"/m.exec(file.toString('utf8'))?.[1] ?? 'from its git tags';
}

/** A package's latest on its registry, its date and its other npm tags. */
async function published(pkg) {
  if (pkg.registry === 'npm') {
    const doc = await fetchJson(`https://registry.npmjs.org/${pkg.name.replace('/', '%2f')}`);
    const latest = doc['dist-tags'].latest;
    const tags = Object.entries(doc['dist-tags'])
      .filter(([tag]) => tag !== 'latest')
      .map(([tag, version]) => `${tag} ${version}`);
    return {latest, date: doc.time[latest].slice(0, 10), tags};
  }
  const doc = await fetchJson(`https://pypi.org/pypi/${pkg.name}/json`);
  const latest = doc.info.version;
  const date = doc.releases[latest]?.[0]?.upload_time_iso_8601?.slice(0, 10) ?? '?';
  return {latest, date, tags: []};
}

// --- Read ----------------------------------------------------------------------------------------

const [headCommit, headDate] = git(['log', '-1', '--format=%H %cs', REF]).trim().split(' ');
const total = commitsSince([]);
const pinIsAncestor = (() => {
  try {
    git(['merge-base', '--is-ancestor', pin.pin.commit, REF]);
    return true;
  } catch {
    return false;
  }
})();

const packages = [];
for (const pkg of pin.packages) {
  let registry;
  try {
    registry = await published(pkg);
  } catch (error) {
    registry = {error: error.message};
  }
  const uses = pkg.registry === 'npm' ? yarnLockVersions(pkg.name) : uvLockVersions(pkg.name);
  packages.push({
    pkg,
    registry,
    uses,
    atPin: sourceVersion(pkg, pin.pin.commit),
    atMain: sourceVersion(pkg, REF),
  });
}

// --- The first part: what the registries and upstream's source carry ----------------------------

const newer = packages.filter(({registry, uses}) => {
  const usesNewest = newest(uses);
  return (
    registry.latest &&
    plain(registry.latest) &&
    usesNewest &&
    compare(registry.latest, usesNewest) > 0
  );
});
const unpublished = packages.filter(
  ({registry, atMain}) =>
    registry.latest &&
    atMain &&
    plain(atMain) &&
    plain(registry.latest) &&
    compare(atMain, registry.latest) > 0,
);
const unread = packages.filter(({registry}) => registry.error);

const headline = [];
headline.push(
  newer.length === 0
    ? 'No registry carries an upstream package in a version newer than the one Spectra uses.'
    : `On the registries, newer than Spectra uses: ${newer
        .map(
          ({pkg, registry, uses}) =>
            `${pkg.name} ${registry.latest} (${registry.date}; Spectra uses ${newest(uses)})`,
        )
        .join(', ')}.`,
);
if (unpublished.length > 0) {
  headline.push(
    `In upstream main's source, past the registry's latest: ${unpublished
      .map(
        ({pkg, registry, atMain}) => `${pkg.name} ${atMain} (the registry has ${registry.latest})`,
      )
      .join(', ')}.`,
  );
}
if (unread.length > 0) {
  headline.push(`Not read: ${unread.map(({pkg}) => pkg.name).join(', ')}.`);
}

say('# Upstream since the pin');
say();
for (const line of headline) {
  say(`**${line}**`);
  say();
}
say(
  `The pin: ${code(short(pin.pin.commit))} (${pin.pin.date}). Upstream main: ${code(short(headCommit))} (${headDate}), ${total.length} commit(s) since the pin.`,
);
if (!pinIsAncestor) say('The pin is not an ancestor of upstream main.');

// --- 1. Commits per area -------------------------------------------------------------------------

say();
say('## 1. Commits since the pin, per area');
say();
for (const [area, paths] of AREAS) {
  const commits = commitsSince(paths);
  say(`- ${area}: ${commits.length}`);
  for (const line of commits) {
    const [, hash, rest] = /^(\S+) (.*)$/.exec(line);
    say(`  - ${code(hash)} ${rest}`);
  }
}

// --- 2. Copied files -----------------------------------------------------------------------------

say();
say('## 2. Each copied file, the pin against upstream main');
say();
for (const copy of pin.copies) {
  const atPin = fileAt(pin.pin.commit, copy.upstream);
  const atHead = fileAt(REF, copy.upstream);
  let state;
  if (atHead === null) state = 'gone at upstream main';
  else if (atPin === null) state = 'absent at the pin';
  else state = atPin.equals(atHead) ? 'unchanged' : 'differs';
  const altered = copy.alterations?.length ? ', an altered copy' : '';
  say(`- ${state}: ${code(copy.upstream)} → ${code(copy.spectra)}${altered}`);
}

// --- 3. Published packages -----------------------------------------------------------------------

say();
say('## 3. Each upstream package');
say();
say(
  '| Package | Registry latest | Date | Spectra uses | The pin states | Upstream main states | Patched locally |',
);
say('| --- | --- | --- | --- | --- | --- | --- |');
for (const {pkg, registry, uses, atPin, atMain} of packages) {
  const latest = registry.error
    ? `not read: ${registry.error}`
    : `${registry.latest}${registry.tags.length ? ` (also ${registry.tags.join(', ')})` : ''}`;
  say(
    `| ${pkg.registry} ${code(pkg.name)} | ${latest} | ${registry.date ?? ''} | ${uses.join(', ') || 'none'} | ${atPin ?? 'none'} | ${atMain ?? 'none'} | ${pkg.patch ? 'yes' : 'no'} |`,
  );
}

// --- 4. versions.json ----------------------------------------------------------------------------

say();
say('## 4. `specification/versions.json` at upstream main');
say();
const versionsAt = commit => {
  const file = fileAt(commit, 'specification/versions.json');
  return file ? JSON.parse(file.toString('utf8')).versions : [];
};
const atPinVersions = new Map(versionsAt(pin.pin.commit).map(v => [v.version, v.status]));
const atHeadVersions = versionsAt(REF);
for (const {version, status} of atHeadVersions) {
  const before = atPinVersions.get(version);
  const supported = SUPPORTED_VERSIONS.includes(version) ? 'supported by Spectra' : 'not supported';
  let change = '';
  if (before === undefined) change = '; new since the pin';
  else if (before !== status) change = `; ${before} at the pin`;
  say(`- ${version}: ${status}, ${supported}${change}`);
}
for (const version of SUPPORTED_VERSIONS) {
  if (!atHeadVersions.some(v => v.version === version)) say(`- ${version}: gone from the file`);
}

// --- 5. OpenTelemetry ----------------------------------------------------------------------------

say();
say('## 5. Each OpenTelemetry package the wrappers state, against the lockfile');
say();
const tsManifest = JSON.parse(
  readFileSync(path.join(REPO, 'typescript/instrumentation/package.json'), 'utf8'),
);
const tsRanges = Object.entries({
  ...tsManifest.dependencies,
  ...tsManifest.peerDependencies,
}).filter(([name]) => name.startsWith('@opentelemetry/'));
say("The TypeScript wrapper, on OpenTelemetry JavaScript's 2.x line:");
say();
for (const [name, range] of tsRanges) {
  let reading;
  try {
    const doc = await fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
    const within = newest(Object.keys(doc.versions).filter(v => plain(v) && inRange(v, range)));
    const tags = doc['dist-tags'];
    const line2 = tags['latest-2'] ? `; latest-2 ${tags['latest-2']}` : '';
    reading = `newest in the range ${within} (${doc.time[within].slice(0, 10)})${line2}; latest ${tags.latest} (${doc.time[tags.latest].slice(0, 10)})`;
  } catch (error) {
    reading = `not read: ${error.message}`;
  }
  say(
    `- npm ${code(name)} ${code(range)}: ${reading}; the lockfile has ${yarnLockVersions(name).join(', ') || 'none'}`,
  );
}
say();
const pyManifest = readFileSync(
  path.join(REPO, 'python/a2ui_spectra_instrumentation/pyproject.toml'),
  'utf8',
);
const pyRanges = [...pyManifest.matchAll(/^\s*"((?:opentelemetry-[a-z-]+|wrapt))([^"]*)",$/gm)].map(
  match => [match[1], match[2]],
);
say('The Python wrapper:');
say();
for (const [name, range] of pyRanges) {
  let reading;
  try {
    const doc = await fetchJson(`https://pypi.org/pypi/${name}/json`);
    const latest = doc.info.version;
    reading = `latest ${latest} (${doc.releases[latest]?.[0]?.upload_time_iso_8601?.slice(0, 10) ?? '?'})`;
  } catch (error) {
    reading = `not read: ${error.message}`;
  }
  say(
    `- PyPI ${code(name + range)}: ${reading}; the lockfile has ${uvLockVersions(name).join(', ') || 'none'}`,
  );
}
say();
say("ADK's own OpenTelemetry ranges, at its latest:");
say();
try {
  const doc = await fetchJson('https://pypi.org/pypi/google-adk/json');
  const ranges = (doc.info.requires_dist ?? []).filter(r =>
    /^opentelemetry-(api|sdk)[^;]*$/.test(r),
  );
  say(
    `- PyPI ${code('google-adk')} ${doc.info.version}: ${ranges.join('; ')}; the lockfile has ${uvLockVersions('google-adk').join(', ') || 'none'}`,
  );
} catch (error) {
  say(`- PyPI ${code('google-adk')}: not read: ${error.message}`);
}
try {
  const doc = await fetchJson('https://registry.npmjs.org/@google%2fadk/latest');
  const api =
    doc.dependencies?.['@opentelemetry/api'] ??
    doc.peerDependencies?.['@opentelemetry/api'] ??
    'none';
  say(`- npm ${code('@google/adk')} ${doc.version}: ${code('@opentelemetry/api')} ${api}`);
} catch (error) {
  say(`- npm ${code('@google/adk')}: not read: ${error.message}`);
}

// --- 6. The site's accent ------------------------------------------------------------------------

say();
say("## 6. The documentation site's accent against the viewer's");
say();

/** A custom property's value in the first rule whose selector passes the test, comments left out. */
function propertyIn(css, selectorTest, property) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorTest(selector.trim())) continue;
    const value = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();
    if (value) return value.toLowerCase();
  }
  return null;
}

const siteTokens = fileAt(REF, 'docs/site/src/styles/tokens.css')?.toString('utf8') ?? '';
const viewerStyles = readFileSync(path.join(REPO, 'tools/spectra_viewer/src/index.css'), 'utf8');
const themed = theme => selector => new RegExp(`\\[data-theme=['"]${theme}['"]\\]`).test(selector);
for (const [theme, site, viewer] of [
  [
    'light',
    propertyIn(siteTokens, themed('light'), '--a2-accent'),
    propertyIn(viewerStyles, s => s === ':root', '--brand'),
  ],
  [
    'dark',
    propertyIn(siteTokens, themed('dark'), '--a2-accent'),
    propertyIn(viewerStyles, s => s === ':root.dark', '--brand'),
  ],
]) {
  const state =
    site === null || viewer === null ? 'not read' : site === viewer ? 'same' : 'differs';
  say(
    `- ${theme}: the site's ${code('--a2-accent')} ${site ?? 'not found'}, the viewer's ${code('--brand')} ${viewer ?? 'not found'}: ${state}`,
  );
}

// --- Out -----------------------------------------------------------------------------------------

const markdown = `${lines.join('\n')}\n`;
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (process.env.GITHUB_ACTIONS) {
  // A workflow command's message escapes `%`, carriage returns and newlines.
  const escape = text => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::notice title=Upstream since the pin::${escape(headline.join(' '))}`);
}
