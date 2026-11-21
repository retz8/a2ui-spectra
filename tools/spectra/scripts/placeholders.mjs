// The npm placeholders: one package for each of the eleven npm names a release publishes, at the
// version `0.0.0-placeholder`, a pre-release below any release, made into `dist/placeholders/`:
//
//     yarn pack:placeholders
//
// A placeholder holds its manifest, the root LICENSE and a README saying that the first release
// is on its way and naming the repository. A new npm name is created by publishing its
// placeholder by hand, after which its trusted publisher can be configured; the release workflow
// then publishes the release's version under trusted publishing. They are published with
//
//     node scripts/release.mjs npm --placeholders --registry <url> --files dist/placeholders
//
// under the dist-tag `placeholder`, and the release
// workflow's dry run publishes them into its stand-in npm registry first.

import {copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {
  NPM_BUGS,
  npmRepository,
  REPO_DIR,
  REPOSITORY,
  run,
  runMain,
  TOOL_DIR,
} from './packages.mjs';
import {npmFileName, NPM_PACKAGES, PLACEHOLDER_VERSION} from './release.mjs';

export const PLACEHOLDERS_DIR = path.join(TOOL_DIR, 'dist/placeholders');

/** A placeholder's README. */
export function placeholderReadme(name) {
  return [
    `# ${name}`,
    `This version, \`${PLACEHOLDER_VERSION}\`, is a placeholder that holds the name \`${name}\`. It contains no code.`,
    `The first release of \`${name}\` is on its way, from Spectra for A2UI, a debugging and observation tool for the developer of an A2UI agent: ${REPOSITORY}.`,
    '',
  ].join('\n\n');
}

function placeholder({name, dir}, staging) {
  mkdirSync(staging);
  writeFileSync(
    path.join(staging, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: PLACEHOLDER_VERSION,
        description: `A placeholder for ${name}, whose first release is on its way from ${REPOSITORY}.`,
        license: 'Apache-2.0',
        repository: npmRepository(dir),
        bugs: NPM_BUGS,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(staging, 'README.md'), placeholderReadme(name));
  copyFileSync(path.join(REPO_DIR, 'LICENSE'), path.join(staging, 'LICENSE'));
  run(
    'npm',
    ['pack', '--pack-destination', PLACEHOLDERS_DIR, '--ignore-scripts', '--loglevel=warn'],
    {
      cwd: staging,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  statSync(path.join(PLACEHOLDERS_DIR, npmFileName(name, PLACEHOLDER_VERSION)));
}

async function main() {
  rmSync(PLACEHOLDERS_DIR, {recursive: true, force: true});
  mkdirSync(PLACEHOLDERS_DIR, {recursive: true});
  const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-placeholders-'));
  try {
    for (const entry of NPM_PACKAGES) {
      placeholder(entry, path.join(scratch, entry.name));
      console.log(`${entry.name}@${PLACEHOLDER_VERSION}: packed.`);
    }
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
  console.log(
    `\nThe ${NPM_PACKAGES.length} placeholders are in ${path.relative(process.cwd(), PLACEHOLDERS_DIR) || '.'}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMain('pack:placeholders', main);
}
