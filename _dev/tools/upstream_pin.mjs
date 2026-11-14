// What the re-pin procedure's scripts share: the pin file, git in the sibling fork, the JSON merge
// patch (RFC 7386) and the lockfiles' versions.
//
// The pin file is `_dev/upstream-pin.json`; the procedure is `_dev/re-pin-procedure.md`.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PIN_FILE = path.join(REPO, '_dev/upstream-pin.json');

export function readPin() {
  return JSON.parse(readFileSync(PIN_FILE, 'utf8'));
}

export function writePin(pin) {
  writeFileSync(PIN_FILE, JSON.stringify(pin, null, 2) + '\n');
}

export function forkDir(pin) {
  return path.resolve(REPO, pin.upstream.fork);
}

export function worktreeDir(pin) {
  return path.resolve(REPO, pin.upstream.worktree);
}

export function upstreamRef(pin) {
  return `${pin.upstream.remote}/${pin.upstream.branch}`;
}

export function git(dir, args, {encoding = 'utf8'} = {}) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Whether `git` exits 0, for the commands whose answer is their exit status. */
export function gitSucceeds(dir, args) {
  try {
    execFileSync('git', ['-C', dir, ...args], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

/** A file's bytes at a commit, or null when the commit has no such file. */
export function fileAt(dir, commit, file) {
  try {
    return git(dir, ['show', `${commit}:${file}`], {encoding: 'buffer'});
  } catch {
    return null;
  }
}

/** RFC 7386: a patch object merges into the target; a null member removes the target's. */
export function applyMergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result =
    target !== null && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = applyMergePatch(result[key], value);
  }
  return result;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** Upstream's file at a commit with a copy's listed alterations applied, as a value. */
export function expectedValue(upstreamBytes, copy) {
  let value = JSON.parse(upstreamBytes.toString('utf8'));
  for (const alteration of copy.alterations ?? []) value = applyMergePatch(value, alteration.mergePatch);
  return value;
}

/** Each version of each upstream npm package in `yarn.lock`, with how it resolves. */
export function yarnLockVersions(name) {
  const lock = readFileSync(path.join(REPO, 'yarn.lock'), 'utf8');
  const found = [];
  for (const block of lock.split(/\n\n/)) {
    const header = block.split('\n')[0];
    if (!header.startsWith(`"${name}@`)) continue;
    const version = /\n {2}version: (.+)/.exec(block)?.[1];
    const resolution = /\n {2}resolution: "(.+)"/.exec(block)?.[1];
    if (version) found.push({version, resolution});
  }
  return found;
}

/** Each version of an upstream Python package in `uv.lock`, with its source. */
export function uvLockVersions(name) {
  const lock = readFileSync(path.join(REPO, 'uv.lock'), 'utf8');
  const found = [];
  for (const block of lock.split(/\n\[\[package\]\]\n/)) {
    if (!block.startsWith(`name = "${name}"\n`)) continue;
    const version = /\nversion = "(.+)"/.exec(block)?.[1];
    const source = /\nsource = \{ (.+) \}/.exec(block)?.[1];
    if (version) found.push({version, source});
  }
  return found;
}
