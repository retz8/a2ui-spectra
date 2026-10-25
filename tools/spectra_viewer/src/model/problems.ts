/**
 * A turn's problems, each on the step it belongs to: the checks' findings and
 * the processor's rejections on the A2UI message they name, and a failed
 * turn's reason on the outcome. A finding that names no message is a problem
 * of the whole turn, on the outcome too. The timeline narrowed to the steps
 * with problems.
 */
import {locateFinding} from './messages.ts';
import {isCheck, isTurnEvent, type TurnRecordEvent} from './record.ts';
import type {Rejection} from './replay.ts';
import type {TimelineRow} from './steps.ts';

export interface Problem {
  /** The step it is on. */
  stepId: string;
  /** What went wrong, in a plain sentence. */
  sentence: string;
  /** The code, and who found it. */
  code: string;
  surfaceId?: string;
  /** A JSON Pointer inside the step's message, to the line it marks; empty for the message itself. */
  inner?: string;
}

export function problemsOf(
  events: readonly TurnRecordEvent[],
  timeline: readonly TimelineRow[],
  rejections: readonly Rejection[],
): Problem[] {
  const stepOfMessage = new Map<string, string>();
  for (const row of timeline) {
    if (row.row === 'step' && row.messageKey !== undefined)
      stepOfMessage.set(row.messageKey, row.id);
  }
  const last = [...timeline].reverse().find(row => row.row === 'step');
  const turnLevel = last?.id ?? '';
  const problems: Problem[] = [];
  for (const event of events) {
    if (!isCheck(event)) continue;
    const name = event.attributes['a2ui.check.name'];
    const version = event.attributes['a2ui.check.protocol_version'];
    for (const finding of event.attributes['a2ui.check.findings']) {
      const location = locateFinding(events, finding.path);
      const stepId = location === undefined ? undefined : stepOfMessage.get(location.key);
      problems.push({
        stepId: stepId ?? turnLevel,
        sentence: finding.message,
        code: `${finding.code} · ${name} check, A2UI ${version}`,
        ...(finding.surfaceId !== undefined && {surfaceId: finding.surfaceId}),
        ...(location !== undefined && stepId !== undefined && {inner: location.inner}),
      });
    }
  }
  for (const rejection of rejections) {
    const stepId = stepOfMessage.get(rejection.key);
    problems.push({
      stepId: stepId ?? turnLevel,
      sentence: rejection.message,
      code: `${rejection.code} · A2UI web core`,
      ...(rejection.surfaceId !== undefined && {surfaceId: rejection.surfaceId}),
      ...(rejection.inner !== undefined && stepId !== undefined && {inner: rejection.inner}),
    });
  }
  const turn = events.find(isTurnEvent);
  if (turn?.attributes['a2ui.turn.outcome'] === 'failed') {
    const reason = turn.status?.message;
    const given = reason !== undefined && reason !== '';
    problems.push({
      stepId: 'outcome',
      sentence: given ? reason : 'The turn failed.',
      code: given ? 'The reason the agent gave · outcome failed' : 'outcome failed',
    });
  }
  return problems;
}

/**
 * The timeline with only the steps that have problems, each delivery's row
 * kept above the steps of it that stay.
 */
export function onlyProblems(
  timeline: readonly TimelineRow[],
  problems: ReadonlyMap<string, number>,
): TimelineRow[] {
  const kept: TimelineRow[] = [];
  let delivery: TimelineRow | undefined;
  for (const row of timeline) {
    if (row.row === 'delivery') {
      delivery = row;
      continue;
    }
    if (!row.grouped) delivery = undefined;
    if ((problems.get(row.id) ?? 0) === 0) continue;
    if (row.grouped && delivery !== undefined) {
      kept.push(delivery);
      delivery = undefined;
    }
    kept.push(row);
  }
  return kept;
}

/** A turn's problem count, from what the listing gives: the findings, the rejections and a failed outcome. */
export function listedProblemCount(turn: {
  outcome?: string;
  schemaCheck?: {findings: number};
  rejections?: number;
}): number {
  return (
    (turn.schemaCheck?.findings ?? 0) + (turn.rejections ?? 0) + (turn.outcome === 'failed' ? 1 : 0)
  );
}
