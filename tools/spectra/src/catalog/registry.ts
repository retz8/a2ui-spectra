/**
 * The catalog registry: every catalog definition Spectra knows. The basic
 * catalogs of v0.9 and v1.0 are built in, copied from upstream at the pin,
 * with the v0.9.1 basic catalog URL a second id of v0.9's; the configured
 * catalogs are read at start from the config file's paths, each carrying its
 * own `catalogId`, and read again when a file changes; and a turn's host
 * message may carry inline catalogs, which the registry builds on request.
 * The registry gives web core's message processor its catalogs, the message
 * box its offer, and the API its listing, each as the definitions stand.
 */
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

import {Catalog, type ComponentApi, type FunctionApi} from '@a2ui/web_core/catalog';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';
import {Ajv2020} from 'ajv/dist/2020.js';

import basicV09 from '../check/schemas/v0_9/catalogs/basic/catalog.json' with {type: 'json'};
import catalogDefinition from '../check/schemas/v1_0/catalog_definition.json' with {type: 'json'};
import basicV10 from '../check/schemas/v1_0/catalogs/basic/catalog.json' with {type: 'json'};
import commonTypesV10 from '../check/schemas/v1_0/common_types.json' with {type: 'json'};
import {ConfigError} from '../config.js';
import {recordFormOf} from '../record/turn_record.js';

/** The v0.9.1 basic catalog URL, which upstream's v0.9.1 doc writes for the v0.9 basic catalog. */
export const BASIC_CATALOG_V0_9_1 =
  'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';

export type CatalogSource = 'built-in' | 'configured';

/** A configured catalog file: where it sits, and its path as the config file names it. */
export interface ConfiguredFile {
  file: string;
  path: string;
}

/** A read of a configured file that failed, the definition read before staying in force. */
export interface FailedRead {
  /** As an ISO 8601 UTC time to the millisecond. */
  time: string;
  /** The reason alone, without the file's path. */
  error: string;
}

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
  /** The configured file's path as the config file names it. */
  path?: string;
  /** When the definition in force was read from its file, as an ISO 8601 UTC time to the millisecond. */
  readTime?: string;
  /** The file's latest read, while it stands failed. */
  failedRead?: FailedRead;
  title?: string;
  definition: Record<string, unknown>;
}

/**
 * What reading a configured file again did: nothing, when it gave the
 * definition in force; replaced the definition, under a new id when the file
 * names one; or failed, the definition read before staying in force.
 */
export type Reread =
  | {kind: 'unchanged'}
  | {kind: 'read'; id: string; previousId?: string}
  | {kind: 'failed'; error: string};

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

/** A catalog a host sent inline: its definition as sent, and the catalog built from it. */
export interface InlineDefinition {
  id: string;
  /** `0.9` or `1.0`, from the capabilities key the item sat under. */
  protocolVersion: string;
  definition: Record<string, unknown>;
  catalog: ProcessorCatalog;
}

/**
 * What the terminal says of a configured file read again, the file named as
 * the config file names it: nothing for a read that changed nothing, and an
 * error line for one that failed.
 */
export function rereadLine(path: string, reread: Reread): {line: string; error?: true} | undefined {
  if (reread.kind === 'unchanged') return undefined;
  if (reread.kind === 'failed') {
    return {
      line: `${path} changed and did not read: ${reread.error}. The definition read before stays in force.`,
      error: true,
    };
  }
  return {
    line:
      `${path} changed. Its catalog definition was read again.` +
      (reread.previousId === undefined
        ? ''
        : ` Its catalog id is now ${reread.id}, no longer ${reread.previousId}.`),
  };
}

let builtInRegistry: CatalogRegistry | undefined;

const validateDefinition = new Ajv2020({strict: false, allErrors: true})
  .addSchema(commonTypesV10)
  .compile(catalogDefinition);
const metaSchema = new Ajv2020({strict: false, allErrors: true});

export class CatalogRegistry {
  readonly #basic: readonly KnownCatalog[];
  readonly #builtInCatalogs: readonly ProcessorCatalog[];
  /** The configured definitions in config order, each with the catalog built from it. */
  readonly #configured: Array<{known: KnownCatalog; catalog: ProcessorCatalog}> = [];
  readonly #now: () => Date;

  private constructor(
    builtIn: readonly KnownCatalog[],
    catalogs: readonly ProcessorCatalog[],
    now: () => Date = () => new Date(),
  ) {
    this.#basic = builtIn;
    this.#builtInCatalogs = catalogs;
    this.#now = now;
  }

  /** The built-in definitions first, then the configured ones in config order. */
  get known(): readonly KnownCatalog[] {
    return [...this.#basic, ...this.#configured.map(entry => entry.known)];
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
  static async load(
    files: ReadonlyArray<string | ConfiguredFile>,
    options: {now?: () => Date} = {},
  ): Promise<CatalogRegistry> {
    const builtIn = CatalogRegistry.builtIn();
    const registry = new CatalogRegistry(builtIn.#basic, builtIn.#builtInCatalogs, options.now);
    for (const entry of files) {
      const configured = typeof entry === 'string' ? {file: entry, path: entry} : entry;
      try {
        registry.#configured.push(await registry.#read(configured, undefined));
      } catch (error) {
        if (error instanceof ReadFailure) throw new ConfigError(error.atStart(configured.file));
        throw error;
      }
    }
    return registry;
  }

  /**
   * A configured file read under the rules of its version, its id held by no
   * other definition: `own` is the definition the file itself holds now.
   */
  async #read(
    {file, path}: ConfiguredFile,
    own: KnownCatalog | undefined,
  ): Promise<{known: KnownCatalog; catalog: ProcessorCatalog}> {
    const {definition, catalog} = await loadDefinition(file);
    const held = this.known.find(
      entry => entry !== own && [entry.id, ...entry.aliases].includes(catalog.id),
    );
    if (held?.source === 'built-in') {
      throw new ReadFailure(`claims the basic catalog's id '${catalog.id}'`);
    }
    if (held !== undefined) {
      throw new ReadFailure(
        `carries the catalog id '${catalog.id}', which ${held.path} already carries`,
        at => `${at} carries the catalog id '${catalog.id}', which ${held.file} already carries.`,
      );
    }
    return {
      known: {
        id: catalog.id,
        aliases: [],
        protocolVersion: catalog.protocolVersion,
        source: 'configured',
        file,
        path,
        readTime: this.#now().toISOString(),
        ...(typeof definition.title === 'string' && {title: definition.title}),
        definition,
      },
      catalog,
    };
  }

  /**
   * Reads a configured file again, under the rules that judged it at start.
   * A read that passes replaces the definition whatever changed in it, its
   * id and protocol version included; one that gives the definition in force
   * changes nothing, unless it clears a failed read; one that fails keeps
   * the definition read before, and stands as the file's failed read.
   */
  async reread(file: string): Promise<Reread> {
    const index = this.#configured.findIndex(entry => entry.known.file === file);
    if (index < 0) return {kind: 'unchanged'};
    const {known} = this.#configured[index];
    let read: {known: KnownCatalog; catalog: ProcessorCatalog};
    try {
      read = await this.#read({file, path: known.path ?? file}, known);
    } catch (error) {
      if (!(error instanceof ReadFailure)) throw error;
      this.#configured[index].known = {
        ...known,
        failedRead: {time: this.#now().toISOString(), error: error.reason},
      };
      return {kind: 'failed', error: error.reason};
    }
    if (
      known.failedRead === undefined &&
      isDeepStrictEqual(read.known.definition, known.definition)
    ) {
      return {kind: 'unchanged'};
    }
    this.#configured[index] = read;
    return {
      kind: 'read',
      id: read.known.id,
      ...(read.known.id !== known.id && {previousId: known.id}),
    };
  }

  /** The definition under an id, its aliases included; nothing for an id Spectra does not know. */
  get(id: string): KnownCatalog | undefined {
    return this.known.find(catalog => catalog.id === id || catalog.aliases.includes(id));
  }

  /**
   * The catalogs for web core's processor: web core's own basic catalogs,
   * the v0.9 basic catalog again under its v0.9.1 URL, and each configured
   * definition, built schema-only.
   */
  catalogs(): ProcessorCatalog[] {
    return [...this.#builtInCatalogs, ...this.#configured.map(entry => entry.catalog)];
  }

  /**
   * The catalogs a host sent inline in its capabilities, built schema-only
   * under each version's key, with the version the key names. An item whose
   * id the registry knows, or that an earlier item carried, is left out, as
   * is one with no id or one web core cannot load.
   */
  inlineCatalogs(capabilities: Record<string, unknown> | undefined): ProcessorCatalog[] {
    return this.inlineDefinitions(capabilities).map(({catalog}) => catalog);
  }

  /** The inline catalogs of `inlineCatalogs`, each with the definition it was built from. */
  inlineDefinitions(capabilities: Record<string, unknown> | undefined): InlineDefinition[] {
    const inline: InlineDefinition[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(capabilities ?? {})) {
      const form = recordFormOf(key);
      const version = form.startsWith('v1.') ? '1.0' : form.startsWith('v0.') ? '0.9' : undefined;
      const items =
        isObject(value) && Array.isArray(value.inlineCatalogs) ? value.inlineCatalogs : [];
      if (version === undefined) continue;
      for (const item of items) {
        if (!isObject(item) || typeof item.catalogId !== 'string') continue;
        const id = item.catalogId;
        if (this.get(id) !== undefined || seen.has(id)) continue;
        try {
          inline.push({
            id,
            protocolVersion: version,
            definition: item,
            catalog: Catalog.fromJson(item, version),
          });
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

/**
 * Why a configured file did not read: the reason alone, as a read that fails
 * while Spectra runs is told, and the whole sentence that stops Spectra at
 * start.
 */
class ReadFailure extends Error {
  readonly reason: string;
  readonly atStart: (file: string) => string;

  constructor(reason: string, atStart: (file: string) => string = file => `${file} ${reason}.`) {
    super(reason);
    this.reason = reason;
    this.atStart = atStart;
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
      throw new ReadFailure('does not exist', at => `The catalog ${at} does not exist.`);
    }
    throw new ReadFailure(`cannot be read: ${describe(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // The parser's own message is the reason.
    throw new ReadFailure(describe(error), at => `${at} is not valid JSON: ${describe(error)}.`);
  }
  if (!isObject(json)) {
    throw new ReadFailure('must hold a JSON object');
  }
  if (typeof json.catalogId !== 'string' || json.catalogId === '') {
    throw new ReadFailure('names no catalogId');
  }
  const declared = typeof json.protocolVersion === 'string' ? json.protocolVersion : undefined;
  if (declared !== undefined && Number(majorMinor(declared)?.split('.')[0]) >= 1) {
    if (!validateDefinition(json)) {
      throw new ReadFailure(
        `is not a 1.0 catalog definition: ${metaSchema.errorsText(validateDefinition.errors, {dataVar: ''})}`,
      );
    }
  } else {
    let valid: boolean | Promise<unknown>;
    try {
      valid = metaSchema.validateSchema(json);
    } catch (error) {
      throw new ReadFailure(`is not a JSON Schema: ${describe(error)}`);
    }
    if (valid !== true) {
      throw new ReadFailure(
        `is not a JSON Schema: ${metaSchema.errorsText(metaSchema.errors, {dataVar: ''})}`,
      );
    }
  }
  let catalog: ProcessorCatalog;
  try {
    catalog = Catalog.fromJson(json);
  } catch (error) {
    throw new ReadFailure(`cannot be loaded as a catalog: ${describe(error)}`);
  }
  for (const name of Object.keys(isObject(json.components) ? json.components : {})) {
    if (!catalog.components.has(name)) {
      throw new ReadFailure(
        `the component '${name}' is not listed under $defs.anyComponent, so it would not be known`,
        at =>
          `${at}: the component '${name}' is not listed under $defs.anyComponent, so it would not be known.`,
      );
    }
  }
  for (const name of functionNames(json.functions)) {
    if (!catalog.functions.has(name)) {
      throw new ReadFailure(
        `the function '${name}' is not listed under $defs.anyFunction, so it would not be known`,
        at =>
          `${at}: the function '${name}' is not listed under $defs.anyFunction, so it would not be known.`,
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
