#!/usr/bin/env node
import {launchOf, runLauncher} from './windows/launcher.js';

// On Windows the compiled binary is also the agent's launcher, started by Spectra itself.
const launch = launchOf(process.env);
if (launch !== undefined) {
  process.exit(await runLauncher(launch));
}

const [{main}, {consoleOutput}, {viewerDirFor}] = await Promise.all([
  import('./main.js'),
  import('./output.js'),
  import('./viewer_files.js'),
]);
// The viewer's build is copied beside this file: dist/viewer under Node, and
// embedded under the same name in the binary.
const code = await main(process.argv.slice(2), consoleOutput, viewerDirFor(import.meta.dirname));
process.exitCode = code;
// Exit even if something still holds the event loop open.
setTimeout(() => process.exit(code), 2000).unref();
