/**
 * What the page knows of Spectra: the turn listing, the open turns as the
 * live stream sends them, the records it has read, and the message box's
 * conversations. One store, which React reads through `useSpectra`.
 */
import {useSyncExternalStore} from 'react';

import {
  type AgentSnapshot,
  type BoxInput,
  getAgent,
  getAgentLogs,
  getCatalogs,
  getContext,
  getFixture,
  getMessageBox,
  getPrices,
  getRecord,
  type KnownCatalog,
  listFixtures,
  type ListedTurn,
  listTurns,
  type LiveEvents,
  type MessageBoxState,
  type ReplayMode,
  type ReplaySource,
  restartAgent,
  saveFixture,
  sendMessage,
  type SessionContext,
  startReplay,
  STREAM_PATH,
} from '../api.ts';
import type {Prices} from '../model/cost.ts';
import {isTurnEvent, type Turn, type TurnRecordEvent} from '../model/record.ts';
import {
  type AgentHeard,
  agentHeard,
  type AgentLogs,
  type AgentProcess,
  agentRead,
  lastSeqOf,
  logsHeard,
  logsRead,
  seqOf,
  sessionEventOf,
} from './agent.ts';
import {
  fixtureFailed,
  fixtureNotHeld,
  fixtureRead,
  fixturesListed,
  type FixturesState,
  NO_FIXTURES,
  replayEnded,
  replayStarted,
  replayTurn,
  type ReplayTurn,
} from './fixtures.ts';
import {
  callChanged,
  closedRow,
  type LiveTurn,
  openRow,
  type RecordState,
  recordRead,
  RELOAD_EVENTS,
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
  /** The fixtures folder as listed, and the records read from it. */
  fixtures: FixturesState;
  /** The replayed turns heard on the stream this session, by trace id. */
  replayTurns: ReadonlyMap<string, ReplayTurn>;
  /** The session, once read. */
  context?: SessionContext;
  /** Under `run`, the agent's process: its command, its state and the session's restarts and exits. */
  agent?: AgentProcess;
  /** Under `run`, the agent's output as the buffer holds it. */
  logs?: AgentLogs;
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
    fixtures: NO_FIXTURES,
    replayTurns: new Map(),
  };
  readonly #listeners = new Set<() => void>();
  #started = false;
  #source: EventSource | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #silence: ReturnType<typeof setTimeout> | undefined;
  /** What the stream said of the agent's process since it opened, not yet in a route's answer. */
  #agentSince: AgentHeard[] = [];
  /** The log entries the stream sent since it opened, until the logs route has answered. */
  #logSince: Array<LiveEvents['agent_log']> = [];
  /** Whether the agent route has answered since the stream opened: a later answer merges into it. */
  #agentRead = false;
  /** Whether the logs route has been asked, and has answered, since the stream opened. */
  #logsRead: 'no' | 'asked' | 'yes' = 'no';
  /** Counts the stream's opens, so an answer asked for before the latest open is dropped. */
  #opens = 0;

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

  /**
   * Starts a replay, of a fixture or a store turn; answers with the trace id
   * of its first turn, once it opens, or the server's refusal.
   */
  async replay(source: ReplaySource, mode: ReplayMode): Promise<string> {
    const {traceId} = await startReplay(source, mode);
    void this.#refreshBox();
    return traceId;
  }

  /**
   * Re-runs a turn: its conversation sent again up to and including it, every
   * model and tool call live; answers as a replay does.
   */
  rerun(source: ReplaySource): Promise<string> {
    return this.replay(source, 'live');
  }

  /** Restarts the agent's process under `run`; the progress comes on the stream. */
  async restart(): Promise<void> {
    await restartAgent();
  }

  /** Saves a stored turn's record as a fixture; the listing is read again at once. */
  async saveFixture(traceId: string, name: string): Promise<{name: string; path: string}> {
    const saved = await saveFixture(traceId, name);
    void this.#readFixtures();
    return saved;
  }

  /** Reads a fixture the listing has not shown yet, as an address can name one. */
  ensureFixture(name: string): void {
    if (this.#state.fixtures.records.has(name)) return;
    this.#readFixture(name, undefined);
  }

  #readFixture(name: string, savedAt: string | undefined): void {
    this.#set({fixtures: fixtureNotHeld(this.#state.fixtures, name)});
    getFixture(name).then(
      record => this.#set({fixtures: fixtureRead(this.#state.fixtures, name, savedAt, record)}),
      (error: unknown) =>
        this.#set({
          fixtures: fixtureFailed(
            this.#state.fixtures,
            name,
            error instanceof Error ? error.message : String(error),
          ),
        }),
    );
  }

  /** Reads the listing, and each fixture's record that is new or whose saved time changed. */
  async #readFixtures(): Promise<void> {
    try {
      const {fixtures, read} = fixturesListed(this.#state.fixtures, await listFixtures());
      this.#set({fixtures});
      for (const {name, savedAt} of read) this.#readFixture(name, savedAt);
    } catch {
      // The check marks the page as not connected; the stream's next open reads again.
    }
  }

  #connect(): void {
    this.#retry = undefined;
    this.#source?.close();
    const source = new EventSource(STREAM_PATH);
    this.#source = source;
    source.onopen = () => {
      this.#heard(source);
      // The agent's routes are read again: what the stream says from here on is newer than their answers.
      this.#opens += 1;
      this.#agentSince = [];
      this.#logSince = [];
      this.#agentRead = false;
      this.#logsRead = 'no';
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
    on('replay_started', data => this.#set(replayStarted(this.#state, data)));
    on('replay_turn', data => {
      this.#set(replayTurn(this.#state, data));
      void this.#refreshBox();
    });
    on('replay_ended', () => {
      this.#set(replayEnded(this.#state));
      void this.#refreshBox();
    });
    on('fixtures_changed', () => void this.#readFixtures());
    on('agent_state', data => this.#agentHeard({state: data}));
    on('agent_restarted', data =>
      this.#agentHeard({event: sessionEventOf('agent_restarted', data)}),
    );
    on('agent_exited', data => this.#agentHeard({event: sessionEventOf('agent_exited', data)}));
    on('agent_log', data => {
      const {logs} = this.#state;
      if (this.#logsRead === 'yes' && logs !== undefined) this.#set({logs: logsHeard(logs, data)});
      else this.#logSince.push(data);
    });
    // The agent's process changed state under run, or a catalog file was read again: the context and
    // the box follow the card and the state, and the list's counts and Structure the definitions.
    for (const name of RELOAD_EVENTS) on(name, () => void this.#reload());
    on('heartbeat', () => {});
  }

  /** What the stream said of the agent's process: kept until a route's answer holds it, and applied at once. */
  #agentHeard(heard: AgentHeard): void {
    this.#agentSince.push(heard);
    const {agent} = this.#state;
    if (agent !== undefined) this.#replace({...this.#state, agent: agentHeard(agent, heard)});
  }

  /**
   * Under `run`, reads the agent's process, and its output once per stream
   * open; the buffer the page held stays until the route's answer replaces it.
   */
  async #readAgent(): Promise<void> {
    const open = this.#opens;
    const snapshot: AgentSnapshot = await getAgent();
    if (open !== this.#opens) return;
    // An answer that passed another on its way merges into the newer one: neither's state goes back.
    const read = agentRead(snapshot, this.#agentSince);
    const {agent} = this.#state;
    this.#set({
      agent:
        this.#agentRead && agent !== undefined
          ? agent.events.reduce((merged, event) => agentHeard(merged, {event}), {
              ...read,
              state: agent.state.seq > read.state.seq ? agent.state : read.state,
            })
          : read,
    });
    this.#agentRead = true;
    const last = lastSeqOf(snapshot);
    this.#agentSince = this.#agentSince.filter(heard => seqOf(heard) > last);
    if (this.#logsRead !== 'no') return;
    this.#logsRead = 'asked';
    try {
      const logs = await getAgentLogs();
      if (open !== this.#opens) return;
      this.#set({logs: logsRead(logs, this.#logSince)});
      this.#logsRead = 'yes';
      this.#logSince = [];
    } catch (error) {
      if (open === this.#opens) this.#logsRead = 'no';
      throw error;
    }
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
      void this.#readFixtures();
      // Spectra owns the agent's process under `run` alone: under `attach` there is none to read.
      if (context.mode === 'run') await this.#readAgent();
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
