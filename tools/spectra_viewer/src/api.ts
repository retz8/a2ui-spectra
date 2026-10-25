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

/** The session, as the context bar shows it. */
export interface SessionContext {
  agentName?: string;
  mode: 'run' | 'attach';
  /** The wire proxy's address, for a host app to point at. */
  proxyAddress: string;
}

/** The message box's conversation. */
export interface MessageBoxState {
  conversationId?: string;
  /** The trace ids of the turns the box sent in this conversation, oldest first. */
  turns?: string[];
  openTurn?: string;
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

export function sendMessage(text: string): Promise<{traceId: string; conversationId?: string}> {
  return post('/api/message-box/messages', {text});
}

export function startNewConversation(): Promise<MessageBoxState> {
  return post('/api/message-box/new-conversation', {});
}

export const STREAM_PATH = '/api/stream';
