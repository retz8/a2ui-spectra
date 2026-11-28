/**
 * The public addresses of the two schemas an adopter's editor or tool reads, each on raw GitHub
 * at the path its file sits at and carrying that address as its `$id`: the config file's schema
 * at the release's tag, `v` and the committed version, so that the address an adopter writes
 * names the schema of the Spectra they run; the turn record's on this repository's `main`. And
 * every config file and document that names the config file's schema naming it by that address.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {VERSION} from './version.js';

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const RAW = 'https://raw.githubusercontent.com/retz8/a2ui-spectra/';

function text(path: string): string {
  return readFileSync(`${REPO_DIR}${path}`, 'utf8');
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(text(path)) as Record<string, unknown>;
}

const CONFIG_SCHEMA = 'tools/spectra/src/config.schema.json';
const TURN_RECORD_SCHEMA = 'specification/turn_record/v0_1/json/turn_record.json';
const CONFIG_SCHEMA_ADDRESS = `${RAW}v${VERSION}/${CONFIG_SCHEMA}`;

describe('the schemas’ public addresses', () => {
  it(`${CONFIG_SCHEMA} carries its raw address at the release's tag as its $id`, () => {
    assert.equal(json(CONFIG_SCHEMA).$id, CONFIG_SCHEMA_ADDRESS);
  });

  it(`${TURN_RECORD_SCHEMA} carries its raw address on main as its $id`, () => {
    assert.equal(json(TURN_RECORD_SCHEMA).$id, `${RAW}main/${TURN_RECORD_SCHEMA}`);
  });

  for (const sample of ['react', 'lit', 'angular']) {
    it(`the ${sample} sample's config file names the config file's schema by that address`, () => {
      assert.equal(
        json(`samples/preview/${sample}/a2ui-spectra.json`).$schema,
        CONFIG_SCHEMA_ADDRESS,
      );
    });
  }

  it('every tracked document names the config file’s schema by that address', () => {
    const documents = execFileSync('git', ['ls-files', '*.md'], {cwd: REPO_DIR, encoding: 'utf8'})
      .split('\n')
      .filter(path => path !== '' && path !== 'CHANGELOG.md');
    const pattern = new RegExp(`${RAW.replaceAll('.', '\\.')}[^/\\s"]+/${CONFIG_SCHEMA}`, 'g');
    const others = documents.flatMap(path =>
      [...text(path).matchAll(pattern)]
        .map(match => match[0])
        .filter(address => address !== CONFIG_SCHEMA_ADDRESS)
        .map(address => `${path}: ${address}`),
    );
    assert.deepEqual(others, []);
  });
});
