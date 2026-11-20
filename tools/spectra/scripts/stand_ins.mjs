// The stand-in registries the release workflow's dry run publishes into: a stand-in npm registry,
// Verdaccio, and a stand-in Python index, pypiserver, each a local process on the runner that
// holds what is published to it and asks no other registry for anything. From any folder:
//
//     node tools/spectra/scripts/stand_ins.mjs start <dir>
//     node tools/spectra/scripts/stand_ins.mjs stop <dir>
//
// `start` starts both, each storing into `<dir>`, waits until both answer, creates the npm user
// the dry run publishes as and writes its token to `<dir>/npmrc`. It prints the variables the
// publishing steps read, and adds them to the job's environment under GitHub Actions:
//
//     A2UI_SPECTRA_STAND_IN_NPM          the npm registry's address
//     A2UI_SPECTRA_STAND_IN_PYPI_INDEX   the Python index's simple index
//     A2UI_SPECTRA_STAND_IN_PYPI_UPLOAD  the address the PyPI publishing action uploads to, from
//                                        its container: on Linux, the Docker bridge's gateway
//     NPM_CONFIG_USERCONFIG              the npm configuration holding the token
//
// `stop` ends both.

import {spawn, spawnSync} from 'node:child_process';
import {appendFileSync, mkdirSync, openSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {BuildError, runMain} from './packages.mjs';

export const VERDACCIO = 'verdaccio@6.11.1';
export const PYPISERVER = 'pypiserver==2.4.2';
const NPM_PORT = 4873;
const PYPI_PORT = 8080;
const USER = {name: 'dry-run', password: 'dry-run-password'};
const windows = process.platform === 'win32';

/** Verdaccio's configuration: its own storage, users by htpasswd, and no uplink. */
function verdaccioConfig(dir) {
  return [
    `storage: ${JSON.stringify(path.join(dir, 'storage'))}`,
    'auth:',
    '  htpasswd:',
    `    file: ${JSON.stringify(path.join(dir, 'htpasswd'))}`,
    '    max_users: 1',
    'packages:',
    "  '**':",
    '    access: $all',
    '    publish: $authenticated',
    '    unpublish: $authenticated',
    // The platform packages hold the binary.
    'max_body_size: 1000mb',
    'log: {type: stdout, format: pretty, level: warn}',
    '',
  ].join('\n');
}

function startProcess(command, args, log) {
  const out = openSync(log, 'a');
  const child = spawn(command, args, {
    detached: !windows,
    stdio: ['ignore', out, out],
    shell: windows,
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function answers(url) {
  try {
    return (await fetch(url, {redirect: 'manual'})).ok;
  } catch {
    return false;
  }
}

async function waitFor(urls, logs) {
  for (let i = 0; i < 240; i++) {
    if ((await Promise.all(urls.map(answers))).every(Boolean)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const tails = logs.map(log => `${log}:\n${readFileSync(log, 'utf8').slice(-2000)}`);
  throw new BuildError(`The stand-ins did not answer within 120 seconds.\n${tails.join('\n')}`);
}

/** The address a container on the default Docker bridge reaches this machine at, or loopback. */
function containerHost() {
  if (process.platform !== 'linux') return '127.0.0.1';
  const result = spawnSync(
    'docker',
    ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'],
    {encoding: 'utf8'},
  );
  const gateway = result.status === 0 ? result.stdout.trim() : '';
  return /^\d+\.\d+\.\d+\.\d+$/.test(gateway) ? gateway : '127.0.0.1';
}

async function start(dir) {
  dir = path.resolve(dir);
  const npmDir = path.join(dir, 'npm');
  const pypiDir = path.join(dir, 'pypi');
  mkdirSync(npmDir, {recursive: true});
  mkdirSync(path.join(pypiDir, 'packages'), {recursive: true});
  writeFileSync(path.join(npmDir, 'config.yaml'), verdaccioConfig(npmDir));
  const npmLog = path.join(npmDir, 'log.txt');
  const pypiLog = path.join(pypiDir, 'log.txt');
  // On Linux the Python index listens beyond loopback, for the publishing action's container.
  const pypiListen = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';
  const pids = [
    startProcess(
      'npx',
      [
        '--yes',
        VERDACCIO,
        '--config',
        path.join(npmDir, 'config.yaml'),
        '--listen',
        `127.0.0.1:${NPM_PORT}`,
      ],
      npmLog,
    ),
    startProcess(
      'uvx',
      [
        ...['--python', '3.12', '--from', PYPISERVER, 'pypi-server', 'run'],
        ...['-p', String(PYPI_PORT), '-i', pypiListen, '-a', '.', '-P', '.'],
        ...['--hash-algo', 'sha256', '--disable-fallback', path.join(pypiDir, 'packages')],
      ],
      pypiLog,
    ),
  ];
  writeFileSync(path.join(dir, 'pids.json'), `${JSON.stringify(pids)}\n`);

  const npm = `http://127.0.0.1:${NPM_PORT}/`;
  const index = `http://127.0.0.1:${PYPI_PORT}/simple/`;
  await waitFor([`${npm}-/ping`, index], [npmLog, pypiLog]);

  const response = await fetch(`${npm}-/user/org.couchdb.user:${USER.name}`, {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(USER),
  });
  const {token} = await response.json();
  if (!response.ok || typeof token !== 'string') {
    throw new BuildError(`The stand-in npm registry gave no token: ${response.status}.`);
  }
  const npmrc = path.join(dir, 'npmrc');
  writeFileSync(npmrc, `//127.0.0.1:${NPM_PORT}/:_authToken=${token}\n`);

  const variables = {
    A2UI_SPECTRA_STAND_IN_NPM: npm,
    A2UI_SPECTRA_STAND_IN_PYPI_INDEX: index,
    A2UI_SPECTRA_STAND_IN_PYPI_UPLOAD: `http://${containerHost()}:${PYPI_PORT}/`,
    NPM_CONFIG_USERCONFIG: npmrc,
  };
  const lines = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
  console.log(`The stand-ins answer, ${VERDACCIO} and ${PYPISERVER}:\n${lines.join('\n')}`);
}

function stop(dir) {
  const pids = JSON.parse(readFileSync(path.join(path.resolve(dir), 'pids.json'), 'utf8'));
  for (const pid of pids) {
    try {
      if (windows) spawnSync('taskkill', ['/pid', String(pid), '/t', '/f']);
      else process.kill(-pid, 'SIGTERM');
    } catch {
      // Already ended.
    }
  }
  console.log('The stand-ins are stopped.');
}

const [mode, dir, ...rest] = process.argv.slice(2);
await runMain(`stand-ins ${mode ?? ''}`.trim(), async () => {
  if (mode === 'start' && dir !== undefined && rest.length === 0) return start(dir);
  if (mode === 'stop' && dir !== undefined && rest.length === 0) return stop(dir);
  throw new BuildError('Run it as `node stand_ins.mjs start <dir>` or `stop <dir>`.');
});
