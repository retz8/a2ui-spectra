import {randomUUID} from 'node:crypto';

import type {CatalogOffer} from '../catalog/registry.js';
import {
  type BoxInput,
  type MessageBox,
  MessageBoxError,
  type MessageBoxState,
  type SentMessage,
  unsetVariablesClause,
} from '../message_box.js';
import {isEventOfKind, type ReplayMode, type Turn, type TurnEvent} from '../record/turn_record.js';
import {
  ReplayDriver,
  type ReplayHooks,
  type ReplaySource,
  type ReplayStarted,
} from '../replay/driver.js';
import type {TurnHub} from '../turn_hub.js';
import {checkTransport} from './card.js';
import {
  boxRequest,
  type BoxInterface,
  type BoxRequest,
  capabilitiesFor,
  chooseInterface,
  type InterfaceChoice,
  readReplySummary,
  replayRequest,
  type ReplySummary,
} from './client.js';
import type {A2aVersion} from './protocol.js';

/**
 * Where the agent's process stands under `run`, as the box refuses by it. Under
 * `attach` and the headless commands the box is not told, and it stays running.
 */
export type BoxAgentState = 'starting' | 'waiting' | 'running' | 'restarting' | 'down';

/** The box's reason while the agent's process cannot be sent to. */
const AGENT_STATE_REFUSALS: Readonly<Record<Exclude<BoxAgentState, 'running'>, string>> = {
  starting: "Can't send · the agent is starting",
  waiting: "Can't send · waiting for the agent's card",
  restarting: "Can't send · the agent is restarting",
  down: "Can't send · the agent is down",
};

/** The box's state as the read route returns it, with what is A2A's. */
export interface A2aMessageBoxState extends MessageBoxState {
  /**
   * Set while the agent runs and its card lists no A2A JSON-RPC interface, or
   * no interface at all: no turn can start, from the box or from a host app
   * pointed at the wire proxy.
   */
  noJsonRpc?: true;
  /** The A2A version of the interface the box sends to, when the card lists one it speaks. */
  a2aVersion?: A2aVersion;
}

/** A conversation the box holds, with what it carries into the next send. */
interface Conversation {
  conversationId?: string;
  taskId?: string;
  turns: string[];
  /** The open turn: true while its request is on its way, then its trace id. */
  open?: string | true;
}

export interface A2aMessageBoxOptions {
  /**
   * The agent's card, its JSON-RPC endpoints pointed at the wire proxy; none
   * under `run` until the first card answers, when `setCard` gives it.
   */
  card?: Record<string, unknown>;
  turns: TurnHub;
  /** The configured headers, their variables replaced, added to every request. */
  headers?: Readonly<Record<string, string>>;
  /** The variables the configured headers name that are not set, which refuse every send. */
  unsetVariables?: readonly string[];
  /**
   * The catalog ids to advertise under each version, or what gives them as
   * they stand at each send; the basic catalogs alone when not given.
   */
  offer?: CatalogOffer | (() => CatalogOffer);
  /** What a replay needs of the session; without it, replay is refused. */
  replay?: ReplayHooks;
  fetch?: typeof fetch;
  newMessageId?: () => string;
}

/**
 * Spectra's message box as a host: an A2A client sending through the wire
 * proxy, holding each conversation it starts. A send starts a conversation or
 * continues one of them, and answers once the proxy opens its turn; the reply
 * is read in the background for the conversation and the task to carry into
 * the conversation's next send. A replay re-sends a record's wire inputs as
 * one new conversation, the proxies armed with the record's calls meanwhile,
 * or, live, with no proxy armed and every call the agent makes going out.
 * Under `run` it follows the agent's process: the latest card, and the
 * process's state, by which it refuses.
 */
export class A2aMessageBox implements MessageBox {
  private card: Record<string, unknown> | undefined;
  private target: InterfaceChoice | undefined;
  private agentState: BoxAgentState = 'running';
  /** Counts the ends of the agent's process, so a reply read across one carries no task on. */
  private agentLaunch = 0;
  private readonly turns: TurnHub;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly unsetVariables: readonly string[];
  private readonly offer: (() => CatalogOffer) | undefined;
  private readonly replays: ReplayDriver;
  private readonly fetch: typeof fetch;
  private readonly newMessageId: () => string;
  private readonly stop = new AbortController();
  private readonly unsubscribe: () => void;
  /** Turns waited for: by the host message's id until they open, by trace id until they close. */
  private readonly opening = new Map<string, (traceId: string) => void>();
  private readonly closing = new Map<string, (turn: Turn) => void>();
  private requestId = 0;
  /** Oldest first; a new conversation joins once its first turn opens. */
  private readonly conversations: Conversation[] = [];

  constructor(options: A2aMessageBoxOptions) {
    if (options.card !== undefined) this.setCard(options.card);
    this.turns = options.turns;
    this.headers = options.headers ?? {};
    this.unsetVariables = options.unsetVariables ?? [];
    const offer = options.offer;
    this.offer = typeof offer === 'object' ? () => offer : offer;
    this.fetch = options.fetch ?? fetch;
    this.newMessageId = options.newMessageId ?? randomUUID;
    // The driver follows the turns first: a replayed turn's provenance is written before its send resolves.
    this.replays = new ReplayDriver({
      turns: this.turns,
      ...(options.replay !== undefined && {hooks: options.replay}),
      newMessageId: this.newMessageId,
    });
    this.unsubscribe = this.turns.subscribe(event => {
      if (event.type === 'turn_opened') {
        if (event.messageId !== undefined) this.opening.get(event.messageId)?.(event.traceId);
      } else if (event.type === 'turn_closed') {
        this.closing.get(event.traceId)?.(event.turn);
      }
    });
  }

  /** Follows a card: the interface the box sends to, and its choice of send or stream, are this card's from now on. */
  setCard(card: Record<string, unknown>): void {
    this.card = card;
    this.target = chooseInterface(card);
  }

  /** Follows the agent's process under `run`: the box refuses by its state until it is running. */
  setAgentState(state: BoxAgentState): void {
    this.agentState = state;
  }

  /**
   * The agent's process ended, by a restart or on its own: every conversation
   * keeps its id and drops its task id, which named state that lived in the
   * stopped process, and a replay running stops, its remaining turns reported
   * not sent with the reason given.
   */
  agentEnded(reason: string): void {
    this.agentLaunch++;
    for (const conversation of this.conversations) {
      conversation.taskId = undefined;
    }
    this.replays.agentEnded(reason);
  }

  /**
   * Nothing of the ended process is running any more: the proxies a replay
   * it stopped had armed are disarmed now. Until then they answer from the
   * record, so a call the agent makes on its way out, its run going on after
   * its turn's connection was cut, does not reach the provider.
   */
  agentStopped(): void {
    this.replays.agentStopped();
  }

  /**
   * Why the latest card leaves the box unable to send, or nothing when it
   * does not: it lists no interface, no JSON-RPC interface, or JSON-RPC only
   * at versions the box does not speak.
   */
  get cardRefusal(): string | undefined {
    if (this.card === undefined || this.target === undefined) {
      return AGENT_STATE_REFUSALS.waiting;
    }
    const transport = checkTransport(this.card);
    if (transport.kind === 'no_interface') {
      return "Can't send · the agent's card lists no interface to reach it at";
    }
    if (transport.kind === 'no_jsonrpc') {
      return `Can't send · the agent's card lists no A2A JSON-RPC interface, only ${transport.transports.join(', ')}`;
    }
    if (this.target.kind !== 'found') {
      const {versions, unversioned} = this.target;
      const at = [
        ...(versions.length > 0
          ? [`at ${versions.length === 1 ? 'version' : 'versions'} ${versions.join(', ')}`]
          : []),
        ...(unversioned ? ['with no protocolVersion'] : []),
      ];
      const lacks =
        at.length === 0
          ? 'with no URL to send to'
          : `only ${at.join(' and ')}, and the box speaks A2A 0.3 and 1.0`;
      return (
        `The message box cannot send to this agent: its card lists A2A JSON-RPC ${lacks}. ` +
        'Hosts pointed at the wire proxy are not affected.'
      );
    }
    return undefined;
  }

  /** Whether the agent runs and its latest card lists no A2A JSON-RPC interface, or none at all. */
  private get listsNoJsonRpc(): boolean {
    if (this.agentState !== 'running' || this.card === undefined) return false;
    const {kind} = checkTransport(this.card);
    return kind === 'no_interface' || kind === 'no_jsonrpc';
  }

  /**
   * Why the box cannot send to this agent, or nothing when it can, the first
   * that applies: the agent's process is not running, its card lists no
   * JSON-RPC interface the box speaks, or a configured header names a
   * variable that is not set in Spectra's environment.
   */
  get unavailable(): string | undefined {
    if (this.agentState !== 'running') {
      return AGENT_STATE_REFUSALS[this.agentState];
    }
    const cardRefusal = this.cardRefusal;
    if (cardRefusal !== undefined) {
      return cardRefusal;
    }
    if (this.unsetVariables.length > 0) {
      return `Can't send · ${unsetVariablesClause(this.unsetVariables)}`;
    }
    return undefined;
  }

  state(): A2aMessageBoxState {
    const unavailable = this.unavailable;
    const replay = this.replays.state;
    return {
      conversations: this.conversations.map(conversation => ({
        ...(conversation.conversationId !== undefined && {
          conversationId: conversation.conversationId,
        }),
        turns: [...conversation.turns],
        ...(typeof conversation.open === 'string' && {openTurn: conversation.open}),
      })),
      ...(unavailable !== undefined && {unavailable}),
      ...(this.unsetVariables.length > 0 && {unsetVariables: [...this.unsetVariables]}),
      ...(this.listsNoJsonRpc && {noJsonRpc: true as const}),
      ...(this.target?.kind === 'found' && {a2aVersion: this.target.version}),
      ...(replay !== undefined && {replay}),
    };
  }

  /**
   * Sends a text, or an A2UI action, with the data model when one is given,
   * continuing the conversation the box started with the id given, or else
   * starting a new one, and resolves with the turn the wire proxy opened for
   * it. An action only continues a conversation.
   */
  async send(input: string | BoxInput, conversationId?: string): Promise<SentMessage> {
    const target = this.available();
    if (this.replays.state !== undefined) {
      throw new MessageBoxError(
        409,
        'A replay is running. The message box sends again once it ends.',
      );
    }
    const content: BoxInput = typeof input === 'string' ? {text: input} : input;
    if ('action' in content && conversationId === undefined) {
      throw new MessageBoxError(
        400,
        'An action continues a conversation the message box started. Send it with that conversationId.',
      );
    }
    let conversation: Conversation = {turns: []};
    if (conversationId !== undefined) {
      const continued = this.conversations.find(held => held.conversationId === conversationId);
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
    const messageId = this.newMessageId();
    const request = boxRequest(
      target,
      {
        ...content,
        messageId,
        ...(conversation.conversationId !== undefined && {
          contextId: conversation.conversationId,
        }),
        ...(conversation.taskId !== undefined && {taskId: conversation.taskId}),
      },
      ++this.requestId,
      {
        ...(this.offer !== undefined && {capabilities: capabilitiesFor(this.offer())}),
        headers: this.headers,
      },
    );
    const {traceId} = await this.dispatch(conversation, target, request, messageId);
    return {
      traceId,
      ...(conversation.conversationId !== undefined && {
        conversationId: conversation.conversationId,
      }),
    };
  }

  /**
   * Replays a record as one new conversation, through the session's replay
   * driver: each recorded turn's wire input re-sent in the live interface's
   * A2A version, the first with no `contextId` and each later one with the
   * id the agent named, a task id where the recorded turn before it ended
   * waiting for input and the live one did too. Resolves once the first
   * turn opens.
   */
  async replay(source: ReplaySource, mode: ReplayMode): Promise<ReplayStarted> {
    const target = this.available();
    const conversation: Conversation = {turns: []};
    return this.replays.start(source, mode, {
      turnOpen: this.conversations.some(held => held.open !== undefined),
      send: (input, messageId) =>
        this.dispatch(
          conversation,
          target,
          replayRequest(
            target,
            input,
            {
              messageId,
              ...(conversation.conversationId !== undefined && {
                contextId: conversation.conversationId,
              }),
              ...(conversation.taskId !== undefined && {taskId: conversation.taskId}),
            },
            ++this.requestId,
            this.headers,
          ),
          messageId,
        ),
    });
  }

  /** Stops reading any reply still coming. */
  close(): void {
    this.stop.abort();
    this.unsubscribe();
    this.replays.close();
  }

  /** The interface the box sends to, or the refusal when it cannot send. */
  private available(): BoxInterface {
    const unavailable = this.unavailable;
    if (this.target?.kind !== 'found' || unavailable !== undefined) {
      throw new MessageBoxError(422, unavailable ?? '');
    }
    return this.target;
  }

  /**
   * Posts a request to the wire proxy in a conversation and resolves once the
   * proxy opens its turn, with the turn's trace id and the closed turn to
   * come; the reply is read in the background to carry the conversation on.
   * A new conversation joins the box's once its first turn opens.
   */
  private async dispatch(
    conversation: Conversation,
    target: BoxInterface,
    request: BoxRequest,
    messageId: string,
  ): Promise<{traceId: string; closed: Promise<Turn>}> {
    conversation.open = true;
    const opened = new Promise<string>(resolve => this.opening.set(messageId, resolve));
    const responding = this.fetch(target.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: this.stop.signal,
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
      this.opening.delete(messageId);
    }

    const closed = new Promise<Turn>(resolve => this.closing.set(traceId, resolve));
    const launch = this.agentLaunch;
    conversation.open = traceId;
    conversation.turns.push(traceId);
    if (!this.conversations.includes(conversation)) {
      this.conversations.push(conversation);
    }
    return {
      traceId,
      closed: this.finish(conversation, traceId, target, responding, closed, launch),
    };
  }

  /**
   * Reads the reply to its end and waits for the turn to close, then carries
   * its conversation on: its id, from the reply or else from the closed turn
   * when the reply broke off, and the task when the turn ended waiting for
   * input and the agent's process is the one that answered it. Resolves with
   * the closed turn.
   */
  private async finish(
    conversation: Conversation,
    traceId: string,
    target: BoxInterface,
    responding: Promise<Response>,
    closed: Promise<Turn>,
    launch: number,
  ): Promise<Turn> {
    let summary: ReplySummary = {};
    try {
      summary = await readReplySummary(await responding, target.version);
    } catch {
      // A reply that cannot be read is a failed turn, which the record shows.
    }
    const turn = await closed;
    this.closing.delete(traceId);
    const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
    conversation.conversationId ??=
      summary.contextId ?? turnEvent?.attributes['gen_ai.conversation.id'];
    const waiting = summary.state === 'input-required' || summary.state === 'auth-required';
    conversation.taskId = waiting && launch === this.agentLaunch ? summary.taskId : undefined;
    conversation.open = undefined;
    return turn;
  }
}
