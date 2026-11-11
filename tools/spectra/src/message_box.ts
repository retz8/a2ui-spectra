import {randomUUID} from 'node:crypto';

import {
  type BoxInput,
  boxRequest,
  type BoxInterface,
  type BoxRequest,
  capabilitiesFor,
  chooseInterface,
  type InterfaceChoice,
  type PreparedMessage,
  preparedRequest,
  readReplySummary,
  type ReplySummary,
} from './a2a/client.js';
import {checkTransport} from './a2a/card.js';
import {joinInputMetadata} from './a2a/metadata.js';
import {a2aPart} from './a2a/parts.js';
import type {A2aVersion} from './a2a/protocol.js';
import type {CatalogOffer} from './catalog/registry.js';
import {type InputBrief, inputBriefOf} from './listing.js';
import {
  isEventOfKind,
  type ReplayMode,
  type Turn,
  type TurnEvent,
  type TurnRecord,
} from './record/turn_record.js';
import {ReplayRecordError, replayInputs} from './replay/inputs.js';
import {hasNothingToServe, ReplayPool} from './replay/pool.js';
import {inWords, outcomeOf, verdictOf} from './replay/verdict.js';
import type {LiveReplayedTurn, ReplayedTurn, TurnHub} from './turn_hub.js';

/** Why everything-recorded mode refuses a record with no model call and no tool call. */
export const NOTHING_TO_SERVE =
  'The record holds no model call and no tool call, so there is nothing to serve with everything recorded.';

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

/** A conversation the box started, as the read route returns it. */
export interface BoxConversation {
  /** The conversation's id; none until the agent's first reply names one. */
  conversationId?: string;
  /** The trace ids of the turns the box sent in this conversation, oldest first. */
  turns: string[];
  /** The trace id of the conversation's open turn, when it has one. */
  openTurn?: string;
}

/** The replay running, as the read route returns it. */
export interface ReplayState {
  /** The record's path, as the turns' provenance names it. */
  source: string;
  mode: ReplayMode;
  /** The number of the turn being replayed, of the total; 0 before the first opens. */
  turn: number;
  turns: number;
}

/** What the read route returns. */
export interface MessageBoxState {
  /** The conversations the box started while Spectra runs, oldest first. */
  conversations: BoxConversation[];
  /** Why the box cannot send to this agent, when it cannot. */
  unavailable?: string;
  /** The variables the configured headers name that are not set in Spectra's environment. */
  unsetVariables?: string[];
  /** The A2A version of the interface the box sends to, when the card lists one it speaks. */
  a2aVersion?: A2aVersion;
  /** The replay running, while one does. */
  replay?: ReplayState;
}

/** What the send route answers with. */
export interface SentMessage {
  traceId: string;
  conversationId?: string;
}

/** What a replay answers with once its first turn has opened. */
export interface ReplayStarted {
  /** The first replayed turn's trace id. */
  traceId: string;
  /** How many turns the record holds. */
  turns: number;
}

/** A record to replay, and the path its turns' provenance names. */
export interface ReplaySource {
  /** The record file's path, relative to the working directory when under it. */
  path: string;
  record: TurnRecord;
}

/** What the box asks of the session during a replay. */
export interface ReplayHooks {
  /** Arms both proxies with the pool, before the first send; a live replay arms neither. */
  arm(pool: ReplayPool): void;
  /** Disarms both, once the last replayed turn has closed. */
  disarm(): void;
  /** Writes the replay's provenance on a turn's turn event, as the turn opens. */
  annotate(traceId: string, attributes: Record<string, unknown>): void;
  /** Writes the verdict on a replayed turn's turn event, once the turn has closed and been written; a live replay takes none. */
  amend(traceId: string, attributes: Record<string, unknown>): Promise<void>;
  /** Takes one terminal line. */
  log(line: string): void;
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
  /** The catalog ids to advertise under each version; the basic catalogs alone when not given. */
  offer?: CatalogOffer;
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
export class MessageBox {
  #card: Record<string, unknown> | undefined;
  #target: InterfaceChoice | undefined;
  #agentState: BoxAgentState = 'running';
  /** Counts the ends of the agent's process, so a reply read across one carries no task on. */
  #agentLaunch = 0;
  /** Stops the replay running, with the sentence its remaining turns are reported not sent with. */
  #stopReplay: ((reason: string) => void) | undefined;
  readonly #turns: TurnHub;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #unsetVariables: readonly string[];
  readonly #capabilities: Readonly<Record<string, unknown>> | undefined;
  readonly #replayHooks: ReplayHooks | undefined;
  readonly #fetch: typeof fetch;
  readonly #newMessageId: () => string;
  readonly #stop = new AbortController();
  readonly #unsubscribe: () => void;
  /** Turns waited for: by the host message's id until they open, by trace id until they close. */
  readonly #opening = new Map<string, (traceId: string) => void>();
  readonly #closing = new Map<string, (turn: Turn) => void>();
  /** The provenance to write on a replayed turn as it opens, by the host message's id. */
  readonly #provenance = new Map<string, Record<string, unknown>>();
  #requestId = 0;
  /** Oldest first; a new conversation joins once its first turn opens. */
  readonly #conversations: Conversation[] = [];
  #replaying: ReplayState | undefined;
  /** Turns another host opened while the proxies replay, named on the terminal once their input comes. */
  readonly #foreign = new Set<string>();

  constructor(options: MessageBoxOptions) {
    if (options.card !== undefined) this.setCard(options.card);
    this.#turns = options.turns;
    this.#headers = options.headers ?? {};
    this.#unsetVariables = options.unsetVariables ?? [];
    this.#capabilities = options.offer === undefined ? undefined : capabilitiesFor(options.offer);
    this.#replayHooks = options.replay;
    this.#fetch = options.fetch ?? fetch;
    this.#newMessageId = options.newMessageId ?? randomUUID;
    this.#unsubscribe = this.#turns.subscribe(event => {
      if (event.type === 'turn_opened') {
        const provenance =
          event.messageId === undefined ? undefined : this.#provenance.get(event.messageId);
        if (provenance !== undefined && event.messageId !== undefined) {
          this.#provenance.delete(event.messageId);
          this.#replayHooks?.annotate(event.traceId, provenance);
        } else if (this.#replaying !== undefined && this.#replaying.mode !== 'live') {
          // With no proxy armed, another host's turn is an ordinary turn.
          this.#foreign.add(event.traceId);
        }
        if (event.messageId !== undefined) this.#opening.get(event.messageId)?.(event.traceId);
      } else if (
        event.type === 'wire_event' &&
        this.#foreign.has(event.traceId) &&
        isEventOfKind(event.event, 'wire_input')
      ) {
        this.#foreign.delete(event.traceId);
        const source = this.#replaying?.source ?? 'the record';
        this.#replayHooks?.log(
          `A turn from another host opened while ${source} replays: ${briefLine(inputBriefOf(event.event))}, ` +
            `trace ${event.traceId}. Its model and tool calls meet the record the proxies are replaying.`,
        );
      } else if (event.type === 'turn_closed') {
        this.#foreign.delete(event.traceId);
        this.#closing.get(event.traceId)?.(event.turn);
      }
    });
  }

  /** Follows a card: the interface the box sends to, and its choice of send or stream, are this card's from now on. */
  setCard(card: Record<string, unknown>): void {
    this.#card = card;
    this.#target = chooseInterface(card);
  }

  /** Follows the agent's process under `run`: the box refuses by its state until it is running. */
  setAgentState(state: BoxAgentState): void {
    this.#agentState = state;
  }

  /**
   * The agent's process ended, by a restart or on its own: every conversation
   * keeps its id and drops its task id, which named state that lived in the
   * stopped process, and a replay running stops, its remaining turns reported
   * not sent with the reason given.
   */
  agentEnded(reason: string): void {
    this.#agentLaunch++;
    for (const conversation of this.#conversations) {
      conversation.taskId = undefined;
    }
    this.#stopReplay?.(reason);
  }

  /**
   * Why the latest card leaves the box unable to send, or nothing when it
   * does not: it lists no interface, no JSON-RPC interface, or JSON-RPC only
   * at versions the box does not speak.
   */
  get cardRefusal(): string | undefined {
    if (this.#card === undefined || this.#target === undefined) {
      return AGENT_STATE_REFUSALS.waiting;
    }
    const transport = checkTransport(this.#card);
    if (transport.kind === 'no_interface') {
      return "Can't send · the agent's card lists no interface to reach it at";
    }
    if (transport.kind === 'no_jsonrpc') {
      return `Can't send · the agent's card lists no A2A JSON-RPC interface, only ${transport.transports.join(', ')}`;
    }
    if (this.#target.kind !== 'found') {
      const versions = this.#target.versions;
      return (
        'The message box cannot send to this agent: its card lists A2A JSON-RPC only at ' +
        `${versions.length === 1 ? 'version' : 'versions'} ${versions.join(', ')}, and the box ` +
        'speaks A2A 0.3 and 1.0. Hosts pointed at the wire proxy are not affected.'
      );
    }
    return undefined;
  }

  /**
   * Why the box cannot send to this agent, or nothing when it can, the first
   * that applies: the agent's process is not running, its card lists no
   * JSON-RPC interface the box speaks, or a configured header names a
   * variable that is not set in Spectra's environment.
   */
  get unavailable(): string | undefined {
    if (this.#agentState !== 'running') {
      return AGENT_STATE_REFUSALS[this.#agentState];
    }
    const cardRefusal = this.cardRefusal;
    if (cardRefusal !== undefined) {
      return cardRefusal;
    }
    if (this.#unsetVariables.length > 0) {
      return `Can't send · ${unsetVariablesClause(this.#unsetVariables)}`;
    }
    return undefined;
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
      ...(this.#unsetVariables.length > 0 && {unsetVariables: [...this.#unsetVariables]}),
      ...(this.#target?.kind === 'found' && {a2aVersion: this.#target.version}),
      ...(this.#replaying !== undefined && {replay: {...this.#replaying}}),
    };
  }

  /**
   * Sends a text, or an A2UI action, with the data model when one is given,
   * continuing the conversation the box started with the id given, or else
   * starting a new one, and resolves with the turn the wire proxy opened for
   * it. An action only continues a conversation.
   */
  async send(input: string | BoxInput, conversationId?: string): Promise<SentMessage> {
    const target = this.#available();
    if (this.#replaying !== undefined) {
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
    const request = boxRequest(
      target,
      {
        ...content,
        messageId: this.#newMessageId(),
        ...(conversation.conversationId !== undefined && {
          contextId: conversation.conversationId,
        }),
        ...(conversation.taskId !== undefined && {taskId: conversation.taskId}),
      },
      ++this.#requestId,
      {
        ...(this.#capabilities !== undefined && {capabilities: this.#capabilities}),
        headers: this.#headers,
      },
    );
    const {traceId} = await this.#dispatch(conversation, target, request);
    return {
      traceId,
      ...(conversation.conversationId !== undefined && {
        conversationId: conversation.conversationId,
      }),
    };
  }

  /**
   * Replays a record as one new conversation: both proxies armed with the
   * record's calls, each recorded turn's wire input re-sent in order, the
   * earlier turns first, in the live interface's A2A version, the first with
   * no `contextId` and each later one with the id the agent named, a task id
   * where the record carried one and the live previous turn ended waiting
   * for input. Resolves once the first turn opens; the rest runs on, each
   * turn's provenance written as it opens and its verdict once it has closed,
   * and the proxies disarmed after the last. A turn that cannot be sent stops
   * the replay, the rest reported as not sent, and so does the end of the
   * agent's process, the open turn having failed. Live, no pool is built and
   * no proxy armed, so every model and tool call goes out; no verdict is
   * taken, and each turn's outcome is said on the terminal as it closes.
   */
  async replay(source: ReplaySource, mode: ReplayMode): Promise<ReplayStarted> {
    const target = this.#available();
    const hooks = this.#replayHooks;
    if (hooks === undefined) {
      throw new MessageBoxError(422, 'Replay is not available in this session.');
    }
    if (this.#replaying !== undefined) {
      throw new MessageBoxError(409, 'A replay is running. Wait for it to end.');
    }
    if (
      this.#turns.openTurns().length > 0 ||
      this.#conversations.some(conversation => conversation.open !== undefined)
    ) {
      throw new MessageBoxError(409, 'A turn is open. Wait for it to close before replaying.');
    }
    let inputs;
    try {
      inputs = replayInputs(source.record);
    } catch (error) {
      if (error instanceof ReplayRecordError) throw new MessageBoxError(422, error.message);
      throw error;
    }
    if (mode === 'recorded' && hasNothingToServe(source.record)) {
      throw new MessageBoxError(422, `${NOTHING_TO_SERVE} Replay it with the model live.`);
    }
    const pool = mode === 'live' ? undefined : new ReplayPool(source.record, mode);

    const replaying: ReplayState = {source: source.path, mode, turn: 0, turns: inputs.length};
    this.#replaying = replaying;
    if (pool !== undefined) hooks.arm(pool);
    this.#turns.notify({type: 'replay_started', source: source.path, mode, turns: inputs.length});
    const conversation: Conversation = {turns: []};
    const replayed: ReplayedTurn[] = [];
    /** The turns of a live replay, which carry no verdict. */
    const live: LiveReplayedTurn[] = [];
    const recordedTurns = source.record.turns.map(turn => ({
      traceId: traceIdOf(turn),
      turn,
    }));

    /** Why the agent's process ended while this replay ran, once it has. */
    let agentEnded: string | undefined;
    this.#stopReplay = reason => {
      agentEnded ??= reason;
    };
    const end = () => {
      if (pool !== undefined) hooks.disarm();
      this.#replaying = undefined;
      this.#stopReplay = undefined;
      if (pool === undefined) {
        this.#turns.notify({type: 'replay_ended', source: source.path, mode: 'live', turns: live});
        return;
      }
      this.#turns.notify({
        type: 'replay_ended',
        source: source.path,
        mode: pool.mode,
        verdict: replayed.every(turn => 'verdict' in turn && turn.verdict === 'passed')
          ? 'passed'
          : 'failed',
        turns: replayed,
      });
    };
    const notSent = (from: number, reason: string) => {
      for (const {traceId} of recordedTurns.slice(from)) {
        (pool === undefined ? live : replayed).push({recordedTurn: traceId, notSent: reason});
      }
    };

    /** Sends recorded turn `index`, and resolves with its trace id and the closed turn's verdict work. */
    const sendTurn = async (index: number): Promise<{traceId: string; finished: Promise<void>}> => {
      const input = inputs[index];
      const recorded = recordedTurns[index];
      const messageId = this.#newMessageId();
      const message: PreparedMessage = {
        parts: input.parts.map(part => a2aPart(part, target.version)),
        messageId,
        ...(conversation.conversationId !== undefined && {
          contextId: conversation.conversationId,
        }),
        ...(input.carriesTask &&
          conversation.taskId !== undefined && {taskId: conversation.taskId}),
      };
      const metadata = joinInputMetadata(input.metadata);
      if (metadata !== undefined) message.metadata = metadata;
      const request = preparedRequest(target, message, ++this.#requestId, {
        extensions: input.extensions,
        headers: this.#headers,
      });
      this.#provenance.set(messageId, {
        'a2ui.replay.source': source.path,
        'a2ui.replay.turn': recorded.traceId,
        'a2ui.replay.mode': mode,
      });
      let dispatched: {traceId: string; closed: Promise<Turn>};
      try {
        dispatched = await this.#dispatch(conversation, target, request, messageId);
      } finally {
        this.#provenance.delete(messageId);
      }
      replaying.turn = index + 1;
      this.#turns.notify({
        type: 'replay_turn',
        traceId: dispatched.traceId,
        recordedTurn: recorded.traceId,
        turn: index + 1,
        turns: inputs.length,
      });
      const finished = dispatched.closed.then(async turn => {
        if (pool === undefined) {
          live.push({traceId: dispatched.traceId, recordedTurn: recorded.traceId});
          hooks.log(
            `Re-run of ${source.path}, turn ${index + 1} of ${inputs.length}: ${inWords(outcomeOf(turn))}.`,
          );
          return;
        }
        const verdict = verdictOf(recorded.turn, turn);
        await hooks.amend(dispatched.traceId, {
          'a2ui.replay.verdict': verdict.verdict,
          ...(verdict.reasons.length > 0 && {'a2ui.replay.reasons': verdict.reasons}),
        });
        const unconsumed = pool.unserved().filter(call => call.traceId === recorded.traceId).length;
        replayed.push({
          traceId: dispatched.traceId,
          recordedTurn: recorded.traceId,
          verdict: verdict.verdict,
          unconsumed,
        });
        hooks.log(
          `Replay of ${source.path}, turn ${index + 1} of ${inputs.length}: ${verdict.verdict}` +
            (verdict.reasons.length > 0
              ? ` (${verdict.reasons.map(reason => reason.message).join(' ')})`
              : '') +
            (unconsumed > 0
              ? `; ${unconsumed} of the recorded calls ${unconsumed === 1 ? 'was' : 'were'} not asked for.`
              : '.'),
        );
      });
      return {traceId: dispatched.traceId, finished};
    };

    let first: {traceId: string; finished: Promise<void>};
    try {
      first = await sendTurn(0);
    } catch (error) {
      notSent(0, error instanceof Error ? error.message : String(error));
      end();
      throw error;
    }
    void (async () => {
      try {
        await first.finished;
        for (let index = 1; index < inputs.length; index++) {
          if (agentEnded !== undefined) {
            notSent(index, agentEnded);
            break;
          }
          try {
            const {finished} = await sendTurn(index);
            await finished;
          } catch (error) {
            notSent(index, error instanceof Error ? error.message : String(error));
            break;
          }
        }
      } finally {
        end();
      }
    })();
    return {traceId: first.traceId, turns: inputs.length};
  }

  /** Stops reading any reply still coming. */
  close(): void {
    this.#stop.abort();
    this.#unsubscribe();
  }

  /** The interface the box sends to, or the refusal when it cannot send. */
  #available(): BoxInterface {
    const unavailable = this.unavailable;
    if (this.#target?.kind !== 'found' || unavailable !== undefined) {
      throw new MessageBoxError(422, unavailable ?? '');
    }
    return this.#target;
  }

  /**
   * Posts a request to the wire proxy in a conversation and resolves once the
   * proxy opens its turn, with the turn's trace id and the closed turn to
   * come; the reply is read in the background to carry the conversation on.
   * A new conversation joins the box's once its first turn opens.
   */
  async #dispatch(
    conversation: Conversation,
    target: BoxInterface,
    request: BoxRequest,
    messageId = messageIdOf(request),
  ): Promise<{traceId: string; closed: Promise<Turn>}> {
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
    const launch = this.#agentLaunch;
    conversation.open = traceId;
    conversation.turns.push(traceId);
    if (!this.#conversations.includes(conversation)) {
      this.#conversations.push(conversation);
    }
    return {
      traceId,
      closed: this.#finish(conversation, traceId, target, responding, closed, launch),
    };
  }

  /**
   * Reads the reply to its end and waits for the turn to close, then carries
   * its conversation on: its id, from the reply or else from the closed turn
   * when the reply broke off, and the task when the turn ended waiting for
   * input and the agent's process is the one that answered it. Resolves with
   * the closed turn.
   */
  async #finish(
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
    this.#closing.delete(traceId);
    const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
    conversation.conversationId ??=
      summary.contextId ?? turnEvent?.attributes['gen_ai.conversation.id'];
    const waiting = summary.state === 'input-required' || summary.state === 'auth-required';
    conversation.taskId = waiting && launch === this.#agentLaunch ? summary.taskId : undefined;
    conversation.open = undefined;
    return turn;
  }
}

/** The `messageId` of the message a request carries. */
function messageIdOf(request: BoxRequest): string {
  const body = JSON.parse(request.body) as {params?: {message?: {messageId?: string}}};
  return body.params?.message?.messageId ?? '';
}

/** A recorded turn's trace id, from its turn event. */
function traceIdOf(turn: Turn): string {
  return turn.events.find(event => isEventOfKind(event, 'turn'))?.traceId ?? '';
}

/** "`A` is not set …" or "`A` and `B` are not set …", as the composer's line says it. */
export function unsetVariablesClause(variables: readonly string[]): string {
  const names =
    variables.length <= 1
      ? variables.join('')
      : `${variables.slice(0, -1).join(', ')} and ${variables[variables.length - 1]}`;
  return `${names} ${variables.length === 1 ? 'is' : 'are'} not set in Spectra's environment`;
}

/** A turn's input in brief, as a terminal line names it. */
function briefLine(input: InputBrief | undefined): string {
  if (input === undefined) return 'a message with no parts';
  if ('text' in input) return `“${input.text}”`;
  if ('action' in input) return `the action “${input.action}”`;
  return `a ${input.partType} part`;
}
