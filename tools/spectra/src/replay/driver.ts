/**
 * What a replay takes and reports, whatever the transport: the record and
 * its path, what the replay asks of the session while it runs, and how it
 * stands as the message box's state shows it.
 */
import type {ReplayMode, TurnRecord} from '../record/turn_record.js';
import type {ReplayPool} from './pool.js';

/** The replay running, as the read route returns it. */
export interface ReplayState {
  /** The record's path, as the turns' provenance names it. */
  source: string;
  mode: ReplayMode;
  /** The number of the turn being replayed, of the total; 0 before the first opens. */
  turn: number;
  turns: number;
}

/** What a replay answers with once its first turn has opened. */
export interface ReplayStarted {
  /** The first replayed turn's trace id. */
  traceId: string;
  /** How many turns the record holds. */
  turns: number;
}

/** A record to replay, and the path its turns' provenance names. */
export interface ReplaySource {
  /** The record file's path, relative to the working directory when under it. */
  path: string;
  record: TurnRecord;
}

/** What a replay asks of the session while it runs. */
export interface ReplayHooks {
  /** Arms both proxies with the pool, before the first send; a live replay arms neither. */
  arm(pool: ReplayPool): void;
  /** Disarms both, once the last replayed turn has closed. */
  disarm(): void;
  /** Writes the replay's provenance on a turn's turn event, as the turn opens. */
  annotate(traceId: string, attributes: Record<string, unknown>): void;
  /** Writes the verdict on a replayed turn's turn event, once the turn has closed and been written; a live replay takes none. */
  amend(traceId: string, attributes: Record<string, unknown>): Promise<void>;
  /** Takes one terminal line. */
  log(line: string): void;
}
