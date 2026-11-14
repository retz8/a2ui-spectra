// The pin's move: copies every file the pin file lists from an upstream commit, applies each
// copy's listed alterations, verifies every copy, and writes the new pin. The steps around it are
// in `_dev/re-pin-procedure.md`.
//
// From the repository root:
//
//     node _dev/tools/upstream_move.mjs <commit>
//
// The commit must be on upstream main. An unchanged copy is upstream's bytes; an altered copy is
// upstream's file with its JSON merge patches applied, written with two-space indentation. Each
// uv git source the pin file lists for a patched Python package gets the new commit in the root
// `pyproject.toml`, so the pin file stays the one place the hash is written by hand.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  REPO,
  deepEqual,
  expectedValue,
  fileAt,
  forkDir,
  git,
  gitSucceeds,
  readPin,
  upstreamRef,
  writePin,
} from './upstream_pin.mjs';

const [target] = process.argv.slice(2);
if (!target) {
  console.error('usage: node _dev/tools/upstream_move.mjs <commit>');
  process.exit(2);
}

const pin = readPin();
const fork = forkDir(pin);
const ref = upstreamRef(pin);

const commit = git(fork, ['rev-parse', '--verify', `${target}^{commit}`]).trim();
const date = git(fork, ['log', '-1', '--format=%cs', commit]).trim();
if (!gitSucceeds(fork, ['merge-base', '--is-ancestor', commit, ref])) {
  console.error(`${commit} is not on ${ref}; the pin follows merged upstream code only.`);
  process.exit(1);
}
const short = commit.slice(0, 9);
console.log(`Moving the pin from ${pin.pin.commit.slice(0, 9)} (${pin.pin.date}) to ${short} (${date}).\n`);

// --- Copy ----------------------------------------------------------------------------------------

let failed = false;
for (const copy of pin.copies) {
  const upstream = fileAt(fork, commit, copy.upstream);
  if (upstream === null) {
    console.log(`MISSING  ${copy.upstream} is not in ${short}`);
    failed = true;
    continue;
  }
  const destination = path.join(REPO, copy.spectra);
  mkdirSync(path.dirname(destination), {recursive: true});
  if (!copy.alterations?.length) {
    writeFileSync(destination, upstream);
    console.log(`copied   ${copy.upstream} -> ${copy.spectra}`);
    continue;
  }
  const original = JSON.parse(upstream.toString('utf8'));
  writeFileSync(destination, JSON.stringify(expectedValue(upstream, copy), null, 2) + '\n');
  console.log(`copied   ${copy.upstream} -> ${copy.spectra}`);
  let before = original;
  for (const alteration of copy.alterations) {
    const after = expectedValue(Buffer.from(JSON.stringify(before)), {alterations: [alteration]});
    const note = deepEqual(before, after) ? ' (changes nothing here: upstream carries it)' : '';
    console.log(`  applied finding ${alteration.finding}'s alteration: ${JSON.stringify(alteration.mergePatch)}${note}`);
    before = after;
  }
}

// --- Verify --------------------------------------------------------------------------------------

console.log('');
for (const copy of pin.copies) {
  const upstream = fileAt(fork, commit, copy.upstream);
  if (upstream === null) continue;
  const written = readFileSync(path.join(REPO, copy.spectra));
  const findings = (copy.alterations ?? []).map(a => a.finding);
  let ok;
  if (findings.length) ok = deepEqual(JSON.parse(written.toString('utf8')), expectedValue(upstream, copy));
  else ok = written.equals(upstream);
  const what = findings.length
    ? `upstream's file at ${short} plus finding ${findings.join(', ')}'s alteration`
    : `upstream's file at ${short}`;
  console.log(`${ok ? 'verified' : 'MISMATCH'} ${copy.spectra} is ${ok ? '' : 'not '}${what}`);
  if (!ok) failed = true;
}

// --- The uv git sources --------------------------------------------------------------------------

const pyprojectPath = path.join(REPO, 'pyproject.toml');
let pyproject = readFileSync(pyprojectPath, 'utf8');
const sourced = pin.packages.filter(p => p.registry === 'pypi' && p.patch);
if (sourced.length) console.log('');
for (const pkg of sourced) {
  const line = new RegExp(`^(${pkg.name} = \\{ git = "[^"]+", rev = ")[0-9a-f]+(")`, 'm');
  if (!line.test(pyproject)) {
    console.log(`MISSING  the uv git source for ${pkg.name} in pyproject.toml`);
    failed = true;
    continue;
  }
  pyproject = pyproject.replace(line, `$1${commit}$2`);
  console.log(`uv source ${pkg.name} -> ${short}`);
}
writeFileSync(pyprojectPath, pyproject);

// --- The pin -------------------------------------------------------------------------------------

if (failed) {
  console.error('\nThe move failed; the pin file is left at the old pin.');
  process.exit(1);
}
pin.pin = {commit, date};
writePin(pin);
console.log(`\nThe pin file names ${short} (${date}).`);
