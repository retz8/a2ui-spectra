/**
 * What the page holds of the fixtures folder and of a replay running, as pure
 * functions the store applies: the listing read, a fixture's record read, the
 * stream's replay events; and what the fixture view shows of it all.
 */
import type {
  FixturesListing,
  ListedFixture,
  LiveEvents,
  MessageBoxState,
  ReplayMode,
} from '../api.ts';
import type {Address} from '../model/address.ts';
import {savedTimeOf} from '../model/fixtures.ts';
import {isTurnEvent, type Turn, type TurnRecord} from '../model/record.ts';

/** A fixture's record, as the page last read it. */
export interface HeldFixture {
  /** The saved time it was read at. */
  savedAt?: string;
  record?: TurnRecord;
  /** Why it could not be read, when it never was. */
  error?: string;
}

export interface FixturesState {
  /** Whether the listing has loaded once. */
  loaded: boolean;
  /** The folder's path as shown. */
  folder?: string;
  listed: readonly ListedFixture[];
  /** The records read, by name, kept after a file leaves the folder. */
  records: ReadonlyMap<string, HeldFixture>;
}

export const NO_FIXTURES: FixturesState = {loaded: false, listed: [], records: new Map()};

/**
 * The listing as read, and the records to read: each fixture's that is new or
 * whose saved time changed. A record held stays until the new one comes, so
 * the view does not flicker.
 */
export function fixturesListed(
  state: FixturesState,
  {folder, fixtures}: FixturesListing,
): {fixtures: FixturesState; read: Array<{name: string; savedAt: string}>} {
  return {
    fixtures: {...state, loaded: true, folder, listed: fixtures},
    read: fixtures.flatMap(({name, savedAt, turns}) =>
      turns !== undefined && state.records.get(name)?.savedAt !== savedAt ? [{name, savedAt}] : [],
    ),
  };
}

/** Marks a record asked for, so that it is asked for once. */
export function fixtureNotHeld(state: FixturesState, name: string): FixturesState {
  if (state.records.has(name)) return state;
  return {...state, records: new Map(state.records).set(name, {})};
}

/** A record read. One read for a saved time the listing has moved past gives way to the newer. */
export function fixtureRead(
  state: FixturesState,
  name: string,
  savedAt: string | undefined,
  record: TurnRecord,
): FixturesState {
  const listed = state.listed.find(fixture => fixture.name === name)?.savedAt;
  const at = savedAt ?? listed;
  return {
    ...state,
    records: new Map(state.records).set(name, {...(at !== undefined && {savedAt: at}), record}),
  };
}

/** A record that could not be read: a record held stays, as a file gone or rewritten leaves the view what it holds. */
export function fixtureFailed(state: FixturesState, name: string, error: string): FixturesState {
  const held = state.records.get(name);
  return {...state, records: new Map(state.records).set(name, {...held, error})};
}

/** A replayed turn, as the stream named it when it opened. */
export interface ReplayTurn {
  recordedTurn: string;
  source: string;
  mode: ReplayMode;
  turn: number;
  turns: number;
}

/** The part of the page's state the replay's events change. */
interface ReplayFields {
  box: MessageBoxState;
  replayTurns: ReadonlyMap<string, ReplayTurn>;
}

/** The live status and the composer's refusal start. */
export function replayStarted<S extends ReplayFields>(
  state: S,
  {source, mode, turns}: LiveEvents['replay_started'],
): S {
  return {...state, box: {...state.box, replay: {source, mode, turn: 0, turns}}};
}

/** A replayed turn opened: the live status names it, and its third line has what the turn event will. */
export function replayTurn<S extends ReplayFields>(
  state: S,
  {traceId, recordedTurn, turn, turns}: LiveEvents['replay_turn'],
): S {
  const {replay} = state.box;
  if (replay === undefined) return state;
  return {
    ...state,
    box: {...state.box, replay: {...replay, turn, turns}},
    replayTurns: new Map(state.replayTurns).set(traceId, {
      recordedTurn,
      source: replay.source,
      mode: replay.mode,
      turn,
      turns,
    }),
  };
}

/** The live status goes back to capturing, and the composer can send. */
export function replayEnded<S extends ReplayFields>(state: S): S {
  const {replay: _ended, ...box} = state.box;
  return {...state, box};
}

/**
 * The turn to follow of a replay that started at `first`: the newest of its
 * turns heard so far, the next replay's turns, which number from 1 again, not
 * among them. Nothing until `first` itself has been heard.
 */
export function replayedTurnToFollow(
  replayTurns: ReadonlyMap<string, ReplayTurn>,
  first: string,
): string | undefined {
  let newest: string | undefined;
  let number = 0;
  for (const [traceId, {turn}] of replayTurns) {
    if (newest === undefined) {
      if (traceId !== first) continue;
    } else if (turn !== number + 1) {
      break;
    }
    newest = traceId;
    number = turn;
  }
  return newest;
}

/** The newest saved fixture that reads as a record, with its own turn. */
function newestFixture(listed: readonly ListedFixture[]): ListedFixture | undefined {
  return listed
    .filter(fixture => fixture.turns !== undefined && fixture.turns.length > 0)
    .reduce<ListedFixture | undefined>(
      (newest, fixture) =>
        newest === undefined || fixture.savedAt > newest.savedAt ? fixture : newest,
      undefined,
    );
}

function traceIdsOf(turns: readonly Turn[]): string[] {
  return turns.flatMap(turn => {
    const traceId = turn.events.find(isTurnEvent)?.traceId;
    return traceId === undefined ? [] : [traceId];
  });
}

/**
 * The address a Fixtures address gives way to, or nothing when it stands: a
 * bare one opens the most recently saved fixture on its own turn; a fixture
 * with no turn, or with a turn its record no longer holds, opens its own turn.
 */
export function fixtureAddressOf(address: Address, state: FixturesState): Address | undefined {
  if (address.section !== 'fixtures' || !state.loaded) return undefined;
  const {fixture: name, traceId} = address;
  if (name === undefined) {
    const newest = newestFixture(state.listed);
    if (newest === undefined) return undefined;
    const turns = newest.turns!;
    return {
      section: 'fixtures',
      fixture: newest.name,
      traceId: turns[turns.length - 1].traceId,
    };
  }
  const held = state.records.get(name)?.record;
  const ids =
    held !== undefined
      ? traceIdsOf(held.turns)
      : state.listed.find(fixture => fixture.name === name)?.turns?.map(turn => turn.traceId);
  if (ids === undefined || ids.length === 0 || (traceId !== undefined && ids.includes(traceId))) {
    return undefined;
  }
  return {section: 'fixtures', fixture: name, traceId: ids[ids.length - 1]};
}

/** What stands in the saved time's place on the fixture line: when it was saved, or what became of it. */
export type SavedState =
  | {kind: 'saved'; text: string}
  | {kind: 'removed'; text: 'no longer in the folder'}
  | {kind: 'unreadable'; text: string};

/** What the fixture view shows. */
export type FixtureViewState =
  | {status: 'reading'}
  /** The folder is empty. */
  | {status: 'empty'}
  /** The folder holds files, none of which reads as a record. */
  | {status: 'unreadable'}
  /** The name in the address, with nothing held for it: why. */
  | {status: 'missing'; message: string}
  | {
      status: 'shown';
      name: string;
      record: TurnRecord;
      /** The turn in view, in the record; `turns` before it are the earlier turns. */
      turn: Turn;
      earlier: readonly Turn[];
      saved: SavedState;
    };

/** The saved time's place, from the listing: the file's time, or that it left the folder or stopped reading. */
function savedStateOf(listed: ListedFixture | undefined): SavedState {
  if (listed === undefined) return {kind: 'removed', text: 'no longer in the folder'};
  if (listed.error !== undefined) return {kind: 'unreadable', text: listed.error};
  return {kind: 'saved', text: `saved ${savedTimeOf(listed.savedAt)}`};
}

/** The fixture view, from the address and what the page holds. */
export function fixtureViewOf(address: Address, state: FixturesState): FixtureViewState {
  const {fixture: name, traceId} = address;
  if (name === undefined) {
    if (!state.loaded) return {status: 'reading'};
    return state.listed.length === 0 ? {status: 'empty'} : {status: 'unreadable'};
  }
  const listed = state.listed.find(fixture => fixture.name === name);
  const held = state.records.get(name);
  if (held?.record === undefined) {
    if (listed?.error !== undefined) return {status: 'missing', message: listed.error};
    if (held?.error !== undefined) return {status: 'missing', message: held.error};
    return {status: 'reading'};
  }
  const {turns} = held.record;
  const index = turns.findIndex(turn => turn.events.find(isTurnEvent)?.traceId === traceId);
  const at = index === -1 ? turns.length - 1 : index;
  return {
    status: 'shown',
    name,
    record: held.record,
    turn: turns[at],
    earlier: turns.slice(0, at),
    saved: savedStateOf(listed),
  };
}
