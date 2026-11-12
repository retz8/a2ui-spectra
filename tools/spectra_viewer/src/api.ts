/** The server's API, as the tool's README describes it. */
import type {KnownCatalog} from './model/catalogs.ts';
import type {Prices} from './model/cost.ts';
import type {A2aVersion, ActionMessage, DataModelMap} from './model/host_message.ts';
import type {InputBrief} from './model/input_brief.ts';
import type {ReplayMode} from './model/provenance.ts';
import type {
  OtherEvent,
  Turn,
  TurnOutcome,
  TurnRecord,
  TurnRecordEvent,
  WireEvent,
} from './model/record.ts';

export type {KnownCatalog, ReplayMode};

/** One entry of the turn listing. */
export interface ListedTurn {
  traceId: string;
  conversationId?: string;
  /** The turn's start, as an ISO 8601 UTC time. */
  startTime: string;
  open?: true;
  outcome?: TurnOutcome;
  agentName?: string;
  durationMs?: number;
  input?: InputBrief;
  /** The findings of the turn's checks together, when it has check events. */
  findings?: number;
  /** How many of the turn's A2UI messages web core's message processor rejects that no finding points into. */
  rejections?: number;
  /** How many of the turn's call rows failed, model and tool, proxy and span-only, when any did. */
  failedCalls?: number;
  /** The A2UI step's errors: each parse error and each failed prompt generation, when any. */
  a2uiStepErrors?: number;
  /** A replayed turn's different outcome and different A2UI, when it has them. */
  replayDifferences?: number;
  /** The render errors the preview counts, set by the viewer while the turn is in view. */
  renderErrors?: number;
  /** Set on a turn whose record was not written to the store: it is held in memory, with no file to replay. */
  unwritten?: true;
}

/** An A2UI extension the agent's card advertises. */
export interface A2uiExtension {
  /** The version its URI names, such as `v0.9`. */
  version: string;
  catalogIds: string[];
}

/** The session, as the context bar, the agent's popover and the first screen show it. */
export interface SessionContext {
  agentName?: string;
  /** The agent's own URL, the one Spectra was given. */
  agentUrl: string;
  mode: 'run' | 'attach';
  /** The wire proxy's address, for a host app to point at. */
  proxyAddress: string;
  /** The config file's preview pages, in config order. */
  previewPages?: string[];
  /** Under `attach`, the variables and values to set in the agent's shell, as `attach` prints them. */
  variables?: Array<{name: string; value: string}>;
  /** The A2A versions the latest card states, in card order; none under `run` before any card has answered. */
  a2aVersions?: string[];
  /** The A2UI extensions the latest card advertises, in card order; none before any card has answered. */
  a2uiExtensions?: A2uiExtension[];
  /** The first example of each of the latest card's skills, in card order; none before any card has answered. */
  examples?: string[];
  /** The fixtures folder's path as shown. */
  fixturesFolder: string;
}

/** A conversation the message box started. */
export interface BoxConversation {
  conversationId?: string;
  /** The trace ids of the turns the box sent in this conversation, oldest first. */
  turns: string[];
  openTurn?: string;
}

/** The conversations the message box started while Spectra runs. */
export interface MessageBoxState {
  /** Oldest first. */
  conversations: BoxConversation[];
  unavailable?: string;
  /** The variables the configured headers name that are not set in Spectra's environment. */
  unsetVariables?: string[];
  /** The A2A version of the interface the box sends to, when the card lists one it speaks. */
  a2aVersion?: A2aVersion;
  /** The replay running, while one does. */
  replay?: ReplayState;
}

/** The replay running. */
export interface ReplayState {
  /** The record's path, as the turns' provenance names it. */
  source: string;
  mode: ReplayMode;
  /** The number of the turn being replayed, of the total; 0 before the first opens. */
  turn: number;
  turns: number;
}

/** One file of the fixtures folder, as the listing gives it. */
export interface ListedFixture {
  /** Its path relative to the folder without `.json`, `/` between folders. */
  name: string;
  /** Its path as shown. */
  path: string;
  /** Its modification time, as an ISO 8601 UTC time. */
  savedAt: string;
  /** The record's turns in the turn listing's form, oldest first, when the file reads as a record. */
  turns?: ListedTurn[];
  /** Why the file does not read as a record, when it does not. */
  error?: string;
}

export interface FixturesListing {
  /** The folder's path as shown. */
  folder: string;
  /** Every `.json` under the folder, in path order. */
  fixtures: ListedFixture[];
}

/**
 * What to replay: a fixture by its name, whole or, with `turn`, up to and
 * including the turn of that recorded trace id; or a store turn by its trace id.
 */
export type ReplaySource = {fixture: string; turn?: string} | {traceId: string};

/** Where the agent's process stands under `run`, with its number in the session's order. */
export type AgentProcessState = {seq: number} & (
  | {state: 'starting'}
  /** With why no card has answered yet, in the terminal's words, and the terminal's wait line whole. */
  | {state: 'waiting'; reason: string; line?: string}
  | {state: 'running'}
  | {state: 'restarting'}
  /** With the exit line, in the terminal's words after "The agent's process". */
  | {state: 'down'; exit: string}
);

/** What caused a restart: a press of Restart, or a save of a watched file. */
export type RestartCause = {kind: 'press'} | {kind: 'save'; file: string};

/** One event of the session under `run`: a restart, or an exit the agent took on its own. */
export type AgentSessionEvent =
  | {type: 'agent_restarted'; seq: number; time: string; cause: RestartCause}
  | {type: 'agent_exited'; seq: number; time: string; exit: string};

/** What `GET /api/agent` gives under `run`. */
export interface AgentSnapshot {
  /** The command as launched, its arguments as given. */
  command: string;
  state: AgentProcessState;
  /** The session's restarts and exits, every one, oldest first. */
  events: AgentSessionEvent[];
}

/** One entry of the agent's output buffer: a line, or the divider of a stop or a start. */
export type LogEntry = {
  /** Its number in the buffer's order, from 1 for the session. */
  n: number;
  /** When it entered the buffer, as an ISO 8601 UTC time to the millisecond. */
  time: string;
} & (
  | {type: 'line'; stream: 'stdout' | 'stderr'; text: string}
  | {type: 'stopped'; exit: string; cause?: RestartCause}
  | {type: 'started'; command: string}
);

/** What `GET /api/agent/logs` gives under `run`. */
export interface LogSnapshot {
  /** The entries held, oldest first. */
  entries: LogEntry[];
  /** How many of them are output lines. */
  lines: number;
  cap: number;
}

/** One response chunk of a call, as the record holds it: a span event named `a2ui.http.response.chunk`. */
export interface CallChunk {
  timeUnixNano: string;
  name: string;
  attributes?: Record<string, unknown>;
}

/** What the live stream sends, by event name. */
export interface LiveEvents {
  turn_opened: {traceId: string; conversationId?: string; startTime: string};
  /** The conversation once the host's request or a reply has named it. */
  wire_event: {traceId: string; conversationId?: string; event: WireEvent};
  /** A call placed in an open turn: its event so far, with its start, its request and the names read from it. */
  call_started: {traceId: string; event: OtherEvent};
  /** One response chunk of a call, as it arrives. */
  call_chunk: {traceId: string; spanId: string; chunk: CallChunk};
  /** A model call's response names read from its chunks so far. */
  call_progress: {traceId: string; spanId: string; attributes: Record<string, unknown>};
  /** The call's complete event, as the record holds it. */
  call_ended: {traceId: string; event: OtherEvent};
  turn_closed: {traceId: string; turn: Turn};
  /**
   * The events one export to the receiver added to a turn or changed in it,
   * open or written, in the record's shape: the spans placed, the proxies'
   * calls whose links grew, the turn event when its capture paths changed.
   * Each replaces the event of its span id, or is added.
   */
  turn_amended: {traceId: string; events: TurnRecordEvent[]};
  replay_started: {source: string; mode: ReplayMode; turns: number};
  /** As each replayed turn opens: the recorded turn it stands for, and its number of the total. */
  replay_turn: {traceId: string; recordedTurn: string; turn: number; turns: number};
  /** Under the `live` mode it carries no verdict, and a turn sent no verdict and no count. */
  replay_ended: {
    source: string;
    mode: ReplayMode;
    verdict?: 'passed' | 'failed';
    turns: ReadonlyArray<
      | {traceId: string; recordedTurn: string; verdict?: 'passed' | 'failed'; unconsumed?: number}
      | {recordedTurn: string; notSent: string}
    >;
  };
  /** A file joined, changed in or left the fixtures folder; the listing is to be read again. */
  fixtures_changed: Record<string, never>;
  /** A configured catalog file was read again, or its read failed; the listing is to be read again. */
  catalogs_changed: Record<string, never>;
  /** Under `run`, the state of the agent's process, whole, at each change; the context and the box are current by then. */
  agent_state: AgentProcessState;
  /** Under `run`, a restart of the agent's process, with the time it began and its cause. */
  agent_restarted: {seq: number; time: string; cause: RestartCause};
  /** Under `run`, an exit the agent took on its own, with its time and its exit line. */
  agent_exited: {seq: number; time: string; exit: string};
  /** Under `run`, the entries one read of the agent's output put into the buffer, and the number of the oldest still held. */
  agent_log: {entries: LogEntry[]; oldest: number};
  heartbeat: Record<string, never>;
}

/** A route's refusal, with the server's message. */
export class ApiError extends Error {
  readonly status: number;
  /** What a clash suggests in its place: the first free numbered name. */
  readonly suggested?: string;

  constructor(status: number, message: string, suggested?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (suggested !== undefined) this.suggested = suggested;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => undefined)) as
    {error?: string; suggested?: string} | undefined;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? `The server answered ${response.status}.`,
      body?.suggested,
    );
  }
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
}

export function getContext(): Promise<SessionContext> {
  return request<SessionContext>('/api/context');
}

export async function listTurns(): Promise<ListedTurn[]> {
  return (await request<{turns: ListedTurn[]}>('/api/turns')).turns;
}

export function getRecord(traceId: string): Promise<TurnRecord> {
  return request<TurnRecord>(`/api/turns/${traceId}`);
}

export function getMessageBox(): Promise<MessageBoxState> {
  return request<MessageBoxState>('/api/message-box');
}

/** The catalog definitions Spectra knows: the built-in and the configured ones. */
export async function getCatalogs(): Promise<KnownCatalog[]> {
  return (await request<{catalogs: KnownCatalog[]}>('/api/catalogs')).catalogs;
}

/** LiteLLM's price table as Spectra copied it, its release and date, and the config's prices. Read once. */
export function getPrices(): Promise<Prices> {
  return request<Prices>('/api/prices');
}

/**
 * What the box sends: a text, or an A2UI action message, with the data model
 * map when a surface asked for it.
 */
export type BoxInput = ({text: string} | {action: ActionMessage}) & {dataModel?: DataModelMap};

/**
 * Sends a message from the box, continuing the conversation named, or else in
 * a new one; an action only continues a conversation.
 */
export function sendMessage(
  input: BoxInput,
  conversationId?: string,
): Promise<{traceId: string; conversationId?: string}> {
  return post('/api/message-box/messages', {...input, conversationId});
}

/** The fixtures folder's files, each one's turns in the listing's form. */
export function listFixtures(): Promise<FixturesListing> {
  return request<FixturesListing>('/api/fixtures');
}

/** A fixture's record, by its name, each segment of the path encoded. */
export function getFixture(name: string): Promise<TurnRecord> {
  return request<TurnRecord>(`/api/fixtures/${name.split('/').map(encodeURIComponent).join('/')}`);
}

/** Saves a stored turn's record whole under a name. */
export function saveFixture(traceId: string, name: string): Promise<{name: string; path: string}> {
  return post('/api/fixtures', {traceId, name});
}

/** Starts a replay; answers once its first turn opens. */
export function startReplay(
  source: ReplaySource,
  mode: ReplayMode,
): Promise<{traceId: string; turns: number}> {
  return post('/api/replays', {source, mode});
}

/** Under `run`, the agent's process: its command, its state and the session's events. `404` under `attach`. */
export function getAgent(): Promise<AgentSnapshot> {
  return request<AgentSnapshot>('/api/agent');
}

/** Under `run`, the agent's output as the buffer holds it. `404` under `attach`. */
export function getAgentLogs(): Promise<LogSnapshot> {
  return request<LogSnapshot>('/api/agent/logs');
}

/** Restarts the agent's process; answers at once, the progress coming on the live stream. */
export function restartAgent(): Promise<{accepted: boolean}> {
  return post('/api/agent/restart', {});
}

export const STREAM_PATH = '/api/stream';
