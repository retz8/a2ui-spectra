import {randomUUID} from 'node:crypto';

import {
  boxRequest,
  type BoxInterface,
  chooseInterface,
  type InterfaceChoice,
  readReplySummary,
  type ReplySummary,
} from './a2a/client.js';
import {isEventOfKind, type Turn, type TurnEvent} from './record/turn_record.js';
import type {TurnHub} from './turn_hub.js';

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

/** A conversation the box started, as the read route returns it. */
export interface BoxConversation {
  /** The conversation's id; none until the agent's first reply names one. */
  conversationId?: string;
  /** The trace ids of the turns the box sent in this conversation, oldest first. */
  turns: string[];
  /** The trace id of the conversation's open turn, when it has one. */
  openTurn?: string;
}

/** What the read route returns. */
export interface MessageBoxState {
  /** The conversations the box started while Spectra runs, oldest first. */
  conversations: BoxConversation[];
  /** Why the box cannot send to this agent, when it cannot. */
  unavailable?: string;
}

/** What the send route answers with. */
export interface SentMessage {
  traceId: string;
  conversationId?: string;
}

/** A conversation the box holds, with what it carries into the next send. */
interface Conversation {
  conversationId?: string;
  taskId?: string;
  turns: string[];
  /** The open turn: true while its request is on its way, then its trace id. */
  open?: string | true;
}

export interface MessageBoxOptions {
  /** The agent's card, its JSON-RPC endpoints pointed at the wire proxy. */
  card: Record<string, unknown>;
  turns: TurnHub;
  fetch?: typeof fetch;
  newMessageId?: () => string;
}

/**
 * Spectra's message box as a host: an A2A client sending through the wire
 * proxy, holding each conversation it starts. A send starts a conversation or
 * continues one of them, and answers once the proxy opens its turn; the reply
 * is read in the background for the conversation and the task to carry into
 * the conversation's next send.
 */
export class MessageBox {
  readonly #target: InterfaceChoice;
  readonly #turns: TurnHub;
  readonly #fetch: typeof fetch;
  readonly #newMessageId: () => string;
  readonly #stop = new AbortController();
  readonly #unsubscribe: () => void;
  /** Turns waited for: by the host message's id until they open, by trace id until they close. */
  readonly #opening = new Map<string, (traceId: string) => void>();
  readonly #closing = new Map<string, (turn: Turn) => void>();
  #requestId = 0;
  /** Oldest first; a new conversation joins once its first turn opens. */
  readonly #conversations: Conversation[] = [];

  constructor(options: MessageBoxOptions) {
    this.#target = chooseInterface(options.card);
    this.#turns = options.turns;
    this.#fetch = options.fetch ?? fetch;
    this.#newMessageId = options.newMessageId ?? randomUUID;
    this.#unsubscribe = this.#turns.subscribe(event => {
      if (event.type === 'turn_opened' && event.messageId !== undefined) {
        this.#opening.get(event.messageId)?.(event.traceId);
      } else if (event.type === 'turn_closed') {
        this.#closing.get(event.traceId)?.(event.turn);
      }
    });
  }

  /** Why the box cannot send to this agent, or nothing when it can. */
  get unavailable(): string | undefined {
    if (this.#target.kind === 'found') {
      return undefined;
    }
    const versions = this.#target.versions;
    return (
      'The message box cannot send to this agent: its card lists A2A JSON-RPC only at ' +
      `${versions.length === 1 ? 'version' : 'versions'} ${versions.join(', ')}, and the box ` +
      'speaks A2A 0.3 and 1.0. Hosts pointed at the wire proxy are not affected.'
    );
  }

  state(): MessageBoxState {
    const unavailable = this.unavailable;
    return {
      conversations: this.#conversations.map(conversation => ({
        ...(conversation.conversationId !== undefined && {
          conversationId: conversation.conversationId,
        }),
        turns: [...conversation.turns],
        ...(typeof conversation.open === 'string' && {openTurn: conversation.open}),
      })),
      ...(unavailable !== undefined && {unavailable}),
    };
  }

  /**
   * Sends a text message, continuing the conversation the box started with
   * the id given, or else starting a new one, and resolves with the turn the
   * wire proxy opened for it.
   */
  async send(text: string, conversationId?: string): Promise<SentMessage> {
    if (this.#target.kind !== 'found') {
      throw new MessageBoxError(422, this.unavailable ?? '');
    }
    let conversation: Conversation = {turns: []};
    if (conversationId !== undefined) {
      const continued = this.#conversations.find(held => held.conversationId === conversationId);
      if (continued === undefined) {
        throw new MessageBoxError(
          404,
          'The message box did not start this conversation while Spectra runs. Send without a conversation to start a new one.',
        );
      }
      conversation = continued;
    }
    if (conversation.open !== undefined) {
      throw new MessageBoxError(
        409,
        'A turn is still open in this conversation. Wait for it to close, or start a new conversation.',
      );
    }
    const target: BoxInterface = this.#target;
    const messageId = this.#newMessageId();
    const request = boxRequest(
      target,
      {
        text,
        messageId,
        ...(conversation.conversationId !== undefined && {
          contextId: conversation.conversationId,
        }),
        ...(conversation.taskId !== undefined && {taskId: conversation.taskId}),
      },
      ++this.#requestId,
    );
    conversation.open = true;

    const opened = new Promise<string>(resolve => this.#opening.set(messageId, resolve));
    const responding = this.#fetch(target.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: this.#stop.signal,
    });
    let traceId: string;
    try {
      traceId = await Promise.race([
        opened,
        responding.then(
          () => opened,
          (error: unknown) => {
            throw new MessageBoxError(
              502,
              `The message box could not reach the wire proxy: ${error instanceof Error ? error.message : String(error)}`,
            );
          },
        ),
      ]);
    } catch (error) {
      conversation.open = undefined;
      throw error;
    } finally {
      this.#opening.delete(messageId);
    }

    const closed = new Promise<Turn>(resolve => this.#closing.set(traceId, resolve));
    conversation.open = traceId;
    conversation.turns.push(traceId);
    if (conversationId === undefined) {
      this.#conversations.push(conversation);
    }
    void this.#finish(conversation, traceId, target, responding, closed);
    return {
      traceId,
      ...(conversation.conversationId !== undefined && {
        conversationId: conversation.conversationId,
      }),
    };
  }

  /** Stops reading any reply still coming. */
  close(): void {
    this.#stop.abort();
    this.#unsubscribe();
  }

  /**
   * Reads the reply to its end and waits for the turn to close, then carries
   * its conversation on: its id, from the reply or else from the closed turn
   * when the reply broke off, and the task when the turn ended waiting for
   * input.
   */
  async #finish(
    conversation: Conversation,
    traceId: string,
    target: BoxInterface,
    responding: Promise<Response>,
    closed: Promise<Turn>,
  ): Promise<void> {
    let summary: ReplySummary = {};
    try {
      summary = await readReplySummary(await responding, target.version);
    } catch {
      // A reply that cannot be read is a failed turn, which the record shows.
    }
    const turn = await closed;
    this.#closing.delete(traceId);
    const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
    conversation.conversationId ??=
      summary.contextId ?? turnEvent?.attributes['gen_ai.conversation.id'];
    const waiting = summary.state === 'input-required' || summary.state === 'auth-required';
    conversation.taskId = waiting ? summary.taskId : undefined;
    conversation.open = undefined;
  }
}
