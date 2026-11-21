// The tool's test target, `yarn test`: Node's test runner over the compiled tests in `dist/`,
// from `tools/spectra/`. `SPECTRA_TEST_PART` runs one part of them: `wrapper-capture`, the
// wrapper capture suite alone; `command-line`, the tests that run Spectra as a process from a
// terminal, the install scripts and the npm launcher; or `others`, every other file; unset or
// empty, every file. CI runs the macOS x64 binary test run as the three parts, on three runners.

import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';

const DIST = 'dist';
/** The named parts, each as its files under `dist/`; `others` is every file in none of them. */
const PARTS = {
  'wrapper-capture': ['receiver/wrapper_capture.conformance.test.js'],
  'command-line': [
    'cli.test.js',
    'install_scripts.test.js',
    'npm/launcher.test.js',
    'process_tree_end_to_end.test.js',
  ],
};

const all = readdirSync(DIST, {recursive: true})
  .map(file => file.split('\\').join('/'))
  .filter(file => file.endsWith('.test.js'))
  .sort();

const part = process.env.SPECTRA_TEST_PART ?? '';
const named = Object.values(PARTS).flat();
for (const file of named) {
  if (!all.includes(file)) {
    console.error(`run_tests: ${DIST}/${file}, named in a part, is not built.`);
    process.exit(1);
  }
}
let files;
if (part === '') files = all;
else if (part === 'others') files = all.filter(file => !named.includes(file));
else if (part in PARTS) files = PARTS[part];
else {
  console.error(
    `run_tests: SPECTRA_TEST_PART names ${part}, not one of ${[...Object.keys(PARTS), 'others'].join(', ')}.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--enable-source-maps',
    '--test-reporter',
    'spec',
    ...files.map(file => `${DIST}/${file}`),
  ],
  {stdio: 'inherit'},
);
process.exitCode = result.status ?? 1;
