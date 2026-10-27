/**
 * What each pane shows, read off the store. A selector that needs a record
 * the page has not read yet names it in `needs`, for the pane to ask for.
 */
import {useEffect} from 'react';

import type {Turn, TurnOutcome} from '../model/record.ts';
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

/** Asks the store for the records a pane needs. */
export function useNeededRecords(needs: readonly string[]): void {
  const key = needs.join(',');
  useEffect(() => {
    for (const traceId of key === '' ? [] : key.split(',')) spectra.ensureRecord(traceId);
  }, [key]);
}
