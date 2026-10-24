import {isWireOutput, type TurnRecordEvent} from './record.ts';

/** One A2UI message the agent sent in a turn, and where it sits among the turn's events. */
export interface AgentMessage {
  /** Names the message within its turn: the event, the part, and its index in an array. */
  key: string;
  eventIndex: number;
  partIndex: number;
  /** The message's index when its part holds an array. */
  index?: number;
  message: unknown;
}

export function messageKey(eventIndex: number, partIndex: number, index?: number): string {
  return index === undefined ? `${eventIndex}.${partIndex}` : `${eventIndex}.${partIndex}.${index}`;
}

/** The agent's A2UI messages in a turn's events, in order, each element of an array on its own. */
export function agentMessages(events: readonly TurnRecordEvent[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  events.forEach((event, eventIndex) => {
    if (!isWireOutput(event)) return;
    event.attributes['a2ui.wire.message'].parts.forEach((part, partIndex) => {
      if (part.type !== 'a2ui') return;
      if (Array.isArray(part.content)) {
        part.content.forEach((message: unknown, index) =>
          messages.push({
            key: messageKey(eventIndex, partIndex, index),
            eventIndex,
            partIndex,
            index,
            message,
          }),
        );
      } else {
        messages.push({
          key: messageKey(eventIndex, partIndex),
          eventIndex,
          partIndex,
          message: part.content,
        });
      }
    });
  });
  return messages;
}

/** Where a finding's path points: the message, and the path inside it. */
export interface FindingLocation {
  key: string;
  /** A JSON Pointer inside the message; empty for the message itself. */
  inner: string;
}

const PART_CONTENT =
  /^\/events\/(\d+)\/attributes\/a2ui\.wire\.message\/parts\/(\d+)\/content(\/.*)?$/;

/**
 * The agent's A2UI message a finding's path points into. The path is a JSON
 * Pointer from the turn: the event, the part, the message's index when the
 * part holds an array, then the path inside the message.
 */
export function locateFinding(
  events: readonly TurnRecordEvent[],
  path: string | undefined,
): FindingLocation | undefined {
  const match = path === undefined ? null : PART_CONTENT.exec(path);
  if (match === null) return undefined;
  const [eventIndex, partIndex] = [Number(match[1]), Number(match[2])];
  const rest = match[3] ?? '';
  const event = events[eventIndex];
  if (event === undefined || !isWireOutput(event)) return undefined;
  const part = event.attributes['a2ui.wire.message'].parts[partIndex];
  if (part?.type !== 'a2ui') return undefined;
  if (!Array.isArray(part.content)) {
    return {key: messageKey(eventIndex, partIndex), inner: rest};
  }
  const index = /^\/(\d+)(\/.*)?$/.exec(rest);
  if (index === null || Number(index[1]) >= part.content.length) return undefined;
  return {key: messageKey(eventIndex, partIndex, Number(index[1])), inner: index[2] ?? ''};
}
