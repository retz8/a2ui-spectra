// Checks the binary's packages that `build:packages` made in `dist/packages/`, from
// `tools/spectra/`, on the Mac that made them:
//
//     yarn check:packages
//
// For all five platforms, each npm package, wheel and archive holds exactly its files: the
// binary with the built binary's SHA-256 and its executable bit, LICENSE, the build's
// THIRD_PARTY_NOTICES.md, and the README where it belongs; each wheel's tag, every stated
// version, the repository and the issues page are right, and checksums.txt verifies. Then this Mac's own packages are installed as an
// adopter installs them, each ending in `a2ui-spectra --version`: the launcher and this
// platform's package by npm from the built packages, this platform's wheel by uv, and this
// platform's archive extracted.

import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {
  archiveFile,
  archiveName,
  binaryName,
  BuildError,
  builtBinary,
  CHECKSUMS,
  expectVersion,
  hostPlatform,
  ISSUES,
  NAME,
  NOTICES,
  NPM_BUGS,
  npmRepository,
  npmTarball,
  output,
  PACKAGES_DIR,
  PLATFORMS,
  platformPackage,
  readVersion,
  REPOSITORY,
  run,
  runMain,
  wheelFile,
} from './packages.mjs';
import {
  Checks,
  expandedTags,
  metadataOf,
  recordOf,
  sha256,
  tarFiles,
  wheelHash,
  zipFiles,
} from './reading.mjs';

function checkPackages(version, checks) {
  const license = readFileSync('../../LICENSE');
  const notices = readFileSync(NOTICES);
  const readme = readFileSync('README.md');
  const common = {LICENSE: {bytes: license}, 'THIRD_PARTY_NOTICES.md': {bytes: notices}};

  // Nothing but the packages, the archives and the notices.
  const listing = dir => readdirSync(path.join(PACKAGES_DIR, dir)).sort();
  checks.equal(listing('.'), ['THIRD_PARTY_NOTICES.md', 'npm', 'pypi', 'release'], PACKAGES_DIR);
  checks.equal(
    listing('npm'),
    [npmTarball(NAME, version), ...PLATFORMS.map(p => npmTarball(platformPackage(p), version))]
      .map(file => path.basename(file))
      .sort(),
    'npm/',
  );
  checks.equal(
    listing('pypi'),
    PLATFORMS.map(p => path.basename(wheelFile(p, version))).sort(),
    'pypi/',
  );
  checks.equal(
    listing('release'),
    [...PLATFORMS.map(p => archiveName(p, version)), 'checksums.txt'].sort(),
    'release/',
  );

  // The npm launcher.
  const launcherTarball = npmTarball(NAME, version);
  const launcher = tarFiles(launcherTarball);
  checks.holds(launcherTarball, launcher, {
    'package/package.json': {},
    [`package/bin/${NAME}.js`]: {executable: true},
    'package/LICENSE': common.LICENSE,
    'package/THIRD_PARTY_NOTICES.md': common['THIRD_PARTY_NOTICES.md'],
    'package/README.md': {bytes: readme},
  });
  const manifest = JSON.parse(launcher.get('package/package.json')?.data ?? '{}');
  checks.equal(manifest.name, NAME, `${launcherTarball}: the name`);
  checks.equal(manifest.version, version, `${launcherTarball}: the version`);
  checks.equal(manifest.license, 'Apache-2.0', `${launcherTarball}: the licence`);
  checks.equal(
    manifest.repository,
    npmRepository('tools/spectra'),
    `${launcherTarball}: repository`,
  );
  checks.equal(manifest.bugs, NPM_BUGS, `${launcherTarball}: bugs`);
  checks.equal(manifest.engines, {node: '>=22'}, `${launcherTarball}: engines`);
  checks.equal(manifest.bin, {[NAME]: `bin/${NAME}.js`}, `${launcherTarball}: bin`);
  checks.equal(
    manifest.optionalDependencies,
    Object.fromEntries(PLATFORMS.map(p => [platformPackage(p), version])),
    `${launcherTarball}: optionalDependencies`,
  );
  for (const field of ['scripts', 'dependencies', 'peerDependencies', 'homepage']) {
    checks.equal(manifest[field], undefined, `${launcherTarball}: ${field}`);
  }
  const script = launcher.get(`package/bin/${NAME}.js`)?.data.toString('utf8') ?? '';
  checks.that(script.startsWith('#!/usr/bin/env node\n'), `${launcherTarball}: no shebang.`);
  checks.that(!script.includes('sourceMappingURL'), `${launcherTarball}: names a source map.`);

  for (const platform of PLATFORMS) {
    const binary = readFileSync(builtBinary(platform));
    const built = {sha256: sha256(binary), executable: true};

    // The npm platform package.
    const tarball = npmTarball(platformPackage(platform), version);
    const files = tarFiles(tarball);
    checks.holds(tarball, files, {
      'package/package.json': {},
      [`package/${binaryName(platform)}`]: built,
      'package/LICENSE': common.LICENSE,
      'package/THIRD_PARTY_NOTICES.md': common['THIRD_PARTY_NOTICES.md'],
    });
    const own = JSON.parse(files.get('package/package.json')?.data ?? '{}');
    checks.equal(own.name, platformPackage(platform), `${tarball}: the name`);
    checks.equal(own.version, version, `${tarball}: the version`);
    checks.equal(own.license, 'Apache-2.0', `${tarball}: the licence`);
    checks.equal(own.repository, npmRepository('tools/spectra'), `${tarball}: repository`);
    checks.equal(own.bugs, NPM_BUGS, `${tarball}: bugs`);
    checks.equal(own.os, [platform.os], `${tarball}: os`);
    checks.equal(own.cpu, [platform.cpu], `${tarball}: cpu`);
    checks.equal(own.libc, platform.libc && [platform.libc], `${tarball}: libc`);
    checks.equal(own.preferUnplugged, true, `${tarball}: preferUnplugged`);
    checks.that(
      typeof own.description === 'string' && own.description.includes(`install ${NAME}.`),
      `${tarball}: its description does not point to ${NAME}.`,
    );
    for (const field of ['scripts', 'bin', 'dependencies', 'optionalDependencies', 'homepage']) {
      checks.equal(own[field], undefined, `${tarball}: ${field}`);
    }

    // The wheel.
    const wheel = wheelFile(platform, version);
    const wheelEntries = zipFiles(wheel);
    const data = `a2ui_spectra-${version}.data`;
    const info = `a2ui_spectra-${version}.dist-info`;
    checks.holds(wheel, wheelEntries, {
      [`${data}/scripts/${binaryName(platform)}`]: built,
      [`${info}/METADATA`]: {},
      [`${info}/WHEEL`]: {},
      [`${info}/RECORD`]: {},
      [`${info}/licenses/LICENSE`]: common.LICENSE,
      [`${info}/licenses/THIRD_PARTY_NOTICES.md`]: common['THIRD_PARTY_NOTICES.md'],
    });
    const wheelInfo = metadataOf(wheelEntries.get(`${info}/WHEEL`)?.data.toString('utf8') ?? '');
    checks.equal(
      [...(wheelInfo.headers.get('Tag') ?? [])].sort(),
      expandedTags(platform.wheelTag),
      `${wheel}: its tags`,
    );
    checks.equal(wheelInfo.headers.get('Root-Is-Purelib'), ['false'], `${wheel}: Root-Is-Purelib`);
    const metadata = metadataOf(wheelEntries.get(`${info}/METADATA`)?.data.toString('utf8') ?? '');
    checks.equal(metadata.headers.get('Name'), [NAME], `${wheel}: the name`);
    checks.equal(metadata.headers.get('Version'), [version], `${wheel}: the version`);
    checks.equal(
      metadata.headers.get('License-Expression'),
      ['Apache-2.0'],
      `${wheel}: the licence`,
    );
    checks.equal(metadata.headers.get('Requires-Dist'), undefined, `${wheel}: its dependencies`);
    checks.equal(
      metadata.headers.get('Project-URL'),
      [`Repository, ${REPOSITORY}`, `Issues, ${ISSUES}`],
      `${wheel}: its project URLs`,
    );
    checks.equal(metadata.headers.get('Home-page'), undefined, `${wheel}: its homepage`);
    checks.that(metadata.body === readme.toString('utf8'), `${wheel}: its text is not the README.`);
    const record = recordOf(wheelEntries.get(`${info}/RECORD`)?.data.toString('utf8') ?? '');
    for (const [name, {data: bytes}] of wheelEntries) {
      if (name === `${info}/RECORD`) continue;
      checks.equal(record.get(name), wheelHash(bytes), `${wheel}: RECORD's hash of ${name}`);
    }

    // The release archive.
    const file = archiveFile(platform, version);
    checks.holds(file, platform.exe === undefined ? tarFiles(file) : zipFiles(file), {
      [binaryName(platform)]: built,
      LICENSE: common.LICENSE,
      'THIRD_PARTY_NOTICES.md': common['THIRD_PARTY_NOTICES.md'],
      'README.md': {bytes: readme},
    });
  }

  // checksums.txt, in sha256sum's format.
  const lines = readFileSync(CHECKSUMS, 'utf8').split('\n');
  checks.equal(lines.pop(), '', `${CHECKSUMS}'s last line's end`);
  checks.equal(
    lines.map(line => line.slice(66)),
    PLATFORMS.map(p => archiveName(p, version)).sort(),
    `${CHECKSUMS}'s archives`,
  );
  for (const line of lines) {
    const [, hash, name] = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line) ?? [];
    checks.that(
      hash !== undefined && hash === sha256(readFileSync(path.join(PACKAGES_DIR, 'release', name))),
      `${CHECKSUMS}: ${line} does not verify.`,
    );
  }
}

/** This Mac's packages installed as an adopter installs them, each ending in `--version`. */
function install(version, scratch) {
  const host = hostPlatform();
  // Caches of their own, so that nothing installed before stands in for these packages.
  const isolated = {
    ...process.env,
    npm_config_cache: path.join(scratch, 'npm-cache'),
    UV_CACHE_DIR: path.join(scratch, 'uv-cache'),
    UV_TOOL_DIR: path.join(scratch, 'uv-tools'),
  };

  // npm, from the built packages: the launcher and this platform's package.
  const project = path.join(scratch, 'npm');
  mkdirSync(project);
  run('npm', ['init', '--yes', '--loglevel=warn'], {cwd: project, env: isolated, stdio: 'ignore'});
  run(
    'npm',
    [
      'install',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      path.resolve(npmTarball(NAME, version)),
      path.resolve(npmTarball(platformPackage(host), version)),
    ],
    {cwd: project, env: isolated},
  );
  expectVersion(path.join(project, 'node_modules', '.bin', NAME), version, {cwd: project});
  console.log(
    `npm: ${NAME} and ${platformPackage(host)} installed, and --version printed ${version}.`,
  );

  // uv: this platform's wheel, run as uvx runs a tool.
  const printed = output(
    'uvx',
    ['--no-config', '--from', path.resolve(wheelFile(host, version)), NAME, '--version'],
    {cwd: scratch, env: isolated},
  ).trim();
  if (printed !== version) {
    throw new BuildError(`uvx ${NAME} --version printed ${printed}, not ${version}.`);
  }
  console.log(
    `uv: ${path.basename(wheelFile(host, version))} run, and --version printed ${version}.`,
  );

  // This platform's archive, extracted.
  const extracted = path.join(scratch, 'release');
  mkdirSync(extracted);
  run('tar', ['-xzf', path.resolve(archiveFile(host, version)), '-C', extracted]);
  expectVersion(path.join(extracted, NAME), version);
  console.log(
    `release: ${archiveName(host, version)} extracted, and --version printed ${version}.`,
  );
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new BuildError("The binary's packages are checked on the Mac that made them.");
  }
  if (!existsSync(NOTICES)) {
    throw new BuildError(
      `${PACKAGES_DIR} holds no packages: make them first, \`yarn build:packages\`.`,
    );
  }
  const version = readVersion();
  expectVersion(builtBinary(hostPlatform()), version);
  const checks = new Checks();
  checkPackages(version, checks);
  if (checks.failures.length > 0) {
    throw new BuildError(
      `${checks.failures.length} of the checks failed:\n${checks.failures.map(f => `- ${f}`).join('\n')}`,
    );
  }
  console.log(
    `The five platforms' npm packages, wheels and archives, the launcher and checksums.txt hold what they should, at ${version}.`,
  );
  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-installs-'));
  try {
    install(version, scratch);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

await runMain('check:packages', main);
