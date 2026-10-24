/**
 * What each pane shows, read off the store. A selector that needs a record
 * the page has not read yet names it in `needs`, for the pane to ask for.
 */
import {useEffect} from 'react';

import {type ChatEntry, chatEntryOf} from '../model/chat.ts';
import {isTurnEvent, type Turn, type TurnRecordEvent} from '../model/record.ts';
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

/** The message box's conversation as its chat: the closed turns from the latest record, then any turn still open. */
export function boxChatOf(
  state: SpectraState,
  needs: string[],
): {entries: ChatEntry[]; loading: boolean} {
  const {conversationId, openTurn} = state.box;
  const turns: Array<{traceId: string; events: readonly TurnRecordEvent[]}> = [];
  let loading = false;
  if (conversationId !== undefined) {
    const row = state.turns.find(turn => turn.conversationId === conversationId && !turn.open);
    const record = row === undefined ? undefined : state.records.get(row.traceId);
    if (row !== undefined && (record === undefined || 'loading' in record)) {
      needs.push(row.traceId);
      loading = true;
    } else if (record !== undefined && 'record' in record) {
      for (const turn of record.record.turns)
        turns.push({traceId: traceIdOf(turn), events: turn.events});
    }
    // Turns that closed in this page and are newer than the record read.
    for (const [traceId, turn] of state.closed) {
      const id = turn.events.find(isTurnEvent)?.attributes['gen_ai.conversation.id'];
      if (id === conversationId && !turns.some(entry => entry.traceId === traceId)) {
        turns.push({traceId, events: turn.events});
      }
    }
  }
  const live = openTurn === undefined ? undefined : state.live.get(openTurn);
  if (live !== undefined && !turns.some(entry => entry.traceId === live.traceId)) {
    turns.push({traceId: live.traceId, events: live.events});
  }
  return {entries: turns.map(({traceId, events}) => chatEntryOf(traceId, events)), loading};
}

function traceIdOf(turn: Turn): string {
  return turn.events.find(isTurnEvent)?.traceId ?? '';
}

/** Asks the store for the records a pane needs. */
export function useNeededRecords(needs: readonly string[]): void {
  const key = needs.join(',');
  useEffect(() => {
    for (const traceId of key === '' ? [] : key.split(',')) spectra.ensureRecord(traceId);
  }, [key]);
}
