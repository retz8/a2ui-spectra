// The release workflow's steps, `.github/workflows/release.yml`, each one command, from any
// folder:
//
//     node tools/spectra/scripts/release.mjs <step> [options]
//
//     first-step --version <v> --ref <ref> [--dry-run] --notes <file>
//         The run's first step. It fails unless the version equals the committed version, a real
//         run was dispatched from main, `CHANGELOG.md` holds a section for the version that is not
//         empty, and, on a real run, neither the tag `v<version>` nor a published release of it
//         exists. It writes the release notes, the changelog's section and the preview protocol
//         lines, to the file, and prints them in the run's summary.
//     local-patches [--refuse]
//         Names each npm package bundled into the binary that resolves to a local patch, from
//         what the builds report they bundled, after `build:packages`. Under `--refuse`, a real
//         run's, it fails when there is one.
//     npm --registry <url> --files <dir> [--placeholders] [--expect-all-there]
//         Publishes the eleven npm packages in their order, or under `--placeholders` the eleven
//         placeholders, `pack:placeholders`'s.
//     pypi --index <simple url> --files <dir> --upload <dir> [--expect-all-there]
//         Copies the seven PyPI files the index does not hold yet into the upload folder, for the
//         publishing action, and sets the step's output `upload`.
//     draft --tag <tag> --target <commit> --files <dir> --notes <file>
//         Creates the GitHub release as a draft, holding the five archives and `checksums.txt`.
//     publish-draft --tag <tag> --files <dir>
//         Publishes the draft, which makes the tag.
//     stand-ins --npm-registry <url> --npm-files <dir> --pypi-index <simple url> --pypi-files <dir>
//         A dry run's last step: every file in the stand-ins, in the order a release publishes.
//
// Before each publish, a publishing step asks the registry whether that version is already there:
// a file the registry holds with the same checksum is skipped, and one it holds with another
// checksum fails the step before anything is published. Under `--expect-all-there`, a file not
// there yet fails the step, for the dry run's second pass.

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

import {NPM_LIBRARIES, pythonSdist, pythonWheel} from './libraries.mjs';
import {
  archiveName,
  BuildError,
  NAME,
  PLATFORMS,
  platformPackage,
  readVersion,
  REPO_DIR,
  run,
  runMain,
  TOOL_DIR,
  VERSION_PATTERN,
  wheelFile,
} from './packages.mjs';

export const CHANGELOG = path.join(REPO_DIR, 'CHANGELOG.md');
/** The preview core's file that sets the preview protocol's version, from the repository's root. */
export const PROTOCOL_FILE = 'typescript/preview/core/src/protocol.ts';
const PROTOCOL_PATTERN = /^export const PREVIEW_PROTOCOL = (\d+);$/m;
export const MAIN = 'refs/heads/main';

/** The version every placeholder carries, a pre-release below any release, and its dist-tag. */
export const PLACEHOLDER_VERSION = '0.0.0-placeholder';
export const PLACEHOLDER_TAG = 'placeholder';

/**
 * The eleven npm packages, in the order a release publishes them, each with its folder in the
 * repository: the five platform packages before the launcher, and the preview core before the
 * three adapters, then the TypeScript wrapper.
 */
export const NPM_PACKAGES = [
  ...PLATFORMS.map(platform => ({name: platformPackage(platform), dir: 'tools/spectra'})),
  {name: NAME, dir: 'tools/spectra'},
  ...NPM_LIBRARIES.map(library => ({name: library.name, dir: library.dir})),
];

/** An npm package's file, as `npm pack` names an unscoped package's. */
export function npmFileName(name, version) {
  return `${name}-${version}.tgz`;
}

/** The seven PyPI files: the five wheels of the binary, then the Python wrapper's wheel and sdist. */
export function pypiFileNames(version) {
  return [
    ...PLATFORMS.map(platform => path.basename(wheelFile(platform, version))),
    path.basename(pythonWheel(version)),
    path.basename(pythonSdist(version)),
  ];
}

/** The GitHub release's six files: the five archives and `checksums.txt`. */
export function githubFileNames(version) {
  return [...PLATFORMS.map(platform => archiveName(platform, version)), 'checksums.txt'];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** npm's integrity value for a file: its SHA-512, in base64. */
export function npmIntegrity(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

// The first step.

/** The changelog's section for a version: its text under `## <version>`, or nothing. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, at) => (line.trim() === `## ${version}` ? [at] : []));
  if (starts.length !== 1) return {count: starts.length};
  const next = lines.findIndex((line, at) => at > starts[0] && /^#{1,2} /.test(line));
  const body = lines.slice(starts[0] + 1, next === -1 ? lines.length : next).join('\n');
  return {count: 1, text: body.trim()};
}

/** The preview protocol's version a copy of `protocol.ts` sets. */
export function protocolOf(text, where) {
  const match = PROTOCOL_PATTERN.exec(text);
  if (match === null) throw new BuildError(`${where} sets no PREVIEW_PROTOCOL.`);
  return Number(match[1]);
}

function compareVersions(a, b) {
  const [x, y] = [a, b].map(version => version.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The tag of the release before a version, the highest `v<version>` below it, or nothing. */
export function previousTag(tags, version) {
  return tags
    .filter(tag => tag.startsWith('v') && VERSION_PATTERN.test(tag.slice(1)))
    .filter(tag => compareVersions(tag.slice(1), version) < 0)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)))
    .at(-1);
}

/** The lines the release notes gain on the preview protocol. */
export function previewProtocolLines(protocol, previous) {
  const lines = [`This release speaks preview protocol ${protocol}.`];
  if (previous !== undefined && previous.protocol !== protocol) {
    lines.push(
      `The preview protocol changed from ${previous.protocol}, which ${previous.tag} spoke, to ${protocol}: preview pages need this release's preview adapters, and a page on an earlier adapter has no preview.`,
    );
  }
  return lines;
}

/** The release notes: the changelog's section, then the preview protocol's lines. */
export function releaseNotes(section, protocolLines) {
  return `${section}\n\n### The preview protocol\n\n${protocolLines.join('\n\n')}\n`;
}

/**
 * The first step's refusals, as lines: each a reason the run stops. `tagExists` and
 * `releaseExists` are read on a real run alone.
 */
export function firstStepRefusals({
  version,
  committed,
  ref,
  dryRun,
  section,
  tagExists,
  releaseExists,
}) {
  const refusals = [];
  if (version !== committed) {
    refusals.push(
      `The version given, ${version}, is not the committed version, ${committed}. The version changes only through a \`set:version\` commit on main.`,
    );
  }
  if (!dryRun && ref !== MAIN) {
    refusals.push(`A real run is dispatched from main, not from ${ref}.`);
  }
  if (section.count === 0) {
    refusals.push(`CHANGELOG.md holds no section \`## ${version}\`.`);
  } else if (section.count > 1) {
    refusals.push(`CHANGELOG.md holds ${section.count} sections \`## ${version}\`, not one.`);
  } else if (section.text === '') {
    refusals.push(`CHANGELOG.md's section \`## ${version}\` is empty.`);
  }
  if (!dryRun && tagExists) refusals.push(`The tag v${version} already exists.`);
  if (!dryRun && releaseExists) refusals.push(`A release of v${version} already exists.`);
  return refusals;
}

function git(args) {
  const result = spawnSync('git', args, {cwd: REPO_DIR, encoding: 'utf8'});
  if (result.error || result.status !== 0) {
    throw new BuildError(`git ${args.join(' ')} failed: ${result.stderr?.trim() ?? result.error}`);
  }
  return result.stdout;
}

/** A GitHub API request, as the token in the environment allows. */
async function github(pathname, {method = 'GET', body, accept, raw} = {}) {
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const url = pathname.startsWith('https://') ? pathname : `${api}${pathname}`;
  const response = await fetch(url, {
    method,
    headers: {
      accept: accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN && {authorization: `Bearer ${process.env.GITHUB_TOKEN}`}),
      ...(raw !== undefined && {'content-type': 'application/octet-stream'}),
      ...(body !== undefined && {'content-type': 'application/json'}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new BuildError(`${method} ${url} answered ${response.status}: ${await response.text()}`);
  }
  return accept === 'application/octet-stream'
    ? Buffer.from(await response.arrayBuffer())
    : response.json();
}

function repository() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo === undefined) throw new BuildError('GITHUB_REPOSITORY names no repository.');
  return repo;
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function firstStep({version, ref, dryRun, notes}) {
  const committed = readVersion();
  const section = changelogSection(readFileSync(CHANGELOG, 'utf8'), version);
  const tag = `v${version}`;
  let tagExists = false;
  let releaseExists = false;
  if (!dryRun) {
    const repo = repository();
    tagExists = (await github(`/repos/${repo}/git/ref/tags/${tag}`)) !== undefined;
    releaseExists = (await github(`/repos/${repo}/releases/tags/${tag}`)) !== undefined;
  }
  const refusals = firstStepRefusals({
    version,
    committed,
    ref,
    dryRun,
    section,
    tagExists,
    releaseExists,
  });
  if (refusals.length > 0) {
    throw new BuildError(
      `The ${dryRun ? 'dry run' : 'real run'} is refused:\n${refusals.map(line => `- ${line}`).join('\n')}`,
    );
  }
  const protocol = protocolOf(
    readFileSync(path.join(REPO_DIR, PROTOCOL_FILE), 'utf8'),
    PROTOCOL_FILE,
  );
  const before = previousTag(git(['tag', '--list', 'v*']).split('\n').filter(Boolean), version);
  const previous =
    before === undefined
      ? undefined
      : {tag: before, protocol: protocolOf(git(['show', `${before}:${PROTOCOL_FILE}`]), before)};
  const text = releaseNotes(section.text, previewProtocolLines(protocol, previous));
  writeFileSync(notes, text);
  console.log(`The ${dryRun ? 'dry run' : 'real run'} of ${tag} goes ahead. Its notes:\n\n${text}`);
  summary(`## The release notes of ${tag}\n\n${text}\n`);
}

// The refusal of unpublished upstream code.

/** A resolution that names a file in the repository, or a patch, as a local patch does. */
const LOCAL = /^(file|portal|link|patch):/;

/** The bundled packages that resolve to a local patch, by the root manifest's `resolutions`. */
export function localPatches(bundled, resolutions) {
  return bundled.flatMap(({name, version}) => {
    const entry = Object.entries(resolutions).find(
      ([key]) => key === name || key.startsWith(`${name}@`),
    );
    return entry !== undefined && LOCAL.test(entry[1])
      ? [{name, version, resolution: entry[1]}]
      : [];
  });
}

/** The finding's lines, and whether it stops the run. */
export function localPatchFinding(patches, refuse) {
  if (patches.length === 0) {
    return {
      lines: ['No npm package bundled into the binary resolves to a local patch.'],
      refused: false,
    };
  }
  return {
    lines: [
      `${patches.length} npm package${patches.length === 1 ? '' : 's'} bundled into the binary resolve${patches.length === 1 ? 's' : ''} to a local patch, upstream code upstream has not published:`,
      ...patches.map(({name, version, resolution}) => `- ${name} ${version}, from ${resolution}`),
      refuse
        ? 'A real run is refused until upstream publishes them.'
        : 'A dry run goes on; a real run is refused.',
    ],
    refused: refuse,
  };
}

async function localPatchesStep({refuse}) {
  // The builds' reports are read from the tool's folder.
  process.chdir(TOOL_DIR);
  const {bundledPackages} = await import('./notices.mjs');
  const {resolutions = {}} = JSON.parse(readFileSync(path.join(REPO_DIR, 'package.json'), 'utf8'));
  const finding = localPatchFinding(localPatches(bundledPackages(), resolutions), refuse);
  console.log(finding.lines.join('\n'));
  summary(`## Upstream code in the binary\n\n${finding.lines.join('\n')}\n`);
  if (finding.refused)
    throw new BuildError('The binary bundles upstream code upstream has not published.');
}

// The already-there check.

/**
 * What to do with each file: publish it, or skip it as already there with the same checksum.
 * A file there with another checksum refuses the whole plan, before anything is published.
 */
export function planOf(files, expectAllThere) {
  const differing = files.filter(file => file.there !== undefined && file.there !== file.checksum);
  if (differing.length > 0) {
    throw new BuildError(
      `The registry already holds ${differing.map(file => file.label).join(', ')} with another checksum than this run's file. Nothing is published; a version whose published file is wrong is abandoned.`,
    );
  }
  const missing = files.filter(file => file.there === undefined);
  if (expectAllThere && missing.length > 0) {
    throw new BuildError(
      `The registry does not hold ${missing.map(file => file.label).join(', ')}, which an earlier pass published.`,
    );
  }
  return files.map(file => ({...file, action: file.there === undefined ? 'publish' : 'skip'}));
}

/** The files a folder holds, which must be exactly those named. */
function exactly(dir, names, what) {
  const held = readdirSync(dir)
    .filter(name => !name.startsWith('.'))
    .sort();
  if (JSON.stringify(held) !== JSON.stringify([...names].sort())) {
    throw new BuildError(
      `${dir} holds ${held.join(', ') || 'nothing'}, not the ${names.length} ${what}: ${names.join(', ')}.`,
    );
  }
}

/** The integrity value the registry holds for a package's version, or nothing. */
export async function npmIntegrityThere(registry, name, version) {
  const response = await fetch(new URL(encodeURIComponent(name), withSlash(registry)), {
    headers: {accept: 'application/json'},
    redirect: 'manual',
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new BuildError(`${registry} answered ${response.status} for ${name}.`);
  const dist = (await response.json()).versions?.[version]?.dist;
  if (dist === undefined) return undefined;
  if (typeof dist.integrity !== 'string') {
    throw new BuildError(`${registry} holds ${name}@${version} with no integrity value.`);
  }
  return dist.integrity;
}

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

/** The npm step's plan, for the eleven packages or the eleven placeholders. */
export async function npmPlan({registry, dir, version, expectAllThere = false}) {
  dir = path.resolve(dir);
  const names = NPM_PACKAGES.map(({name}) => npmFileName(name, version));
  exactly(dir, names, 'npm packages');
  const files = [];
  for (const {name} of NPM_PACKAGES) {
    const file = path.join(dir, npmFileName(name, version));
    files.push({
      label: `${name}@${version}`,
      name,
      file,
      checksum: npmIntegrity(readFileSync(file)),
      there: await npmIntegrityThere(registry, name, version),
    });
  }
  return planOf(files, expectAllThere);
}

/** The npm release trusted publishing needs, and the one the publishing jobs install. */
export const NPM_FLOOR = '11.5.1';

function expectNpm() {
  const result = spawnSync('npm', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const found = result.stdout?.trim() ?? '';
  if (!VERSION_PATTERN.test(found) || compareVersions(found, NPM_FLOOR) < 0) {
    throw new BuildError(
      `npm ${found || 'is not found'}; publishing needs npm ${NPM_FLOOR} or later.`,
    );
  }
}

async function npmStep({registry, files: dir, placeholders, expectAllThere}) {
  const version = placeholders ? PLACEHOLDER_VERSION : readVersion();
  const plan = await npmPlan({registry, dir, version, expectAllThere});
  if (plan.some(entry => entry.action === 'publish')) expectNpm();
  // From a folder of its own, so that no project's configuration applies.
  const cwd = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-npm-'));
  try {
    for (const entry of plan) {
      if (entry.action === 'skip') {
        console.log(`${entry.label}: already there, with the same checksum; skipped.`);
        continue;
      }
      run(
        'npm',
        [
          'publish',
          entry.file,
          '--registry',
          registry,
          '--ignore-scripts',
          ...(placeholders ? ['--tag', PLACEHOLDER_TAG] : []),
        ],
        {cwd},
      );
      console.log(`${entry.label}: published.`);
    }
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
  summary(
    `## npm, at ${registry}\n\n${plan.map(entry => `- ${entry.label}: ${entry.action === 'skip' ? 'already there' : 'published'}`).join('\n')}\n`,
  );
}

/** A project's name in a PyPI file's name, normalized as the simple index names it. */
export function pypiProject(fileName) {
  const project = fileName.endsWith('.whl')
    ? fileName.split('-')[0]
    : fileName.replace(/-[^-]+\.tar\.gz$/, '');
  return project.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Each file a simple index's project page lists, by name, with its SHA-256. */
export function simplePageFiles(html) {
  const files = new Map();
  for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>/g)) {
    const [location, fragment = ''] = href.replace(/&amp;/g, '&').split('#');
    const name = decodeURIComponent(location.split('/').at(-1));
    const hash = /(?:^|&)sha256=([0-9a-f]{64})/.exec(fragment)?.[1];
    files.set(name, hash);
  }
  return files;
}

async function simplePage(index, project) {
  const response = await fetch(new URL(`${project}/`, withSlash(index)), {
    headers: {accept: 'text/html'},
    redirect: 'manual',
  });
  if (response.status === 404) return new Map();
  if (!response.ok) throw new BuildError(`${index} answered ${response.status} for ${project}.`);
  return simplePageFiles(await response.text());
}

/** The PyPI step's plan, for the seven files. */
export async function pypiPlan({index, dir, version, expectAllThere = false}) {
  dir = path.resolve(dir);
  const names = pypiFileNames(version);
  exactly(dir, names, 'PyPI files');
  const pages = new Map();
  const files = [];
  for (const name of names) {
    const project = pypiProject(name);
    if (!pages.has(project)) pages.set(project, await simplePage(index, project));
    const listed = pages.get(project);
    if (listed.has(name) && listed.get(name) === undefined) {
      throw new BuildError(`${index} lists ${name} with no SHA-256.`);
    }
    const file = path.join(dir, name);
    files.push({label: name, file, checksum: sha256(readFileSync(file)), there: listed.get(name)});
  }
  return planOf(files, expectAllThere);
}

async function pypiStep({index, files: dir, upload, expectAllThere}) {
  const plan = await pypiPlan({index, dir, version: readVersion(), expectAllThere});
  rmSync(upload, {recursive: true, force: true});
  mkdirSync(upload, {recursive: true});
  for (const entry of plan) {
    if (entry.action === 'skip') {
      console.log(`${entry.label}: already there, with the same checksum; skipped.`);
    } else {
      copyFileSync(entry.file, path.join(upload, entry.label));
      console.log(`${entry.label}: to be published.`);
    }
  }
  const any = plan.some(entry => entry.action === 'publish');
  setOutput('upload', String(any));
  summary(
    `## PyPI, at ${index}\n\n${plan.map(entry => `- ${entry.label}: ${entry.action === 'skip' ? 'already there' : 'published'}`).join('\n')}\n`,
  );
}

// The GitHub release.

/**
 * What the draft step does, from the repository's releases of the tag and the run's files, each
 * with its SHA-256: create the draft, or complete the draft an earlier attempt made by uploading
 * the files it lacks. A published release, a draft of another commit, a file on the draft with
 * another checksum or a file the run does not hold refuses it.
 */
export function draftPlan(releases, tag, target, files) {
  const ofTag = releases.filter(release => release.tag_name === tag);
  if (ofTag.length === 0) return {create: true, upload: files.map(file => file.name)};
  if (ofTag.length > 1) throw new BuildError(`${ofTag.length} releases of ${tag} exist, not one.`);
  const [release] = ofTag;
  if (!release.draft) throw new BuildError(`The release ${tag} is already published.`);
  if (release.target_commitish !== target) {
    throw new BuildError(
      `The draft of ${tag} targets ${release.target_commitish}, not this run's commit, ${target}.`,
    );
  }
  const names = new Set(files.map(file => file.name));
  const extra = release.assets.filter(asset => !names.has(asset.name));
  if (extra.length > 0) {
    throw new BuildError(
      `The draft of ${tag} holds ${extra.map(asset => asset.name).join(', ')}, which this run does not.`,
    );
  }
  const differing = files.filter(file => {
    const asset = release.assets.find(held => held.name === file.name);
    return asset !== undefined && asset.sha256 !== file.sha256;
  });
  if (differing.length > 0) {
    throw new BuildError(
      `The draft of ${tag} holds ${differing.map(file => file.name).join(', ')} with another checksum than this run's file.`,
    );
  }
  return {
    create: false,
    id: release.id,
    upload: files
      .filter(file => !release.assets.some(asset => asset.name === file.name))
      .map(file => file.name),
  };
}

async function releasesOf(repo) {
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await github(`/repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

/** A release's assets, each with its SHA-256, from its digest or else from its bytes. */
async function withChecksums(repo, release) {
  const assets = [];
  for (const asset of release.assets) {
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1];
    const bytes = digest
      ? undefined
      : await github(`/repos/${repo}/releases/assets/${asset.id}`, {
          accept: 'application/octet-stream',
        });
    assets.push({...asset, sha256: digest ?? sha256(bytes)});
  }
  return {...release, assets};
}

async function draftStep({tag, target, files: dir, notes}) {
  const repo = repository();
  const names = githubFileNames(readVersion());
  exactly(dir, names, 'files of the GitHub release');
  const files = names.map(name => ({name, sha256: sha256(readFileSync(path.join(dir, name)))}));
  const releases = await Promise.all(
    (await releasesOf(repo))
      .filter(release => release.tag_name === tag)
      .map(release => withChecksums(repo, release)),
  );
  const plan = draftPlan(releases, tag, target, files);
  const release = plan.create
    ? await github(`/repos/${repo}/releases`, {
        method: 'POST',
        body: {
          tag_name: tag,
          target_commitish: target,
          name: tag,
          body: readFileSync(notes, 'utf8'),
          draft: true,
        },
      })
    : releases.find(held => held.id === plan.id);
  console.log(plan.create ? `The draft of ${tag} is created.` : `The draft of ${tag} is there.`);
  const uploads = release.upload_url.replace(/\{[^}]*\}$/, '');
  for (const name of plan.upload) {
    await github(`${uploads}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      raw: readFileSync(path.join(dir, name)),
    });
    console.log(`${name}: uploaded to the draft.`);
  }
  for (const name of names.filter(name => !plan.upload.includes(name))) {
    console.log(`${name}: already on the draft, with the same checksum; skipped.`);
  }
}

async function publishDraftStep({tag, files: dir}) {
  const repo = repository();
  const names = githubFileNames(readVersion());
  exactly(dir, names, 'files of the GitHub release');
  const ofTag = (await releasesOf(repo)).filter(release => release.tag_name === tag);
  if (ofTag.length !== 1)
    throw new BuildError(`${ofTag.length} releases of ${tag} exist, not one.`);
  const [release] = ofTag;
  if (!release.draft) {
    console.log(`The release ${tag} is already published.`);
    return;
  }
  const held = release.assets.map(asset => asset.name).sort();
  if (JSON.stringify(held) !== JSON.stringify([...names].sort())) {
    throw new BuildError(`The draft of ${tag} holds ${held.join(', ')}, not ${names.join(', ')}.`);
  }
  await github(`/repos/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    body: {draft: false, make_latest: 'true'},
  });
  console.log(`The release ${tag} is published, and its tag made.`);
}

// The dry run's last step.

/** A package's packument from the stand-in, for its versions' times and integrity values. */
async function packument(registry, name) {
  const response = await fetch(new URL(encodeURIComponent(name), withSlash(registry)), {
    headers: {accept: 'application/json'},
  });
  if (!response.ok) throw new BuildError(`${registry} answered ${response.status} for ${name}.`);
  return response.json();
}

/**
 * The order the stand-ins' publish times show, as failures: every placeholder before every
 * package, each platform package before the launcher, and the preview core before each adapter.
 */
export function orderFailures(times, version) {
  const at = (name, of) => Date.parse(times[name]?.[of] ?? 'invalid');
  const failures = [];
  for (const {name} of NPM_PACKAGES) {
    for (const of of [PLACEHOLDER_VERSION, version]) {
      if (Number.isNaN(at(name, of))) failures.push(`${name}@${of} is not in the stand-in.`);
    }
  }
  const lastPlaceholder = Math.max(...NPM_PACKAGES.map(({name}) => at(name, PLACEHOLDER_VERSION)));
  const firstPackage = Math.min(...NPM_PACKAGES.map(({name}) => at(name, version)));
  if (!(lastPlaceholder < firstPackage)) {
    failures.push(`A placeholder was published after a package of ${version}.`);
  }
  for (const platform of PLATFORMS) {
    if (!(at(platformPackage(platform), version) < at(NAME, version))) {
      failures.push(`${platformPackage(platform)} was not published before ${NAME}.`);
    }
  }
  for (const library of NPM_LIBRARIES.filter(library => library.adapter)) {
    if (!(at(NPM_LIBRARIES[0].name, version) < at(library.name, version))) {
      failures.push(`${NPM_LIBRARIES[0].name} was not published before ${library.name}.`);
    }
  }
  return failures;
}

async function standInsStep(options) {
  const version = readVersion();
  await npmPlan({
    registry: options['npm-registry'],
    dir: options['npm-files'],
    version,
    expectAllThere: true,
  });
  await pypiPlan({
    index: options['pypi-index'],
    dir: options['pypi-files'],
    version,
    expectAllThere: true,
  });
  const times = {};
  for (const {name} of NPM_PACKAGES) {
    times[name] = (await packument(options['npm-registry'], name)).time;
  }
  const failures = orderFailures(times, version);
  if (failures.length > 0) {
    throw new BuildError(`The stand-ins:\n${failures.map(line => `- ${line}`).join('\n')}`);
  }
  const lines = [
    `The stand-in npm registry holds the ${NPM_PACKAGES.length} placeholders, then the ${NPM_PACKAGES.length} npm packages of ${version}, each with this run's checksum, the platform packages before the launcher and the preview core before the adapters.`,
    `The stand-in Python index holds the ${pypiFileNames(version).length} PyPI files, each with this run's checksum.`,
  ];
  console.log(lines.join('\n'));
  summary(`## The stand-ins\n\n${lines.join('\n\n')}\n`);
}

const STEPS = {
  'first-step': {
    options: {
      version: {type: 'string'},
      ref: {type: 'string'},
      'dry-run': {type: 'boolean', default: false},
      notes: {type: 'string'},
    },
    required: ['version', 'ref', 'notes'],
    run: options =>
      firstStep({
        version: options.version,
        ref: options.ref,
        dryRun: options['dry-run'],
        notes: options.notes,
      }),
  },
  'local-patches': {
    options: {refuse: {type: 'boolean', default: false}},
    required: [],
    run: localPatchesStep,
  },
  npm: {
    options: {
      registry: {type: 'string'},
      files: {type: 'string'},
      placeholders: {type: 'boolean', default: false},
      'expect-all-there': {type: 'boolean', default: false},
    },
    required: ['registry', 'files'],
    run: options => npmStep({...options, expectAllThere: options['expect-all-there']}),
  },
  pypi: {
    options: {
      index: {type: 'string'},
      files: {type: 'string'},
      upload: {type: 'string'},
      'expect-all-there': {type: 'boolean', default: false},
    },
    required: ['index', 'files', 'upload'],
    run: options => pypiStep({...options, expectAllThere: options['expect-all-there']}),
  },
  draft: {
    options: {
      tag: {type: 'string'},
      target: {type: 'string'},
      files: {type: 'string'},
      notes: {type: 'string'},
    },
    required: ['tag', 'target', 'files', 'notes'],
    run: draftStep,
  },
  'publish-draft': {
    options: {tag: {type: 'string'}, files: {type: 'string'}},
    required: ['tag', 'files'],
    run: publishDraftStep,
  },
  'stand-ins': {
    options: {
      'npm-registry': {type: 'string'},
      'npm-files': {type: 'string'},
      'pypi-index': {type: 'string'},
      'pypi-files': {type: 'string'},
    },
    required: ['npm-registry', 'npm-files', 'pypi-index', 'pypi-files'],
    run: standInsStep,
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, ...args] = process.argv.slice(2);
  await runMain(`release ${name ?? ''}`.trim(), async () => {
    const step = STEPS[name];
    if (step === undefined) {
      throw new BuildError(`Name a step: ${Object.keys(STEPS).join(', ')}.`);
    }
    const {values} = parseArgs({args, options: step.options, strict: true});
    const missing = step.required.filter(option => values[option] === undefined);
    if (missing.length > 0) {
      throw new BuildError(`${name} needs ${missing.map(option => `--${option}`).join(', ')}.`);
    }
    await step.run(values);
  });
}
