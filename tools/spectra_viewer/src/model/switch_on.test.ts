/**
 * The hint for switching on a wrapper: each of its lines is a code block of its wrapper's README,
 * word for word, and each column links to that README at this Spectra's version tag.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

import {readmeLink, SWITCH_ON_LINES} from './switch_on.ts';

const REPO = new URL('../../../../', import.meta.url);

/** The text of each fenced code block of a Markdown file. */
function codeBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)\n```$/gm)].map(match => match[1]);
}

describe('the hint for switching on a wrapper', () => {
  for (const lines of SWITCH_ON_LINES) {
    const blocks = codeBlocks(readFileSync(new URL(lines.readme, REPO), 'utf8'));
    for (const [what, code] of [
      ['install', lines.install],
      ['launch', lines.launch.code],
      ['one line', lines.line.code],
    ] as const) {
      it(`${lines.language}: its ${what} line is a code block of ${lines.readme}`, () => {
        assert.ok(blocks.includes(code), `${lines.readme} has no code block holding ${code}`);
      });
    }
  }

  it('links each README at this Spectra’s version tag, or on main without a version', () => {
    assert.deepEqual(readmeLink('typescript/instrumentation/README.md', '0.1.0'), {
      href: 'https://github.com/retz8/a2ui-spectra/blob/v0.1.0/typescript/instrumentation/README.md',
      text: 'The README, at v0.1.0',
      ref: 'v0.1.0',
    });
    assert.equal(
      readmeLink('typescript/instrumentation/README.md', undefined).href,
      'https://github.com/retz8/a2ui-spectra/blob/main/typescript/instrumentation/README.md',
    );
  });
});
