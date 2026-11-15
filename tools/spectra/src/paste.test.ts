import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {pasteBlocks, pasteLine, shellsOf} from './paste.js';

describe('the lines to paste', () => {
  it('are POSIX exports on macOS and Linux, and PowerShell and cmd on Windows', () => {
    assert.deepEqual(shellsOf('darwin'), ['posix']);
    assert.deepEqual(shellsOf('linux'), ['posix']);
    assert.deepEqual(shellsOf('win32'), ['powershell', 'cmd']);
  });

  it('write a variable in each shell, with a comment where the shell takes one', () => {
    assert.equal(pasteLine('A', 'http://x', 'posix', 'for y'), 'export A=http://x  # for y');
    assert.equal(pasteLine('A', 'http://x', 'powershell', 'for y'), "$env:A = 'http://x'  # for y");
    assert.equal(pasteLine('A', "it's", 'powershell'), "$env:A = 'it''s'");
    assert.equal(pasteLine('A', 'http://x?a=1&b=2', 'cmd', 'for y'), 'set "A=http://x?a=1&b=2"');
  });

  it('are one block on macOS and Linux, and a labelled block per shell on Windows', () => {
    const linesFor = (shell: string) => [`${shell} line`];
    assert.deepEqual(pasteBlocks(linesFor, 'linux'), ['posix line']);
    assert.deepEqual(pasteBlocks(linesFor, 'win32'), [
      '# In PowerShell:',
      'powershell line',
      '',
      'rem In cmd:',
      'cmd line',
    ]);
  });
});
