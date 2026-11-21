// The stand-in for GitHub, the install check's, as a process of its own that outlives the command
// starting it: at the paths the two install commands of the root README name on raw GitHub, the
// commit's install scripts; the releases list, holding the one release at the committed version;
// and that release's files, from a folder. From any folder:
//
//     node tools/spectra/scripts/github_stand_in.mjs start <dir> --files <release-files>
//     node tools/spectra/scripts/github_stand_in.mjs stop <dir>
//
// `start` starts it, keeping its log and its process id in `<dir>`, waits until it answers, and
// prints the variables an install from it reads, adding them to the job's environment under
// GitHub Actions:
//
//     A2UI_SPECTRA_GITHUB_URL       its origin, for the release's files
//     A2UI_SPECTRA_GITHUB_API_URL   its origin, for the releases list
//     A2UI_SPECTRA_STAND_IN_SH      the root README's shell install command, its origin changed
//     A2UI_SPECTRA_STAND_IN_PS1     the root README's PowerShell install command, its origin changed
//
// `stop` ends it, printing every request it took.

import {spawn} from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {fromStandIn, githubStandIn, readmeInstallCommands} from './install_check.mjs';
import {BuildError, readVersion, runMain} from './packages.mjs';

async function serve(dir, files) {
  const commands = readmeInstallCommands();
  const standIn = await githubStandIn({
    filesDir: files,
    version: readVersion(),
    commands: [commands.sh, commands.powershell],
  });
  const log = path.join(dir, 'requests.txt');
  writeFileSync(log, '');
  const record = standIn.requests.push.bind(standIn.requests);
  standIn.requests.push = (...urls) => {
    for (const url of urls) appendFileSync(log, `${url}\n`);
    return record(...urls);
  };
  writeFileSync(path.join(dir, 'origin'), standIn.origin);
}

async function start(dir, files) {
  dir = path.resolve(dir);
  files = path.resolve(files);
  if (!existsSync(files)) throw new BuildError(`${files}, the release's files, is not there.`);
  mkdirSync(dir, {recursive: true});
  const origin = path.join(dir, 'origin');
  if (existsSync(origin)) throw new BuildError(`A stand-in for GitHub was started in ${dir}.`);
  const out = openSync(path.join(dir, 'log.txt'), 'a');
  // Detached on Windows too, with no console of its own, so that it outlives the step's console.
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), 'serve', dir, '--files', files],
    {detached: true, stdio: ['ignore', out, out], windowsHide: true},
  );
  child.unref();
  writeFileSync(path.join(dir, 'pid'), String(child.pid));
  for (let i = 0; i < 100 && !existsSync(origin); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!existsSync(origin)) {
    throw new BuildError(
      `The stand-in for GitHub did not answer:\n${readFileSync(path.join(dir, 'log.txt'), 'utf8')}`,
    );
  }
  const at = readFileSync(origin, 'utf8');
  const commands = readmeInstallCommands();
  const variables = {
    A2UI_SPECTRA_GITHUB_URL: at,
    A2UI_SPECTRA_GITHUB_API_URL: at,
    A2UI_SPECTRA_STAND_IN_SH: fromStandIn(commands.sh, at),
    A2UI_SPECTRA_STAND_IN_PS1: fromStandIn(commands.powershell, at),
  };
  const lines = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
  console.log(`The stand-in for GitHub answers, serving ${files}:\n${lines.join('\n')}`);
}

function stop(dir) {
  dir = path.resolve(dir);
  const pid = path.join(dir, 'pid');
  if (!existsSync(pid)) {
    console.log('No stand-in for GitHub was started there.');
    return;
  }
  try {
    process.kill(Number(readFileSync(pid, 'utf8')));
  } catch {
    // Already ended.
  }
  const requests = path.join(dir, 'requests.txt');
  const taken = existsSync(requests) ? readFileSync(requests, 'utf8').trim() : '';
  console.log(`The stand-in for GitHub is stopped. It took:\n${taken || '(no request)'}`);
}

const [mode, dir, ...rest] = process.argv.slice(2);
const files = rest[0] === '--files' && rest.length === 2 ? rest[1] : undefined;
if (mode === 'serve' && dir !== undefined && files !== undefined) {
  await serve(dir, files);
} else {
  await runMain(`stand-in for GitHub ${mode ?? ''}`.trim(), async () => {
    if (mode === 'start' && dir !== undefined && files !== undefined) return start(dir, files);
    if (mode === 'stop' && dir !== undefined && rest.length === 0) return stop(dir);
    throw new BuildError(
      'Run it as `node github_stand_in.mjs start <dir> --files <release-files>` or `stop <dir>`.',
    );
  });
}
