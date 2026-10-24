import {agentMessages} from './messages.ts';
import {isTurnEvent, isWireInput, isWireOutput, type TurnRecordEvent} from './record.ts';

/** One turn of the message box's conversation, as its panel shows it. */
export interface ChatEntry {
  traceId: string;
  /** The text the box sent. */
  sent: string;
  /** The reply's text parts, in order. */
  replies: string[];
  a2uiMessages: number;
  /** The turn's outcome when it is not completed. */
  outcome?: 'waiting_for_input' | 'failed' | 'cancelled';
  /** A failed turn's reason, when its status has one. */
  reason?: string;
  /** Set while the turn is open. */
  open?: true;
}

/** A turn's chat entry, from its events; a turn with no turn event yet is open. */
export function chatEntryOf(traceId: string, events: readonly TurnRecordEvent[]): ChatEntry {
  const texts = (event: TurnRecordEvent) =>
    isWireInput(event) || isWireOutput(event)
      ? event.attributes['a2ui.wire.message'].parts.flatMap(part =>
          part.type === 'text' && typeof part.content === 'string' && part.content.trim() !== ''
            ? [part.content]
            : [],
        )
      : [];
  const turn = events.find(isTurnEvent);
  const outcome = turn?.attributes['a2ui.turn.outcome'];
  const reason = outcome === 'failed' ? turn?.status?.message : undefined;
  return {
    traceId,
    sent: events.filter(isWireInput).flatMap(texts).join('\n'),
    replies: events.filter(isWireOutput).flatMap(texts),
    a2uiMessages: agentMessages(events).length,
    ...(outcome !== undefined && outcome !== 'completed' && {outcome}),
    ...(reason !== undefined && reason !== '' && {reason}),
    ...(turn === undefined && {open: true}),
  };
}
