/**
 * The release workflow's steps, `scripts/release.mjs`, outside any real run: the first step's
 * refusals, the refusal of unpublished upstream code, and the publishing steps' already-there
 * check, which skips a file the registry holds with the same checksum and refuses one it holds
 * with another, against a stand-in npm registry and a stand-in simple index served here.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {VERSION} from './version.js';

const SCRIPT = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));

interface Section {
  count: number;
  text?: string;
}
interface PlanEntry {
  label: string;
  action: 'publish' | 'skip';
}
interface Release {
  id: number;
  tag_name: string;
  target_commitish: string;
  draft: boolean;
  assets: {name: string; sha256: string}[];
}
/** The part of `scripts/release.mjs` the tests use. */
interface ReleaseSteps {
  MAIN: string;
  PLACEHOLDER_VERSION: string;
  NPM_PACKAGES: {name: string; dir: string}[];
  CHANGELOG: string;
  npmFileName(name: string, version: string): string;
  pypiFileNames(version: string): string[];
  npmIntegrity(bytes: Buffer): string;
  changelogSection(text: string, version: string): Section;
  previousTag(tags: string[], version: string): string | undefined;
  previewProtocolLines(protocol: number, previous?: {tag: string; protocol: number}): string[];
  firstStepRefusals(input: {
    version: string;
    committed: string;
    ref: string;
    dryRun: boolean;
    section: Section;
    tagExists: boolean;
    releaseExists: boolean;
  }): string[];
  localPatches(
    bundled: {name: string; version: string}[],
    resolutions: Record<string, string>,
  ): {name: string; version: string; resolution: string}[];
  localPatchFinding(
    patches: {name: string; version: string; resolution: string}[],
    refuse: boolean,
  ): {lines: string[]; refused: boolean};
  npmPlan(input: {
    registry: string;
    dir: string;
    version: string;
    expectAllThere?: boolean;
  }): Promise<PlanEntry[]>;
  pypiPlan(input: {
    index: string;
    dir: string;
    version: string;
    expectAllThere?: boolean;
  }): Promise<PlanEntry[]>;
  draftPlan(
    releases: Release[],
    tag: string,
    target: string,
    files: {name: string; sha256: string}[],
  ): {create: boolean; id?: number; upload: string[]};
  orderFailures(times: Record<string, Record<string, string>>, version: string): string[];
}

const steps = (await import(SCRIPT)) as ReleaseSteps;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Runs a step as the workflow does, without blocking this process, which serves the stand-ins.
 */
function runStep(args: string[]): Promise<{status: number | null; stderr: string}> {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    env: {...process.env, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: ''},
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => resolve({status, stderr}));
  });
}

const good = {
  version: VERSION,
  committed: VERSION,
  ref: 'refs/heads/main',
  dryRun: false,
  section: {count: 1, text: '- An entry.'},
  tagExists: false,
  releaseExists: false,
};

describe('the first step', () => {
  it('lets a real run from main through, with the committed version and its section', () => {
    assert.deepEqual(steps.firstStepRefusals(good), []);
  });

  it('refuses a version that is not the committed version, on a real run and a dry run', () => {
    for (const dryRun of [false, true]) {
      const refusals = steps.firstStepRefusals({...good, dryRun, version: '9.9.9'});
      assert.equal(refusals.length, 1);
      assert.match(refusals[0], /9\.9\.9, is not the committed version/);
    }
  });

  it('refuses a real run dispatched from another ref than main, and lets a dry run start there', () => {
    assert.match(
      steps.firstStepRefusals({...good, ref: 'refs/heads/topic'}).join('\n'),
      /dispatched from main, not from refs\/heads\/topic/,
    );
    assert.deepEqual(steps.firstStepRefusals({...good, dryRun: true, ref: 'refs/heads/topic'}), []);
  });

  it('refuses a missing, empty or doubled changelog section, on a real run and a dry run', () => {
    for (const dryRun of [false, true]) {
      for (const [section, reason] of [
        [{count: 0}, /holds no section `## /],
        [{count: 1, text: ''}, /is empty/],
        [{count: 2}, /holds 2 sections/],
      ] as const) {
        const refusals = steps.firstStepRefusals({...good, dryRun, section});
        assert.equal(refusals.length, 1);
        assert.match(refusals[0], reason);
      }
    }
  });

  it('refuses a real run whose tag or release already exists, which a dry run does not read', () => {
    assert.match(
      steps.firstStepRefusals({...good, tagExists: true}).join('\n'),
      new RegExp(`The tag v${VERSION} already exists`),
    );
    assert.match(
      steps.firstStepRefusals({...good, releaseExists: true}).join('\n'),
      new RegExp(`A release of v${VERSION} already exists`),
    );
    assert.deepEqual(
      steps.firstStepRefusals({...good, dryRun: true, tagExists: true, releaseExists: true}),
      [],
    );
  });

  it("reads a version's changelog section up to the next one", () => {
    const text = '# Changelog\n\n## Unreleased\n\n## 0.2.0\n\n- Two.\n\n## 0.1.0\n\n- One.\n';
    assert.deepEqual(steps.changelogSection(text, '0.2.0'), {count: 1, text: '- Two.'});
    assert.deepEqual(steps.changelogSection(text, '0.1.0'), {count: 1, text: '- One.'});
    assert.deepEqual(steps.changelogSection(text, '0.3.0'), {count: 0});
    assert.deepEqual(steps.changelogSection('## Unreleased\n\n## 0.2.0\n\n## 0.1.0\n', '0.2.0'), {
      count: 1,
      text: '',
    });
  });

  it("finds the committed version's section in the repository's CHANGELOG.md", () => {
    const section = steps.changelogSection(readFileSync(steps.CHANGELOG, 'utf8'), VERSION);
    assert.equal(section.count, 1);
    assert.notEqual(section.text, '');
  });

  it('adds the preview protocol, and says when it changed since the release before', () => {
    assert.equal(steps.previousTag(['v0.1.0', 'v0.2.0', 'v0.10.0', 'other'], '0.10.1'), 'v0.10.0');
    assert.equal(steps.previousTag(['v0.2.0'], '0.1.0'), undefined);
    assert.deepEqual(steps.previewProtocolLines(2), ['This release speaks preview protocol 2.']);
    assert.deepEqual(steps.previewProtocolLines(2, {tag: 'v0.1.0', protocol: 2}), [
      'This release speaks preview protocol 2.',
    ]);
    const changed = steps.previewProtocolLines(3, {tag: 'v0.1.0', protocol: 2});
    assert.equal(changed.length, 2);
    assert.match(changed[1], /changed from 2, which v0\.1\.0 spoke, to 3/);
    assert.match(changed[1], /preview pages need this release's preview adapters/);
  });

  it('runs as a dry run from any ref, writing the notes, and refuses another version', async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-first-step-'));
    try {
      const notes = path.join(scratch, 'notes.md');
      const passed = await runStep([
        ...['first-step', '--version', VERSION, '--ref', 'refs/heads/topic'],
        ...['--dry-run', '--notes', notes],
      ]);
      assert.equal(passed.status, 0, passed.stderr);
      assert.match(readFileSync(notes, 'utf8'), /### The preview protocol\n\nThis release speaks/);

      const refused = await runStep([
        ...['first-step', '--version', '9.9.9', '--ref', steps.MAIN],
        ...['--dry-run', '--notes', path.join(scratch, 'refused.md')],
      ]);
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /The dry run is refused:\n- The version given, 9\.9\.9/);
    } finally {
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});

describe('the refusal of unpublished upstream code', () => {
  const bundled = [
    {name: '@a2ui/web_core', version: '0.15.0'},
    {name: '@a2ui/react', version: '0.15.0'},
    {name: 'react', version: '19.2.0'},
  ];

  it('names each bundled package that resolves to a local patch, and refuses a real run', () => {
    const patches = steps.localPatches(bundled, {
      '@a2ui/web_core': 'file:./vendor/a2ui/a2ui-web_core-0.15.0.tgz',
      '@a2ui/react@npm:0.15.0': 'file:./vendor/a2ui/a2ui-react-0.15.0.tgz',
      '@a2ui/lit': 'file:./vendor/a2ui/a2ui-lit-0.15.0.tgz',
    });
    assert.deepEqual(
      patches.map(patch => patch.name),
      ['@a2ui/web_core', '@a2ui/react'],
    );
    const real = steps.localPatchFinding(patches, true);
    assert.equal(real.refused, true);
    assert.match(real.lines.join('\n'), /- @a2ui\/web_core 0\.15\.0, from file:/);
    assert.match(real.lines.join('\n'), /- @a2ui\/react 0\.15\.0, from file:/);
    const dry = steps.localPatchFinding(patches, false);
    assert.equal(dry.refused, false);
    assert.deepEqual(dry.lines.slice(0, -1), real.lines.slice(0, -1));
    assert.match(dry.lines.at(-1)!, /A dry run goes on/);
  });

  it('lets a real run through when every bundled package comes from a registry', () => {
    const patches = steps.localPatches(bundled, {'@a2ui/web_core': 'npm:0.15.1'});
    assert.deepEqual(patches, []);
    assert.equal(steps.localPatchFinding(patches, true).refused, false);
  });
});

describe('the publishing steps', () => {
  let scratch: string;
  let server: Server;
  let base: string;
  /** What the stand-ins hold: npm integrity values by name, and simple pages by project. */
  let npmHeld: Record<string, string> = {};
  let pypiHeld: Record<string, Record<string, string>> = {};
  const npmDir = () => path.join(scratch, 'npm');
  const pypiDir = () => path.join(scratch, 'pypi');

  before(async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'a2ui-spectra-publishing-'));
    mkdirSync(npmDir());
    mkdirSync(pypiDir());
    for (const {name} of steps.NPM_PACKAGES) {
      writeFileSync(path.join(npmDir(), steps.npmFileName(name, VERSION)), `the pack of ${name}`);
    }
    for (const name of steps.pypiFileNames(VERSION)) {
      writeFileSync(path.join(pypiDir(), name), `the file ${name}`);
    }
    server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://localhost');
      const simple = /^\/simple\/([^/]+)\/$/.exec(url.pathname);
      if (simple !== null) {
        const files = pypiHeld[simple[1]];
        if (files === undefined) return void response.writeHead(404).end();
        const links = Object.entries(files)
          .map(([name, hash]) => `<a href="/packages/${name}#sha256=${hash}">${name}</a>`)
          .join('\n');
        return void response.writeHead(200, {'content-type': 'text/html'}).end(links);
      }
      const name = decodeURIComponent(url.pathname.slice(1));
      const integrity = npmHeld[name];
      if (integrity === undefined) return void response.writeHead(404).end();
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({name, versions: {[VERSION]: {dist: {integrity}}}}));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  after(() => {
    server.close();
    rmSync(scratch, {recursive: true, force: true});
  });

  const npmFile = (name: string) =>
    readFileSync(path.join(npmDir(), steps.npmFileName(name, VERSION)));
  const pypiFile = (name: string) => readFileSync(path.join(pypiDir(), name));

  it('publishes every npm package in order when the registry holds none', async () => {
    npmHeld = {};
    const plan = await steps.npmPlan({registry: base, dir: npmDir(), version: VERSION});
    assert.deepEqual(
      plan.map(entry => [entry.label, entry.action]),
      steps.NPM_PACKAGES.map(({name}) => [`${name}@${VERSION}`, 'publish']),
    );
    assert.deepEqual(
      plan.slice(0, 6).map(entry => entry.label.split('@')[0]),
      [
        'a2ui-spectra-darwin-arm64',
        'a2ui-spectra-darwin-x64',
        'a2ui-spectra-linux-x64',
        'a2ui-spectra-linux-arm64',
        'a2ui-spectra-windows-x64',
        'a2ui-spectra',
      ],
    );
  });

  it('skips an npm package the registry holds with the same checksum', async () => {
    const [first, second] = steps.NPM_PACKAGES;
    npmHeld = {[first.name]: steps.npmIntegrity(npmFile(first.name))};
    const plan = await steps.npmPlan({registry: base, dir: npmDir(), version: VERSION});
    assert.equal(plan[0].action, 'skip');
    assert.equal(plan[1].action, 'publish');
    await assert.rejects(
      steps.npmPlan({registry: base, dir: npmDir(), version: VERSION, expectAllThere: true}),
      new RegExp(`does not hold ${second.name}@`),
    );
  });

  it('refuses before any publish when the registry holds an npm package with another checksum', async () => {
    const launcher = 'a2ui-spectra';
    npmHeld = {[launcher]: steps.npmIntegrity(Buffer.from('another pack'))};
    await assert.rejects(
      steps.npmPlan({registry: base, dir: npmDir(), version: VERSION}),
      new RegExp(
        `already holds ${launcher}@${VERSION.replace(/\./g, '\\.')} with another checksum`,
      ),
    );
    const step = await runStep(['npm', '--registry', base, '--files', npmDir()]);
    assert.equal(step.status, 1);
    assert.match(step.stderr, /with another checksum than this run's file\. Nothing is published/);
  });

  it('refuses a folder that does not hold exactly the eleven npm packages', async () => {
    const extra = path.join(npmDir(), 'stray-0.0.1.tgz');
    writeFileSync(extra, 'stray');
    try {
      await assert.rejects(
        steps.npmPlan({registry: base, dir: npmDir(), version: VERSION}),
        /not the 11 npm packages/,
      );
    } finally {
      rmSync(extra);
    }
  });

  it('skips a PyPI file the index holds with the same checksum, and uploads the rest', async () => {
    const [wheel] = steps.pypiFileNames(VERSION);
    pypiHeld = {'a2ui-spectra': {[wheel]: sha256(pypiFile(wheel))}};
    const plan = await steps.pypiPlan({index: `${base}simple/`, dir: pypiDir(), version: VERSION});
    assert.deepEqual(
      plan.map(entry => entry.action),
      ['skip', 'publish', 'publish', 'publish', 'publish', 'publish', 'publish'],
    );
    const upload = path.join(scratch, 'upload');
    const step = await runStep([
      ...['pypi', '--index', `${base}simple/`, '--files', pypiDir(), '--upload', upload],
    ]);
    assert.equal(step.status, 0, step.stderr);
    assert.equal(
      readFileSync(path.join(upload, plan[1].label), 'utf8'),
      `the file ${plan[1].label}`,
    );
  });

  it('refuses before any upload when the index holds a PyPI file with another checksum', async () => {
    const names = steps.pypiFileNames(VERSION);
    const sdist = names.at(-1)!;
    pypiHeld = {
      'a2ui-spectra-instrumentation': {[sdist]: sha256(Buffer.from('another sdist'))},
    };
    await assert.rejects(
      steps.pypiPlan({index: `${base}simple/`, dir: pypiDir(), version: VERSION}),
      new RegExp(`already holds ${sdist.replace(/\./g, '\\.')} with another checksum`),
    );
  });

  it('completes a draft an earlier attempt made, and refuses a published release, another commit or another file', () => {
    const tag = `v${VERSION}`;
    const commit = 'c0ffee';
    const files = [
      {name: 'a.tar.gz', sha256: 'aa'},
      {name: 'checksums.txt', sha256: 'cc'},
    ];
    assert.deepEqual(steps.draftPlan([], tag, commit, files), {
      create: true,
      upload: ['a.tar.gz', 'checksums.txt'],
    });
    const draft = {
      id: 7,
      tag_name: tag,
      target_commitish: commit,
      draft: true,
      assets: [{name: 'a.tar.gz', sha256: 'aa'}],
    };
    assert.deepEqual(steps.draftPlan([draft], tag, commit, files), {
      create: false,
      id: 7,
      upload: ['checksums.txt'],
    });
    for (const [release, reason] of [
      [{...draft, draft: false}, /already published/],
      [{...draft, target_commitish: 'beef'}, /targets beef, not this run's commit, c0ffee/],
      [
        {...draft, assets: [{name: 'a.tar.gz', sha256: 'ab'}]},
        /holds a\.tar\.gz with another checksum/,
      ],
      [
        {...draft, assets: [{name: 'b.zip', sha256: 'bb'}]},
        /holds b\.zip, which this run does not/,
      ],
    ] as [Release, RegExp][]) {
      assert.throws(() => steps.draftPlan([release], tag, commit, files), reason);
    }
  });

  it("reads the dry run's order from the stand-in's publish times", () => {
    const times: Record<string, Record<string, string>> = {};
    steps.NPM_PACKAGES.forEach(({name}, at) => {
      times[name] = {
        [steps.PLACEHOLDER_VERSION]: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
        [VERSION]: new Date(Date.UTC(2026, 0, 1, 1, 0, at)).toISOString(),
      };
    });
    assert.deepEqual(steps.orderFailures(times, VERSION), []);
    const launcherFirst = {
      ...times,
      'a2ui-spectra': {...times['a2ui-spectra'], [VERSION]: '2026-01-01T00:30:00.000Z'},
    };
    assert.match(
      steps.orderFailures(launcherFirst, VERSION).join('\n'),
      /a2ui-spectra-darwin-arm64 was not published before a2ui-spectra\./,
    );
  });
});
