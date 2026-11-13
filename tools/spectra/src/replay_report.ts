/**
 * The result lines `replay` and `test` print on stdout: one per recorded
 * turn and a closing line for the record under `replay`, a turn's outcome
 * where its verdict sits under `--live`; one per fixture, with its failing
 * turns under it, and a summary under `test`.
 */
import type {ReplayReason, ReplayVerdict, TurnOutcome} from './record/turn_record.js';
import {inWords} from './replay/verdict.js';

/** One replayed turn as the result lines report it: judged, or never sent. */
export type ReportedTurn =
  | {
      /** The recorded turn's number, of the total. */
      turn: number;
      turns: number;
      verdict: ReplayVerdict;
      reasons: ReplayReason[];
      /** How many of the recorded turn's calls were never asked for. */
      unconsumed: number;
    }
  | {turn: number; turns: number; notSent: string};

/** One turn of a live replay as the result lines report it: closed, with its outcome, or never sent. */
export type ReportedLiveTurn =
  | {turn: number; turns: number; outcome: TurnOutcome | undefined}
  | {turn: number; turns: number; notSent: string};

/** One fixture as `test` reports it: replayed, failed before anything was sent, or not run. */
export type ReportedFixture =
  | {
      name: string;
      verdict: ReplayVerdict;
      turns: ReportedTurn[];
      /** The conversation folder the replayed turns landed in, once one has. */
      folder?: string;
    }
  | {name: string; failed: string}
  | {name: string; notRun: string};

/** How many of the recorded calls were not asked for, as a clause; nothing for none. */
function unaskedClause(count: number): string {
  if (count === 0) return '';
  return `; ${count} of the recorded calls ${count === 1 ? 'was' : 'were'} not asked for`;
}

/** A recorded turn's line: its number, its verdict and its reasons, or that it was not sent. */
export function turnLine(turn: ReportedTurn): string {
  const head = `turn ${turn.turn} of ${turn.turns}: `;
  if ('notSent' in turn) {
    return `${head}not sent (${turn.notSent})`;
  }
  const reasons =
    turn.reasons.length === 0 ? '' : ` (${turn.reasons.map(reason => reason.message).join(' ')})`;
  return `${head}${turn.verdict}${reasons}${unaskedClause(turn.unconsumed)}`;
}

/** The record's closing line: its verdict and, once a turn landed, the folder the turns are in. */
export function recordLine(source: string, verdict: ReplayVerdict, folder?: string): string {
  return `${source}: ${verdict}${folder === undefined ? '' : `; the replayed turns are in ${folder}`}`;
}

/** A live turn's line: its number and its outcome where a verdict sits, or that it was not sent. */
export function liveTurnLine(turn: ReportedLiveTurn): string {
  const head = `turn ${turn.turn} of ${turn.turns}: `;
  return 'notSent' in turn
    ? `${head}not sent (${turn.notSent})`
    : `${head}${inWords(turn.outcome)}`;
}

/** A live record's closing line: how many of its turns were sent and, once one landed, the folder they are in. */
export function liveRecordLine(source: string, turns: ReportedLiveTurn[], folder?: string): string {
  const sent = turns.filter(turn => !('notSent' in turn)).length;
  return (
    `${source}: ${sent} of ${turns.length} turn${turns.length === 1 ? '' : 's'} sent` +
    (folder === undefined ? '' : `; the replayed turns are in ${folder}`)
  );
}

/** A fixture's line, with a failed fixture's failing turns and its folder under it. */
export function fixtureLines(fixture: ReportedFixture): string[] {
  if ('failed' in fixture) {
    return [`${fixture.name}: failed (${fixture.failed})`];
  }
  if ('notRun' in fixture) {
    return [`${fixture.name}: not run (${fixture.notRun})`];
  }
  if (fixture.verdict === 'passed') {
    const unasked = fixture.turns.reduce(
      (sum, turn) => sum + ('unconsumed' in turn ? turn.unconsumed : 0),
      0,
    );
    return [`${fixture.name}: passed${unaskedClause(unasked)}`];
  }
  return [
    `${fixture.name}: failed`,
    ...fixture.turns
      .filter(turn => 'notSent' in turn || turn.verdict === 'failed')
      .map(turn => `  ${turnLine(turn)}`),
    ...(fixture.folder === undefined ? [] : [`  the replayed turns are in ${fixture.folder}`]),
  ];
}

/** The summary: how many fixtures, and how many passed, failed and were not run. */
export function summaryLine(fixtures: ReportedFixture[]): string {
  const passed = fixtures.filter(
    fixture => 'verdict' in fixture && fixture.verdict === 'passed',
  ).length;
  const notRun = fixtures.filter(fixture => 'notRun' in fixture).length;
  const failed = fixtures.length - passed - notRun;
  const counts = [`${passed} passed`];
  if (failed > 0 || notRun > 0) counts.push(`${failed} failed`);
  if (notRun > 0) counts.push(`${notRun} not run`);
  return `${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}: ${counts.join(', ')}`;
}

/** The warning when a record replayed with no call reaching the proxies and none of its calls asked for. */
export function nothingReachedLine(source: string): string {
  return (
    `No model call and no tool call reached the proxies while ${source} replayed, and none of its recorded calls was asked for. ` +
    'An agent already running needs the variables Spectra prints set in its shell, and an agent that hardcodes its model or tool endpoints is not redirected.'
  );
}
