/**
 * The catalog registry: every catalog definition Spectra knows. The basic
 * catalogs of v0.9 and v1.0 are built in, copied from upstream at the pin,
 * with the v0.9.1 basic catalog URL a second id of v0.9's; the configured
 * catalogs are read once at start from the config file's paths, each
 * carrying its own `catalogId`; and a turn's host message may carry inline
 * catalogs, which the registry builds on request. The registry gives web
 * core's message processor its catalogs, the message box its offer, and the
 * API its listing.
 */
import {readFile} from 'node:fs/promises';

import {Catalog, type ComponentApi, type FunctionApi} from '@a2ui/web_core/catalog';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';
import {Ajv2020} from 'ajv/dist/2020.js';

import basicV09 from '../check/schemas/v0_9/catalogs/basic/catalog.json' with {type: 'json'};
import catalogDefinition from '../check/schemas/v1_0/catalog_definition.json' with {type: 'json'};
import basicV10 from '../check/schemas/v1_0/catalogs/basic/catalog.json' with {type: 'json'};
import commonTypesV10 from '../check/schemas/v1_0/common_types.json' with {type: 'json'};
import {ConfigError} from '../config.js';

/** The v0.9.1 basic catalog URL, which upstream's v0.9.1 doc writes for the v0.9 basic catalog. */
export const BASIC_CATALOG_V0_9_1 =
  'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';

export type CatalogSource = 'built-in' | 'configured';

/** A definition the registry holds. */
export interface KnownCatalog {
  id: string;
  /** Other ids the definition answers to. */
  aliases: string[];
  /** The protocol version the definition targets, as web core reads it: `0.9` or `1.0`. */
  protocolVersion: string;
  source: CatalogSource;
  /** The configured file the definition was read from. */
  file?: string;
  title?: string;
  definition: Record<string, unknown>;
}

/** The definitions as the API serves them: everything but where the file sits. */
export interface CatalogListing {
  catalogs: Array<Omit<KnownCatalog, 'file'>>;
}

/** The A2UI versions the message box offers under, each its own capabilities key. */
export type OfferedVersion = 'v0.9' | 'v0.9.1' | 'v1.0';

/** The catalog ids the message box advertises under each version. */
export type CatalogOffer = Record<OfferedVersion, string[]>;

/** A catalog as web core's processor takes it. */
export type ProcessorCatalog = Catalog<ComponentApi, FunctionApi>;

let builtInRegistry: CatalogRegistry | undefined;

const validateDefinition = new Ajv2020({strict: false, allErrors: true})
  .addSchema(commonTypesV10)
  .compile(catalogDefinition);
const metaSchema = new Ajv2020({strict: false, allErrors: true});

export class CatalogRegistry {
  /** The built-in definitions first, then the configured ones in config order. */
  readonly known: readonly KnownCatalog[];
  readonly #byId: ReadonlyMap<string, KnownCatalog>;
  readonly #catalogs: readonly ProcessorCatalog[];

  private constructor(known: KnownCatalog[], catalogs: ProcessorCatalog[]) {
    this.known = known;
    this.#catalogs = catalogs;
    this.#byId = new Map(
      known.flatMap(catalog => [catalog.id, ...catalog.aliases].map(id => [id, catalog] as const)),
    );
  }

  /** The registry with the built-in basic catalogs alone, built once. */
  static builtIn(): CatalogRegistry {
    builtInRegistry ??= CatalogRegistry.#builtIn();
    return builtInRegistry;
  }

  static #builtIn(): CatalogRegistry {
    const v09 = basicV09 as Record<string, unknown>;
    const v10 = basicV10 as Record<string, unknown>;
    return new CatalogRegistry(
      [
        {
          id: basicCatalogV09.id,
          aliases: [BASIC_CATALOG_V0_9_1],
          protocolVersion: '0.9',
          source: 'built-in',
          title: v09.title as string,
          definition: v09,
        },
        {
          id: basicCatalogV10.id,
          aliases: [],
          protocolVersion: '1.0',
          source: 'built-in',
          title: v10.title as string,
          definition: v10,
        },
      ],
      [
        basicCatalogV09 as unknown as ProcessorCatalog,
        basicCatalogV10 as unknown as ProcessorCatalog,
        Catalog.fromJson(v09, undefined, BASIC_CATALOG_V0_9_1),
      ],
    );
  }

  /**
   * The registry with the configured definitions read from their files, in
   * order, after the built-in ones. A file that does not load, a definition
   * that fails its version's rules, an id two files carry, and a file that
   * claims a basic catalog's id each stop Spectra at start.
   */
  static async load(files: readonly string[]): Promise<CatalogRegistry> {
    const builtIn = CatalogRegistry.builtIn();
    const known = [...builtIn.known];
    const catalogs = [...builtIn.#catalogs];
    for (const file of files) {
      const {definition, catalog} = await loadDefinition(file);
      const held = known.find(entry => [entry.id, ...entry.aliases].includes(catalog.id));
      if (held?.source === 'built-in') {
        throw new ConfigError(`${file} claims the basic catalog's id '${catalog.id}'.`);
      }
      if (held !== undefined) {
        throw new ConfigError(
          `${file} carries the catalog id '${catalog.id}', which ${held.file} already carries.`,
        );
      }
      known.push({
        id: catalog.id,
        aliases: [],
        protocolVersion: catalog.protocolVersion,
        source: 'configured',
        file,
        ...(typeof definition.title === 'string' && {title: definition.title}),
        definition,
      });
      catalogs.push(catalog);
    }
    return new CatalogRegistry(known, catalogs);
  }

  /** The definition under an id, its aliases included; nothing for an id Spectra does not know. */
  get(id: string): KnownCatalog | undefined {
    return this.#byId.get(id);
  }

  /**
   * The catalogs for web core's processor: web core's own basic catalogs,
   * the v0.9 basic catalog again under its v0.9.1 URL, and each configured
   * definition, built schema-only.
   */
  catalogs(): ProcessorCatalog[] {
    return [...this.#catalogs];
  }

  /**
   * The catalogs a host sent inline in its capabilities, built schema-only
   * under each version's key, with the version the key names. An item whose
   * id the registry knows, or that an earlier item carried, is left out, as
   * is one with no id or one web core cannot load.
   */
  inlineCatalogs(capabilities: Record<string, unknown> | undefined): ProcessorCatalog[] {
    const inline: ProcessorCatalog[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(capabilities ?? {})) {
      const version = key.startsWith('v1.') ? '1.0' : key.startsWith('v0.') ? '0.9' : undefined;
      const items =
        isObject(value) && Array.isArray(value.inlineCatalogs) ? value.inlineCatalogs : [];
      if (version === undefined) continue;
      for (const item of items) {
        if (!isObject(item) || typeof item.catalogId !== 'string') continue;
        const id = item.catalogId;
        if (this.#byId.has(id) || seen.has(id)) continue;
        try {
          inline.push(Catalog.fromJson(item, version));
          seen.add(id);
        } catch {
          // The host's inline definition is the host's; an unloadable one is as if not sent.
        }
      }
    }
    return inline;
  }

  /**
   * The ids the message box advertises under each version: a 0.9 definition
   * under v0.9 and, with its aliases, under v0.9.1; a 1.0 one under v1.0.
   */
  offer(): CatalogOffer {
    const offer: CatalogOffer = {'v0.9': [], 'v0.9.1': [], 'v1.0': []};
    for (const catalog of this.known) {
      if (majorMinor(catalog.protocolVersion) === '0.9') {
        offer['v0.9'].push(catalog.id);
        offer['v0.9.1'].push(catalog.id, ...catalog.aliases);
      } else if (majorMinor(catalog.protocolVersion) === '1.0') {
        offer['v1.0'].push(catalog.id, ...catalog.aliases);
      }
    }
    return offer;
  }

  /** The definitions as the API serves them. */
  listing(): CatalogListing {
    return {
      catalogs: this.known.map(({file: _file, ...catalog}) => catalog),
    };
  }
}

/** A configured definition read from its file, validated for its version and built. */
async function loadDefinition(
  file: string,
): Promise<{definition: Record<string, unknown>; catalog: ProcessorCatalog}> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigError(`The catalog ${file} does not exist.`);
    }
    throw new ConfigError(`${file} cannot be read: ${describe(error)}.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${describe(error)}.`);
  }
  if (!isObject(json)) {
    throw new ConfigError(`${file} must hold a JSON object.`);
  }
  if (typeof json.catalogId !== 'string' || json.catalogId === '') {
    throw new ConfigError(`${file} names no catalogId.`);
  }
  const declared = typeof json.protocolVersion === 'string' ? json.protocolVersion : undefined;
  if (declared !== undefined && Number(majorMinor(declared)?.split('.')[0]) >= 1) {
    if (!validateDefinition(json)) {
      throw new ConfigError(
        `${file} is not a 1.0 catalog definition: ${metaSchema.errorsText(validateDefinition.errors, {dataVar: ''})}.`,
      );
    }
  } else {
    let valid: boolean | Promise<unknown>;
    try {
      valid = metaSchema.validateSchema(json);
    } catch (error) {
      throw new ConfigError(`${file} is not a JSON Schema: ${describe(error)}.`);
    }
    if (valid !== true) {
      throw new ConfigError(
        `${file} is not a JSON Schema: ${metaSchema.errorsText(metaSchema.errors, {dataVar: ''})}.`,
      );
    }
  }
  let catalog: ProcessorCatalog;
  try {
    catalog = Catalog.fromJson(json);
  } catch (error) {
    throw new ConfigError(`${file} cannot be loaded as a catalog: ${describe(error)}.`);
  }
  for (const name of Object.keys(isObject(json.components) ? json.components : {})) {
    if (!catalog.components.has(name)) {
      throw new ConfigError(
        `${file}: the component '${name}' is not listed under $defs.anyComponent, so it would not be known.`,
      );
    }
  }
  for (const name of functionNames(json.functions)) {
    if (!catalog.functions.has(name)) {
      throw new ConfigError(
        `${file}: the function '${name}' is not listed under $defs.anyFunction, so it would not be known.`,
      );
    }
  }
  return {definition: json, catalog};
}

/** The names a definition's `functions` carry, as a map or as the legacy list. */
function functionNames(functions: unknown): string[] {
  if (Array.isArray(functions)) {
    return functions.flatMap(entry =>
      isObject(entry) && typeof entry.name === 'string' ? [entry.name] : [],
    );
  }
  return isObject(functions) ? Object.keys(functions) : [];
}

function majorMinor(version: string): string | undefined {
  return /^(\d+\.\d+)(?:\.\d+)?$/.exec(version.trim())?.[1];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
