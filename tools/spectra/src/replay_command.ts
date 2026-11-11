/**
 * The headless commands: `replay <file>` runs one record through the message
 * box's replay entry and `test [<folder>]` every fixture under a folder, each
 * printing its result lines on stdout and exiting 0 when everything passed.
 * What is wrong before the agent is reached, a file or folder missing, a file
 * that is not a turn record, a folder with no fixture, exits 2 before the
 * agent is launched or its card waited for.
 */
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

import {UsageError} from './args.js';
import type {SpectraConfig} from './config.js';
import {
  FixtureReadError,
  type FixtureListing,
  FixturesFolder,
  readRecord,
} from './fixtures/fixtures.js';
import {MessageBoxError, NOTHING_TO_SERVE, type ReplaySource} from './message_box.js';
import type {Output} from './output.js';
import {
  isEventOfKind,
  type ReplayMode,
  type ReplayReason,
  type ReplayVerdict,
  type Turn,
  type TurnEvent,
  type TurnRecord,
} from './record/turn_record.js';
import {hasNothingToServe} from './replay/pool.js';
import {
  fixtureLines,
  nothingReachedLine,
  recordLine,
  type ReportedFixture,
  type ReportedTurn,
  summaryLine,
  turnLine,
} from './replay_report.js';
import type {HeadlessSession, HeadlessWork} from './session.js';
import type {LiveEvent} from './turn_hub.js';

/** A path as shown: relative to the working directory when under it, else absolute. */
function displayPath(file: string, cwd: string): string {
  const absolute = path.resolve(cwd, file);
  const relative = path.relative(cwd, absolute);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : absolute;
}

/**
 * Reads the record `replay` is given; the work replaying it, or the exit
 * code when the file is missing, is not a turn record, or holds nothing to
 * serve with everything recorded.
 */
export async function prepareReplay(
  file: string,
  modelLive: boolean,
  cwd: string,
  out: Output,
): Promise<HeadlessWork | number> {
  const source = displayPath(file, cwd);
  let text: string;
  try {
    text = await readFile(path.resolve(cwd, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UsageError(`No file at ${source}.`, 'replay');
    }
    throw new UsageError(
      `${source} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      'replay',
    );
  }
  let record: TurnRecord;
  try {
    record = readRecord(text);
  } catch (error) {
    if (error instanceof FixtureReadError) {
      throw new UsageError(`${source} does not read as a turn record: ${error.message}`, 'replay');
    }
    throw error;
  }
  const mode: ReplayMode = modelLive ? 'model_live' : 'recorded';
  if (mode === 'recorded' && hasNothingToServe(record)) {
    out.print(`${source}: failed (${NOTHING_TO_SERVE} Replay it with --model-live.)`);
    return 1;
  }
  return async session => {
    if (session.box.unavailable !== undefined) {
      out.error(session.box.unavailable);
      return 1;
    }
    const outcome = await runReplay(session, {path: source, record}, mode);
    if ('refused' in outcome) {
      out.print(`${source}: failed (${outcome.refused})`);
      return 1;
    }
    for (const turn of outcome.turns) out.print(turnLine(turn));
    out.print(recordLine(source, outcome.verdict, outcome.folder));
    if (outcome.nothingReached) out.info(nothingReachedLine(source));
    return outcome.verdict === 'passed' ? 0 : 1;
  };
}

/**
 * Lists the fixtures `test` is given, the folder named or the config file's;
 * the work replaying each with everything recorded, or the exit code when
 * the folder is missing or holds no `.json` file.
 */
export async function prepareTest(
  folder: string | undefined,
  config: SpectraConfig,
  cwd: string,
  out: Output,
): Promise<HeadlessWork | number> {
  const fixtures = new FixturesFolder(folder ?? config.fixtures, cwd);
  let isFolder = false;
  try {
    isFolder = (await stat(fixtures.dir)).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder) {
    throw new UsageError(`No folder at ${fixtures.display}.`, 'test');
  }
  const listing: FixtureListing = await fixtures.list();
  if (listing.fixtures.length === 0) {
    throw new UsageError(`${fixtures.display} holds no .json file.`, 'test');
  }
  return async session => {
    if (session.box.unavailable !== undefined) {
      out.error(session.box.unavailable);
      return 1;
    }
    const reported: ReportedFixture[] = [];
    for (const entry of listing.fixtures) {
      let fixture: ReportedFixture;
      if (session.stopping.aborted) {
        fixture = {name: entry.name, notRun: session.stopReason()};
      } else if (entry.record === undefined) {
        fixture = {
          name: entry.name,
          failed: entry.error ?? 'The file does not read as a turn record.',
        };
      } else if (hasNothingToServe(entry.record)) {
        fixture = {name: entry.name, failed: NOTHING_TO_SERVE};
      } else {
        const outcome = await runReplay(
          session,
          {path: entry.path, record: entry.record},
          'recorded',
        );
        if ('refused' in outcome) {
          fixture = {name: entry.name, failed: outcome.refused};
        } else {
          fixture = {
            name: entry.name,
            verdict: outcome.verdict,
            turns: outcome.turns,
            ...(outcome.folder !== undefined && {folder: outcome.folder}),
          };
          if (outcome.nothingReached) out.info(nothingReachedLine(entry.path));
        }
      }
      reported.push(fixture);
      for (const line of fixtureLines(fixture)) out.print(line);
    }
    out.print(summaryLine(reported));
    return reported.every(fixture => 'verdict' in fixture && fixture.verdict === 'passed') ? 0 : 1;
  };
}

/** What one record's replay came to. */
type ReplayOutcome =
  | {refused: string}
  | {
      verdict: ReplayVerdict;
      turns: ReportedTurn[];
      /** The conversation folder the replayed turns landed in, as shown, once one has. */
      folder?: string;
      /** Whether no call reached the proxies while recorded calls went unasked. */
      nothingReached: boolean;
    };

function turnEventOf(turn: Turn): TurnEvent | undefined {
  return turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
}

/**
 * Replays one record through the box and reads the result off the hub: the
 * reasons from each turn's amended turn event, the verdicts and the unasked
 * counts from the replay's end, or what was known when Spectra stopped.
 */
async function runReplay(
  session: HeadlessSession,
  source: ReplaySource,
  mode: ReplayMode,
): Promise<ReplayOutcome> {
  const total = source.record.turns.length;
  const reasons = new Map<string, ReplayReason[]>();
  const closed = new Map<string, Turn>();
  const sent: Array<{traceId: string; turn: number}> = [];
  let ended: Extract<LiveEvent, {type: 'replay_ended'; verdict: ReplayVerdict}> | undefined;
  let onEnded: () => void = () => {};
  const endedPromise = new Promise<void>(resolve => {
    onEnded = resolve;
  });
  const unsubscribe = session.turns.subscribe(event => {
    switch (event.type) {
      case 'replay_turn':
        sent.push({traceId: event.traceId, turn: event.turn});
        break;
      case 'turn_amended': {
        const turnEvent = event.events.find((candidate): candidate is TurnEvent =>
          isEventOfKind(candidate, 'turn'),
        );
        const found = turnEvent?.attributes['a2ui.replay.reasons'];
        if (found !== undefined) reasons.set(event.traceId, found);
        break;
      }
      case 'turn_closed':
        closed.set(event.traceId, event.turn);
        break;
      case 'replay_ended':
        if (event.source === source.path && event.mode !== 'live') {
          ended = event;
          onEnded();
        }
        break;
    }
  });
  try {
    try {
      await session.box.replay(source, mode);
    } catch (error) {
      if (!(error instanceof MessageBoxError)) throw error;
      // The first turn's send failed: the replay ended with every turn not sent.
      if (ended === undefined) return {refused: error.message};
    }
    await Promise.race([endedPromise, aborted(session.stopping)]);
  } finally {
    unsubscribe();
  }

  const turns: ReportedTurn[] = [];
  if (ended !== undefined) {
    const end = ended as Extract<LiveEvent, {type: 'replay_ended'; verdict: ReplayVerdict}>;
    for (const [index, turn] of end.turns.entries()) {
      turns.push(
        'notSent' in turn
          ? {turn: index + 1, turns: total, notSent: turn.notSent}
          : {
              turn: index + 1,
              turns: total,
              verdict: turn.verdict,
              reasons: reasons.get(turn.traceId) ?? [],
              unconsumed: turn.unconsumed,
            },
      );
    }
  } else {
    // Spectra stopped before the replay ended: the turns judged so far, the rest not sent.
    const reason = session.stopReason();
    for (let index = 0; index < total; index++) {
      const opened = sent.find(entry => entry.turn === index + 1);
      const record = opened === undefined ? undefined : closed.get(opened.traceId);
      const verdict =
        record === undefined ? undefined : turnEventOf(record)?.attributes['a2ui.replay.verdict'];
      turns.push(
        opened === undefined || verdict === undefined
          ? {turn: index + 1, turns: total, notSent: reason}
          : {
              turn: index + 1,
              turns: total,
              verdict,
              reasons: reasons.get(opened.traceId) ?? [],
              unconsumed: 0,
            },
      );
    }
  }
  const verdict: ReplayVerdict = turns.every(turn => 'verdict' in turn && turn.verdict === 'passed')
    ? 'passed'
    : 'failed';

  let folder: string | undefined;
  const first = sent[0];
  if (first !== undefined) {
    const stored = (await session.store.list()).find(turn => turn.traceId === first.traceId);
    if (stored !== undefined) folder = path.dirname(session.store.displayPathOf(stored.file));
  }

  const replayedCalls = sent
    .map(entry => closed.get(entry.traceId))
    .flatMap(record =>
      record === undefined
        ? []
        : record.events.filter(
            event => isEventOfKind(event, 'model_call') || isEventOfKind(event, 'tool_call'),
          ),
    );
  const unasked = turns.reduce(
    (sum, turn) => sum + ('unconsumed' in turn ? turn.unconsumed : 0),
    0,
  );
  return {
    verdict,
    turns,
    ...(folder !== undefined && {folder}),
    nothingReached: replayedCalls.length === 0 && unasked > 0,
  };
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener('abort', () => resolve(), {once: true});
    }
  });
}
