/** What the agent's popover shows of the card, as it reads. */
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

import type {KnownCatalog} from './catalogs.ts';

const BASIC_CATALOGS = new Map([
  [basicCatalogV09.id, 'basic, v0.9'],
  ['https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json', 'basic, v0.9'],
  [basicCatalogV10.id, 'basic, v1.0'],
]);

/**
 * A catalog by its id: a basic catalog by its short name, a configured
 * catalog by the title its definition carries, any other by its id in full.
 */
export function catalogName(id: string, catalogs: readonly KnownCatalog[] = []): string {
  const basic = BASIC_CATALOGS.get(id);
  if (basic !== undefined) return basic;
  const known = catalogs.find(catalog => catalog.id === id || catalog.aliases.includes(id));
  return known?.title ?? id;
}

/** The transport line: the A2A versions the card states, each as major.minor, over JSON-RPC. */
export function transportLine(versions: readonly string[]): string {
  const shown = [
    ...new Set(versions.map(version => /^(\d+\.\d+)\.\d+$/.exec(version)?.[1] ?? version)),
  ];
  return shown.length === 0
    ? 'A2A, version not stated · JSON-RPC'
    : `A2A ${shown.join(', ')} · JSON-RPC`;
}

/** A URL as the popover shows it: without the slash of a bare origin. */
export function shownUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\/$/i.test(url) ? url.slice(0, -1) : url;
}
