/** The server's API, as the tool's README describes it. */
import type {KnownCatalog} from './model/catalogs.ts';
import type {A2aVersion, ActionMessage, DataModelMap} from './model/host_message.ts';
import type {InputBrief} from './model/input_brief.ts';
import type {OtherEvent, Turn, TurnOutcome, TurnRecord, WireEvent} from './model/record.ts';

export type {KnownCatalog};

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
  /** The render errors the preview counts, set by the viewer while the turn is in view. */
  renderErrors?: number;
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
  /** The A2A versions the card states, in card order. */
  a2aVersions: string[];
  /** The A2UI extensions the card advertises, in card order. */
  a2uiExtensions: A2uiExtension[];
  /** The first example of each of the card's skills, in card order. */
  examples: string[];
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
  /** The call's complete event, as the record holds it. */
  call_ended: {traceId: string; event: OtherEvent};
  turn_closed: {traceId: string; turn: Turn};
  heartbeat: Record<string, never>;
}

/** A route's refusal, with the server's message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => undefined)) as {error?: string} | undefined;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? `The server answered ${response.status}.`);
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

export const STREAM_PATH = '/api/stream';
