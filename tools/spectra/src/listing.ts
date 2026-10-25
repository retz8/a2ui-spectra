/** What the turn listing shows of each turn beyond the store's file names. */
import {rejectionCount} from './check/rejections.js';
import {
  isA2uiPart,
  isEventOfKind,
  type Turn,
  type TurnOutcome,
  type WireInputEvent,
} from './record/turn_record.js';

/**
 * What a turn's input is about, in brief: the host's first text part, else
 * the name of the action it sent, else the type of its first part.
 */
export type InputBrief = {text: string} | {action: string} | {partType: string};

/** The listing's fields read from a closed turn. */
export interface ListingFields {
  outcome: TurnOutcome;
  agentName?: string;
  durationMs: number;
  input?: InputBrief;
  /** The schema check, when the turn has one. */
  schemaCheck?: {passed: boolean; findings: number};
  /** How many of the turn's A2UI messages web core's message processor rejects. */
  rejections: number;
}

export function inputBriefOf(event: WireInputEvent): InputBrief | undefined {
  const {parts} = event.attributes['a2ui.wire.message'];
  for (const part of parts) {
    if (part.type === 'text' && typeof part.content === 'string') {
      const text = part.content.replace(/\s+/g, ' ').trim();
      if (text !== '') return {text};
    }
  }
  for (const part of parts) {
    if (!isA2uiPart(part)) continue;
    for (const message of Array.isArray(part.content) ? part.content : [part.content]) {
      const name = actionName(message);
      if (name !== undefined) return {action: name};
    }
  }
  return parts.length > 0 ? {partType: parts[0].type} : undefined;
}

/**
 * The listing's fields of a closed turn, after the conversation's earlier
 * turns its record holds; nothing for a turn with no turn event.
 */
export function listingFieldsOf(
  turn: Turn,
  earlierTurns: readonly Turn[] = [],
): ListingFields | undefined {
  let fields: Pick<ListingFields, 'outcome' | 'agentName' | 'durationMs'> | undefined;
  let input: InputBrief | undefined;
  let schemaCheck: ListingFields['schemaCheck'];
  for (const event of turn.events) {
    if (isEventOfKind(event, 'turn')) {
      const agentName = event.attributes['gen_ai.agent.name'];
      fields = {
        outcome: event.attributes['a2ui.turn.outcome'],
        ...(agentName !== undefined && {agentName}),
        durationMs: Number(
          (BigInt(event.endTimeUnixNano) - BigInt(event.startTimeUnixNano)) / 1_000_000n,
        ),
      };
    } else if (isEventOfKind(event, 'wire_input') && input === undefined) {
      input = inputBriefOf(event);
    } else if (isEventOfKind(event, 'check') && event.attributes['a2ui.check.name'] === 'schema') {
      schemaCheck = {
        passed: event.attributes['a2ui.check.passed'],
        findings: event.attributes['a2ui.check.findings'].length,
      };
    }
  }
  return (
    fields && {
      ...fields,
      ...(input !== undefined && {input}),
      ...(schemaCheck !== undefined && {schemaCheck}),
      rejections: rejectionCount(turn, earlierTurns),
    }
  );
}

/** An action's name, in v0.9 and v1.0's `action` or v0.8's `userAction`. */
function actionName(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  for (const key of ['action', 'userAction']) {
    const action = (message as Record<string, unknown>)[key];
    if (typeof action === 'object' && action !== null) {
      const name = (action as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
  }
  return undefined;
}
