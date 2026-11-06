/**
 * What each pane shows, read off the store. A selector that needs a record
 * the page has not read yet names it in `needs`, for the pane to ask for.
 */
import {useEffect} from 'react';

import {
  type Provenance,
  provenanceOf,
  replayWhereOf,
  type ResolvedSource,
  resolveSource,
  numberIn,
  storeTraceOf,
  traceIdOfTurn,
} from '../model/provenance.ts';
import type {Turn, TurnOutcome, TurnRecordEvent} from '../model/record.ts';
import {briefText} from '../model/turn_groups.ts';
import {type LiveTurn, spectra, type SpectraState} from './spectra.ts';

/** A conversation's earlier turns, once their record has been read. */
export type EarlierTurns = {turns: readonly Turn[]} | {loading: true};

/** Kept the same from render to render, so what is computed from them is too. */
const NO_TURNS: {turns: readonly Turn[]} = {turns: []};
const earlierOfRecord = new WeakMap<object, {turns: readonly Turn[]}>();

/** A record's turns before its last, the same object each time. */
function beforeLast(turns: readonly Turn[]): {turns: readonly Turn[]} {
  let earlier = earlierOfRecord.get(turns);
  if (earlier === undefined) {
    earlier = {turns: turns.slice(0, -1)};
    earlierOfRecord.set(turns, earlier);
  }
  return earlier;
}

const wholeRecord = new WeakMap<object, {turns: readonly Turn[]}>();

function allOf(turns: readonly Turn[]): {turns: readonly Turn[]} {
  let all = wholeRecord.get(turns);
  if (all === undefined) {
    all = {turns};
    wholeRecord.set(turns, all);
  }
  return all;
}

export type TurnView =
  | {status: 'none'}
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'open'; live: LiveTurn; earlier: EarlierTurns}
  | {status: 'closed'; turn: Turn; earlier: EarlierTurns};

/**
 * The turns of a conversation before a turn that started at `startTime`: the
 * conversation's latest closed record that started before it.
 */
export function earlierTurnsOf(
  state: SpectraState,
  conversationId: string | undefined,
  startTime: string,
  needs: string[],
): EarlierTurns {
  if (conversationId === undefined) return NO_TURNS;
  const row = state.turns.find(
    turn => turn.conversationId === conversationId && !turn.open && turn.startTime < startTime,
  );
  if (row === undefined) return NO_TURNS;
  const record = state.records.get(row.traceId);
  if (record === undefined || 'loading' in record) {
    needs.push(row.traceId);
    return {loading: true};
  }
  return 'record' in record ? allOf(record.record.turns) : NO_TURNS;
}

/** The selected turn: open from the live stream, or closed from its record. */
export function turnViewOf(state: SpectraState, traceId: string, needs: string[]): TurnView {
  const live = state.live.get(traceId);
  if (live !== undefined) {
    return {
      status: 'open',
      live,
      earlier: earlierTurnsOf(state, live.conversationId, live.startTime, needs),
    };
  }
  const record = state.records.get(traceId);
  if (record !== undefined && 'record' in record) {
    const {turns} = record.record;
    return {status: 'closed', turn: turns[turns.length - 1], earlier: beforeLast(turns)};
  }
  if (record !== undefined && 'error' in record) return {status: 'error', message: record.error};
  const row = state.turns.find(turn => turn.traceId === traceId);
  if (row === undefined) return state.loaded ? {status: 'none'} : {status: 'loading'};
  needs.push(traceId);
  // A turn that just closed shows its own events until its record has been read.
  const closed = state.closed.get(traceId);
  if (closed !== undefined) {
    return {
      status: 'closed',
      turn: closed,
      earlier: earlierTurnsOf(state, row.conversationId, row.startTime, needs),
    };
  }
  return {status: 'loading'};
}

/**
 * Where the composer sends: on in a conversation the box started, or into a
 * new conversation, because one was asked for, or because the conversation
 * in view is not the box's or its agent named no conversation.
 */
export type ComposerTarget =
  | {kind: 'continues'; conversationId: string; title: string; outcome?: TurnOutcome; open?: true}
  | {kind: 'new'}
  | {kind: 'notStarted'}
  | {kind: 'unnamed'};

/** What the composer says and whether it can send. */
export interface ComposerView {
  /** Why the box cannot send to the agent; it takes the input's place. */
  unavailable?: string;
  /** The variables the configured headers name that are not set; the field stays, Send does not. */
  refused?: string[];
  /** Why the input waits. */
  waiting?: string;
  /** That a replay is running: the refusal takes the line's place, and no send goes out until it ends. */
  replaying?: true;
  target: ComposerTarget;
}

/**
 * The composer, for the turn in view: it continues that turn's conversation
 * when the box started it, named by its first message, with how its newest
 * turn ended; or it starts a new conversation, when one was asked for, with
 * no turn in view, or with a conversation it cannot continue.
 */
export function composerOf(
  state: SpectraState,
  inView: {traceId?: string; startsNew?: boolean},
): ComposerView {
  const {box} = state;
  const view = composerTargetOf(state, inView);
  return box.replay === undefined ? view : {...view, replaying: true};
}

function composerTargetOf(
  state: SpectraState,
  inView: {traceId?: string; startsNew?: boolean},
): ComposerView {
  const {box, connected} = state;
  const refused = box.unsetVariables?.length ? {refused: [...box.unsetVariables]} : undefined;
  if (refused === undefined && box.unavailable !== undefined) {
    return {unavailable: box.unavailable, target: {kind: 'new'}};
  }
  const notConnected = connected === false ? {waiting: 'Not connected to Spectra'} : {};
  const {traceId} = inView;
  if (inView.startsNew === true || traceId === undefined) {
    return {...refused, ...notConnected, target: {kind: 'new'}};
  }
  const conversationId = state.turns.find(turn => turn.traceId === traceId)?.conversationId;
  const held = box.conversations.find(
    conversation =>
      conversation.turns.includes(traceId) ||
      (conversationId !== undefined && conversation.conversationId === conversationId),
  );
  if (held === undefined) return {...refused, ...notConnected, target: {kind: 'notStarted'}};
  const waiting =
    notConnected.waiting ?? (held.openTurn !== undefined ? 'A turn is open' : undefined);
  const withWaiting = waiting !== undefined ? {waiting} : {};
  if (held.conversationId === undefined) {
    return {...refused, ...withWaiting, target: {kind: 'unnamed'}};
  }
  // Newest first: the box's turns, and any other host's in the same conversation.
  const rows = state.turns.filter(
    turn => held.turns.includes(turn.traceId) || turn.conversationId === held.conversationId,
  );
  const newest = rows[0];
  const first = [...rows].reverse().find(turn => turn.input !== undefined);
  return {
    ...refused,
    ...withWaiting,
    target: {
      kind: 'continues',
      conversationId: held.conversationId,
      title: briefText(first?.input),
      ...(newest?.outcome !== undefined && {outcome: newest.outcome}),
      ...(newest?.open === true && {open: true}),
    },
  };
}

/**
 * Why an action cannot be sent where the composer stands, which takes the
 * line's place: an action only continues a conversation the box started.
 */
export function actionRefusalOf(target: ComposerTarget): string | undefined {
  switch (target.kind) {
    case 'continues':
      return undefined;
    case 'unnamed':
      return 'The agent named no conversation · an action can only be sent in a conversation the agent named';
    case 'notStarted':
    case 'new':
      return 'Started by another host or in an earlier run · an action can only be sent in a conversation the message box started';
  }
}

/** A replayed turn's provenance: on its turn event once closed; while open, from the stream's turn event. */
export function provenanceOfTurn(
  state: SpectraState,
  traceId: string,
  events: readonly TurnRecordEvent[],
): Provenance | undefined {
  const closed = provenanceOf(events);
  if (closed !== undefined) return closed;
  const live = state.replayTurns.get(traceId);
  if (live !== undefined) {
    return {source: live.source, recordedTurn: live.recordedTurn, mode: live.mode, reasons: []};
  }
  // A page opened during a replay has heard no turn event: the box says which turn is running.
  const {replay} = state.box;
  if (replay === undefined || replay.turn === 0 || !state.live.has(traceId)) return undefined;
  const heard = [...state.replayTurns.values()].some(
    turn => turn.source === replay.source && turn.turn === replay.turn,
  );
  return heard
    ? undefined
    : {source: replay.source, recordedTurn: '', mode: replay.mode, reasons: []};
}

/** Where a replayed turn's source is now, and its turns once read. */
export interface SourceInView {
  resolved: ResolvedSource;
  turns?: readonly Turn[];
  /** The record to read through the turn route, for its turns. */
  needs?: string;
}

/**
 * Resolves a replay's source, a fixture's record already read for the group
 * costs, a store turn's through the turn route: the source file's own turn
 * when listed, which holds the conversation replayed, else the recorded turn.
 */
export function sourceInView(
  state: SpectraState,
  provenance: Pick<Provenance, 'source' | 'recordedTurn'>,
): SourceInView {
  const resolved = resolveSource(provenance.source, provenance.recordedTurn, {
    fixtures: state.fixtures.listed,
    turns: state.turns,
  });
  if (resolved.kind === 'fixture') {
    const turns = state.fixtures.records.get(resolved.name)?.record?.turns;
    return {resolved, ...(turns !== undefined && {turns})};
  }
  if (resolved.kind === 'gone') return {resolved};
  const own = storeTraceOf(provenance.source);
  const traceId =
    own !== undefined && state.turns.some(turn => turn.traceId === own && !turn.open)
      ? own
      : resolved.traceId;
  const record = state.records.get(traceId);
  if (record === undefined) return {resolved, needs: traceId};
  return 'record' in record ? {resolved, turns: record.record.turns} : {resolved};
}

/** The third line under a replayed turn's header, or what the context bar names. */
export interface ReplayLine {
  source: ResolvedSource;
  /** The turn's number and the mode. */
  where: string;
  verdict?: 'passed' | 'failed';
}

/**
 * A replayed turn's third line: its number of the total from the source's
 * turns, the listing's or the stream's; with no source to count against, its
 * number alone, from its place in its own conversation.
 */
export function replayLineOf(
  state: SpectraState,
  traceId: string,
  provenance: Provenance,
  source: SourceInView,
  position: number,
): ReplayLine {
  const {resolved} = source;
  const listed =
    resolved.kind === 'fixture'
      ? state.fixtures.listed.find(fixture => fixture.name === resolved.name)?.turns
      : undefined;
  const live = state.replayTurns.get(traceId);
  const number =
    numberIn(
      source.turns?.map(turn => ({traceId: traceIdOfTurn(turn)})),
      provenance.recordedTurn,
    ) ??
    numberIn(listed, provenance.recordedTurn) ??
    (live !== undefined
      ? {turn: live.turn, turns: live.turns}
      : state.box.replay !== undefined && state.live.has(traceId)
        ? {turn: state.box.replay.turn, turns: state.box.replay.turns}
        : {turn: position});
  return {
    source: resolved,
    where: replayWhereOf(provenance.mode, number),
    ...(provenance.verdict !== undefined && {verdict: provenance.verdict}),
  };
}

/** The context bar's live status: not connected, capturing, or replaying a record, its turn of the total. */
export type LiveStatusView =
  | {form: 'connecting'}
  | {form: 'down'}
  | {form: 'capturing'}
  | {form: 'replaying'; source: ResolvedSource; recordedTurn?: string; turn?: string};

export function liveStatusOf(state: SpectraState): LiveStatusView {
  if (state.connected === false) return {form: 'down'};
  const {replay} = state.box;
  if (replay === undefined)
    return state.connected === true ? {form: 'capturing'} : {form: 'connecting'};
  const running = [...state.replayTurns.values()].find(
    turn => turn.source === replay.source && turn.turn === replay.turn,
  );
  // Before the first turn opens, a store source's own turn is known from its file's name.
  const recordedTurn = running?.recordedTurn ?? storeTraceOf(replay.source) ?? '';
  return {
    form: 'replaying',
    source: resolveSource(replay.source, recordedTurn, {
      fixtures: state.fixtures.listed,
      turns: state.turns,
    }),
    ...(recordedTurn !== '' && {recordedTurn}),
    ...(replay.turn > 0 && {turn: `turn ${replay.turn} of ${replay.turns}`}),
  };
}

/** Asks the store for the records a pane needs. */
export function useNeededRecords(needs: readonly string[]): void {
  const key = needs.join(',');
  useEffect(() => {
    for (const traceId of key === '' ? [] : key.split(',')) spectra.ensureRecord(traceId);
  }, [key]);
}
