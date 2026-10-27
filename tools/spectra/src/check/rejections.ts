/**
 * The processor's rejections of a turn: how many of the turn's own A2UI
 * messages upstream web core's message processor throws on, after the
 * conversation's earlier turns, fed as `conversation.ts` feeds it. The
 * viewer's conversation replay feeds the processor the same way, so the
 * listing's count and the viewer's marks agree.
 */
import type {CatalogRegistry} from '../catalog/registry.js';
import type {Finding, Turn} from '../record/turn_record.js';
import {type Conversation, feedConversation} from './conversation.js';

export {processorCatalogs} from './conversation.js';

/** How many of a turn's own A2UI messages the processor rejects, after the conversation's earlier turns. */
export function rejectionCount(
  turn: Turn,
  earlierTurns: readonly Turn[] = [],
  registry?: CatalogRegistry,
): number {
  const conversation = feedConversation(turn, earlierTurns, registry);
  try {
    return conversation.rejectionCount;
  } finally {
    conversation.dispose();
  }
}

/**
 * The rejections no finding's step covers: a rejection of a message that a
 * check finding points into folds under that finding and is not counted on
 * its own; the rest stand as problems of their own.
 */
export function unfoldedRejections(
  conversation: Conversation,
  findings: readonly Finding[],
): number {
  return conversation.own.filter(
    ({path, rejection}) =>
      rejection !== undefined &&
      !findings.some(finding => finding.path === path || finding.path?.startsWith(`${path}/`)),
  ).length;
}
