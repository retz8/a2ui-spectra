/**
 * A turn's problems, each on the step it belongs to: the checks' findings on
 * the message each points into, the processor's rejections on the A2UI
 * message they name, a failed model call on its row, and a failed turn's
 * reason on the outcome. A finding
 * that names no message is a problem of the whole turn, on the outcome too.
 * A rejection of a message that a finding already points into is not a
 * problem of its own: it folds under that step's findings as a quiet line
 * and is not counted. The timeline narrowed to the steps with problems.
 */
import {locateFinding} from './messages.ts';
import {failureOf, isProxyModelCall} from './model_calls.ts';
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
  /**
   * A third, quiet line: where a problem that is not recorded came from, or
   * the status message the model proxy recorded on a failed call.
   */
  note?: string;
}

/**
 * A rejection folded under a step's findings: web core's sentence, on the
 * step, after what folded it, web core's own rejection unless a lead says.
 */
export interface FoldedRejection {
  stepId: string;
  sentence: string;
  /** What reported it, when it is not the viewer's web core: the preview page. */
  lead?: string;
}

/** The problems and the folded rejections of a turn together. */
export interface TurnProblems {
  problems: Problem[];
  folded: FoldedRejection[];
}

export function problemsOf(
  events: readonly TurnRecordEvent[],
  timeline: readonly TimelineRow[],
  rejections: readonly Rejection[],
): Problem[] {
  return turnProblemsOf(events, timeline, rejections).problems;
}

export function turnProblemsOf(
  events: readonly TurnRecordEvent[],
  timeline: readonly TimelineRow[],
  rejections: readonly Rejection[],
): TurnProblems {
  const stepOfMessage = new Map<string, string>();
  for (const row of timeline) {
    if (row.row === 'step' && row.messageKey !== undefined)
      stepOfMessage.set(row.messageKey, row.id);
  }
  const last = [...timeline].reverse().find(row => row.row === 'step');
  const turnLevel = last?.id ?? '';
  const problems: Problem[] = [];
  /** The steps of the messages a finding points into. */
  const found = new Set<string>();
  for (const event of events) {
    if (!isCheck(event)) continue;
    const name = event.attributes['a2ui.check.name'];
    const version = event.attributes['a2ui.check.protocol_version'];
    for (const finding of event.attributes['a2ui.check.findings']) {
      const location = locateFinding(events, finding.path);
      const stepId = location === undefined ? undefined : stepOfMessage.get(location.key);
      if (stepId !== undefined) found.add(stepId);
      problems.push({
        stepId: stepId ?? turnLevel,
        sentence: finding.message,
        code: `${finding.code} · ${name} check, A2UI ${version}`,
        ...(finding.surfaceId !== undefined && {surfaceId: finding.surfaceId}),
        ...(location !== undefined && stepId !== undefined && {inner: location.inner}),
      });
    }
  }
  const folded: FoldedRejection[] = [];
  for (const rejection of rejections) {
    const stepId = stepOfMessage.get(rejection.key);
    if (stepId !== undefined && found.has(stepId)) {
      folded.push({stepId, sentence: rejection.message});
      continue;
    }
    problems.push({
      stepId: stepId ?? turnLevel,
      sentence: rejection.message,
      code: `${rejection.code} · A2UI web core`,
      ...(rejection.surfaceId !== undefined && {surfaceId: rejection.surfaceId}),
      ...(rejection.inner !== undefined && stepId !== undefined && {inner: rejection.inner}),
    });
  }
  for (const row of timeline) {
    if (row.row !== 'step' || row.call === undefined) continue;
    const failure = failureOf(row.call);
    if (failure !== undefined) problems.push({stepId: row.id, ...failure});
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
  return {problems, folded};
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

/**
 * A turn's problem count, from what the listing gives: the findings, the
 * unfolded rejections, the failed model calls and a failed outcome; and,
 * while the turn is in view, the render errors its preview counts.
 */
export function listedProblemCount(turn: {
  outcome?: string;
  findings?: number;
  rejections?: number;
  failedModelCalls?: number;
  renderErrors?: number;
}): number {
  return (
    (turn.findings ?? 0) +
    (turn.rejections ?? 0) +
    (turn.failedModelCalls ?? 0) +
    (turn.outcome === 'failed' ? 1 : 0) +
    (turn.renderErrors ?? 0)
  );
}

/** How many of the model proxy's calls in a turn failed. */
export function failedModelCallsOf(events: readonly TurnRecordEvent[]): number {
  return events.filter(event => isProxyModelCall(event) && event.status?.code === 2).length;
}
