// The upstream check: what happened upstream since the pin. It prints and decides nothing; which
// event it found is the judgement step of `_dev/re-pin-procedure.md`.
//
// From the repository root, with no argument:
//
//     node _dev/tools/upstream_check.mjs
//
// It fetches the upstream remote in the sibling fork, then prints five readings and the commits
// that touch the held-by findings' paths:
//
//   1. the commits since the pin, as a count and a list per area Spectra uses;
//   2. each copied file, the pin against upstream main;
//   3. each upstream package's published latest on npm and PyPI, against the version Spectra has;
//   4. `specification/versions.json` at upstream main, against the supported versions;
//   5. the watch list, each item's state on GitHub.

import {execFileSync} from 'node:child_process';
import {
  fileAt,
  forkDir,
  git,
  gitSucceeds,
  readPin,
  upstreamRef,
  uvLockVersions,
  yarnLockVersions,
} from './upstream_pin.mjs';

// The areas of upstream Spectra takes from, as path prefixes in upstream's repository.
const AREAS = [
  ['The specification', ['specification/']],
  ['The catalogs', ['catalogs/']],
  ['The conformance data', ['conformance/']],
  ['The TypeScript core, renderers and agent SDK', ['typescript/core/', 'typescript/renderers/', 'typescript/agents/']],
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
];

// The protocol versions Spectra supports: those `specification/versions.json` gives as current or
// previous (the Phase 9 spec, decision 4).
const SUPPORTED_VERSIONS = ['v0.9', 'v0.9.1', 'v1.0'];

const pin = readPin();
const fork = forkDir(pin);
const ref = upstreamRef(pin);
const short = c => c.slice(0, 9);

function heading(text) {
  console.log(`\n## ${text}\n`);
}

function commitsSince(paths) {
  const out = git(fork, ['log', '--format=%h %cs %s', `${pin.pin.commit}..${ref}`, '--', ...paths]);
  return out.split('\n').filter(Boolean);
}

async function fetchJson(url) {
  const response = await fetch(url, {headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function githubApi(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  } catch {
    return fetchJson(`https://api.github.com/${endpoint}`);
  }
}

// --- Fetch ---------------------------------------------------------------------------------------

execFileSync('git', ['-C', fork, 'fetch', '--quiet', pin.upstream.remote], {stdio: 'inherit'});
const head = git(fork, ['log', '-1', '--format=%H %cs', ref]).trim().split(' ');
const total = commitsSince([]);

console.log(`# The upstream check`);
console.log(`\nThe pin: ${short(pin.pin.commit)} (${pin.pin.date}).`);
console.log(`${ref}: ${short(head[0])} (${head[1]}), ${total.length} commit(s) since the pin.`);
if (!gitSucceeds(fork, ['merge-base', '--is-ancestor', pin.pin.commit, ref])) {
  console.log(`The pin is not an ancestor of ${ref}.`);
}

// --- 1. Commits per area -------------------------------------------------------------------------

heading('1. Commits since the pin, per area');
for (const [area, paths] of AREAS) {
  const commits = commitsSince(paths);
  console.log(`${area} (${paths.join(', ')}): ${commits.length}`);
  for (const line of commits) console.log(`  ${line}`);
}

// --- 2. Copied files -----------------------------------------------------------------------------

heading('2. Each copied file, the pin against upstream main');
for (const copy of pin.copies) {
  const atPin = fileAt(fork, pin.pin.commit, copy.upstream);
  const atHead = fileAt(fork, ref, copy.upstream);
  let state;
  if (atHead === null) state = 'gone at upstream main';
  else if (atPin === null) state = 'absent at the pin';
  else state = atPin.equals(atHead) ? 'unchanged' : 'differs';
  const altered = copy.alterations?.length
    ? ` (altered copy: finding ${copy.alterations.map(a => a.finding).join(', ')})`
    : '';
  console.log(`${state.padEnd(22)} ${copy.upstream} -> ${copy.spectra}${altered}`);
}

// --- 3. Published packages -----------------------------------------------------------------------

heading('3. Each upstream package, its published latest against the version Spectra has');
for (const pkg of pin.packages) {
  let published;
  try {
    if (pkg.registry === 'npm') {
      const doc = await fetchJson(`https://registry.npmjs.org/${pkg.name.replace('/', '%2f')}`);
      const latest = doc['dist-tags'].latest;
      const tags = Object.entries(doc['dist-tags'])
        .filter(([tag]) => tag !== 'latest')
        .map(([tag, v]) => `${tag} ${v}`);
      published = `${latest} (${doc.time[latest].slice(0, 10)})${tags.length ? `; also ${tags.join(', ')}` : ''}`;
    } else {
      const doc = await fetchJson(`https://pypi.org/pypi/${pkg.name}/json`);
      const latest = doc.info.version;
      const uploaded = doc.releases[latest]?.[0]?.upload_time_iso_8601?.slice(0, 10) ?? '?';
      published = `${latest} (${uploaded})`;
    }
  } catch (error) {
    published = `unread: ${error.message}`;
  }
  const lock = pkg.registry === 'npm' ? yarnLockVersions(pkg.name) : uvLockVersions(pkg.name);
  const has = lock.length ? lock.map(l => l.version).join(', ') : 'not in the lockfile';
  const atPin = upstreamVersion(pkg, pin.pin.commit);
  const flag = pkg.patch ? `  [patched locally to the pin, ${describePatch(pkg.patch)}]` : '';
  console.log(`${pkg.registry} ${pkg.name}: published ${published}; Spectra has ${has}; the pin's source states ${atPin}${flag}`);
}

function upstreamVersion(pkg, commit) {
  if (pkg.registry === 'npm') {
    const file = fileAt(fork, commit, `${pkg.upstreamPath}/package.json`);
    return file ? JSON.parse(file.toString('utf8')).version : 'nothing';
  }
  const file = fileAt(fork, commit, `${pkg.upstreamPath}/pyproject.toml`);
  if (!file) return 'nothing';
  const text = file.toString('utf8');
  return /^version = "(.+)"/m.exec(text)?.[1] ?? 'a version from its git tags';
}

function describePatch(patch) {
  return patch.source === 'tarball' ? `tarball ${patch.tarball}` : 'a uv git source at the pin';
}

// --- 4. versions.json ----------------------------------------------------------------------------

heading('4. specification/versions.json at upstream main');
const versionsAt = commit => {
  const file = fileAt(fork, commit, 'specification/versions.json');
  return file ? JSON.parse(file.toString('utf8')).versions : [];
};
const atPinVersions = new Map(versionsAt(pin.pin.commit).map(v => [v.version, v.status]));
const atHeadVersions = versionsAt(ref);
for (const {version, status} of atHeadVersions) {
  const before = atPinVersions.get(version);
  const supported = SUPPORTED_VERSIONS.includes(version) ? 'supported' : 'not supported';
  let change = '';
  if (before === undefined) change = '  CHANGE: a new version since the pin';
  else if (before !== status) change = `  CHANGE: ${before} at the pin`;
  if (SUPPORTED_VERSIONS.includes(version) && status === 'deprecated') change += '  CHANGE: a supported version is deprecated';
  console.log(`${version.padEnd(8)} ${status.padEnd(11)} ${supported}${change}`);
}
for (const version of SUPPORTED_VERSIONS) {
  if (!atHeadVersions.some(v => v.version === version)) console.log(`${version}: CHANGE: gone from the file`);
}

// --- 5. The watch list ---------------------------------------------------------------------------

heading('5. The watch list');
for (const item of pin.watch) {
  const endpoint = `repos/${pin.upstream.repository}/${item.kind === 'pull' ? 'pulls' : 'issues'}/${item.number}`;
  let state;
  try {
    const doc = await githubApi(endpoint);
    if (item.kind === 'pull') {
      state = doc.merged_at ? `merged ${doc.merged_at.slice(0, 10)}` : doc.state;
    } else {
      state = doc.state === 'closed' ? `closed ${doc.closed_at.slice(0, 10)} (${doc.state_reason})` : 'open';
    }
  } catch (error) {
    state = `unread: ${error.message}`;
  }
  console.log(`${item.kind === 'pull' ? 'PR' : 'issue'} #${item.number}: ${state} (${item.about})`);
}

// --- The held-by findings ------------------------------------------------------------------------

heading('Commits since the pin that touch the held-by findings\' paths');
for (const held of pin.heldBy) {
  const commits = commitsSince(held.paths);
  console.log(`Finding ${held.finding} (${held.paths.join(', ')}): ${commits.length}`);
  for (const line of commits) console.log(`  ${line}`);
}
