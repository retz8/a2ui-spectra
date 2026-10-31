/**
 * What each event of the live stream changes in the page's state, as pure
 * functions the store applies: a turn opened, a wire event, a call started,
 * a chunk or its progress, a call ended, a turn closed, and a turn amended
 * by the receiver's spans.
 */
import type {ListedTurn, LiveEvents} from '../api.ts';
import {inputBrief} from '../model/input_brief.ts';
import {
  amendedTurn,
  isTurnEvent,
  isWireInput,
  type OtherEvent,
  type Turn,
  type TurnRecord,
  type TurnRecordEvent,
  unixMillis,
  type WireEvent,
} from '../model/record.ts';
import {openFieldsOf, rowFieldsOf} from '../model/summary.ts';

/** An open turn, as the live stream has sent it so far. */
export interface LiveTurn {
  traceId: string;
  conversationId?: string;
  startTime: string;
  /**
   * Its wire events and its calls by start time, as the record will hold
   * them, then the spans the receiver placed in it, by start time.
   */
  events: TurnRecordEvent[];
  wire: WireEvent[];
  /**
   * The calls placed in it, by span id: each as its event stood at its start,
   * with its chunks and its progress so far, until it ends complete, and with
   * the links the receiver's spans gave it.
   */
  calls: ReadonlyMap<string, OtherEvent>;
  /** The spans the receiver placed in it so far, by span id. */
  received: ReadonlyMap<string, TurnRecordEvent>;
}

/** A record the page has asked for. */
export type RecordState = {loading: true} | {record: TurnRecord} | {error: string};

/** The part of the page's state the live stream changes. */
export interface LiveState {
  turns: ListedTurn[];
  live: ReadonlyMap<string, LiveTurn>;
  closed: ReadonlyMap<string, Turn>;
  records: ReadonlyMap<string, RecordState>;
  /** Amendments of turns whose record is on its way, by trace id, applied when it comes. */
  pending: ReadonlyMap<string, readonly TurnRecordEvent[]>;
}

export function turnOpened<S extends LiveState>(
  state: S,
  data: LiveEvents['turn_opened'],
  agentName: string | undefined,
): S {
  const turn: LiveTurn = {...data, events: [], wire: [], calls: new Map(), received: new Map()};
  const live = new Map(state.live).set(data.traceId, turn);
  return {...state, live, turns: upsertRow(state.turns, openRow(turn, agentName))};
}

export function wireEvent<S extends LiveState>(
  state: S,
  {traceId, conversationId, event}: LiveEvents['wire_event'],
  agentName: string | undefined,
): S {
  const turn = state.live.get(traceId);
  if (turn === undefined) return state;
  const wire = [...turn.wire, event];
  const updated = withEvents({
    ...turn,
    ...(turn.conversationId === undefined && conversationId !== undefined && {conversationId}),
    wire,
  });
  const live = new Map(state.live).set(traceId, updated);
  const listed = state.turns.some(row => row.traceId === traceId);
  return {
    ...state,
    live,
    turns: listed ? upsertRow(state.turns, openRow(updated, agentName)) : state.turns,
  };
}

/** Changes a call of an open turn: it starts, gains a chunk or its progress, or ends. */
export function callChanged<S extends LiveState>(
  state: S,
  traceId: string,
  spanId: string,
  change: (call: OtherEvent | undefined) => OtherEvent | undefined,
): S {
  const turn = state.live.get(traceId);
  if (turn === undefined) return state;
  const call = change(turn.calls.get(spanId));
  if (call === undefined) return state;
  const calls = new Map(turn.calls).set(spanId, call);
  return {...state, live: new Map(state.live).set(traceId, withEvents({...turn, calls}))};
}

export function turnClosed<S extends LiveState>(
  state: S,
  {traceId, turn}: LiveEvents['turn_closed'],
): S {
  const live = new Map(state.live);
  live.delete(traceId);
  const closed = new Map(state.closed).set(traceId, turn);
  const row = state.turns.find(listed => listed.traceId === traceId);
  return {...state, live, closed, turns: upsertRow(state.turns, closedRow(turn, row))};
}

/**
 * Applies the events a `turn_amended` sent, each replacing or added by span
 * id, to every form of the turn the page holds: the open turn, the turn
 * that closed while the page was open, and every record that holds it, its
 * own and a later turn's of its conversation; its list row is computed
 * again. A turn whose record is on its way keeps the amendment until it
 * comes. For a turn the page holds in no form, `fetch` names it, for its
 * record to be read once.
 */
export function turnAmended<S extends LiveState>(
  state: S,
  {traceId, events}: LiveEvents['turn_amended'],
): {state: S; fetch?: string} {
  const turn = state.live.get(traceId);
  if (turn !== undefined) {
    const calls = new Map(turn.calls);
    const received = new Map(turn.received);
    for (const event of events) {
      if ('a2ui.received.attributes' in event.attributes) received.set(event.spanId, event);
      else if (!isTurnEvent(event)) calls.set(event.spanId, event as OtherEvent);
    }
    const updated = withEvents({...turn, calls, received});
    return {state: {...state, live: new Map(state.live).set(traceId, updated)}};
  }
  let held = false;
  let closed = state.closed;
  const before = state.closed.get(traceId);
  let amended: Turn | undefined;
  if (before !== undefined) {
    held = true;
    amended = amendedTurn(before, events);
    closed = new Map(state.closed).set(traceId, amended);
  }
  let records = state.records;
  for (const [id, record] of state.records) {
    if (!('record' in record)) continue;
    const at = record.record.turns.findIndex(
      recorded => recorded.events.find(isTurnEvent)?.traceId === traceId,
    );
    if (at === -1) continue;
    if (id === traceId) held = true;
    const turns = [...record.record.turns];
    turns[at] = amendedTurn(turns[at], events);
    if (id === traceId) amended = turns[at];
    if (records === state.records) records = new Map(state.records);
    (records as Map<string, RecordState>).set(id, {
      record: {...record.record, turns: turns as TurnRecord['turns']},
    });
  }
  let pending = state.pending;
  const asked = state.records.get(traceId);
  if (asked !== undefined && 'loading' in asked) {
    held = true;
    pending = new Map(state.pending).set(traceId, [
      ...(state.pending.get(traceId) ?? []),
      ...events,
    ]);
  }
  let turns = state.turns;
  if (amended !== undefined) {
    const row = turns.find(listed => listed.traceId === traceId);
    if (row !== undefined) turns = upsertRow(turns, closedRow(amended, row));
  }
  const next = {...state, closed, records, pending, turns};
  return held ? {state: next} : {state: next, fetch: traceId};
}

/**
 * A record that has come: the amendments kept for it while it was on its
 * way applied, and the turn's list row computed from it.
 */
export function recordRead<S extends LiveState>(state: S, traceId: string, record: TurnRecord): S {
  const kept = state.pending.get(traceId);
  let pending = state.pending;
  let read = record;
  if (kept !== undefined) {
    pending = new Map(state.pending);
    (pending as Map<string, readonly TurnRecordEvent[]>).delete(traceId);
    const turns = [...record.turns];
    turns[turns.length - 1] = amendedTurn(turns[turns.length - 1], kept);
    read = {...record, turns: turns as TurnRecord['turns']};
  }
  const records = new Map(state.records).set(traceId, {record: read});
  return {...state, records, pending};
}

/** A turn's list row computed again from its record, as an amendment of a turn the page did not hold asks. */
export function rowFromRecord<S extends LiveState>(state: S, traceId: string): S {
  const record = state.records.get(traceId);
  const row = state.turns.find(listed => listed.traceId === traceId);
  if (record === undefined || !('record' in record) || row === undefined) return state;
  const {turns} = record.record;
  return {...state, turns: upsertRow(state.turns, closedRow(turns[turns.length - 1], row))};
}

/** An open turn's events: its wire events and calls by start time, the wire's first on a tie, then its spans. */
function withEvents(turn: LiveTurn): LiveTurn {
  return {...turn, events: [...byStart(turn.wire, turn.calls), ...spansByStart(turn.received)]};
}

/** The wire events and the calls together by start time, as the record joins them; the wire's first on a tie. */
function byStart(
  wire: readonly WireEvent[],
  calls: ReadonlyMap<string, OtherEvent>,
): TurnRecordEvent[] {
  if (calls.size === 0) return [...wire];
  return [...wire, ...calls.values()]
    .map((event, index) => ({event, index, start: BigInt(event.startTimeUnixNano)}))
    .sort((a, b) => (a.start === b.start ? a.index - b.index : a.start < b.start ? -1 : 1))
    .map(({event}) => event);
}

/** The received spans by start time, the order they came among equals. */
function spansByStart(received: ReadonlyMap<string, TurnRecordEvent>): TurnRecordEvent[] {
  return [...received.values()]
    .map((event, index) => ({event, index, start: BigInt(event.startTimeUnixNano)}))
    .sort((a, b) => (a.start === b.start ? a.index - b.index : a.start < b.start ? -1 : 1))
    .map(({event}) => event);
}

/** An open turn's row: the session's agent is the open turn's, and its duration runs to its newest event. */
export function openRow(turn: LiveTurn, agentName: string | undefined): ListedTurn {
  const wireInput = turn.events.find(isWireInput);
  const input = wireInput === undefined ? undefined : inputBrief(wireInput);
  const {durationMs} = openFieldsOf(turn.events, Date.parse(turn.startTime));
  return {
    traceId: turn.traceId,
    ...(turn.conversationId !== undefined && {conversationId: turn.conversationId}),
    startTime: turn.startTime,
    open: true,
    ...(agentName !== undefined && {agentName}),
    ...(turn.events.length > 0 && {durationMs}),
    ...(input !== undefined && {input}),
  };
}

export function closedRow(turn: Turn, row: ListedTurn | undefined): ListedTurn {
  const event = turn.events.find(isTurnEvent);
  const conversationId = event?.attributes['gen_ai.conversation.id'] ?? row?.conversationId;
  const startTime =
    row?.startTime ??
    new Date(event === undefined ? Date.now() : unixMillis(event.startTimeUnixNano)).toISOString();
  return {
    traceId: event?.traceId ?? row?.traceId ?? '',
    ...(conversationId !== undefined && {conversationId}),
    startTime,
    ...rowFieldsOf(turn),
    ...(row?.rejections !== undefined && {rejections: row.rejections}),
  };
}

export function upsertRow(turns: readonly ListedTurn[], row: ListedTurn): ListedTurn[] {
  return sortRows([...turns.filter(turn => turn.traceId !== row.traceId), row]);
}

/** Newest first; turns that started in the same millisecond keep their order. */
export function sortRows(turns: ListedTurn[]): ListedTurn[] {
  return turns.sort((a, b) =>
    a.startTime === b.startTime ? 0 : a.startTime < b.startTime ? 1 : -1,
  );
}
