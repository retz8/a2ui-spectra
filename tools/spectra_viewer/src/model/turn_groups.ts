/**
 * The turn list's groups: the turns of each conversation together, newest
 * first, each group titled by its conversation's first message and its
 * agent. A turn with no conversation id is a group of its own.
 */
import type {InputBrief} from './input_brief.ts';
import {listedProblemCount} from './problems.ts';
import type {TurnOutcome} from './record.ts';

/** The fields of a listed turn a group reads. */
export interface GroupedTurn {
  traceId: string;
  conversationId?: string;
  startTime: string;
  open?: true;
  outcome?: TurnOutcome;
  agentName?: string;
  input?: InputBrief;
  schemaCheck?: {findings: number};
  rejections?: number;
}

export interface TurnGroup<T extends GroupedTurn = GroupedTurn> {
  /** The conversation id, or the trace id of a turn with none. */
  key: string;
  /** The conversation's first message known to the list. */
  title?: InputBrief;
  agentName?: string;
  /** Newest first. */
  turns: T[];
  problems: number;
}

/** Groups turns listed newest first; the groups come in the order of their newest turn. */
export function groupTurns<T extends GroupedTurn>(turns: readonly T[]): Array<TurnGroup<T>> {
  const groups = new Map<string, Array<T>>();
  for (const turn of turns) {
    const key = turn.conversationId ?? turn.traceId;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [turn]);
    else group.push(turn);
  }
  return [...groups].map(([key, members]) => {
    const title = [...members].reverse().find(turn => turn.input !== undefined)?.input;
    const agentName = members.find(turn => turn.agentName !== undefined)?.agentName;
    return {
      key,
      ...(title !== undefined && {title}),
      ...(agentName !== undefined && {agentName}),
      turns: members,
      problems: members.reduce((sum, turn) => sum + listedProblemCount(turn), 0),
    };
  });
}

/** An input in brief as the list reads it. */
export function briefText(input: InputBrief | undefined): string {
  if (input === undefined) return '';
  if ('text' in input) return input.text;
  if ('action' in input) return `Action “${input.action}”`;
  return `${input.partType} part`;
}

/**
 * The groups with a turn that matches the search, each with only its
 * matching turns. A turn matches by its input, its conversation's title or
 * agent, or a trace or conversation id, whole or by its start.
 */
export function searchGroups<T extends GroupedTurn>(
  groups: ReadonlyArray<TurnGroup<T>>,
  query: string,
): Array<TurnGroup<T>> {
  const words = query.trim().toLowerCase();
  if (words === '') return [...groups];
  const has = (text: string | undefined) =>
    text !== undefined && text.toLowerCase().includes(words);
  const starts = (id: string | undefined) => id !== undefined && id.toLowerCase().startsWith(words);
  return groups.flatMap(group => {
    const groupMatches = has(briefText(group.title)) || has(group.agentName);
    const turns = group.turns.filter(
      turn =>
        groupMatches ||
        has(briefText(turn.input)) ||
        starts(turn.traceId) ||
        starts(turn.conversationId),
    );
    return turns.length === 0 ? [] : [{...group, turns}];
  });
}
