// What the binary's packages are, for the command that makes them, `build_packages.mjs`, and the
// one that checks them, `check_packages.mjs`, both run from `tools/spectra/`: the five
// platforms, the files' names, and the version every package and archive is stamped with.

import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

export const NAME = 'a2ui-spectra';
export const REPOSITORY = 'https://github.com/retz8/a2ui-spectra';
export const BINARIES_DIR = 'dist/binaries';
export const PACKAGES_DIR = 'dist/packages';
/** Where the tool's version is set. */
export const VERSION_FILE = 'src/version.ts';

/**
 * The five platforms: named as upstream's `a2ui` CLI names them, with npm's `os`, `cpu` and
 * `libc`, and the wheel's tag, from the binaries' floors, macOS 13.0 and glibc 2.17.
 */
export const PLATFORMS = [
  {
    name: 'darwin-arm64',
    words: 'macOS arm64',
    os: 'darwin',
    cpu: 'arm64',
    wheelTag: 'py3-none-macosx_13_0_arm64',
  },
  {
    name: 'darwin-x64',
    words: 'macOS x64',
    os: 'darwin',
    cpu: 'x64',
    wheelTag: 'py3-none-macosx_13_0_x86_64',
  },
  {
    name: 'linux-x64',
    words: 'Linux x64',
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    wheelTag: 'py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64',
  },
  {
    name: 'linux-arm64',
    words: 'Linux arm64',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    wheelTag: 'py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64',
  },
  {
    name: 'windows-x64',
    words: 'Windows x64',
    os: 'win32',
    cpu: 'x64',
    exe: '.exe',
    wheelTag: 'py3-none-win_amd64',
  },
];

export class BuildError extends Error {}

/** The tool's version, three numbers. */
export function readVersion() {
  const match = /^export const VERSION = '([^']*)';$/m.exec(readFileSync(VERSION_FILE, 'utf8'));
  if (match === null) throw new BuildError(`${VERSION_FILE} sets no VERSION.`);
  if (!/^\d+\.\d+\.\d+$/.test(match[1])) {
    throw new BuildError(`The version in ${VERSION_FILE}, ${match[1]}, is not three numbers.`);
  }
  return match[1];
}

/** The binary's name inside every package and archive. */
export function binaryName(platform) {
  return `${NAME}${platform.exe ?? ''}`;
}

/** The binary `build:binaries` built for the platform. */
export function builtBinary(platform) {
  return path.join(BINARIES_DIR, `${NAME}-${platform.name}${platform.exe ?? ''}`);
}

/** The npm package that holds the platform's binary. */
export function platformPackage(platform) {
  return `${NAME}-${platform.name}`;
}

/** An npm package's file, as `npm pack` names it. */
export function npmTarball(name, version) {
  return path.join(PACKAGES_DIR, 'npm', `${name}-${version}.tgz`);
}

export function wheelFile(platform, version) {
  return path.join(PACKAGES_DIR, 'pypi', `a2ui_spectra-${version}-${platform.wheelTag}.whl`);
}

export function archiveName(platform, version) {
  return `${NAME}-v${version}-${platform.name}${platform.exe === undefined ? '.tar.gz' : '.zip'}`;
}

export function archiveFile(platform, version) {
  return path.join(PACKAGES_DIR, 'release', archiveName(platform, version));
}

export const CHECKSUMS = path.join(PACKAGES_DIR, 'release', 'checksums.txt');
export const NOTICES = path.join(PACKAGES_DIR, 'THIRD_PARTY_NOTICES.md');

/** The platform of the Mac the command runs on, among the five. */
export function hostPlatform() {
  const host = PLATFORMS.find(
    platform => platform.os === process.platform && platform.cpu === process.arch,
  );
  if (host === undefined) {
    throw new BuildError(`This command runs on macOS, not ${process.platform} ${process.arch}.`);
  }
  return host;
}

/** Runs a command, its output passed through; a failure fails the command. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw new BuildError(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new BuildError(`${command} ${args.join(' ')} exited with ${result.status}.`);
  }
}

/** What a command printed on stdout; a failure fails the command. */
export function output(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', ...options});
  if (result.error) throw new BuildError(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new BuildError(
      `${command} ${args.join(' ')} exited with ${result.status}:\n${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/** Fails the command unless the binary prints the version. */
export function expectVersion(binary, version, options = {}) {
  const printed = output(binary, ['--version'], options).trim();
  if (printed !== version) {
    throw new BuildError(`${binary} --version printed ${printed}, not ${version}.`);
  }
}

/** Runs a command's `main`, and ends it with one line when it fails. */
export async function runMain(command, main) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(`${command}: ${error.message}`);
    process.exitCode = 1;
  }
}
