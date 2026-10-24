import {type InputBrief, inputBriefOfTurn} from './input_brief.ts';
import {agentMessages} from './messages.ts';
import {
  type CheckEvent,
  isCheck,
  isTurnEvent,
  type Turn,
  type TurnOutcome,
  unixMillis,
} from './record.ts';

/** The turn list's fields of a closed turn, as the listing gives them. */
export interface RowFields {
  outcome?: TurnOutcome;
  input?: InputBrief;
  schemaCheck?: {passed: boolean; findings: number};
}

export function rowFieldsOf(turn: Turn): RowFields {
  const outcome = turn.events.find(isTurnEvent)?.attributes['a2ui.turn.outcome'];
  const input = inputBriefOfTurn(turn);
  const check = schemaCheckEventOf(turn);
  return {
    ...(outcome !== undefined && {outcome}),
    ...(input !== undefined && {input}),
    ...(check !== undefined && {
      schemaCheck: {
        passed: check.attributes['a2ui.check.passed'],
        findings: check.attributes['a2ui.check.findings'].length,
      },
    }),
  };
}

/** The schema check, as the header and the turn list show it. */
export type SchemaCheckState =
  | {state: 'passed'}
  | {state: 'findings'; count: number}
  /** A passing check of a turn with no A2UI from the agent. */
  | {state: 'no_a2ui'}
  /** No schema check event: the turn has no protocol version. */
  | {state: 'none'};

/** What the header shows of a closed turn. */
export interface TurnSummary {
  traceId: string;
  conversationId?: string;
  agentName?: string;
  outcome: TurnOutcome;
  /** The turn status's reason, on a failed turn that has one. */
  statusReason?: string;
  /** Milliseconds since the Unix epoch. */
  startTime: number;
  durationMs: number;
  protocolVersion?: string;
  schemaCheck: SchemaCheckState;
}

/** The summary of a closed turn; nothing for a turn with no turn event. */
export function summaryOf(turn: Turn): TurnSummary | undefined {
  const event = turn.events.find(isTurnEvent);
  if (event === undefined) return undefined;
  const {attributes} = event;
  const startTime = unixMillis(event.startTimeUnixNano);
  const outcome = attributes['a2ui.turn.outcome'];
  const reason = outcome === 'failed' ? event.status?.message : undefined;
  return {
    traceId: event.traceId,
    ...(attributes['gen_ai.conversation.id'] !== undefined && {
      conversationId: attributes['gen_ai.conversation.id'],
    }),
    ...(attributes['gen_ai.agent.name'] !== undefined && {
      agentName: attributes['gen_ai.agent.name'],
    }),
    outcome,
    ...(reason !== undefined && reason !== '' && {statusReason: reason}),
    startTime,
    durationMs: unixMillis(event.endTimeUnixNano) - startTime,
    ...(attributes['a2ui.turn.protocol_version'] !== undefined && {
      protocolVersion: attributes['a2ui.turn.protocol_version'],
    }),
    schemaCheck: schemaCheckOf(turn),
  };
}

function schemaCheckEventOf(turn: Turn): CheckEvent | undefined {
  return turn.events.find(
    (event): event is CheckEvent =>
      isCheck(event) && event.attributes['a2ui.check.name'] === 'schema',
  );
}

export function schemaCheckOf(turn: Turn): SchemaCheckState {
  const check = schemaCheckEventOf(turn);
  if (check === undefined) return {state: 'none'};
  if (!check.attributes['a2ui.check.passed']) {
    return {state: 'findings', count: check.attributes['a2ui.check.findings'].length};
  }
  return agentMessages(turn.events).length === 0 ? {state: 'no_a2ui'} : {state: 'passed'};
}
