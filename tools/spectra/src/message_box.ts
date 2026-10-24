import {randomUUID} from 'node:crypto';

import {
  boxRequest,
  type BoxInterface,
  chooseInterface,
  type InterfaceChoice,
  readReplySummary,
  type ReplySummary,
} from './a2a/client.js';
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

/** The box's conversation, as the read route returns it. */
export interface MessageBoxState {
  /** The conversation's id; none until the agent's first reply names one. */
  conversationId?: string;
  /** The trace id of the conversation's open turn, when it has one. */
  openTurn?: string;
  /** Why the box cannot send to this agent, when it cannot. */
  unavailable?: string;
}

/** What the send route answers with. */
export interface SentMessage {
  traceId: string;
  conversationId?: string;
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
 * proxy, holding one conversation. A send answers once the proxy opens its
 * turn; the reply is read in the background for the conversation and the
 * task to carry into the next send.
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
  readonly #closing = new Map<string, () => void>();
  #requestId = 0;
  /** Bumped by each new conversation, so an earlier conversation's reply changes nothing. */
  #generation = 0;
  #conversationId: string | undefined;
  #taskId: string | undefined;
  /** The current conversation's open turn: true while its request is on its way, then its trace id. */
  #open: string | true | undefined;

  constructor(options: MessageBoxOptions) {
    this.#target = chooseInterface(options.card);
    this.#turns = options.turns;
    this.#fetch = options.fetch ?? fetch;
    this.#newMessageId = options.newMessageId ?? randomUUID;
    this.#unsubscribe = this.#turns.subscribe(event => {
      if (event.type === 'turn_opened' && event.messageId !== undefined) {
        this.#opening.get(event.messageId)?.(event.traceId);
      } else if (event.type === 'turn_closed') {
        this.#closing.get(event.traceId)?.();
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
      ...(this.#conversationId !== undefined && {conversationId: this.#conversationId}),
      ...(typeof this.#open === 'string' && {openTurn: this.#open}),
      ...(unavailable !== undefined && {unavailable}),
    };
  }

  /** Starts a new conversation. A turn still open goes on, and changes nothing here. */
  newConversation(): MessageBoxState {
    this.#generation++;
    this.#conversationId = undefined;
    this.#taskId = undefined;
    this.#open = undefined;
    return this.state();
  }

  /**
   * Sends a text message in the current conversation, and resolves with the
   * turn the wire proxy opened for it.
   */
  async send(text: string): Promise<SentMessage> {
    if (this.#target.kind !== 'found') {
      throw new MessageBoxError(422, this.unavailable ?? '');
    }
    if (this.#open !== undefined) {
      throw new MessageBoxError(
        409,
        'A turn is still open in this conversation. Wait for it to close, or start a new conversation.',
      );
    }
    const target: BoxInterface = this.#target;
    const generation = this.#generation;
    const messageId = this.#newMessageId();
    const request = boxRequest(
      target,
      {
        text,
        messageId,
        ...(this.#conversationId !== undefined && {contextId: this.#conversationId}),
        ...(this.#taskId !== undefined && {taskId: this.#taskId}),
      },
      ++this.#requestId,
    );
    this.#open = true;

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
      if (generation === this.#generation) {
        this.#open = undefined;
      }
      throw error;
    } finally {
      this.#opening.delete(messageId);
    }

    const closed = new Promise<void>(resolve => this.#closing.set(traceId, resolve));
    if (generation === this.#generation) {
      this.#open = traceId;
    }
    void this.#finish(generation, traceId, target, responding, closed);
    return {
      traceId,
      ...(this.#conversationId !== undefined && {conversationId: this.#conversationId}),
    };
  }

  /** Stops reading any reply still coming. */
  close(): void {
    this.#stop.abort();
    this.#unsubscribe();
  }

  /**
   * Reads the reply to its end and waits for the turn to close, then carries
   * the conversation on: its id, and the task when the turn ended waiting
   * for input.
   */
  async #finish(
    generation: number,
    traceId: string,
    target: BoxInterface,
    responding: Promise<Response>,
    closed: Promise<void>,
  ): Promise<void> {
    let summary: ReplySummary = {};
    try {
      summary = await readReplySummary(await responding, target.version);
    } catch {
      // A reply that cannot be read is a failed turn, which the record shows.
    }
    await closed;
    this.#closing.delete(traceId);
    if (generation !== this.#generation) {
      return;
    }
    this.#conversationId ??= summary.contextId;
    const waiting = summary.state === 'input-required' || summary.state === 'auth-required';
    this.#taskId = waiting ? summary.taskId : undefined;
    this.#open = undefined;
  }
}
