import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

import {NAME, VERSION} from './version.js';

describe('the version', () => {
  it("equals the package's name and version", () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {name: string; version: string};
    assert.equal(NAME, manifest.name);
    assert.equal(VERSION, manifest.version);
  });
});
