/**
 * The catalogs the viewer builds for web core's message processor: the
 * definitions the server serves, built once per listing, and the catalogs a
 * host sent inline in a turn's capabilities.
 */
import {Catalog, type ComponentApi, type FunctionApi} from '@a2ui/web_core/catalog';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

/** A definition as `GET /api/catalogs` serves it. */
export interface KnownCatalog {
  id: string;
  /** Other ids the definition answers to. */
  aliases: string[];
  /** The protocol version the definition targets, as web core reads it: `0.9` or `1.0`. */
  protocolVersion: string;
  source: 'built-in' | 'configured';
  title?: string;
  definition: Record<string, unknown>;
}

/** A catalog as web core's processor takes it. */
export type ProcessorCatalog = Catalog<ComponentApi, FunctionApi>;

const BASIC_IDS = new Set([basicCatalogV09.id, basicCatalogV10.id]);

/**
 * The catalogs for the processor: web core's own basic catalogs, the v0.9
 * one again under each alias the listing gives it, and each configured
 * definition built schema-only. A definition web core cannot load is left
 * out, and the listing being unknown yet gives the basic catalogs alone.
 */
export function catalogsOf(listing: readonly KnownCatalog[] | undefined): ProcessorCatalog[] {
  const catalogs: ProcessorCatalog[] = [
    basicCatalogV09 as unknown as ProcessorCatalog,
    basicCatalogV10 as unknown as ProcessorCatalog,
  ];
  const known = listing ?? [];
  const v09 = known.find(catalog => catalog.id === basicCatalogV09.id);
  const aliases = v09?.aliases ?? [
    'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json',
  ];
  for (const alias of aliases) {
    catalogs.push(Catalog.fromJson(basicCatalogV09.toJson(), undefined, alias));
  }
  for (const entry of known) {
    if (BASIC_IDS.has(entry.id)) continue;
    try {
      catalogs.push(Catalog.fromJson(entry.definition, undefined, entry.id));
    } catch {
      // The server validated it; a definition this build of web core cannot load is left out.
    }
  }
  return catalogs;
}

/**
 * The catalogs a host sent inline in its capabilities, built schema-only
 * under each version's key with the version the key names. An item whose id
 * is already known, has no id, or web core cannot load is left out.
 */
export function inlineCatalogsOf(
  capabilities: Record<string, unknown> | undefined,
  known: ReadonlySet<string>,
): ProcessorCatalog[] {
  const inline: ProcessorCatalog[] = [];
  const seen = new Set(known);
  for (const [key, value] of Object.entries(capabilities ?? {})) {
    const version = key.startsWith('v1.') ? '1.0' : key.startsWith('v0.') ? '0.9' : undefined;
    if (version === undefined) continue;
    const items =
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as {inlineCatalogs?: unknown}).inlineCatalogs)
        ? (value as {inlineCatalogs: unknown[]}).inlineCatalogs
        : [];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const id = (item as {catalogId?: unknown}).catalogId;
      if (typeof id !== 'string' || seen.has(id)) continue;
      try {
        inline.push(Catalog.fromJson(item as Record<string, unknown>, version));
        seen.add(id);
      } catch {
        // The host's inline definition is the host's; an unloadable one is as if not sent.
      }
    }
  }
  return inline;
}
