/**
 * Spectra's message box, its own host, as the local API and the headless
 * commands drive it, whatever the transport: its state, a send, a replay and
 * what it refuses with. Each transport's adapter has the host that does it;
 * A2A's is in `a2a/`.
 */
import type {ReplayMode} from './record/turn_record.js';
import type {ReplaySource, ReplayStarted, ReplayState} from './replay/driver.js';

/** A send the box refuses, with the HTTP status the server answers with. */
export class MessageBoxError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MessageBoxError';
  }
}

/**
 * What a host message carries: a text, or one A2UI action message,
 * `{version, action}`, with the data model map, `{version, surfaces}`, when
 * a surface asked for it.
 */
export type BoxInput = ({text: string} | {action: Record<string, unknown>}) & {
  dataModel?: Record<string, unknown>;
};

/** A conversation the box started, as the read route returns it. */
export interface BoxConversation {
  /** The conversation's id; none until the agent's first reply names one. */
  conversationId?: string;
  /** The trace ids of the turns the box sent in this conversation, oldest first. */
  turns: string[];
  /** The trace id of the conversation's open turn, when it has one. */
  openTurn?: string;
}

/** What the read route returns, whatever the transport; an adapter's host adds what is its own. */
export interface MessageBoxState {
  /** The conversations the box started while Spectra runs, oldest first. */
  conversations: BoxConversation[];
  /** Why the box cannot send to this agent, when it cannot. */
  unavailable?: string;
  /** The variables the configured headers name that are not set in Spectra's environment. */
  unsetVariables?: string[];
  /** The replay running, while one does. */
  replay?: ReplayState;
}

/** What the send route answers with. */
export interface SentMessage {
  traceId: string;
  conversationId?: string;
}

/** The message box as the local API and the headless commands drive it. */
export interface MessageBox {
  /** Why the box cannot send to this agent, or nothing when it can. */
  readonly unavailable: string | undefined;
  state(): MessageBoxState;
  /**
   * Sends a text, or an A2UI action, with the data model when one is given,
   * continuing the conversation the box started with the id given, or else
   * starting a new one, and resolves with the turn opened for it.
   */
  send(input: string | BoxInput, conversationId?: string): Promise<SentMessage>;
  /** Replays a record as one new conversation, and resolves once its first turn opens. */
  replay(source: ReplaySource, mode: ReplayMode): Promise<ReplayStarted>;
}

/** "`A` is not set …" or "`A` and `B` are not set …", as the composer's line says it. */
export function unsetVariablesClause(variables: readonly string[]): string {
  const names =
    variables.length <= 1
      ? variables.join('')
      : `${variables.slice(0, -1).join(', ')} and ${variables[variables.length - 1]}`;
  return `${names} ${variables.length === 1 ? 'is' : 'are'} not set in Spectra's environment`;
}
