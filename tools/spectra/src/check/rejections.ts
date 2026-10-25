/**
 * The processor's rejections of a turn: the agent's A2UI messages of the
 * conversation's earlier turns, then the turn's own, go one by one into
 * upstream web core's message processor in its relaxed validation mode, with
 * the v0.9 and v1.0 basic catalogs registered and a stand-in catalog with no
 * component schemas under any other catalog id the messages name. Each of
 * the turn's own messages the processor throws on is a rejection. The
 * viewer's conversation replay feeds the processor the same way, so the
 * listing's count and the viewer's marks agree.
 */
import {Catalog} from '@a2ui/web_core/catalog';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/processing';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

import type {Turn} from '../record/turn_record.js';
import {agentMessages} from './schema_check.js';

const BASIC_CATALOG_IDS = new Set([basicCatalogV09.id, basicCatalogV10.id]);

/** How many of a turn's own A2UI messages the processor rejects, after the conversation's earlier turns. */
export function rejectionCount(turn: Turn, earlierTurns: readonly Turn[] = []): number {
  const earlier = earlierTurns.flatMap(earlierTurn => agentMessages(earlierTurn));
  const own = agentMessages(turn);
  const messages = [...earlier, ...own].map(({message}) => message);
  const processor = new MessageProcessor(
    [basicCatalogV09, basicCatalogV10, ...standInCatalogs(messages)],
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
 * A catalog with no component schemas under each catalog id the messages
 * name that is not a basic catalog's: a surface's, a component's or a
 * function call's. The relaxed mode lets any component and function through it.
 */
function standInCatalogs(messages: readonly unknown[]): Array<Catalog<never>> {
  const versions = new Map<string, string>();
  for (const message of messages) {
    const version = versionOf(message)?.startsWith('v1.') ? '1.0' : '0.9';
    for (const id of catalogIdsIn(message)) {
      if (!BASIC_CATALOG_IDS.has(id) && !versions.has(id)) versions.set(id, version);
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
