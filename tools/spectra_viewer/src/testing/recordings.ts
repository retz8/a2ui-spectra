/**
 * Sub-task 2.3's recordings, as the records the A2A capture path writes from
 * them, and the tool and receiver capture suites' expected records.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {KnownCatalog} from '../model/catalogs.ts';
import type {TurnRecord} from '../model/record.ts';

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const RECORDINGS_DIR = path.join(findConformanceDir(), 'test_data/a2a_capture/v0_1');
const CATALOGS_DIR = path.join(findConformanceDir(), 'test_data/catalogs');

/** A recording's record, by its path under `test_data/a2a_capture/v0_1/` without `.json`. */
export function readRecording(name: string): TurnRecord {
  return JSON.parse(
    fs.readFileSync(path.join(RECORDINGS_DIR, `${name}.json`), 'utf8'),
  ) as TurnRecord;
}

/** A catalog definition of the test data, by its file name under `test_data/catalogs/` without `.json`. */
export function readCatalog(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(CATALOGS_DIR, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

const SCHEMAS_DIR = path.join(findConformanceDir(), '../tools/spectra/src/check/schemas');

/**
 * The catalog definitions Spectra holds, as `GET /api/catalogs` would serve
 * them: the built-in basic catalogs, the v0.9 one under its v0.9.1 alias,
 * then every definition of the test data as a configured catalog.
 */
export function heldCatalogs(): KnownCatalog[] {
  const read = (file: string) =>
    JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const basic = (version: string, protocolVersion: string, aliases: string[]): KnownCatalog => {
    const definition = read(path.join(SCHEMAS_DIR, version, 'catalogs/basic/catalog.json'));
    return {
      id: definition.catalogId as string,
      aliases,
      protocolVersion,
      source: 'built-in',
      definition,
    };
  };
  return [
    basic('v0_9', '0.9', ['https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json']),
    basic('v1_0', '1.0', []),
    ...fs
      .readdirSync(CATALOGS_DIR)
      .filter(file => file.endsWith('.json'))
      .sort()
      .map((file): KnownCatalog => {
        const definition = read(path.join(CATALOGS_DIR, file));
        return {
          id: definition.catalogId as string,
          aliases: [],
          protocolVersion: definition.protocolVersion === '1.0' ? '1.0' : '0.9',
          source: 'configured',
          path: `catalogs/${file}`,
          definition,
        };
      }),
  ];
}

const TEST_DATA_DIR = path.join(findConformanceDir(), 'test_data');

/** A record of the shared test data, by its path under `conformance/test_data/`. */
export function readTestData(file: string): TurnRecord {
  return JSON.parse(fs.readFileSync(path.join(TEST_DATA_DIR, file), 'utf8')) as TurnRecord;
}

const WRAPPER_CAPTURE_DIR = path.join(TEST_DATA_DIR, 'wrapper_capture/v0_1');

/** The wrapper capture suite's expected records: each case's, one per language file it has. */
export function wrapperCaptureRecords(): Array<{name: string; record: TurnRecord}> {
  return fs
    .readdirSync(WRAPPER_CAPTURE_DIR)
    .sort()
    .flatMap(caseName => {
      const dir = path.join(WRAPPER_CAPTURE_DIR, caseName);
      return fs
        .readdirSync(dir)
        .filter(file => file.startsWith('expected') && file.endsWith('.json'))
        .sort()
        .map(file => ({
          name: file === 'expected.json' ? caseName : `${caseName} (${file.slice(9, -5)})`,
          record: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as TurnRecord,
        }));
    });
}
