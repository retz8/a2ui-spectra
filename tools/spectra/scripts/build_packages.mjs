// The binary's packages, made from the five binaries `build:binaries` built, into `dist/packages/`:
//
//     npm/      the launcher, a2ui-spectra-<version>.tgz, and the five platform packages,
//               a2ui-spectra-<platform>-<version>.tgz, as `npm pack` writes them
//     pypi/     the five wheels, built by hatchling through `uv build` from the project in wheel/
//     release/  the five archives, a2ui-spectra-v<version>-<platform>.tar.gz, and .zip for
//               Windows, flat, and checksums.txt, which lists them in sha256sum's format
//     THIRD_PARTY_NOTICES.md, which every package and archive carries
//
// It runs on macOS, from `tools/spectra/`, after `build:binaries` and `build:tsc`:
//
//     yarn build:packages
//
// It takes no version: every package and archive is stamped with the tool's version, from
// `src/version.ts`, which the host's binary must print. `yarn check:packages` checks the result.

import {createHash} from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {thirdPartyNotices} from './notices.mjs';
import {
  archiveFile,
  archiveName,
  binaryName,
  BuildError,
  builtBinary,
  CHECKSUMS,
  expectVersion,
  hostPlatform,
  NAME,
  NOTICES,
  npmTarball,
  PACKAGES_DIR,
  PLATFORMS,
  platformPackage,
  REPOSITORY,
  readVersion,
  run,
  runMain,
  wheelFile,
} from './packages.mjs';

const LICENSE = '../../LICENSE';
const README = 'README.md';
/** The launcher, as `build:tsc` compiles it. */
const LAUNCHER = 'dist/npm/launcher.js';
const WHEEL_PROJECT = 'wheel';
const RUNTIMES_FILE = 'scripts/bun_runtimes.json';

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Copies a file, executable when asked. */
function put(from, to, {executable = false} = {}) {
  mkdirSync(path.dirname(to), {recursive: true});
  copyFileSync(from, to);
  chmodSync(to, executable ? 0o755 : 0o644);
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const repository = {type: 'git', url: `git+${REPOSITORY}.git`, directory: 'tools/spectra'};

/** The launcher's package: its script, LICENSE, the notices and the README. */
function launcherPackage(dir, version, description) {
  mkdirSync(dir);
  writeJson(path.join(dir, 'package.json'), {
    name: NAME,
    version,
    description,
    license: 'Apache-2.0',
    repository,
    type: 'module',
    bin: {[NAME]: `bin/${NAME}.js`},
    files: [`bin/${NAME}.js`, 'THIRD_PARTY_NOTICES.md'],
    engines: {node: '>=22'},
    optionalDependencies: Object.fromEntries(
      PLATFORMS.map(platform => [platformPackage(platform), version]),
    ),
  });
  // The compiled launcher, without the line that names its source map, which is not shipped.
  const script = readFileSync(LAUNCHER, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n');
  mkdirSync(path.join(dir, 'bin'));
  writeFileSync(path.join(dir, 'bin', `${NAME}.js`), script);
  chmodSync(path.join(dir, 'bin', `${NAME}.js`), 0o755);
  put(LICENSE, path.join(dir, 'LICENSE'));
  put(NOTICES, path.join(dir, 'THIRD_PARTY_NOTICES.md'));
  put(README, path.join(dir, 'README.md'));
}

/** A platform's npm package: the binary, LICENSE and the notices, and no README. */
function binaryPackage(dir, platform, version) {
  mkdirSync(dir);
  writeJson(path.join(dir, 'package.json'), {
    name: platformPackage(platform),
    version,
    description: `The ${NAME} binary for ${platform.words}, which the ${NAME} package runs; install ${NAME}.`,
    license: 'Apache-2.0',
    repository,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.libc !== undefined && {libc: [platform.libc]}),
    files: [binaryName(platform), 'THIRD_PARTY_NOTICES.md'],
    preferUnplugged: true,
  });
  put(builtBinary(platform), path.join(dir, binaryName(platform)), {executable: true});
  put(LICENSE, path.join(dir, 'LICENSE'));
  put(NOTICES, path.join(dir, 'THIRD_PARTY_NOTICES.md'));
}

function npmPack(dir, expected) {
  // From the package's own folder, outside the workspace.
  run(
    'npm',
    [
      'pack',
      '--pack-destination',
      path.resolve(path.dirname(expected)),
      '--ignore-scripts',
      '--loglevel=warn',
    ],
    {cwd: dir, stdio: ['ignore', 'ignore', 'inherit']},
  );
  statSync(expected);
}

/** A platform's wheel, built by hatchling through uv from a copy of the wheel's project. */
function wheel(dir, platform, version) {
  mkdirSync(dir);
  for (const file of ['pyproject.toml', 'hatch_build.py']) {
    put(path.join(WHEEL_PROJECT, file), path.join(dir, file));
  }
  put(builtBinary(platform), path.join(dir, binaryName(platform)), {executable: true});
  put(LICENSE, path.join(dir, 'LICENSE'));
  put(NOTICES, path.join(dir, 'THIRD_PARTY_NOTICES.md'));
  put(README, path.join(dir, 'README.md'));
  const out = path.join(dir, 'out');
  run('uv', ['build', '--wheel', '--no-config', '--out-dir', out, dir], {
    cwd: dir,
    env: {...process.env, A2UI_SPECTRA_VERSION: version, A2UI_SPECTRA_WHEEL_TAG: platform.wheelTag},
  });
  const built = readdirSync(out).filter(file => file.endsWith('.whl'));
  const expected = wheelFile(platform, version);
  if (built.length !== 1 || built[0] !== path.basename(expected)) {
    throw new BuildError(
      `uv build wrote ${built.join(', ') || 'no wheel'}, not ${path.basename(expected)}.`,
    );
  }
  // Copied, since the scratch folder may be on another volume.
  copyFileSync(path.join(out, built[0]), expected);
}

/** A platform's release archive, flat: the binary, LICENSE, the notices and the README. */
function archive(dir, platform, version) {
  mkdirSync(dir);
  const files = [binaryName(platform), 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'];
  put(builtBinary(platform), path.join(dir, files[0]), {executable: true});
  put(LICENSE, path.join(dir, files[1]));
  put(NOTICES, path.join(dir, files[2]));
  put(README, path.join(dir, files[3]));
  const file = path.resolve(archiveFile(platform, version));
  if (platform.exe === undefined) {
    // BSD tar, without macOS's metadata and with no owner of this machine's.
    run(
      'tar',
      [
        ...['--no-mac-metadata', '--no-xattrs', '--no-acls', '--no-fflags'],
        ...['--uid', '0', '--gid', '0', '--uname', '', '--gname', ''],
        ...['-czf', file, '-C', dir, ...files],
      ],
      {env: {...process.env, COPYFILE_DISABLE: '1'}},
    );
  } else {
    run('zip', ['-q', '-X', file, ...files], {cwd: dir});
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new BuildError("The binary's packages are made on macOS, where the binaries are built.");
  }
  const version = readVersion();
  const host = hostPlatform();
  expectVersion(builtBinary(host), version);
  for (const platform of PLATFORMS) statSync(builtBinary(platform));
  const {version: bunVersion} = JSON.parse(readFileSync(RUNTIMES_FILE, 'utf8'));
  const {description} = JSON.parse(readFileSync('package.json', 'utf8'));

  rmSync(PACKAGES_DIR, {recursive: true, force: true});
  for (const dir of ['npm', 'pypi', 'release']) {
    mkdirSync(path.join(PACKAGES_DIR, dir), {recursive: true});
  }
  writeFileSync(NOTICES, thirdPartyNotices({version, bunVersion}));

  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-packages-'));
  try {
    launcherPackage(path.join(scratch, 'npm-launcher'), version, description);
    npmPack(path.join(scratch, 'npm-launcher'), npmTarball(NAME, version));
    for (const platform of PLATFORMS) {
      const dir = path.join(scratch, `npm-${platform.name}`);
      binaryPackage(dir, platform, version);
      npmPack(dir, npmTarball(platformPackage(platform), version));
      wheel(path.join(scratch, `pypi-${platform.name}`), platform, version);
      archive(path.join(scratch, `release-${platform.name}`), platform, version);
      console.log(`${platform.name}: its npm package, wheel and archive are made.`);
    }
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
  writeFileSync(
    CHECKSUMS,
    PLATFORMS.map(platform => archiveName(platform, version))
      .sort()
      .map(name => `${sha256(path.join(PACKAGES_DIR, 'release', name))}  ${name}\n`)
      .join(''),
  );

  console.log(`\nThe binary's packages, ${version}:`);
  for (const dir of ['npm', 'pypi', 'release']) {
    for (const name of readdirSync(path.join(PACKAGES_DIR, dir)).sort()) {
      const file = path.join(PACKAGES_DIR, dir, name);
      console.log(`${file}  ${(statSync(file).size / 1e6).toFixed(1)} MB`);
    }
  }
}

await runMain('build:packages', main);
