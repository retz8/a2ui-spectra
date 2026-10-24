/**
 * What the page knows of Spectra: the turn listing, the open turns as the
 * live stream sends them, the records it has read, and the message box's
 * conversation. One store, which React reads through `useSpectra`.
 */
import {useSyncExternalStore} from 'react';

import {
  getMessageBox,
  getRecord,
  type ListedTurn,
  listTurns,
  type LiveEvents,
  type MessageBoxState,
  sendMessage,
  startNewConversation,
  STREAM_PATH,
} from '../api.ts';
import {inputBrief} from '../model/input_brief.ts';
import {
  isTurnEvent,
  isWireInput,
  type Turn,
  type TurnRecord,
  unixMillis,
  type WireEvent,
} from '../model/record.ts';
import {rowFieldsOf} from '../model/summary.ts';

/** An open turn, as the live stream has sent it so far. */
export interface LiveTurn {
  traceId: string;
  conversationId?: string;
  startTime: string;
  events: WireEvent[];
}

/** A record the page has asked for. */
export type RecordState = {loading: true} | {record: TurnRecord} | {error: string};

export interface SpectraState {
  /** Whether the live stream is open; unknown until it has opened or failed once. */
  connected?: boolean;
  /** Whether the listing has loaded once. */
  loaded: boolean;
  /** The turn list, newest first. */
  turns: ListedTurn[];
  live: ReadonlyMap<string, LiveTurn>;
  /** The turns that closed while the page was open, as the stream sent them. */
  closed: ReadonlyMap<string, Turn>;
  records: ReadonlyMap<string, RecordState>;
  box: MessageBoxState;
}

/** How long to wait before opening the live stream again after it was dropped. */
const RETRY_MS = 2000;

/**
 * How often the page checks that the server answers. A proxy in front of
 * Spectra, such as a tunnel, can keep the browser's side of the stream open
 * after Spectra has gone, so the stream alone does not show it is down.
 */
const CHECK_MS = 5000;

class Spectra {
  #state: SpectraState = {
    loaded: false,
    turns: [],
    live: new Map(),
    closed: new Map(),
    records: new Map(),
    box: {},
  };
  readonly #listeners = new Set<() => void>();
  #started = false;
  #source: EventSource | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;

  getState = (): SpectraState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /**
   * Reads the listing and the box, opens the live stream, and checks the
   * server from then on. Each time the stream opens, the listing and the box
   * are read again.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.#reload();
    this.#connect();
    setInterval(() => void this.#check(), CHECK_MS);
  }

  /** Reads a closed turn's record, once. A turn still open is asked for again later. */
  ensureRecord(traceId: string): void {
    if (this.#state.records.has(traceId)) return;
    this.#setRecord(traceId, {loading: true});
    getRecord(traceId).then(
      record => this.#setRecord(traceId, {record}),
      (error: unknown) => {
        if ((error as {status?: number}).status === 409) {
          this.#setRecord(traceId, undefined);
        } else {
          this.#setRecord(traceId, {error: error instanceof Error ? error.message : String(error)});
        }
      },
    );
  }

  /** Sends a message from the box; answers with the trace id of its turn, once it opens. */
  async send(text: string): Promise<string> {
    const {traceId} = await sendMessage(text);
    await this.#refreshBox();
    return traceId;
  }

  async newConversation(): Promise<void> {
    this.#set({box: await startNewConversation()});
  }

  #connect(): void {
    this.#retry = undefined;
    this.#source?.close();
    const source = new EventSource(STREAM_PATH);
    this.#source = source;
    source.onopen = () => {
      // The stream catches a new subscriber up on the open turns, so they start again from it.
      this.#set({connected: true, live: new Map()});
      void this.#reload();
    };
    source.onerror = () => {
      this.#set({connected: false});
      if (source.readyState === EventSource.CLOSED) this.#reconnect();
    };
    const on = <Name extends keyof LiveEvents>(
      name: Name,
      handle: (data: LiveEvents[Name]) => void,
    ) =>
      source.addEventListener(name, event =>
        handle(JSON.parse((event as MessageEvent<string>).data) as LiveEvents[Name]),
      );
    on('turn_opened', data => this.#turnOpened(data));
    on('wire_event', data => this.#wireEvent(data));
    on('turn_closed', data => this.#turnClosed(data));
  }

  /** Drops the stream and opens it again after a pause, once. */
  #reconnect(): void {
    this.#source?.close();
    this.#source = undefined;
    if (this.#retry === undefined) this.#retry = setTimeout(() => this.#connect(), RETRY_MS);
  }

  /** Checks that the server answers, keeping the box's state current; drops the stream when it does not. */
  async #check(): Promise<void> {
    try {
      const box = await getMessageBox();
      if (JSON.stringify(box) !== JSON.stringify(this.#state.box)) this.#set({box});
    } catch {
      if (this.#source !== undefined) {
        this.#set({connected: false});
        this.#reconnect();
      }
    }
  }

  async #reload(): Promise<void> {
    try {
      const [turns, box] = await Promise.all([listTurns(), getMessageBox()]);
      // What the stream said while the listing was on its way is newer than the listing.
      const {live, closed} = this.#state;
      const rows = new Map(turns.map(turn => [turn.traceId, turn]));
      for (const [traceId, turn] of closed) rows.set(traceId, closedRow(turn, rows.get(traceId)));
      for (const turn of live.values()) {
        if (!rows.has(turn.traceId)) rows.set(turn.traceId, openRow(turn));
      }
      this.#set({loaded: true, turns: sortRows([...rows.values()]), box});
    } catch {
      // The check marks the page as not connected; the stream's next open reads again.
    }
  }

  async #refreshBox(): Promise<void> {
    try {
      this.#set({box: await getMessageBox()});
    } catch {
      // Left as it was; the next stream open reads it again.
    }
  }

  #turnOpened(data: LiveEvents['turn_opened']): void {
    const turn: LiveTurn = {...data, events: []};
    const live = new Map(this.#state.live).set(data.traceId, turn);
    this.#set({live, turns: upsertRow(this.#state.turns, openRow(turn))});
  }

  #wireEvent({traceId, event}: LiveEvents['wire_event']): void {
    const turn = this.#state.live.get(traceId);
    if (turn === undefined) return;
    const updated = {...turn, events: [...turn.events, event]};
    const live = new Map(this.#state.live).set(traceId, updated);
    const row = this.#state.turns.find(row => row.traceId === traceId);
    let turns = this.#state.turns;
    if (row !== undefined && row.input === undefined && isWireInput(event)) {
      const input = inputBrief(event);
      if (input !== undefined) turns = upsertRow(turns, {...row, input});
    }
    this.#set({live, turns});
  }

  #turnClosed({traceId, turn}: LiveEvents['turn_closed']): void {
    const live = new Map(this.#state.live);
    live.delete(traceId);
    const closed = new Map(this.#state.closed).set(traceId, turn);
    const row = this.#state.turns.find(row => row.traceId === traceId);
    this.#set({live, closed, turns: upsertRow(this.#state.turns, closedRow(turn, row))});
    const {box} = this.#state;
    const conversationId = turn.events.find(isTurnEvent)?.attributes['gen_ai.conversation.id'];
    if (
      box.openTurn === traceId ||
      (conversationId !== undefined && box.conversationId === conversationId)
    ) {
      void this.#refreshBox();
    }
  }

  #setRecord(traceId: string, state: RecordState | undefined): void {
    const records = new Map(this.#state.records);
    if (state === undefined) records.delete(traceId);
    else records.set(traceId, state);
    this.#set({records});
  }

  #set(changes: Partial<SpectraState>): void {
    this.#state = {...this.#state, ...changes};
    for (const listener of this.#listeners) listener();
  }
}

function openRow(turn: LiveTurn): ListedTurn {
  const wireInput = turn.events.find(isWireInput);
  const input = wireInput === undefined ? undefined : inputBrief(wireInput);
  return {
    traceId: turn.traceId,
    ...(turn.conversationId !== undefined && {conversationId: turn.conversationId}),
    startTime: turn.startTime,
    open: true,
    ...(input !== undefined && {input}),
  };
}

function closedRow(turn: Turn, row: ListedTurn | undefined): ListedTurn {
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
  };
}

function upsertRow(turns: readonly ListedTurn[], row: ListedTurn): ListedTurn[] {
  return sortRows([...turns.filter(turn => turn.traceId !== row.traceId), row]);
}

/** Newest first; turns that started in the same millisecond keep their order. */
function sortRows(turns: ListedTurn[]): ListedTurn[] {
  return turns.sort((a, b) =>
    a.startTime === b.startTime ? 0 : a.startTime < b.startTime ? 1 : -1,
  );
}

export const spectra = new Spectra();

export function useSpectra(): SpectraState {
  return useSyncExternalStore(spectra.subscribe, spectra.getState);
}
