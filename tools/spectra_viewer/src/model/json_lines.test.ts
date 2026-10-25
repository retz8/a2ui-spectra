import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {jsonLines} from './json_lines.ts';

const message = {
  version: 'v0.9',
  createSurface: {surfaceId: 's1', catalogId: 'basic'},
  list: [1, 2],
  none: {},
};

describe('jsonLines', () => {
  it('shows JSON as JSON.stringify indents it, each object and array foldable', () => {
    const lines = jsonLines(message);
    assert.deepEqual(
      lines.map(line => line.text),
      JSON.stringify(message, null, 2).split('\n'),
    );
    assert.deepEqual(
      lines.filter(line => line.fold !== undefined).map(line => line.fold),
      ['', '/createSurface', '/list'],
    );
  });

  it('shows a folded object or array as one line counting what it holds', () => {
    const lines = jsonLines(message, new Set(['/createSurface', '/list']));
    assert.deepEqual(
      lines.map(line => line.text),
      [
        '{',
        '  "version": "v0.9",',
        '  "createSurface": { … 2 keys },',
        '  "list": [ … 2 items ],',
        '  "none": {}',
        '}',
      ],
    );
    assert.equal(lines[2].folded, true);
  });

  it('escapes a key in its path as a JSON Pointer does', () => {
    const lines = jsonLines({'a/b': {'c~d': 1}});
    assert.equal(lines[1].fold, '/a~1b');
    assert.equal(lines[2].path, '/a~1b/c~0d');
  });
});
