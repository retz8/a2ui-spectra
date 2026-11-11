/** What the agent's popover shows of the card, as it reads. */
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

import type {SessionContext} from '../api.ts';
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

/** A row of the agent's popover, a Catalog row carrying its file's failed read while it stands. */
export interface AgentRow {
  label: string;
  value: string;
  /** The two muted lines under a catalog whose file did not read: what happened, and the reader's error. */
  failedRead?: {line: string; error: string};
}

/** The two lines of a configured file's failed read, its times as the clock gives them. */
function failedReadOf(
  catalog: KnownCatalog | undefined,
  clock: (time: string) => string,
): Pick<AgentRow, 'failedRead'> {
  if (catalog?.failedRead === undefined) return {};
  const read =
    catalog.readTime === undefined
      ? ''
      : ` · checking against the definition read at ${clock(catalog.readTime)}`;
  return {
    failedRead: {
      line: `${catalog.path ?? catalog.id} did not read at ${clock(catalog.failedRead.time)}${read}`,
      error: catalog.failedRead.error,
    },
  };
}

/**
 * The popover's rows: the agent's address; once a card has answered, its
 * transport and each A2UI version it advertises with that version's
 * catalogs; a Catalog row of its own for each configured file whose read
 * stands failed and whose id the card does not advertise, a card answered or
 * not; and the mode.
 */
export function agentRowsOf(
  context: SessionContext,
  catalogs: readonly KnownCatalog[],
  clock: (time: string) => string,
): AgentRow[] {
  const known = (id: string) =>
    catalogs.find(catalog => catalog.id === id || catalog.aliases.includes(id));
  const extensions = context.a2uiExtensions;
  const advertised = new Set((extensions ?? []).flatMap(extension => extension.catalogIds));
  const unadvertised = catalogs.filter(
    catalog =>
      catalog.failedRead !== undefined &&
      ![catalog.id, ...catalog.aliases].some(id => advertised.has(id)),
  );
  return [
    {label: 'Address', value: shownUrl(context.agentUrl)},
    // Under run, until a card has answered, the popover holds no transport and no A2UI.
    ...(context.a2aVersions === undefined
      ? []
      : [{label: 'Transport', value: transportLine(context.a2aVersions)}]),
    ...(extensions === undefined
      ? []
      : extensions.length === 0
        ? [{label: 'A2UI', value: 'None advertised'}]
        : extensions.flatMap(extension => [
            {label: 'A2UI', value: extension.version},
            ...extension.catalogIds.map(id => ({
              label: 'Catalog',
              value: catalogName(id, catalogs),
              ...failedReadOf(known(id), clock),
            })),
          ])),
    ...unadvertised.map(catalog => ({
      label: 'Catalog',
      value: catalogName(catalog.id, catalogs),
      ...failedReadOf(catalog, clock),
    })),
    {
      label: 'Mode',
      value:
        context.mode === 'run'
          ? 'Launched by Spectra (run)'
          : 'Attached to a running agent (attach)',
    },
  ];
}
