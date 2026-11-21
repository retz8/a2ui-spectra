/**
 * The Markdown links module, `scripts/markdown.mjs`, that the link check and the packing commands
 * read links with: the links and anchors it finds, a packed README's links written as GitHub URLs
 * at the version's tag, and the problems the package checks refuse a packed README for.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

interface Link {
  kind: 'link' | 'image';
  target: string;
  line: number;
  start: number;
  end: number;
}

interface Repo {
  files: Set<string>;
  folders: Set<string>;
  read(file: string): string;
}

/** The part of `scripts/markdown.mjs` the tests use. */
interface Markdown {
  linksOf(text: string): Link[];
  anchorsOf(text: string): Set<string>;
  trackedFolders(files: Iterable<string>): Set<string>;
  packedReadme(
    text: string,
    options: Repo & {readme: string; version: string},
  ): {text: string; problems: string[]};
  packedReadmeProblems(text: string, options: Repo & {where: string}): string[];
}

// By its URL, which Windows needs of an import.
const markdown = (await import(
  new URL('../../../scripts/markdown.mjs', import.meta.url).href
)) as Markdown;

/** A repository of a few files, for the resolution of links. */
function repo(texts: Record<string, string>): Repo {
  const files = new Set(Object.keys(texts));
  return {files, folders: markdown.trackedFolders(files), read: file => texts[file] ?? ''};
}

const REPO = repo({
  'README.md': '# Spectra\n\n## What Spectra supports\n',
  'docs/design/a2ui-step.md': '# The A2UI step\n\n## The pinned API\n\n## The pinned API\n',
  'docs/images/viewer-light.png': '',
  'docs/images/viewer-dark.png': '',
  'python/wrapper/README.md': '# Wrapper\n',
  'samples/preview/react/index.html': '',
});

describe('the links of a Markdown file', () => {
  it('finds inline links and images, definitions and HTML attributes, at their offsets', () => {
    const text = [
      'See [the doc](docs/a.md "title") and ![a picture](<docs/b c.png>).',
      '[label]: docs/c.md',
      '<picture><source srcset="docs/d.png 2x, docs/e.png"><img src="docs/f.png"></picture>',
      '<a href="docs/g.md">g</a>',
    ].join('\n');
    const links = markdown.linksOf(text);
    assert.deepEqual(
      links.map(link => [link.kind, link.target, link.line]),
      [
        ['link', 'docs/a.md', 1],
        ['image', 'docs/b c.png', 1],
        ['link', 'docs/c.md', 2],
        ['image', 'docs/d.png', 3],
        ['image', 'docs/e.png', 3],
        ['image', 'docs/f.png', 3],
        ['link', 'docs/g.md', 4],
      ],
    );
    for (const link of links) assert.equal(text.slice(link.start, link.end), link.target);
  });

  it('finds none in code blocks, inline code or comments', () => {
    const text = [
      '```json',
      '[a](in-fence.md)',
      '```',
      '`[b](in-code.md)` <!-- [c](in-comment.md) -->',
      '~~~',
      '[d](in-tilde-fence.md)',
      '~~~',
      '[e](after.md)',
    ].join('\n');
    assert.deepEqual(
      markdown.linksOf(text).map(link => link.target),
      ['after.md'],
    );
  });

  it('slugs headings as GitHub does, numbering a repeated one', () => {
    const text = [
      '# The `a2ui_step` span',
      '## What it **buys**, and what it costs',
      '## Repeated',
      '## Repeated',
      'A setext heading',
      '----------------',
      '<a id="by-hand"></a>',
      '```',
      '# not a heading',
      '```',
    ].join('\n');
    assert.deepEqual([...markdown.anchorsOf(text)].sort(), [
      'a-setext-heading',
      'by-hand',
      'repeated',
      'repeated-1',
      'the-a2ui_step-span',
      'what-it-buys-and-what-it-costs',
    ]);
  });
});

describe('a packed README', () => {
  const readme = 'python/wrapper/README.md';
  const packed = (text: string) => markdown.packedReadme(text, {...REPO, readme, version: '0.1.0'});

  it('writes relative links and images as GitHub URLs at the version tag', () => {
    const {text, problems} = packed(
      [
        '[Design](../../docs/design/a2ui-step.md#the-pinned-api-1)',
        '[Sample](../../samples/preview/react/)',
        '[Top](#wrapper)',
        '![Viewer](../../docs/images/viewer-light.png)',
        '<source srcset="../../docs/images/viewer-dark.png">',
        '[npm](https://www.npmjs.com/package/a2ui-spectra)',
      ].join('\n'),
    );
    assert.deepEqual(problems, []);
    assert.equal(
      text,
      [
        '[Design](https://github.com/retz8/a2ui-spectra/blob/v0.1.0/docs/design/a2ui-step.md#the-pinned-api-1)',
        '[Sample](https://github.com/retz8/a2ui-spectra/tree/v0.1.0/samples/preview/react)',
        '[Top](https://github.com/retz8/a2ui-spectra/blob/v0.1.0/python/wrapper/README.md#wrapper)',
        '![Viewer](https://raw.githubusercontent.com/retz8/a2ui-spectra/v0.1.0/docs/images/viewer-light.png)',
        '<source srcset="https://raw.githubusercontent.com/retz8/a2ui-spectra/v0.1.0/docs/images/viewer-dark.png">',
        '[npm](https://www.npmjs.com/package/a2ui-spectra)',
      ].join('\n'),
    );
    assert.deepEqual(markdown.packedReadmeProblems(text, {...REPO, where: 'packed'}), []);
  });

  it('stops at a relative link that does not resolve', () => {
    const {problems} = packed(
      [
        '[Gone](../../docs/design/gone.md)',
        '[Anchor](../../docs/design/a2ui-step.md#gone)',
        '[Outside](../../../elsewhere.md)',
      ].join('\n'),
    );
    assert.deepEqual(problems, [
      `${readme}:1: ../../docs/design/gone.md names docs/design/gone.md, which is not tracked.`,
      `${readme}:2: ../../docs/design/a2ui-step.md#gone names #gone, which docs/design/a2ui-step.md has no heading or anchor for.`,
      `${readme}:3: ../../../elsewhere.md names a path outside the repository.`,
    ]);
  });

  it('is refused when it holds a relative link or names what the repository does not hold', () => {
    const problems = markdown.packedReadmeProblems(
      [
        '[Relative](docs/design/a2ui-step.md)',
        '[Gone](https://github.com/retz8/a2ui-spectra/blob/v0.1.0/docs/design/gone.md)',
        '![Gone](https://raw.githubusercontent.com/retz8/a2ui-spectra/v0.1.0/docs/images/gone.png)',
        '[Anchor](https://github.com/retz8/a2ui-spectra/blob/v0.1.0/README.md#gone)',
        '[Issues](https://github.com/retz8/a2ui-spectra/issues)',
      ].join('\n'),
      {...REPO, where: 'packed'},
    );
    assert.deepEqual(problems, [
      'packed:1: docs/design/a2ui-step.md is a relative link.',
      'packed:2: https://github.com/retz8/a2ui-spectra/blob/v0.1.0/docs/design/gone.md names docs/design/gone.md, which is not a tracked file.',
      'packed:3: https://raw.githubusercontent.com/retz8/a2ui-spectra/v0.1.0/docs/images/gone.png names docs/images/gone.png, which is not a tracked file.',
      'packed:4: https://github.com/retz8/a2ui-spectra/blob/v0.1.0/README.md#gone names #gone, which README.md has no heading or anchor for.',
    ]);
  });
});
