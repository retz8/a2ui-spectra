/**
 * The install check, `scripts/install_check.mjs`, outside a release run: the root README's
 * install section read as the check reads it, its four commands, the two script commands as the
 * scripts' header comments write them, and each command's form from the stand-ins; the stand-in
 * for GitHub the check serves; the A2UI messages it reads from a turn; and, on macOS and Windows,
 * the download mark found on a binary that carries it.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {VERSION} from './version.js';

type Kind = 'npx' | 'uvx' | 'sh' | 'powershell';

/** The part of `scripts/install_check.mjs` the tests use. */
interface InstallCheck {
  README: string;
  RAW_GITHUB: string;
  MARK: string;
  CANNED_SURFACE: unknown[];
  installCommands(text: string): Record<Kind, string>;
  commandWords(command: string): string[];
  fromStandIn(command: string, origin: string): string;
  githubStandIn(input: {
    filesDir: string;
    version: string;
    commands: string[];
  }): Promise<{origin: string; requests: string[]; close(): Promise<void>}>;
  a2uiMessagesOf(turn: unknown): unknown[];
  binariesUnder(dirs: string[], name: string): string[];
  expectNoMark(binaries: string[]): void;
}

// By its URL, which Windows needs of an import.
const check = (await import(
  new URL('../scripts/install_check.mjs', import.meta.url).href
)) as InstallCheck;

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const windows = process.platform === 'win32';
const marked = process.platform === 'darwin' || windows;

const SH =
  'curl -fsSL https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.sh | sh';
const PS =
  'irm https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.ps1 | iex';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-install-check-'));
  dirs.push(dir);
  return dir;
}

function section(...blocks: string[]): string {
  return [
    '# A README',
    '',
    '## Install',
    '',
    ...blocks.map(block => `\`\`\`sh\n${block}\n\`\`\`\n`),
    '## Next',
    '',
    '```sh\nnpx something-else\n```',
  ].join('\n');
}

describe('the install check', () => {
  it("reads the root README's install section as its four commands", () => {
    assert.deepEqual(check.installCommands(readFileSync(check.README, 'utf8')), {
      npx: 'npx a2ui-spectra',
      uvx: 'uvx a2ui-spectra',
      sh: SH,
      powershell: PS,
    });
  });

  it("writes the two script commands as the scripts' header comments do", () => {
    const {sh, powershell} = check.installCommands(readFileSync(check.README, 'utf8'));
    for (const [script, command] of [
      ['install.sh', sh],
      ['install.ps1', powershell],
    ]) {
      const header = readFileSync(path.join(REPO_DIR, 'scripts', 'public', script), 'utf8');
      assert.ok(
        header.split(/\r?\n/).includes(`#   ${command}`),
        `${script}'s usage line is not \`${command}\`.`,
      );
    }
  });

  it('reads the section alone, and refuses one without its four commands, each once', () => {
    assert.deepEqual(check.installCommands(section('npx a', 'uvx a', SH, PS)), {
      npx: 'npx a',
      uvx: 'uvx a',
      sh: SH,
      powershell: PS,
    });
    assert.throws(() => check.installCommands(section('npx a', 'uvx a', SH)), /no powershell/);
    assert.throws(
      () => check.installCommands(section('npx a', 'npx b', 'uvx a', SH, PS)),
      /two npx commands/,
    );
    assert.throws(
      () => check.installCommands(section('npx a', 'uvx a', SH, PS, 'brew install a')),
      /`brew install a`, which is none of its four commands/,
    );
    assert.throws(() => check.installCommands('# A README\n'), /0 sections `## Install`/);
    assert.throws(
      () => check.installCommands('## Install\n\n```sh\nnpx a\n\n## Next\n'),
      /leaves a code block open/,
    );
  });

  it('runs the npx and uvx commands as written, and the script commands from the stand-in', () => {
    assert.deepEqual(check.commandWords('npx a2ui-spectra'), ['npx', 'a2ui-spectra']);
    assert.throws(() => check.commandWords('npx a2ui-spectra && rm x'), /needs a shell/);
    assert.equal(
      check.fromStandIn(SH, 'http://127.0.0.1:4000'),
      'curl -fsSL http://127.0.0.1:4000/retz8/a2ui-spectra/main/scripts/public/install.sh | sh',
    );
    assert.equal(
      check.fromStandIn(PS, 'http://127.0.0.1:4000'),
      'irm http://127.0.0.1:4000/retz8/a2ui-spectra/main/scripts/public/install.ps1 | iex',
    );
    assert.throws(
      () => check.fromStandIn('curl -fsSL https://example.com/install.sh | sh', 'http://x'),
      /names no one script on raw GitHub/,
    );
  });

  it('serves the stand-in for GitHub: the scripts, the one release, and its files', async () => {
    const files = freshDir();
    writeFileSync(path.join(files, 'checksums.txt'), 'the checksums\n');
    const standIn = await check.githubStandIn({
      filesDir: files,
      version: VERSION,
      commands: [SH, PS],
    });
    try {
      const get = async (pathname: string) => {
        const response = await fetch(`${standIn.origin}${pathname}`);
        return {status: response.status, text: await response.text()};
      };
      for (const script of ['install.sh', 'install.ps1']) {
        assert.deepEqual(await get(`/retz8/a2ui-spectra/main/scripts/public/${script}`), {
          status: 200,
          text: readFileSync(path.join(REPO_DIR, 'scripts', 'public', script), 'utf8'),
        });
      }
      const page = await get('/repos/retz8/a2ui-spectra/releases?per_page=100&page=1');
      assert.equal(page.status, 200);
      assert.deepEqual(JSON.parse(page.text), [
        {tag_name: `v${VERSION}`, draft: false, prerelease: false},
      ]);
      const next = await get('/repos/retz8/a2ui-spectra/releases?per_page=100&page=2');
      assert.deepEqual(JSON.parse(next.text), []);
      assert.deepEqual(
        await get(`/retz8/a2ui-spectra/releases/download/v${VERSION}/checksums.txt`),
        {
          status: 200,
          text: 'the checksums\n',
        },
      );
      for (const missing of [
        `/retz8/a2ui-spectra/releases/download/v${VERSION}/nothing.zip`,
        '/retz8/a2ui-spectra/releases/download/v0.0.1/checksums.txt',
        '/repos/someone/else/releases?per_page=100&page=1',
        '/retz8/a2ui-spectra/main/README.md',
      ]) {
        assert.equal((await get(missing)).status, 404, missing);
      }
    } finally {
      await standIn.close();
    }
  });

  it("reads a turn's A2UI messages in order, from a part holding a list or one message", () => {
    const [first, second, third] = check.CANNED_SURFACE;
    const output = (parts: unknown[]) => ({
      attributes: {'a2ui.event.kind': 'wire_output', 'a2ui.wire.message': {parts}},
    });
    const turn = {
      events: [
        {attributes: {'a2ui.event.kind': 'turn'}},
        output([
          {type: 'text', content: "What's your name?"},
          {type: 'a2ui', content: [first]},
        ]),
        output([
          {type: 'a2ui', content: second},
          {type: 'a2ui', content: third},
        ]),
      ],
    };
    assert.deepEqual(check.a2uiMessagesOf(turn), check.CANNED_SURFACE);
  });

  it(
    'finds each installed binary, and fails on one carrying the download mark',
    {skip: !marked && 'Linux has no download mark the check asserts.'},
    () => {
      const name = windows ? 'a2ui-spectra.exe' : 'a2ui-spectra';
      const header = windows ? Buffer.from('MZ', 'latin1') : Buffer.from('cffaedfe', 'hex');
      const root = freshDir();
      const installed = path.join(root, 'a', 'b');
      mkdirSync(installed, {recursive: true});
      const binary = path.join(installed, name);
      writeFileSync(binary, Buffer.concat([header, Buffer.alloc(64)]));
      // Neither a script of the binary's name nor a link to the binary is a binary.
      mkdirSync(path.join(root, 'bin'));
      writeFileSync(path.join(root, 'bin', name), '#!/bin/sh\nexec node launcher.js "$@"\n');
      if (!windows) symlinkSync(binary, path.join(root, 'link'));
      assert.deepEqual(check.binariesUnder([root, path.join(root, 'nowhere')], name), [binary]);

      check.expectNoMark([binary]);
      const mark = windows
        ? spawnSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Set-Content -LiteralPath '${binary}' -Stream Zone.Identifier -Value '[ZoneTransfer]'`,
            ],
            {
              encoding: 'utf8',
              env: Object.fromEntries(
                Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'),
              ),
            },
          )
        : spawnSync('xattr', ['-w', check.MARK, '0081;00000000;a test;', binary], {
            encoding: 'utf8',
          });
      assert.equal(mark.status, 0, mark.stderr);
      assert.throws(() => check.expectNoMark([binary]), /carries the download mark/);
      assert.throws(() => check.expectNoMark([]), /No installed binary was found/);
    },
  );
});
