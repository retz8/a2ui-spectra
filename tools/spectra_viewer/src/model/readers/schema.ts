/**
 * Upstream's schema helpers at the pin, carried by hand: how a component's
 * positional arguments fill its properties, and whether it holds children,
 * read from a catalog's definition as Python's `CatalogSchemaHelper`
 * (`a2ui/inference_formats/_shared/schema_helper.py`) and TypeScript's
 * (`inference-formats/express/schema-helper.ts`) read it, with the Express
 * compilers' removal of the check property from the positional arguments.
 */
import type {ReaderSdk} from './reading.ts';

type Schema = Record<string, unknown>;

/** What a reader needs of one component's definition. */
export interface ComponentShape {
  /** The properties positional arguments fill, in order, the check property left out. */
  positional: readonly string[];
  /** Whether it holds child components: a child list or a single child property. */
  container: boolean;
}

/** What a reader needs of one catalog's definition. */
export interface CatalogShape {
  components: ReadonlyMap<string, ComponentShape>;
  /** Whether a bare string child can be wrapped in one of its components, as Python's Atom compiler has it. */
  hasTextComponent: boolean;
}

const ENVELOPE_NAMES = ['catalogId', 'metadata', 'accessibility', 'checks'] as const;
const AT_ENVELOPE_KEYS = ENVELOPE_NAMES.map(name => `@${name}`);
const STANDARD_CATALOG_ID_DESCRIPTION =
  'The catalog ID for this component, overriding any surface-level default catalogId.';
const STANDARD_METADATA_DESCRIPTION = 'Optional component-level metadata for vendor extensions.';
const TEXT_PROP_NAMES = ['text', 'content', 'label', 'title'];

/**
 * The common type names Python keeps as references when it writes a
 * catalog's local `#/$defs/` references inline: its `PRESERVED_TYPE_REFS`
 * at the pin, the schema module's type names.
 */
const PRESERVED_TYPE_REFS = new Set([
  'AccessibilityAttributes',
  'Action',
  'ActionEvent',
  'ActionEventWrapper',
  'ActionFunctionCallWrapper',
  'CallId',
  'CheckRule',
  'Checkable',
  'Child',
  'ChildList',
  'ComponentCommon',
  'ComponentCommonMetadata',
  'ComponentId',
  'ComponentReference',
  'DataBinding',
  'DynamicBoolean',
  'DynamicNumber',
  'DynamicString',
  'DynamicStringList',
  'DynamicValue',
  'Extensions',
  'FunctionCall',
  'FunctionCommon',
  'FunctionResponse',
  'FunctionResponseError',
  'IndexSystemFunction',
  'IndexSystemFunctionArgs',
  'ListReference',
  'LiteralObject',
  'OpenObject',
  'ReturnType',
  'SingleReference',
  'Surface',
  'TemplateChildList',
]);

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertiesOf(schema: Schema): Schema | undefined {
  return isSchema(schema.properties) ? schema.properties : undefined;
}

function pointerOf(root: Schema, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const part of pointer.slice(2).split('/')) {
    if (!isSchema(current)) return undefined;
    current = current[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current;
}

/** The common type a `$ref` names, as TypeScript's `commonDefName` reads it. */
function commonDefName(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  return /(?:^|\/)common_types\.json#\/(?:\$defs|definitions)\/(\w+)$/.exec(ref)?.[1];
}

/**
 * A schema with its local references written inline, as Python's
 * `inline_local_refs` writes them: each `#/` reference replaced by what it
 * points to, the keys beside it merged over, a preserved common type name
 * and a reference to itself kept.
 */
function inlineLocalRefs(node: unknown, root: Schema, visited: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map(item => inlineLocalRefs(item, root, visited));
  if (!isSchema(node)) return node;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    const name = ref.split('/').pop()!;
    if (ref.startsWith('#/$defs/') && PRESERVED_TYPE_REFS.has(name)) return node;
    if (visited.has(ref)) return node;
    const target = pointerOf(root, ref);
    if (target !== undefined && target !== null) {
      const resolved = inlineLocalRefs(target, root, new Set([...visited, ref]));
      const merged: Schema = {};
      for (const [key, value] of Object.entries(node)) {
        if (key !== '$ref') merged[key] = inlineLocalRefs(value, root, visited);
      }
      if (!isSchema(resolved)) return resolved;
      const result: Schema = {...resolved};
      for (const [key, value] of Object.entries(merged)) {
        const existing = result[key];
        if (isSchema(existing) && isSchema(value)) result[key] = {...existing, ...value};
        else if (Array.isArray(existing) && Array.isArray(value)) {
          result[key] = [...existing, ...value.filter(item => !existing.includes(item))];
        } else result[key] = value;
      }
      return result;
    }
  }
  const result: Schema = {};
  for (const [key, value] of Object.entries(node))
    result[key] = inlineLocalRefs(value, root, visited);
  return result;
}

/**
 * Python's sub-schemas of a component: the schema and its nested `allOf`
 * entries in pre-order, those whose properties declare `component` before
 * the others, the root among the others only when it has properties,
 * `required` or a `$ref`.
 */
function pythonSubSchemas(schema: Schema): Schema[] {
  const specific: Schema[] = [];
  const common: Schema[] = [];
  const visit = (node: unknown, isRoot: boolean) => {
    if (!isSchema(node)) return;
    const props = propertiesOf(node);
    if (props !== undefined && 'component' in props) specific.push(node);
    else if (!isRoot || props !== undefined || 'required' in node || '$ref' in node) {
      common.push(node);
    }
    if (Array.isArray(node.allOf)) for (const sub of node.allOf) visit(sub, false);
  };
  visit(schema, true);
  return [...specific, ...common];
}

/**
 * TypeScript's sub-schemas of a component: the schema itself, then its
 * `allOf` entries that declare `component`, then the others, each local
 * reference resolved and each expanded depth first with its own `allOf`.
 */
function typescriptSubSchemas(schema: Schema, root: Schema): Schema[] {
  const resolve = (sub: unknown): unknown => {
    if (isSchema(sub) && typeof sub.$ref === 'string' && sub.$ref.startsWith('#/')) {
      const target = pointerOf(root, sub.$ref);
      if (isSchema(target)) return target;
    }
    return sub;
  };
  const specific: Schema[] = [];
  const inherited: Schema[] = [];
  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      const sub = resolve(entry);
      if (!isSchema(sub)) continue;
      const props = propertiesOf(sub);
      (props !== undefined && 'component' in props ? specific : inherited).push(sub);
    }
  }
  const expanded: Schema[] = [schema];
  const visited = new Set<Schema>([schema]);
  const expand = (node: Schema) => {
    const target = resolve(node);
    if (!isSchema(target) || visited.has(target)) return;
    visited.add(target);
    expanded.push(target);
    if (Array.isArray(target.allOf)) {
      for (const child of target.allOf) if (isSchema(child)) expand(child);
    }
  };
  for (const sub of [...specific, ...inherited]) expand(sub);
  return expanded;
}

/** Every property of the sub-schemas, the first definition winning, in order of first declaration. */
function propertiesIn(subs: readonly Schema[]): Map<string, unknown> {
  const props = new Map<string, unknown>();
  for (const sub of subs) {
    for (const [key, value] of Object.entries(propertiesOf(sub) ?? {})) {
      if (!props.has(key)) props.set(key, value);
    }
  }
  return props;
}

function requiredIn(subs: readonly Schema[]): string[] {
  const required: string[] = [];
  for (const sub of subs) {
    if (!Array.isArray(sub.required)) continue;
    for (const name of sub.required) {
      if (typeof name === 'string' && !required.includes(name)) required.push(name);
    }
  }
  return required;
}

/** Python's `_is_standard_checks_schema`: the `Checkable` mixin, or items that are check rules. */
function isPythonStandardChecks(schema: unknown): boolean {
  if (!isSchema(schema)) return false;
  if (typeof schema.$ref === 'string' && schema.$ref.endsWith('/Checkable')) return true;
  return isSchema(schema.items) && typeof schema.items.$ref === 'string'
    ? schema.items.$ref.endsWith('/CheckRule')
    : false;
}

/** TypeScript's `isCheckRuleArraySchema`: an array whose items are the common check rule. */
function isTypescriptCheckRuleArray(schema: unknown): boolean {
  return (
    isSchema(schema) &&
    schema.type === 'array' &&
    isSchema(schema.items) &&
    commonDefName(schema.items.$ref) === 'CheckRule'
  );
}

/** A component's ordered properties and the property its checks go to, as Python reads them. */
function pythonProperties(schema: Schema): {
  ordered: string[];
  custom: Set<string>;
  required: string[];
  subs: Schema[];
} {
  const subs = pythonSubSchemas(schema);
  const props = propertiesIn(subs);
  let checkable = subs.some(sub => typeof sub.$ref === 'string' && sub.$ref.includes('Checkable'));
  if (props.has('@checks') || isPythonStandardChecks(props.get('checks'))) checkable = true;
  const custom = new Set<string>(ENVELOPE_NAMES.filter(name => props.has(name)));
  if (isPythonStandardChecks(props.get('checks'))) custom.delete('checks');
  const catalogId = props.get('catalogId');
  if (isSchema(catalogId) && catalogId.description === STANDARD_CATALOG_ID_DESCRIPTION) {
    custom.delete('catalogId');
  }
  const metadata = props.get('metadata');
  if (
    isSchema(metadata) &&
    isSchema(metadata.properties) &&
    Object.keys(metadata.properties).length === 1 &&
    'extensions' in metadata.properties &&
    metadata.additionalProperties === false
  ) {
    custom.delete('metadata');
  }
  const accessibility = props.get('accessibility');
  if (
    isSchema(accessibility) &&
    (String(accessibility.$ref ?? '').endsWith('/AccessibilityAttributes') ||
      (isSchema(accessibility.properties) &&
        'label' in accessibility.properties &&
        'description' in accessibility.properties &&
        accessibility.additionalProperties === false))
  ) {
    custom.delete('accessibility');
  }
  const excluded = new Set(['component', 'id', ...AT_ENVELOPE_KEYS]);
  for (const name of ['catalogId', 'metadata', 'accessibility']) {
    if (!custom.has(name)) excluded.add(name);
  }
  if (checkable && !custom.has('checks')) excluded.add('checks');
  const ordered = [...props.keys()].filter(key => !excluded.has(key));
  if (checkable && !custom.has('checks')) ordered.push('checks');
  return {ordered, custom, required: requiredIn(subs), subs};
}

/** The positional properties of a component, as the parse's SDK's Express compiler fills them. */
function positionalOf(schema: Schema, root: Schema, sdk: ReaderSdk): string[] {
  if (sdk === 'python') {
    const {ordered, custom} = pythonProperties(schema);
    return custom.has('checks') ? ordered : ordered.filter(key => key !== 'checks');
  }
  const subs = typescriptSubSchemas(schema, root);
  let ownCheckProp: string | undefined;
  for (const sub of subs) {
    if (sub.$ref) continue;
    for (const [key, value] of Object.entries(propertiesOf(sub) ?? {})) {
      if (isTypescriptCheckRuleArray(value)) {
        ownCheckProp = key === '@checks' ? 'checks' : key;
        break;
      }
    }
    if (ownCheckProp !== undefined) break;
  }
  // The common types' only mixin with an array of check rules is `Checkable`, in every version.
  const inheritedCheckProp =
    ownCheckProp === undefined && subs.some(sub => commonDefName(sub.$ref) === 'Checkable')
      ? 'checks'
      : undefined;
  const props = propertiesIn(subs);
  const standardCheckable = ownCheckProp === 'checks' || inheritedCheckProp === 'checks';
  const custom = new Set<string>(ENVELOPE_NAMES.filter(name => props.has(name)));
  if (isTypescriptCheckRuleArray(props.get('checks'))) custom.delete('checks');
  const catalogId = props.get('catalogId');
  if (isSchema(catalogId) && catalogId.description === STANDARD_CATALOG_ID_DESCRIPTION) {
    custom.delete('catalogId');
  }
  const metadata = props.get('metadata');
  if (
    isSchema(metadata) &&
    (metadata.description === STANDARD_METADATA_DESCRIPTION ||
      (isSchema(metadata.properties) &&
        isSchema(metadata.properties.extensions) &&
        commonDefName(metadata.properties.extensions.$ref) === 'Extensions'))
  ) {
    custom.delete('metadata');
  }
  const accessibility = props.get('accessibility');
  if (isSchema(accessibility) && commonDefName(accessibility.$ref) === 'AccessibilityAttributes') {
    custom.delete('accessibility');
  }
  const excluded = new Set(['component', 'id', ...AT_ENVELOPE_KEYS]);
  for (const name of ['catalogId', 'metadata', 'accessibility']) {
    if (!custom.has(name)) excluded.add(name);
  }
  if (standardCheckable && !custom.has('checks')) excluded.add('checks');
  const ordered = [...props.keys()].filter(key => !excluded.has(key));
  if (standardCheckable && !custom.has('checks')) ordered.push('checks');
  else if (
    inheritedCheckProp !== undefined &&
    !custom.has(inheritedCheckProp) &&
    !ordered.includes(inheritedCheckProp)
  ) {
    ordered.push(inheritedCheckProp);
  }
  const checkProp = ownCheckProp ?? inheritedCheckProp;
  return checkProp !== undefined && !custom.has(checkProp)
    ? ordered.filter(key => key !== checkProp)
    : ordered;
}

/** Python's `get_property_type`: `ChildList`, `Child` or `Action`, by the `$ref` a property's schema holds. */
function refKindOf(schema: unknown): 'ChildList' | 'Child' | 'Action' | undefined {
  if (!isSchema(schema)) return undefined;
  if (typeof schema.$ref === 'string') {
    if (schema.$ref.includes('ChildList')) return 'ChildList';
    if (schema.$ref.includes('Child') || schema.$ref.includes('ComponentId')) return 'Child';
    if (schema.$ref.includes('Action')) return 'Action';
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const subs = schema[key];
    if (!Array.isArray(subs)) continue;
    for (const sub of subs) {
      const kind = refKindOf(sub);
      if (kind !== undefined) return kind;
    }
  }
  return undefined;
}

/**
 * Whether a component holds children, as Python's Atom compiler's
 * `child_props` reads it: a property of its own order whose schema is a
 * child list or a child, or one named `children` or `child`.
 */
function isContainer(schema: Schema, ordered: readonly string[], subs: readonly Schema[]): boolean {
  // Python's `get_property_schema`: the component's own definition, else the first sub-schema's.
  const schemaOf = (key: string): unknown => {
    for (const source of [schema, ...subs]) {
      const props = propertiesOf(source);
      if (props !== undefined && key in props) return props[key];
    }
    return undefined;
  };
  return ordered
    .filter(key => !['id', 'component', 'catalogId'].includes(key))
    .some(key => {
      if (key === 'children' || key === 'child') return true;
      const kind = refKindOf(schemaOf(key));
      return kind === 'ChildList' || kind === 'Child';
    });
}

/** The shapes a catalog's definition gives its components, for the parse's SDK. */
export function catalogShapeOf(definition: Record<string, unknown>, sdk: ReaderSdk): CatalogShape {
  const inlined = inlineLocalRefs(definition, definition, new Set()) as Schema;
  const raw = isSchema(definition.components) ? definition.components : {};
  const components = isSchema(inlined.components) ? inlined.components : {};
  const shapes = new Map<string, ComponentShape>();
  let hasTextComponent = false;
  for (const [name, schema] of Object.entries(components)) {
    if (!isSchema(schema)) continue;
    const python = pythonProperties(schema);
    const rawSchema = raw[name];
    shapes.set(name, {
      positional:
        sdk === 'python' || !isSchema(rawSchema)
          ? positionalOf(schema, inlined, 'python')
          : positionalOf(rawSchema, definition, 'typescript'),
      container: isContainer(schema, python.ordered, python.subs),
    });
    // Python's `_text_component`: the only required property, else the only property, is a text name.
    const props = python.ordered.filter(key => !['id', 'component', 'catalogId'].includes(key));
    const required = python.required.filter(key => !['id', 'component', 'catalogId'].includes(key));
    const prop = required.length === 1 ? required[0] : props.length === 1 ? props[0] : undefined;
    if (prop !== undefined && TEXT_PROP_NAMES.includes(prop)) hasTextComponent = true;
  }
  return {components: shapes, hasTextComponent};
}
