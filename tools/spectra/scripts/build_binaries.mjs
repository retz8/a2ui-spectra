// The five binaries: the tool compiled by Bun for macOS arm64, macOS x64, Linux x64, Linux arm64
// and Windows x64, with the viewer's build embedded, into `dist/binaries/` as
// `a2ui-spectra-<platform>`, with `.exe` on Windows. It runs on macOS, from `tools/spectra/`,
// after the viewer's build is copied into `dist/viewer/`:
//
//     yarn build:binaries
//
// Bun cross-compiles each binary onto its platform's Bun runtime, the npm package
// `@oven/bun-<target>` at the Bun version the build runs. The build fetches each package from the
// npm registry itself, checks it against npm's published integrity value held in
// `bun_runtimes.json`, and gives its runtime to Bun; a package that does not match fails the build.
// Bun signs the macOS arm64 binary ad hoc and the build signs the macOS x64 one ad hoc with
// `codesign`; both signatures are verified before the build ends.

import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const OUT_DIR = 'dist/binaries';
const REGISTRY = 'https://registry.npmjs.org';
const RUNTIMES_FILE = 'scripts/bun_runtimes.json';

/** The five platforms, named as upstream's `a2ui` CLI names them, with Bun's target and runtime package. */
const PLATFORMS = [
  {name: 'darwin-arm64', target: 'bun-darwin-arm64', runtime: '@oven/bun-darwin-aarch64'},
  {name: 'darwin-x64', target: 'bun-darwin-x64', runtime: '@oven/bun-darwin-x64'},
  {name: 'linux-x64', target: 'bun-linux-x64', runtime: '@oven/bun-linux-x64'},
  {name: 'linux-arm64', target: 'bun-linux-arm64', runtime: '@oven/bun-linux-aarch64'},
  {name: 'windows-x64', target: 'bun-windows-x64', runtime: '@oven/bun-windows-x64', exe: '.exe'},
];

class BuildError extends Error {}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: {...process.env, NODE_ENV: 'production'},
  });
  if (result.error) throw new BuildError(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0)
    throw new BuildError(`${command} ${args[0]} exited with ${result.status}.`);
}

/** Fetches a platform's runtime package, checks it, and returns the path of its Bun executable. */
async function fetchRuntime(platform, runtimes, scratch) {
  const expected = runtimes.integrity[platform.runtime];
  if (expected === undefined) {
    throw new BuildError(`${RUNTIMES_FILE} holds no integrity value for ${platform.runtime}.`);
  }
  const id = `${platform.runtime}@${runtimes.version}`;
  const url = `${REGISTRY}/${platform.runtime}/-/${platform.runtime.split('/')[1]}-${runtimes.version}.tgz`;
  const response = await fetch(url);
  if (!response.ok) throw new BuildError(`${id}: ${url} answered ${response.status}.`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (integrity !== expected) {
    throw new BuildError(
      `${id} does not match its integrity value in ${RUNTIMES_FILE}: fetched ${integrity}, expected ${expected}.`,
    );
  }
  console.log(`${platform.name}: ${id} matches its integrity value.`);
  const dir = path.join(scratch, platform.name);
  mkdirSync(dir);
  const file = path.join(dir, 'runtime.tgz');
  writeFileSync(file, tarball);
  const member = `package/bin/bun${platform.exe ?? ''}`;
  run('tar', ['-xzf', file, '-C', dir, member]);
  return path.join(dir, member);
}

/** Confirms that a macOS binary carries a valid ad-hoc signature. */
function verifySignature(file) {
  const verify = spawnSync('codesign', ['--verify', '--strict', file], {encoding: 'utf8'});
  if (verify.status !== 0) {
    throw new BuildError(`${file}'s signature does not verify: ${verify.stderr.trim()}`);
  }
  const display = spawnSync('codesign', ['--display', '--verbose=2', file], {encoding: 'utf8'});
  if (!/^Signature=adhoc$/m.test(display.stderr)) {
    throw new BuildError(`${file} is not signed ad hoc:\n${display.stderr.trim()}`);
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new BuildError(
      'The five binaries are built on macOS, where codesign signs the macOS ones.',
    );
  }
  const runtimes = JSON.parse(readFileSync(RUNTIMES_FILE, 'utf8'));
  const bun = execFileSync('bun', ['--version'], {encoding: 'utf8'}).trim();
  if (bun !== runtimes.version) {
    throw new BuildError(
      `${RUNTIMES_FILE} holds the runtimes of Bun ${runtimes.version}, and the build runs Bun ${bun}. ` +
        `Write each runtime package's integrity value at ${bun} into it, as \`npm view <package>@${bun} dist.integrity\` prints it.`,
    );
  }

  rmSync(OUT_DIR, {recursive: true, force: true});
  mkdirSync(OUT_DIR, {recursive: true});
  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-runtimes-'));
  const built = [];
  try {
    for (const platform of PLATFORMS) {
      const runtime = await fetchRuntime(platform, runtimes, scratch);
      const file = path.join(OUT_DIR, `a2ui-spectra-${platform.name}${platform.exe ?? ''}`);
      run('bun', [
        'build',
        '--compile',
        '--minify',
        '--sourcemap',
        '--no-compile-autoload-dotenv',
        '--no-compile-autoload-bunfig',
        `--target=${platform.target}`,
        `--compile-executable-path=${runtime}`,
        'src/cli.ts',
        '--asset',
        'dist/viewer',
        '--outfile',
        file,
      ]);
      if (platform.name === 'darwin-x64') {
        run('codesign', ['--force', '--sign', '-', file]);
      }
      if (platform.name.startsWith('darwin-')) {
        verifySignature(file);
        console.log(`${platform.name}: ${file} is signed ad hoc, and the signature verifies.`);
      }
      built.push(file);
    }
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }

  console.log('\nThe five binaries:');
  for (const file of built) {
    const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
    const size = (statSync(file).size / 1e6).toFixed(1);
    console.log(`${file}  ${size} MB  sha256 ${sha256}`);
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof BuildError)) throw error;
  console.error(`build:binaries: ${error.message}`);
  process.exitCode = 1;
}
