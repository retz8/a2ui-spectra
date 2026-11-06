/**
 * A turn's problems, each on the step it belongs to: the checks' findings on
 * the message each points into, the processor's rejections on the A2UI
 * message they name, a failed call on its row, one problem per row whichever
 * of its sources failed, and a failed turn's reason on the outcome. A finding
 * that names no message is a problem of the whole turn, on the outcome too.
 * A rejection of a message that a finding already points into is not a
 * problem of its own: it folds under that step's findings as a quiet line
 * and is not counted. Each error a parse raised is a problem on the parse's
 * row, the tool span's status not counted beside them when the parse is the
 * toolset's call; a failed prompt generation is one on its row. The
 * timeline narrowed to the steps with problems.
 */
import {generationProblemOf, parseProblemsOf} from './a2ui_step.ts';
import {type CallRow, sourceOfSpan} from './call_rows.ts';
import {agentMessages, locateFinding} from './messages.ts';
import {type CallFailure, failureOf} from './model_calls.ts';
import {
  isCheck,
  isModelCall,
  isTurnEvent,
  type ModelCallEvent,
  type Turn,
  type TurnRecordEvent,
} from './record.ts';
import {provenanceOf} from './provenance.ts';
import {toolFailureOf} from './tool_calls.ts';
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
  /** A parse error's rejected block in the parse's input, to show in its raw text. */
  range?: {start: number; end: number};
  /** The words of the sentence that select a step: the message a different A2UI names. */
  link?: {before: string; text: string; after: string; stepId: string};
  /** The recorded message under it, folded. */
  recorded?: {meta: string; value: unknown};
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
  /** The recorded turn a replayed turn stands for, when its source still holds it. */
  recordedTurn?: Turn,
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
    if (row.row !== 'step') continue;
    if (row.parse !== undefined) {
      for (const problem of parseProblemsOf(row.parse)) problems.push({stepId: row.id, ...problem});
      continue;
    }
    if (row.generation !== undefined) {
      const problem = generationProblemOf(row.generation);
      if (problem !== undefined) problems.push({stepId: row.id, ...problem});
      continue;
    }
    if (row.call === undefined) continue;
    const failure = rowFailureOf(row.call);
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
  problems.push(...verdictProblemsOf(events, stepOfMessage, recordedTurn));
  return {problems, folded};
}

/** The words of a different A2UI's sentence that name the message. */
const NAMED_MESSAGE = /^(.*?)(message (\d+) of \d+)(.*)$/;

/**
 * A failed verdict's reasons that are problems of the whole turn, on the
 * outcome step: a different outcome and different A2UI, each a plain sentence
 * over its code. A miss is the failed call's own problem, on its row.
 */
function verdictProblemsOf(
  events: readonly TurnRecordEvent[],
  stepOfMessage: ReadonlyMap<string, string>,
  recordedTurn: Turn | undefined,
): Problem[] {
  return (provenanceOf(events)?.reasons ?? []).flatMap((reason): Problem[] => {
    if (reason.code === 'OUTCOME_DIFFERS') {
      return [{stepId: 'outcome', sentence: reason.message, code: 'Outcome differs · replay'}];
    }
    if (reason.code !== 'A2UI_DIFFERS') return [];
    const problem: Problem = {
      stepId: 'outcome',
      sentence: reason.message,
      code: 'A2UI differs · replay',
    };
    const named = NAMED_MESSAGE.exec(reason.message);
    if (named === null) return [problem];
    const [, before, text, number, after] = named;
    const location = locateFinding(events, reason.path);
    const stepId = location === undefined ? undefined : stepOfMessage.get(location.key);
    const message =
      recordedTurn === undefined
        ? undefined
        : agentMessages(recordedTurn.events)[Number(number) - 1]?.message;
    return [
      {
        ...problem,
        ...(stepId !== undefined && {link: {before, text, after, stepId}}),
        ...(message !== undefined && {recorded: {meta: text, value: message}}),
      },
    ];
  });
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
 * How a failed call row reads: its proxy's failure when the proxy's event
 * failed, a failed span's status message joining the third line; else, when
 * a span of its chain failed, that the agent's span ended in error. Nothing
 * for a row none of whose sources failed. A framework span above the call is
 * not one of its sources.
 */
export function rowFailureOf(row: CallRow): CallFailure | undefined {
  const failedSpans = row.spans.filter(span => span.status?.code === 2);
  const spanNotes = failedSpans.flatMap(span =>
    span.status?.message !== undefined && span.status.message !== '' ? [span.status.message] : [],
  );
  const proxyFailure =
    row.proxy === undefined
      ? undefined
      : isModelCall(row.proxy)
        ? failureOf(row.proxy as ModelCallEvent)
        : toolFailureOf(row.proxy);
  if (proxyFailure !== undefined) {
    const notes = [...(proxyFailure.note !== undefined ? [proxyFailure.note] : []), ...spanNotes];
    return {
      sentence: proxyFailure.sentence,
      code: proxyFailure.code,
      ...(notes.length > 0 && {note: notes.join(' · ')}),
    };
  }
  if (failedSpans.length === 0) return undefined;
  // The innermost failed span names the source.
  const failed = failedSpans[failedSpans.length - 1];
  return {
    sentence: "The agent's span ended in error.",
    code: `Span status error · ${sourceOfSpan(failed)}`,
    ...(spanNotes.length > 0 && {note: spanNotes.join(' · ')}),
  };
}

/**
 * A turn's problem count, from what the listing gives: the findings, the
 * unfolded rejections, the failed call rows, the A2UI step's errors, a replay's
 * different outcome and different A2UI and a failed outcome; and, while the
 * turn is in view, the render errors its preview counts.
 */
export function listedProblemCount(turn: {
  outcome?: string;
  findings?: number;
  rejections?: number;
  failedCalls?: number;
  a2uiStepErrors?: number;
  replayDifferences?: number;
  renderErrors?: number;
}): number {
  return (
    (turn.findings ?? 0) +
    (turn.rejections ?? 0) +
    (turn.failedCalls ?? 0) +
    (turn.a2uiStepErrors ?? 0) +
    (turn.replayDifferences ?? 0) +
    (turn.outcome === 'failed' ? 1 : 0) +
    (turn.renderErrors ?? 0)
  );
}
