// What the packages' checks read a package's files with, for `check_packages.mjs`, the binary's
// packages, and `check_libraries.mjs`, the libraries' packs: a tar file's and a zip file's files,
// a wheel's RECORD, tags and METADATA, and the list of checks that failed.

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync, inflateRawSync} from 'node:zlib';

import {BuildError} from './packages.mjs';

/**
 * A tar file's regular files by name, each with its mode and bytes, read through its pax
 * headers; a link or a device fails the check, a directory is passed over.
 */
export function tarFiles(file) {
  const data = gunzipSync(readFileSync(file));
  const files = new Map();
  let pax = {};
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (offset, length) =>
      header
        .subarray(offset, offset + length)
        .toString('utf8')
        .replace(/\0[\s\S]*$/, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const body = data.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const [, key, value] of body.toString('utf8').matchAll(/^\d+ ([^=]+)=(.*)$/gm)) {
        pax[key] = value;
      }
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(345, 155);
    const name = pax.path ?? (prefix === '' ? field(0, 100) : `${prefix}/${field(0, 100)}`);
    pax = {};
    if (type === '5') continue;
    if (type !== '0') throw new BuildError(`${file} holds ${name}, which is not a regular file.`);
    files.set(name, {mode: parseInt(field(100, 8).trim(), 8), data: body});
  }
  return files;
}

/** A zip file's files by name, each with its Unix mode and bytes, read from its central directory. */
export function zipFiles(file) {
  const data = readFileSync(file);
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end === -1) throw new BuildError(`${file} is not a zip file.`);
  const count = data.readUInt16LE(end + 10);
  const files = new Map();
  for (let at = data.readUInt32LE(end + 16), i = 0; i < count; i++) {
    if (data.readUInt32LE(at) !== 0x02014b50) {
      throw new BuildError(`${file}'s central directory does not read.`);
    }
    const method = data.readUInt16LE(at + 10);
    const compressedSize = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const external = data.readUInt32LE(at + 38);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const stored = data.subarray(start, start + compressedSize);
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) {
      throw new BuildError(`${file} holds ${name} compressed by method ${method}.`);
    }
    files.set(name, {mode: external >>> 16, data: method === 0 ? stored : inflateRawSync(stored)});
  }
  return files;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export class Checks {
  failures = [];

  that(condition, failure) {
    if (!condition) this.failures.push(failure);
  }

  equal(actual, expected, what) {
    this.that(
      JSON.stringify(actual) === JSON.stringify(expected),
      `${what} is ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}.`,
    );
  }

  /** The files are exactly those named, each holding what it should. */
  holds(where, files, expected) {
    this.equal([...files.keys()].sort(), Object.keys(expected).sort(), `${where}'s list of files`);
    for (const [name, want] of Object.entries(expected)) {
      const found = files.get(name);
      if (found === undefined) continue;
      if (want.sha256 !== undefined) {
        this.that(
          sha256(found.data) === want.sha256,
          `${where}: ${name} is not the built binary, by its SHA-256.`,
        );
      }
      if (want.bytes !== undefined) {
        this.that(found.data.equals(want.bytes), `${where}: ${name} is not the build's file.`);
      }
      if (want.executable) {
        this.that((found.mode & 0o111) === 0o111, `${where}: ${name} is not executable.`);
      }
    }
  }
}

/** A wheel's RECORD: each file's SHA-256, as the wheel format writes it, by name. */
export function recordOf(text) {
  const record = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const [name, hash] = line.split(',');
    record.set(name, hash);
  }
  return record;
}

/** A compressed tag set, as a wheel's name has it, as the tags its WHEEL file lists one by one. */
export function expandedTags(tag) {
  const [pythons, abis, platforms] = tag.split('-').map(part => part.split('.'));
  return pythons
    .flatMap(python => abis.flatMap(abi => platforms.map(on => `${python}-${abi}-${on}`)))
    .sort();
}

export function wheelHash(bytes) {
  return `sha256=${createHash('sha256').update(bytes).digest('base64url')}`;
}

/** The headers of a wheel's METADATA, each name with its values, and its body. */
export function metadataOf(text) {
  const split = text.includes('\n\n') ? text.indexOf('\n\n') : text.length;
  const headers = new Map();
  for (const line of text.slice(0, split).split('\n').filter(Boolean)) {
    const colon = line.indexOf(': ');
    const name = line.slice(0, colon);
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 2)]);
  }
  return {headers, body: text.slice(split + 2)};
}
