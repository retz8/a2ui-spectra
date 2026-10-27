/**
 * The schema check: each A2UI message the agent sent in a turn, validated
 * against the protocol schema of the version it declares. The schemas are
 * upstream's, copied unchanged into `schemas/`, with their catalog reference
 * bound to a stand-in that accepts any component, function and theme.
 */
import {
  Ajv2020,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';

import {
  type CheckEvent,
  type Finding,
  isA2uiPart,
  isEventOfKind,
  type ProtocolVersion,
  type Turn,
  type TurnEvent,
} from '../record/turn_record.js';
import {checkEvent} from './check_event.js';
import v0_9 from './schemas/v0_9/server_to_client.json' with {type: 'json'};
import v0_9_1 from './schemas/v0_9_1/server_to_client.json' with {type: 'json'};
import v1_0 from './schemas/v1_0/agent_to_renderer.json' with {type: 'json'};
import v1_0CommonTypes from './schemas/v1_0/common_types.json' with {type: 'json'};

/** Each version the check covers: its single-message schema, then the schemas it references. */
const SCHEMAS: Readonly<Record<ProtocolVersion, AnySchemaObject[]>> = {
  'v0.9': [v0_9],
  'v0.9.1': [v0_9_1],
  'v1.0': [v1_0, v1_0CommonTypes],
};

/** The versions the check covers, as a finding names them. */
const CHECKED_VERSIONS = Object.keys(SCHEMAS);

/** The record's form of a protocol version. */
const VERSION_FORM = /^v[0-9]+\.[0-9]+(\.[0-9]+)?$/;

/**
 * What the schemas reference in `catalog.json`, accepting anything. An
 * `unevaluatedProperties` of true counts every property as evaluated, so
 * v1.0's `unevaluatedProperties: false` on a component does not reject the
 * properties its catalog would define.
 */
const CATALOG_STAND_IN = {
  $defs: {
    anyComponent: {unevaluatedProperties: true},
    anyFunction: {unevaluatedProperties: true},
    theme: true,
  },
};

/** One version's validators. */
interface VersionSchema {
  /** The single-message envelope. */
  message: ValidateFunction;
  /** Each message type, by the key that names it, such as `createSurface`. */
  types: Map<string, ValidateFunction>;
}

function compile(schemas: AnySchemaObject[]): VersionSchema {
  // Strict mode off, as upstream's own schema tests run Ajv.
  const ajv = new Ajv2020({strict: false, allErrors: true});
  const [envelope] = schemas;
  const base = envelope.$id as string;
  for (const schema of schemas) {
    ajv.addSchema(schema);
  }
  ajv.addSchema({$id: new URL('catalog.json', base).href, ...CATALOG_STAND_IN});
  const types = new Map<string, ValidateFunction>();
  for (const branch of envelope.oneOf as Array<{$ref: string}>) {
    const name = branch.$ref.replace('#/$defs/', '');
    const required = (envelope.$defs[name].required as string[]).filter(key => key !== 'version');
    types.set(required[0], ajv.getSchema(`${base}#/$defs/${name}`) as ValidateFunction);
  }
  return {message: ajv.getSchema(base) as ValidateFunction, types};
}

const compiled = new Map<ProtocolVersion, VersionSchema>();

/** The validators for a version the check covers, compiled on first use; nothing for another. */
function schemaFor(version: string): VersionSchema | undefined {
  if (!Object.hasOwn(SCHEMAS, version)) {
    return undefined;
  }
  let schema = compiled.get(version);
  if (schema === undefined) {
    schema = compile(SCHEMAS[version]);
    compiled.set(version, schema);
  }
  return schema;
}

/** What the schema check found in one turn. */
export interface SchemaCheckResult {
  /** The version checked against. */
  protocolVersion: ProtocolVersion;
  passed: boolean;
  findings: Finding[];
}

/** One A2UI message the agent sent, with the JSON Pointer to it from the turn. */
export interface AgentMessage {
  message: unknown;
  path: string;
}

/**
 * Runs the schema check on a turn. Nothing when the turn has no protocol
 * version: neither the agent's messages nor the turn event name one.
 */
export function checkSchema(turn: Turn): SchemaCheckResult | undefined {
  const messages = agentMessages(turn);
  const declared = messages.flatMap(({message}) =>
    isObject(message) && typeof message.version === 'string' ? [message.version] : [],
  );
  const protocolVersion =
    declared.find(version => VERSION_FORM.test(version)) ??
    turnEventOf(turn)?.attributes['a2ui.turn.protocol_version'];
  if (protocolVersion === undefined) {
    return undefined;
  }
  const findings = messages.flatMap(({message, path}) => messageFindings(message, path));
  const versions = [...new Set(declared)];
  if (versions.length > 1) {
    findings.push({
      code: 'SCHEMA_VERSIONS_MIXED',
      message: `The agent's messages in this turn declare more than one version: ${versions.join(', ')}.`,
    });
  }
  return {protocolVersion, passed: findings.length === 0, findings};
}

/** The check event for a turn's schema check, under the turn event. */
export function schemaCheckEvent(
  turnEvent: TurnEvent,
  result: SchemaCheckResult,
  ids: {spanId: string; timeUnixNano: bigint},
): CheckEvent {
  return checkEvent(turnEvent, 'schema', result.protocolVersion, {findings: result.findings}, ids);
}

function turnEventOf(turn: Turn): TurnEvent | undefined {
  return turn.events.find(event => isEventOfKind(event, 'turn'));
}

/** The A2UI messages in the turn's wire outputs, in order, each element of an array on its own. */
export function agentMessages(turn: Turn): AgentMessage[] {
  const messages: AgentMessage[] = [];
  turn.events.forEach((event, eventIndex) => {
    if (!isEventOfKind(event, 'wire_output')) {
      return;
    }
    event.attributes['a2ui.wire.message'].parts.forEach((part, partIndex) => {
      if (!isA2uiPart(part)) {
        return;
      }
      const path = `/events/${eventIndex}/attributes/a2ui.wire.message/parts/${partIndex}/content`;
      if (Array.isArray(part.content)) {
        part.content.forEach((message: unknown, index) =>
          messages.push({message, path: `${path}/${index}`}),
        );
      } else {
        messages.push({message: part.content, path});
      }
    });
  });
  return messages;
}

function messageFindings(message: unknown, path: string): Finding[] {
  if (!isObject(message)) {
    return [
      {code: 'SCHEMA_NOT_AN_OBJECT', path, message: 'The A2UI content is not a JSON object.'},
    ];
  }
  const surface = surfaceIdOf(message);
  const finding = (code: string, at: string, text: string): Finding => ({
    code,
    ...(surface !== undefined && {surfaceId: surface}),
    path: at,
    message: text,
  });
  const version = message.version;
  if (typeof version !== 'string') {
    return [finding('SCHEMA_VERSION_MISSING', path, 'The message declares no version.')];
  }
  const schema = schemaFor(version);
  if (schema === undefined) {
    return [
      finding(
        'SCHEMA_VERSION_UNSUPPORTED',
        `${path}/version`,
        `The message declares ${version}; Spectra checks ${CHECKED_VERSIONS.join(', ')}.`,
      ),
    ];
  }
  if (schema.message(message)) {
    return [];
  }
  const keys = [...schema.types.keys()];
  const named = keys.filter(key => Object.hasOwn(message, key));
  if (named.length !== 1) {
    const text =
      named.length === 0
        ? `The message names none of ${version}'s message types: ${keys.join(', ')}.`
        : `The message names more than one message type: ${named.join(', ')}.`;
    return [finding('VALIDATION_FAILED', path, text)];
  }
  const validate = schema.types.get(named[0]) as ValidateFunction;
  validate(message);
  const errors = validate.errors ?? schema.message.errors ?? [];
  return errors.map(error =>
    finding('VALIDATION_FAILED', path + errorPath(error), errorText(error)),
  );
}

/** The JSON Pointer inside the validated value to the offending one: the extra property itself, for one. */
export function errorPath(error: ErrorObject): string {
  const property = extraProperty(error);
  return property === undefined
    ? error.instancePath
    : `${error.instancePath}/${property.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** Ajv's text, naming the property for an additional or unevaluated one. */
export function errorText(error: ErrorObject): string {
  const text = error.message ?? `fails ${error.keyword}`;
  const property = extraProperty(error);
  return property === undefined ? text : `${text}: ${property}`;
}

function extraProperty(error: ErrorObject): string | undefined {
  const params = error.params as {additionalProperty?: string; unevaluatedProperty?: string};
  return params.additionalProperty ?? params.unevaluatedProperty;
}

/** The surface a message names: the `surfaceId` of its first payload that has one. */
function surfaceIdOf(message: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(message)) {
    if (key !== 'version' && isObject(value) && typeof value.surfaceId === 'string') {
      return value.surfaceId;
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
