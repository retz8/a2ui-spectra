/**
 * The catalog check: each component the agent sent, in `updateComponents`
 * and in a v1.0 `createSurface`, validated against its catalog's definition
 * with Ajv, the real catalog bound where the schema check binds a stand-in,
 * and cut to the branch of the component's own type, as the schema check
 * cuts a message to its own message type. A function call inside a component
 * is cut to its own function's branch the same way, and a v0.9 surface's
 * theme is validated against the catalog's theme.
 *
 * A component's catalog is its own `catalogId` in v1.0 when it names one,
 * else the one its surface's `createSurface` named. A surface whose catalog
 * has no definition, and one no `createSurface` named, are skipped and say why.
 */
import {Ajv2020, type AnySchemaObject, type ValidateFunction} from 'ajv/dist/2020.js';

import type {Finding} from '../record/turn_record.js';
import type {CheckResult} from './check_event.js';
import {type Conversation, isObject, type ResolvedCatalog} from './conversation.js';
import {dynamicKeys, dynamicValues} from './dynamic.js';
import {token} from './pointers.js';
import {errorPath, errorText} from './schema_check.js';
import {SkippedList, skippedSurface} from './skipped.js';
import v0_9Common from './schemas/v0_9/common_types.json' with {type: 'json'};
import v0_9 from './schemas/v0_9/server_to_client.json' with {type: 'json'};
import v1_0 from './schemas/v1_0/agent_to_renderer.json' with {type: 'json'};
import v1_0Common from './schemas/v1_0/common_types.json' with {type: 'json'};

/** The protocol family a definition and its messages belong to. */
type Family = '0.9' | '1.0';

/**
 * What the common types reference as the catalog's `anyFunction` while a
 * component is validated: any object naming a call, its properties counted as
 * evaluated, and in v1.0 any call but the system index function, which has
 * its own branch beside the catalog's. Function calls are judged on their
 * own, each against its own function's branch.
 */
const FUNCTION_STAND_IN: Record<Family, AnySchemaObject> = {
  '0.9': {type: 'object', required: ['call'], unevaluatedProperties: true},
  '1.0': {
    type: 'object',
    required: ['@call'],
    properties: {'@call': {not: {const: '@index'}}},
    unevaluatedProperties: true,
  },
};

export function checkCatalog(conversation: Conversation): CheckResult {
  const findings: Finding[] = [];
  const skipped = new SkippedList();
  const judged = new Map<string, ResolvedCatalog | undefined>();
  const surfaceCatalog = (surfaceId: string): ResolvedCatalog | undefined => {
    if (!judged.has(surfaceId)) judged.set(surfaceId, judge(conversation, surfaceId, skipped));
    return judged.get(surfaceId);
  };
  for (const {type, surfaceId, path, message, version} of conversation.own) {
    if (surfaceId === undefined || type === undefined || !isObject(message)) continue;
    if (type !== 'updateComponents' && type !== 'createSurface') continue;
    const body = message[type];
    if (!isObject(body)) continue;
    const resolved = surfaceCatalog(surfaceId);
    const family = familyOf(version);
    if (Array.isArray(body.components)) {
      body.components.forEach((component: unknown, index) => {
        if (!isObject(component)) return;
        const pointer = `${path}/${type}/components/${index}`;
        let catalog = resolved;
        if (family === '1.0' && typeof component.catalogId === 'string') {
          catalog = conversation.resolve(component.catalogId);
          if (catalog === undefined) {
            skipped.add(skippedSurface(surfaceId, component.catalogId, 'no_definition'));
          }
        }
        if (catalog !== undefined) {
          findings.push(...componentFindings(component, pointer, catalog, version, surfaceId));
        }
      });
    }
    if (type === 'createSurface' && resolved !== undefined && family === '0.9' && 'theme' in body) {
      const theme = validatorsFor(resolved).theme();
      if (theme !== undefined && !theme(body.theme)) {
        for (const error of theme.errors ?? []) {
          findings.push({
            code: 'VALIDATION_FAILED',
            surfaceId,
            path: `${path}/createSurface/theme${errorPath(error)}`,
            message: errorText(error),
          });
        }
      }
    }
  }
  return {findings, skipped: skipped.list};
}

/**
 * The catalog a surface's messages are judged against: the one its
 * `createSurface` named, whether or not web core accepted that message, since
 * the check judges each message as sent. Nothing, with the surface skipped,
 * when no `createSurface` of the conversation named the surface or its
 * catalog has no definition. A surface the turn deleted is passed over.
 */
function judge(
  conversation: Conversation,
  surfaceId: string,
  skipped: SkippedList,
): ResolvedCatalog | undefined {
  if (conversation.deletedByTurn.has(surfaceId)) return undefined;
  const catalogId = conversation.catalogIdOf.get(surfaceId);
  if (!conversation.created.has(surfaceId)) {
    skipped.add(skippedSurface(surfaceId, catalogId, 'not_created'));
    return undefined;
  }
  const resolved = catalogId === undefined ? undefined : conversation.resolve(catalogId);
  if (resolved === undefined) skipped.add(skippedSurface(surfaceId, catalogId, 'no_definition'));
  return resolved;
}

/** One component's findings: against its type's branch, then each function call against its function's. */
function componentFindings(
  component: Record<string, unknown>,
  pointer: string,
  resolved: ResolvedCatalog,
  version: string | undefined,
  surfaceId: string,
): Finding[] {
  const type = component.component;
  if (typeof type !== 'string') return [];
  const validators = validatorsFor(resolved);
  const validate = validators.component(type);
  if (validate === undefined) {
    return [
      {
        code: 'COMPONENT_UNKNOWN',
        surfaceId,
        path: `${pointer}/component`,
        message: `The catalog ${resolved.id} defines no component '${type}'.`,
      },
    ];
  }
  const findings: Finding[] = [];
  if (!validate(component)) {
    for (const error of validate.errors ?? []) {
      findings.push({
        code: 'VALIDATION_FAILED',
        surfaceId,
        path: pointer + errorPath(error),
        message: errorText(error),
      });
    }
  }
  const api = resolved.catalog.components.get(type);
  if (api === undefined) return findings;
  const keys = dynamicKeys(version);
  for (const value of dynamicValues(component, api, version)) {
    if (value.kind !== 'call') continue;
    const fn = validators.fn(value.name);
    if (fn === undefined) {
      findings.push({
        code: 'FUNCTION_UNKNOWN',
        surfaceId,
        path: `${pointer}${value.pointer}/${token(keys.call)}`,
        message: `The catalog ${resolved.id} defines no function '${value.name}'.`,
      });
    } else if (!fn(value.call)) {
      for (const error of fn.errors ?? []) {
        findings.push({
          code: 'VALIDATION_FAILED',
          surfaceId,
          path: `${pointer}${value.pointer}${errorPath(error)}`,
          message: errorText(error),
        });
      }
    }
  }
  return findings;
}

function familyOf(version: string | undefined): Family {
  return version !== undefined && /^v?1\./.test(version) ? '1.0' : '0.9';
}

const validators = new WeakMap<Record<string, unknown>, CatalogValidators>();

/** The validators for a definition, built once per definition object. */
function validatorsFor(resolved: ResolvedCatalog): CatalogValidators {
  let built = validators.get(resolved.definition);
  if (built === undefined) {
    built = new CatalogValidators(resolved.definition, familyOf(resolved.protocolVersion));
    validators.set(resolved.definition, built);
  }
  return built;
}

/**
 * One definition bound into Ajv under the URL the protocol schemas reference
 * as `catalog.json`, beside the version's common types. The definition is
 * bound without its own `$id`, so its relative references, `common_types.json`
 * in a v1.0 definition, resolve beside the protocol schemas, as the common
 * types' own `catalog.json` reference resolves to it. Validators are compiled
 * on first use, one per component type and per function.
 */
class CatalogValidators {
  readonly #ajv: Ajv2020;
  readonly #family: Family;
  readonly #definition: Record<string, unknown>;
  /** The URL the definition is bound under. */
  readonly #url: string;
  readonly #commonUrl: string;
  readonly #components = new Map<string, ValidateFunction | undefined>();
  readonly #functions = new Map<string, ValidateFunction | undefined>();
  #theme: ValidateFunction | null | undefined;

  constructor(definition: Record<string, unknown>, family: Family) {
    this.#family = family;
    this.#definition = definition;
    // Strict mode off and formats unchecked, as upstream's own schema tests run Ajv.
    this.#ajv = new Ajv2020({strict: false, allErrors: true, validateFormats: false});
    const [envelope, common] = family === '1.0' ? [v1_0, v1_0Common] : [v0_9, v0_9Common];
    this.#ajv.addSchema(common as AnySchemaObject);
    this.#commonUrl = common.$id;
    this.#url = new URL('catalog.json', envelope.$id).href;
    const {$id: _id, ...rest} = definition;
    const bound = {
      ...rest,
      $defs: {
        ...(isObject(definition.$defs) ? definition.$defs : {}),
        anyFunction: FUNCTION_STAND_IN[family],
      },
    };
    this.#ajv.addSchema(bound as AnySchemaObject, this.#url);
  }

  /** The validator for a component of this type; nothing when the definition has no such component. */
  component(type: string): ValidateFunction | undefined {
    if (!this.#components.has(type)) {
      const components = this.#definition.components;
      const known = isObject(components) && Object.hasOwn(components, type);
      const branch = `${this.#url}#/components/${token(type)}`;
      this.#components.set(
        type,
        !known
          ? undefined
          : this.#compile(
              this.#family === '1.0'
                ? {
                    allOf: [
                      {$ref: `${this.#commonUrl}#/$defs/ComponentCommon`},
                      {$ref: branch},
                      {type: 'object', properties: {component: {not: {const: 'Surface'}}}},
                    ],
                    unevaluatedProperties: false,
                  }
                : {$ref: branch},
            ),
      );
    }
    return this.#components.get(type);
  }

  /** The validator for a call of this function; nothing when the definition has no such function. */
  fn(name: string): ValidateFunction | undefined {
    if (!this.#functions.has(name)) {
      const branch = this.#functionBranch(name);
      this.#functions.set(
        name,
        branch === undefined
          ? undefined
          : this.#compile(
              this.#family === '1.0'
                ? {
                    allOf: [{$ref: `${this.#commonUrl}#/$defs/FunctionCommon`}, {$ref: branch}],
                    unevaluatedProperties: false,
                  }
                : {$ref: branch},
            ),
      );
    }
    return this.#functions.get(name);
  }

  /** The validator for a v0.9 surface's theme; nothing when the definition defines none. */
  theme(): ValidateFunction | undefined {
    if (this.#theme === undefined) {
      const defs = this.#definition.$defs;
      this.#theme =
        isObject(defs) && 'theme' in defs
          ? this.#compile({$ref: `${this.#url}#/$defs/theme`})
          : null;
    }
    return this.#theme ?? undefined;
  }

  /** The reference to a function's own schema: an entry of the `functions` map, or an item of the legacy list. */
  #functionBranch(name: string): string | undefined {
    if (this.#family === '1.0' && name === '@index') {
      return `${this.#commonUrl}#/$defs/IndexSystemFunction`;
    }
    const functions = this.#definition.functions;
    if (isObject(functions) && Object.hasOwn(functions, name)) {
      return `${this.#url}#/functions/${token(name)}`;
    }
    if (Array.isArray(functions)) {
      const index = functions.findIndex(entry => isObject(entry) && entry.name === name);
      if (index >= 0) return `${this.#url}#/functions/${index}`;
    }
    return undefined;
  }

  /** Compiles a schema against the bound definition; a definition whose own schemas do not compile is an error of the checks. */
  #compile(schema: AnySchemaObject): ValidateFunction {
    try {
      return this.#ajv.compile(schema);
    } catch (error) {
      const id =
        typeof this.#definition.catalogId === 'string' ? this.#definition.catalogId : 'the catalog';
      throw new Error(
        `The definition of ${id} does not compile: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
