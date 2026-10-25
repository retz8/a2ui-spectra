/** The server's API, as the tool's README describes it. */
import type {InputBrief} from './model/input_brief.ts';
import type {Turn, TurnOutcome, TurnRecord, WireEvent} from './model/record.ts';

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
  schemaCheck?: {passed: boolean; findings: number};
  /** How many of the turn's A2UI messages web core's message processor rejects. */
  rejections?: number;
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
}

/** What the live stream sends, by event name. */
export interface LiveEvents {
  turn_opened: {traceId: string; conversationId?: string; startTime: string};
  wire_event: {traceId: string; event: WireEvent};
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

/** Sends a message from the box, continuing the conversation named, or else in a new one. */
export function sendMessage(
  text: string,
  conversationId?: string,
): Promise<{traceId: string; conversationId?: string}> {
  return post('/api/message-box/messages', {text, conversationId});
}

export const STREAM_PATH = '/api/stream';
