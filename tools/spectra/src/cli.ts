#!/usr/bin/env node
import {main} from './main.js';
import {consoleOutput} from './output.js';
import {viewerDirFor} from './viewer_files.js';

// The viewer's build is copied beside this file: dist/viewer under Node, and
// embedded under the same name in the binary.
const code = await main(process.argv.slice(2), consoleOutput, viewerDirFor(import.meta.dirname));
process.exitCode = code;
// Exit even if something still holds the event loop open.
setTimeout(() => process.exit(code), 2000).unref();
