import {isWireInput, messagesOfPart, type Turn, type WireInputEvent} from './record.ts';

/**
 * What a turn's input is about, in brief: the host's first text part, else
 * the name of the action it sent, else the type of its first part.
 */
export type InputBrief = {text: string} | {action: string} | {partType: string};

export function inputBrief(event: WireInputEvent): InputBrief | undefined {
  const {parts} = event.attributes['a2ui.wire.message'];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.content === 'string') {
      const text = part.content.replace(/\s+/g, ' ').trim();
      if (text !== '') return {text};
    }
  }
  for (const part of parts) {
    for (const message of messagesOfPart(part)) {
      const name = actionName(message);
      if (name !== undefined) return {action: name};
    }
  }
  return parts.length > 0 ? {partType: parts[0].type} : undefined;
}

/** The input in brief of a turn's wire input, when it has one. */
export function inputBriefOfTurn(turn: Turn): InputBrief | undefined {
  const event = turn.events.find(isWireInput);
  return event === undefined ? undefined : inputBrief(event);
}

/** An action's name, in v0.9 and v1.0's `action` or v0.8's `userAction`. */
function actionName(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const record = message as Record<string, unknown>;
  for (const key of ['action', 'userAction']) {
    const action = record[key];
    if (typeof action === 'object' && action !== null) {
      const name = (action as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
  }
  return undefined;
}
