/**
 * The processor's rejections of a turn: the agent's A2UI messages of the
 * conversation's earlier turns, then the turn's own, go one by one into
 * upstream web core's message processor in its relaxed validation mode, with
 * every catalog the registry knows registered, the catalogs the hosts of the
 * conversation sent inline built from their messages, and a stand-in catalog
 * with no component schemas under any other catalog id the messages name.
 * Each of the turn's own messages the processor throws on is a rejection.
 * The viewer's conversation replay feeds the processor the same way, so the
 * listing's count and the viewer's marks agree.
 */
import {Catalog} from '@a2ui/web_core/catalog';
import {MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/processing';

import {CatalogRegistry, type ProcessorCatalog} from '../catalog/registry.js';
import {isEventOfKind, type Turn} from '../record/turn_record.js';
import {agentMessages} from './schema_check.js';

/** How many of a turn's own A2UI messages the processor rejects, after the conversation's earlier turns. */
export function rejectionCount(
  turn: Turn,
  earlierTurns: readonly Turn[] = [],
  registry: CatalogRegistry = CatalogRegistry.builtIn(),
): number {
  const earlier = earlierTurns.flatMap(earlierTurn => agentMessages(earlierTurn));
  const own = agentMessages(turn);
  const messages = [...earlier, ...own].map(({message}) => message);
  // The processor asks a schema-only catalog for no function here: it nests and validates only.
  const processor = new MessageProcessor(
    processorCatalogs(registry, [...earlierTurns, turn], messages) as Array<Catalog<never>>,
    undefined,
    {validationConfig: RELAXED_VALIDATION},
  );
  try {
    for (const {message} of earlier) rejects(processor, message);
    return own.filter(({message}) => rejects(processor, message)).length;
  } finally {
    processor.dispose();
  }
}

/**
 * Feeds a copy of one message, since the processor keeps and changes the
 * objects it is given; whether the processor threw on it.
 */
function rejects(processor: MessageProcessor, message: unknown): boolean {
  try {
    processor.processMessages(
      structuredClone(message) as Parameters<MessageProcessor['processMessages']>[0],
    );
    return false;
  } catch {
    return true;
  }
}

/**
 * The catalogs for the processor on a conversation: every catalog the
 * registry knows, the catalogs its hosts sent inline, each id once, and a
 * stand-in under each other catalog id the messages name.
 */
export function processorCatalogs(
  registry: CatalogRegistry,
  turns: readonly Turn[],
  messages: readonly unknown[],
): ProcessorCatalog[] {
  const catalogs = registry.catalogs();
  const known = new Set(catalogs.map(catalog => catalog.id));
  for (const turn of turns) {
    for (const event of turn.events) {
      if (!isEventOfKind(event, 'wire_input')) continue;
      for (const inline of registry.inlineCatalogs(event.attributes['a2ui.wire.capabilities'])) {
        if (known.has(inline.id)) continue;
        known.add(inline.id);
        catalogs.push(inline);
      }
    }
  }
  return [...catalogs, ...standInCatalogs(messages, known)];
}

/**
 * A catalog with no component schemas under each catalog id the messages
 * name that no catalog is known under: a surface's, a component's or a
 * function call's. The relaxed mode lets any component and function through it.
 */
function standInCatalogs(
  messages: readonly unknown[],
  known: ReadonlySet<string>,
): Array<Catalog<never>> {
  const versions = new Map<string, string>();
  for (const message of messages) {
    const version = versionOf(message)?.startsWith('v1.') ? '1.0' : '0.9';
    for (const id of catalogIdsIn(message)) {
      if (!known.has(id) && !versions.has(id)) versions.set(id, version);
    }
  }
  return [...versions].map(([id, version]) => new Catalog<never>(id, version, [], []));
}

/** Every string under a `catalogId` key, at any depth. */
function catalogIdsIn(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) catalogIdsIn(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'catalogId' && typeof item === 'string') found.push(item);
      else catalogIdsIn(item, found);
    }
  }
  return found;
}

function versionOf(message: unknown): string | undefined {
  const version = (message as {version?: unknown} | null)?.version;
  return typeof version === 'string' ? version : undefined;
}
