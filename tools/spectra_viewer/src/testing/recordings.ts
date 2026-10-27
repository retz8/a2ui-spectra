/** Sub-task 2.3's recordings, as the records the A2A capture path writes from them. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
