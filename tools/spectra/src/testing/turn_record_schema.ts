/**
 * Validates turn records against turn record v0.1's JSON Schema, set up as
 * the conformance harness sets it up: Ajv's draft 2020-12 build in strict
 * mode, the copied GenAI schemas under their addresses relative to the
 * schema's $id, and the draft-07 meta-schema one of them references.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

import {Ajv2020, type AnySchemaObject} from 'ajv/dist/2020.js';

const schemaDir = fileURLToPath(
  new URL('../../../../specification/turn_record/v0_1/json/', import.meta.url),
);

function readJson(file: string): AnySchemaObject {
  return JSON.parse(readFileSync(schemaDir + file, 'utf8')) as AnySchemaObject;
}

function compile() {
  const ajv = new Ajv2020({
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allErrors: true,
    validateFormats: false,
  });
  const require = createRequire(import.meta.url);
  ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json') as AnySchemaObject);
  const schema = readJson('turn_record.json');
  for (const file of readdirSync(schemaDir).filter(f => f.startsWith('gen-ai-'))) {
    ajv.addSchema(readJson(file), new URL(file, schema.$id as string).href);
  }
  return ajv.compile(schema);
}

let validate: ReturnType<typeof compile> | undefined;

/** The schema's errors for a record, one line each; empty when it validates. */
export function turnRecordErrors(record: unknown): string[] {
  validate ??= compile();
  if (validate(record)) {
    return [];
  }
  return (validate.errors ?? []).map(
    e => `${e.instancePath || '/'}: ${e.keyword}: ${e.message ?? ''}`,
  );
}
