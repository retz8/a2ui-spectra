import {describe, it} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import {createRequire} from 'node:module';
import * as yaml from 'js-yaml';
import {Ajv2020, type AnySchemaObject, type ErrorObject} from 'ajv/dist/2020.js';

interface ExpectedDetail {
  path: string;
  code: string;
}

interface TurnRecordCase {
  name: string;
  description?: string;
  action: 'validate_turn_record';
  fixture: string;
  expectError?: {category: 'ValidationError'; details: ExpectedDetail[]};
}

interface TurnRecord {
  turns: {events: {attributes: Record<string, unknown>}[]}[];
}

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(url.fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'conformance_schema.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance_schema.json');
}

const CONFORMANCE_DIR = findConformanceDir();
const SCHEMA_DIR = path.join(CONFORMANCE_DIR, '../specification/turn_record/v0_1/json');
const SUITE = path.join(CONFORMANCE_DIR, 'turn_record/validator_v0_1.yaml');
const FIXTURE_ROOT = path.join(CONFORMANCE_DIR, 'test_data/turn_record');

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * Formats are annotations, as JSON Schema 2020-12 has them by default. verbose
 * keeps each error's schema, which failedKeyword reads.
 */
function createAjv(): Ajv2020 {
  return new Ajv2020({
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allErrors: true,
    verbose: true,
    validateFormats: false,
  });
}

function loadCases(): TurnRecordCase[] {
  const validateCases = createAjv().compile(
    readJson(path.join(CONFORMANCE_DIR, 'conformance_schema.json')) as AnySchemaObject,
  );
  const cases = yaml.load(fs.readFileSync(SUITE, 'utf-8'));
  if (!validateCases(cases)) {
    throw new Error(
      `${SUITE} does not match conformance_schema.json:\n${formatErrors(validateCases.errors)}`,
    );
  }
  return cases as TurnRecordCase[];
}

/**
 * Compiles turn_record.json with the copied GenAI schemas loaded under their
 * addresses relative to its $id, and the draft-07 meta-schema one of them
 * references.
 */
function compileTurnRecordSchema(ajv: Ajv2020) {
  const require = createRequire(import.meta.url);
  ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json') as AnySchemaObject);
  const schema = readJson(path.join(SCHEMA_DIR, 'turn_record.json')) as AnySchemaObject;
  for (const file of fs.readdirSync(SCHEMA_DIR).filter(f => f.startsWith('gen-ai-'))) {
    const copied = readJson(path.join(SCHEMA_DIR, file)) as AnySchemaObject;
    ajv.addSchema(copied, new URL(file, schema.$id).href);
  }
  return {schema, validate: ajv.compile(schema)};
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(e => `  ${e.instancePath || '/'}: ${e.keyword}: ${e.message}`)
    .join('\n');
}

function valueAt(document: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((value, token) => (value as Record<string, unknown>)[token], document);
}

/**
 * The keyword that failed, as JSON Schema 2020-12's output format names it.
 * Ajv reports a failed contains, minContains or maxContains alike as
 * contains, so the matching items are counted to tell them apart.
 */
function failedKeyword(ajv: Ajv2020, error: ErrorObject, document: unknown): string {
  if (error.keyword !== 'contains') {
    return error.keyword;
  }
  const items = valueAt(document, error.instancePath) as unknown[];
  const matches = items.filter(item => ajv.validate(error.schema as AnySchemaObject, item)).length;
  const {minContains, maxContains} = error.params as {minContains: number; maxContains?: number};
  if (maxContains !== undefined && matches > maxContains) {
    return 'maxContains';
  }
  if (matches > 0 && matches < minContains) {
    return 'minContains';
  }
  return 'contains';
}

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .flatMap(entry =>
      entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
}

const cases = loadCases();
const ajv = createAjv();
const {schema, validate} = compileTurnRecordSchema(ajv);

describe('turn record v0.1', () => {
  for (const c of cases) {
    it(c.name, () => {
      const fixture = readJson(path.join(CONFORMANCE_DIR, c.fixture));
      const valid = validate(fixture);
      const errors = [...(validate.errors ?? [])];
      if (!c.expectError) {
        assert.ok(valid, `${c.fixture} must validate:\n${formatErrors(errors)}`);
        return;
      }
      assert.ok(!valid, `${c.fixture} must fail validation`);
      const reported = errors.map(e => ({
        path: e.instancePath,
        code: failedKeyword(ajv, e, fixture),
      }));
      for (const expected of c.expectError.details) {
        assert.ok(
          reported.some(r => r.path === expected.path && r.code === expected.code),
          `${c.fixture} must fail with ${expected.code} at ${expected.path}, but failed with:\n` +
            reported.map(r => `  ${r.path || '/'}: ${r.code}`).join('\n'),
        );
      }
    });
  }

  it('every kind appears in a must-pass fixture', () => {
    const kinds: string[] =
      schema.$defs.Event.properties.attributes.properties['a2ui.event.kind'].enum;
    const covered = new Set(
      cases
        .filter(c => !c.expectError)
        .flatMap(c => (readJson(path.join(CONFORMANCE_DIR, c.fixture)) as TurnRecord).turns)
        .flatMap(t => t.events.map(e => e.attributes['a2ui.event.kind'])),
    );
    assert.deepEqual(
      kinds.filter(kind => !covered.has(kind)),
      [],
      'kinds no must-pass fixture holds',
    );
  });

  it('every fixture is named by a case', () => {
    const named = new Set(cases.map(c => path.join(CONFORMANCE_DIR, c.fixture)));
    assert.deepEqual(
      listFiles(FIXTURE_ROOT)
        .filter(file => !named.has(file))
        .map(file => path.relative(CONFORMANCE_DIR, file)),
      [],
      'fixtures no case names',
    );
  });
});
