/**
 * What the page knows of Spectra: the turn listing, the open turns as the
 * live stream sends them, the records it has read, and the message box's
 * conversations. One store, which React reads through `useSpectra`.
 */
import {useSyncExternalStore} from 'react';

import {
  type BoxInput,
  getCatalogs,
  getContext,
  getMessageBox,
  getPrices,
  getRecord,
  type KnownCatalog,
  type ListedTurn,
  listTurns,
  type LiveEvents,
  type MessageBoxState,
  sendMessage,
  type SessionContext,
  STREAM_PATH,
} from '../api.ts';
import type {Prices} from '../model/cost.ts';
import {isTurnEvent, type Turn, type TurnRecordEvent} from '../model/record.ts';
import {
  callChanged,
  closedRow,
  type LiveTurn,
  openRow,
  type RecordState,
  recordRead,
  rowFromRecord,
  sortRows,
  turnAmended,
  turnClosed,
  turnOpened,
  wireEvent,
} from './live.ts';

export type {LiveTurn, RecordState};

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
  /** Amendments of turns whose record is on its way, by trace id, applied when it comes. */
  pending: ReadonlyMap<string, readonly TurnRecordEvent[]>;
  box: MessageBoxState;
  /** The session, once read. */
  context?: SessionContext;
  /** The catalog definitions Spectra knows, once read; the same array until they change. */
  catalogs?: KnownCatalog[];
  /** LiteLLM's price table and the config's prices, once read. */
  prices?: Prices;
}

/** How long to wait before opening the live stream again after it was dropped. */
const RETRY_MS = 2000;

/**
 * How often the page checks that the server answers. A proxy in front of
 * Spectra, such as a tunnel, can keep the browser's side of the stream open
 * after Spectra has gone, so the stream alone does not show it is down.
 */
const CHECK_MS = 5000;

/**
 * How long the live stream may stay silent before the page opens it again.
 * The server sends a heartbeat every two seconds; a stream a proxy holds open
 * after Spectra stopped, or restarted, sends nothing more.
 */
const SILENCE_MS = 7000;

class Spectra {
  #state: SpectraState = {
    loaded: false,
    turns: [],
    live: new Map(),
    closed: new Map(),
    records: new Map(),
    pending: new Map(),
    box: {conversations: []},
  };
  readonly #listeners = new Set<() => void>();
  #started = false;
  #source: EventSource | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #silence: ReturnType<typeof setTimeout> | undefined;

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
  ensureRecord(traceId: string, {row = false}: {row?: boolean} = {}): void {
    if (this.#state.records.has(traceId)) return;
    this.#setRecord(traceId, {loading: true});
    getRecord(traceId).then(
      record => {
        const read = recordRead(this.#state, traceId, record);
        this.#replace(row ? rowFromRecord(read, traceId) : read);
      },
      (error: unknown) => {
        if ((error as {status?: number}).status === 409) {
          this.#setRecord(traceId, undefined);
        } else {
          this.#setRecord(traceId, {error: error instanceof Error ? error.message : String(error)});
        }
      },
    );
  }

  /**
   * Sends a text or an action from the box, continuing the box's conversation
   * named or else in a new one; answers with the trace id of its turn, once
   * it opens.
   */
  async send(input: BoxInput, conversationId?: string): Promise<string> {
    const {traceId} = await sendMessage(input, conversationId);
    await this.#refreshBox();
    return traceId;
  }

  #connect(): void {
    this.#retry = undefined;
    this.#source?.close();
    const source = new EventSource(STREAM_PATH);
    this.#source = source;
    source.onopen = () => {
      this.#heard(source);
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
      source.addEventListener(name, event => {
        this.#heard(source);
        handle(JSON.parse((event as MessageEvent<string>).data) as LiveEvents[Name]);
      });
    const agent = () => this.#state.context?.agentName;
    on('turn_opened', data => this.#replace(turnOpened(this.#state, data, agent())));
    on('wire_event', data => this.#replace(wireEvent(this.#state, data, agent())));
    on('call_started', ({traceId, event}) =>
      this.#replace(callChanged(this.#state, traceId, event.spanId, () => event)),
    );
    on('call_chunk', ({traceId, spanId, chunk}) =>
      this.#replace(
        callChanged(
          this.#state,
          traceId,
          spanId,
          call => call && {...call, events: [...(call.events ?? []), chunk]},
        ),
      ),
    );
    on('call_progress', ({traceId, spanId, attributes}) =>
      this.#replace(
        callChanged(
          this.#state,
          traceId,
          spanId,
          call => call && {...call, attributes: {...call.attributes, ...attributes}},
        ),
      ),
    );
    on('call_ended', ({traceId, event}) =>
      this.#replace(callChanged(this.#state, traceId, event.spanId, () => event)),
    );
    on('turn_closed', data => this.#turnClosed(data));
    on('turn_amended', data => {
      const {state, fetch} = turnAmended(this.#state, data);
      this.#replace(state);
      // A turn the page holds in no form: its record is read once, and its list row from it.
      if (fetch !== undefined) this.ensureRecord(fetch, {row: true});
    });
    on('heartbeat', () => {});
  }

  /** Opens the stream again when nothing, not even a heartbeat, comes on it for a while. */
  #heard(source: EventSource): void {
    clearTimeout(this.#silence);
    this.#silence = setTimeout(() => {
      if (this.#source !== source) return;
      this.#set({connected: false});
      this.#reconnect();
    }, SILENCE_MS);
  }

  /** Drops the stream and opens it again after a pause, once. */
  #reconnect(): void {
    clearTimeout(this.#silence);
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
      const [turns, box, context, catalogs] = await Promise.all([
        listTurns(),
        getMessageBox(),
        getContext(),
        getCatalogs(),
      ]);
      // What the stream said while the listing was on its way is newer than the listing.
      const {live, closed} = this.#state;
      // An open turn's agent is the session's.
      const rows = new Map(
        turns.map(turn => [
          turn.traceId,
          turn.open && context.agentName !== undefined
            ? {agentName: context.agentName, ...turn}
            : turn,
        ]),
      );
      for (const [traceId, turn] of closed) rows.set(traceId, closedRow(turn, rows.get(traceId)));
      for (const turn of live.values()) {
        rows.set(turn.traceId, {...rows.get(turn.traceId), ...openRow(turn, context.agentName)});
      }
      const known =
        JSON.stringify(catalogs) === JSON.stringify(this.#state.catalogs)
          ? this.#state.catalogs
          : catalogs;
      this.#set({loaded: true, turns: sortRows([...rows.values()]), box, context, catalogs: known});
      if (this.#state.prices === undefined) void this.#readPrices();
    } catch {
      // The check marks the page as not connected; the stream's next open reads again.
    }
  }

  async #readPrices(): Promise<void> {
    try {
      this.#set({prices: await getPrices()});
    } catch {
      // Read again with the listing; without it, no cost is shown.
    }
  }

  async #refreshBox(): Promise<void> {
    try {
      this.#set({box: await getMessageBox()});
    } catch {
      // Left as it was; the next stream open reads it again.
    }
  }

  #turnClosed(data: LiveEvents['turn_closed']): void {
    const {traceId, turn} = data;
    this.#replace(turnClosed(this.#state, data));
    // The listing counts the turn's rejections after the conversation's earlier turns.
    void this.#reload();
    const conversationId = turn.events.find(isTurnEvent)?.attributes['gen_ai.conversation.id'];
    const held = this.#state.box.conversations.some(
      conversation =>
        conversation.turns.includes(traceId) ||
        (conversationId !== undefined && conversation.conversationId === conversationId),
    );
    if (held) void this.#refreshBox();
  }

  #setRecord(traceId: string, state: RecordState | undefined): void {
    const records = new Map(this.#state.records);
    if (state === undefined) records.delete(traceId);
    else records.set(traceId, state);
    this.#set({records});
  }

  #replace(state: SpectraState): void {
    if (state !== this.#state) this.#set(state);
  }

  #set(changes: Partial<SpectraState>): void {
    this.#state = {...this.#state, ...changes};
    for (const listener of this.#listeners) listener();
  }
}

export const spectra = new Spectra();

export function useSpectra(): SpectraState {
  return useSyncExternalStore(spectra.subscribe, spectra.getState);
}
