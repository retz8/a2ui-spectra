/**
 * A v1.0 component's envelope keys as web core reads them at the pin, in
 * `typescript/core/web_core/src/catalog/component_envelope.ts`: `@catalogId`,
 * `@accessibility`, `@metadata` and `@checks`, and during the transition
 * their bare names. A bare name is read as the envelope key where the
 * component's schema declares no property of that name of its own, a bare
 * `checks` only on a component whose schema takes checks; a component
 * carrying both forms of a key is rejected. Below v1.0 none of this applies.
 *
 * Web core reads the layout from the component's schema as web core built it
 * from the catalog's definition; Spectra reads it from the definition itself.
 * The differential test holds the two together, and fails on the bare names
 * once upstream removes its fallback (issue #4082).
 */
import {isObject} from './conversation.js';
import {token} from './pointers.js';
import v1_0Common from './schemas/v1_0/common_types.json' with {type: 'json'};

/** The bare names of the envelope keys, in web core's order. */
export const ENVELOPE_KEYS = ['metadata', 'catalogId', 'accessibility', 'checks'] as const;

export type EnvelopeKey = (typeof ENVELOPE_KEYS)[number];

/** How a component type's schema declares the envelope keys. */
export interface EnvelopeLayout {
  /** The bare names the schema declares as the component's own properties. */
  readonly custom: ReadonlySet<EnvelopeKey>;
  /** Each envelope key the schema declares in the protocol's own shape, with the name it declares it under, such as `@checks`. */
  readonly declared: ReadonlyMap<EnvelopeKey, string>;
}

/** The layout of a component type a definition does not define: nothing declared. */
export const NO_LAYOUT: EnvelopeLayout = {custom: new Set(), declared: new Map()};

/** A property a component's schema declares. */
interface Declaration {
  schema: unknown;
  /** The `properties` block declaring it; none for a property of a protocol mixin such as `Checkable`. */
  block?: Record<string, unknown>;
}

const layouts = new WeakMap<Record<string, unknown>, Map<string, EnvelopeLayout>>();

/** The layout of a component type's schema in a v1.0 definition; `NO_LAYOUT` when the definition does not define the type. */
export function envelopeLayout(definition: Record<string, unknown>, type: string): EnvelopeLayout {
  let byType = layouts.get(definition);
  if (byType === undefined) {
    byType = new Map();
    layouts.set(definition, byType);
  }
  let layout = byType.get(type);
  if (layout === undefined) {
    const components = definition.components;
    layout =
      isObject(components) && Object.hasOwn(components, type)
        ? layoutOf(declarations(components[type], definition))
        : NO_LAYOUT;
    byType.set(type, layout);
  }
  return layout;
}

/**
 * The layout of a component a bare `catalogId` routed, which the bare key
 * routed because the component's schema in the surface's default catalog
 * declares no `catalogId` of its own: the bare key is the envelope key in the
 * catalog it names too, whatever that catalog's schema declares.
 */
export function routedByBareCatalogId(layout: EnvelopeLayout): EnvelopeLayout {
  if (!layout.custom.has('catalogId')) return layout;
  const custom = new Set(layout.custom);
  custom.delete('catalogId');
  return {custom, declared: layout.declared};
}

/** Whether a component carries a key: its value is not `undefined`, a `null` counting. */
export function carries(component: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(component, key) && component[key] !== undefined;
}

/** A v1.0 component's envelope keys, read under its schema's layout. */
export interface EnvelopeReading {
  /** The bare keys read as the envelope keys, in the order the component writes them. */
  readonly legacy: EnvelopeKey[];
  /** The keys the component carries in both forms, in web core's order. */
  readonly both: EnvelopeKey[];
  /**
   * The component as its catalog's schema takes it: each envelope value
   * under the name the schema declares it under, else under its `@` key, and
   * the bare key of a key carried in both forms left out, so that the `@`
   * key's value is the one judged.
   */
  readonly component: Record<string, unknown>;
  /** A JSON Pointer inside `component` as the pointer inside the component as written. */
  written(pointer: string): string;
}

export function readEnvelope(
  component: Record<string, unknown>,
  layout: EnvelopeLayout,
): EnvelopeReading {
  const both = ENVELOPE_KEYS.filter(
    key => carries(component, `@${key}`) && carries(component, key) && !layout.custom.has(key),
  );
  const legacy: EnvelopeKey[] = [];
  const read: Record<string, unknown> = {};
  /** Each name the reading moved a value to, with the key the component wrote it under. */
  const moved = new Map<string, string>();
  for (const [key, value] of Object.entries(component)) {
    let name = key;
    const bare = envelopeKey(key);
    const at = key.startsWith('@') ? envelopeKey(key.slice(1)) : undefined;
    if (bare !== undefined) {
      if (both.includes(bare)) continue;
      const envelope =
        value !== undefined &&
        !layout.custom.has(bare) &&
        (bare !== 'checks' || layout.declared.has('checks'));
      if (envelope) {
        legacy.push(bare);
        name = layout.declared.get(bare) ?? `@${bare}`;
      }
    } else if (at !== undefined) {
      name = layout.declared.get(at) ?? key;
    }
    if (name !== key) moved.set(name, key);
    read[name] = value;
  }
  return {
    legacy,
    both,
    component: read,
    written(pointer) {
      const match = /^\/([^/]*)(.*)$/s.exec(pointer);
      if (match === null) return pointer;
      const first = match[1].replaceAll('~1', '/').replaceAll('~0', '~');
      const original = moved.get(first);
      return original === undefined ? pointer : `/${token(original)}${match[2]}`;
    },
  };
}

function envelopeKey(key: string): EnvelopeKey | undefined {
  return (ENVELOPE_KEYS as readonly string[]).includes(key) ? (key as EnvelopeKey) : undefined;
}

/**
 * Every property a component's schema declares, by name, as web core
 * gathers them: through `allOf`, `anyOf` and `oneOf`, the definition's own
 * `#/` references, and a protocol mixin of the common types, such as
 * `common_types.json#/$defs/Checkable`, whose properties are the protocol's
 * own. A name declared in several places keeps each declaration.
 */
function declarations(
  schema: unknown,
  root: Record<string, unknown>,
  declared = new Map<string, Declaration[]>(),
  seen = new Set<unknown>(),
): Map<string, Declaration[]> {
  if (!isObject(schema) || seen.has(schema)) return declared;
  seen.add(schema);
  const add = (key: string, declaration: Declaration) => {
    const list = declared.get(key);
    if (list === undefined) declared.set(key, [declaration]);
    else list.push(declaration);
  };
  if (typeof schema.$ref === 'string') {
    if (schema.$ref.startsWith('#/')) {
      declarations(resolveLocal(root, schema.$ref), root, declared, seen);
    } else {
      const mixin = commonDefinition(schema.$ref);
      if (isObject(mixin) && isObject(mixin.properties)) {
        for (const [key, property] of Object.entries(mixin.properties)) {
          add(key, {schema: property});
        }
      }
    }
  }
  if (isObject(schema.properties)) {
    for (const [key, property] of Object.entries(schema.properties)) {
      add(key, {schema: property, block: schema.properties});
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      for (const branch of branches) declarations(branch, root, declared, seen);
    }
  }
  return declared;
}

/**
 * The layout the declarations give, as web core's `componentMixinLayout`
 * decides it. Where the schema declares the `@` key, the bare name is the
 * component's own property unless every declaration of it is the protocol's
 * own; elsewhere the bare name is the envelope key, declared under that name,
 * when every declaration of it has the protocol's shape, and the component's
 * own property otherwise.
 */
function layoutOf(declared: Map<string, Declaration[]>): EnvelopeLayout {
  const custom = new Set<EnvelopeKey>();
  const names = new Map<EnvelopeKey, string>();
  for (const key of ENVELOPE_KEYS) {
    const bare = declared.get(key);
    if (declared.has(`@${key}`)) {
      names.set(key, `@${key}`);
      if (bare?.some(declaration => !isProtocolOwn(key, declaration))) custom.add(key);
    } else if (bare !== undefined) {
      if (bare.every(declaration => hasProtocolShape(key, declaration))) names.set(key, key);
      else custom.add(key);
    }
  }
  return {custom, declared: names};
}

/**
 * Whether a declaration is the protocol's own: a protocol mixin's property,
 * or a `catalogId` or `metadata` of an inlined `ComponentCommon`, declared
 * beside `id` in the standard shape, a string `catalogId` or a `metadata`
 * object whose one property is `extensions`.
 */
function isProtocolOwn(key: EnvelopeKey, {schema, block}: Declaration): boolean {
  if (block === undefined) return true;
  if (!Object.hasOwn(block, 'id') || !isObject(schema)) return false;
  switch (key) {
    case 'catalogId':
      return schema.type === 'string';
    case 'metadata':
      return (
        schema.type === 'object' &&
        isObject(schema.properties) &&
        Object.keys(schema.properties).join() === 'extensions'
      );
    default:
      return false;
  }
}

/**
 * Whether a bare name's declaration has the protocol's shape: the
 * protocol's own, a `checks` that is an array of check rules, or an
 * `accessibility` that is the accessibility attributes, each a reference to
 * the common type, as web core resolves any reference by its `$defs` name.
 */
function hasProtocolShape(key: EnvelopeKey, declaration: Declaration): boolean {
  if (isProtocolOwn(key, declaration)) return true;
  const {schema} = declaration;
  if (!isObject(schema)) return false;
  switch (key) {
    case 'checks':
      return (
        schema.type === 'array' &&
        isObject(schema.items) &&
        defName(schema.items.$ref) === 'CheckRule'
      );
    case 'accessibility':
      return defName(schema.$ref) === 'AccessibilityAttributes';
    default:
      return false;
  }
}

/** The `$defs` name a reference names, as web core reads it. */
function defName(ref: unknown): string | undefined {
  return typeof ref === 'string' ? ref.split(/#\/(?:\$defs|definitions)\//)[1] : undefined;
}

/** The common type an outside reference names by its `$defs` name. */
function commonDefinition(ref: string): unknown {
  const name = defName(ref);
  const defs = v1_0Common.$defs as Record<string, unknown>;
  return name !== undefined && Object.hasOwn(defs, name) ? defs[name] : undefined;
}

/** The value a `#/` reference points at inside the definition. */
function resolveLocal(root: Record<string, unknown>, ref: string): unknown {
  let value: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
