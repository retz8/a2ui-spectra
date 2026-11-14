// The npm packages' local patch: builds each upstream npm package the pin file marks as patched
// by tarball, in the `a2ui-upstream` worktree at the pin, through upstream's own publish
// preparation, and writes its tarball into `vendor/a2ui/`. The root `package.json`'s
// `resolutions` line and the pin file's entry are pointed at each tarball written.
//
// From the repository root, with the worktree detached at the pin and installed:
//
//     node _dev/tools/build_upstream_tarballs.mjs
//
// Upstream's preparation is the part of each package's `publish:package` script before
// `cd dist`: its build, and for most packages `prepare-publish.mjs`, which writes `dist/package.json`
// with the workspace dependencies as version ranges. `npm pack` in `dist/` stands in for the
// `yarn npm publish` that follows. Then `yarn install` in this repository takes the tarballs.

import {execFileSync, execSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {REPO, git, readPin, worktreeDir, writePin} from './upstream_pin.mjs';

const VENDOR = 'vendor/a2ui';

const pin = readPin();
const worktree = worktreeDir(pin);
const head = git(worktree, ['rev-parse', 'HEAD']).trim();
if (head !== pin.pin.commit) {
  console.error(`The worktree is at ${head.slice(0, 9)}, not at the pin ${pin.pin.commit.slice(0, 9)}.`);
  process.exit(1);
}
const dirty = git(worktree, ['status', '--porcelain', '--untracked-files=no']).trim();
if (dirty) {
  console.error(`The worktree has changes to tracked files:\n${dirty}`);
  process.exit(1);
}

mkdirSync(path.join(REPO, VENDOR), {recursive: true});
const rootManifestPath = path.join(REPO, 'package.json');
const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
rootManifest.resolutions ??= {};

for (const pkg of pin.packages.filter(p => p.registry === 'npm' && p.patch?.source === 'tarball')) {
  const dir = path.join(worktree, pkg.upstreamPath);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const publish = manifest.scripts?.['publish:package'];
  const preparation = publish?.split(/\s*&&\s*cd dist\b/)[0];
  if (!preparation || preparation === publish) {
    console.error(`${pkg.name}: no publish:package script of the form "<preparation> && cd dist && …".`);
    process.exit(1);
  }
  console.log(`\n${pkg.name} ${manifest.version}: ${preparation}`);
  execSync(preparation, {cwd: dir, stdio: 'inherit'});

  const dist = path.join(dir, 'dist');
  const prepared = JSON.parse(readFileSync(path.join(dist, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(prepared[field] ?? {})) {
      if (/^(workspace|file|link|portal):/.test(range)) {
        console.error(`${pkg.name}: dist/package.json's ${field} keeps ${name}@${range}.`);
        process.exit(1);
      }
    }
  }
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', path.join(REPO, VENDOR)], {
      cwd: dist,
      encoding: 'utf8',
    }),
  )[0];
  const tarball = `${VENDOR}/${packed.filename}`;
  console.log(`${pkg.name}: ${tarball}, ${packed.entryCount} files, ${packed.integrity}`);

  if (pkg.patch.tarball && pkg.patch.tarball !== tarball) rmSync(path.join(REPO, pkg.patch.tarball), {force: true});
  pkg.patch.tarball = tarball;
  rootManifest.resolutions[pkg.name] = `file:./${tarball}`;
}

writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2) + '\n');
writePin(pin);
console.log('\nThe root package.json and the pin file name each tarball. Run `yarn install` next.');
