/**
 * The public addresses of the two schemas an adopter's editor or tool reads: the config file's
 * schema and the turn record's, each served from this repository's `main` on raw GitHub at the
 * path its file sits at, and carrying that address as its `$id`; and the sample catalog apps'
 * config files naming the config file's schema by it, as every example config does.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const RAW_MAIN = 'https://raw.githubusercontent.com/retz8/a2ui-spectra/main/';

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${REPO_DIR}${path}`, 'utf8')) as Record<string, unknown>;
}

const CONFIG_SCHEMA = 'tools/spectra/src/config.schema.json';
const TURN_RECORD_SCHEMA = 'specification/turn_record/v0_1/json/turn_record.json';

describe('the schemas’ public addresses', () => {
  for (const path of [CONFIG_SCHEMA, TURN_RECORD_SCHEMA]) {
    it(`${path} carries its raw address on main as its $id`, () => {
      assert.equal(json(path).$id, `${RAW_MAIN}${path}`);
    });
  }

  for (const sample of ['react', 'lit', 'angular']) {
    it(`the ${sample} sample's config file names the config file's schema by that address`, () => {
      assert.equal(
        json(`samples/preview/${sample}/a2ui-spectra.json`).$schema,
        `${RAW_MAIN}${CONFIG_SCHEMA}`,
      );
    });
  }
});
