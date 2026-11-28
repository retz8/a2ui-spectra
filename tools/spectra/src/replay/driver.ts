/**
 * The replay's driver, whatever the transport: a record's wire inputs sent
 * again in order through the transport's host as one new conversation, the
 * proxies armed with the record's calls meanwhile, each turn's provenance
 * written as it opens and its verdict once it has closed.
 */
import path from 'node:path';

import {type InputBrief, inputBriefOf} from '../listing.js';
import {MessageBoxError} from '../message_box.js';
import {isEventOfKind, type ReplayMode, type Turn, type TurnRecord} from '../record/turn_record.js';
import type {LiveReplayedTurn, ReplayedTurn, TurnHub} from '../turn_hub.js';
import {type ReplayInput, ReplayRecordError, replayInputs} from './inputs.js';
import {hasNothingToServe, NOTHING_TO_SERVE, ReplayPool} from './pool.js';
import {inWords, outcomeOf, type Verdict, verdictOf} from './verdict.js';

/** The replay running, as the read route returns it. */
export interface ReplayState {
  /** The record's path, as the turns' provenance names it. */
  source: string;
  mode: ReplayMode;
  /** The number of the turn being replayed, of the total; 0 before the first opens. */
  turn: number;
  turns: number;
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

/** What a replay asks of the session while it runs. */
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

/** What a replay asks of the transport's host: each recorded input sent as the next turn of one new conversation. */
export interface ReplaySender {
  /** Whether a turn the host sent is open, or its request on its way. */
  turnOpen: boolean;
  /**
   * Sends a recorded input under the message id given, in the transport's
   * own form, and resolves once its turn opens, with the turn's trace id and
   * the closed turn to come; rejects when it cannot be sent.
   */
  send(input: ReplayInput, messageId: string): Promise<{traceId: string; closed: Promise<Turn>}>;
}

export interface ReplayDriverOptions {
  turns: TurnHub;
  /** What a replay needs of the session; without it, replay is refused. */
  hooks?: ReplayHooks;
  newMessageId: () => string;
}

/** A sent turn of a replay: its trace id, and the closed turn's work. */
interface SentTurn {
  traceId: string;
  /**
   * Never rejects: resolves with why the replay stops at this turn, when its
   * verdict could not be taken or its line could not be said, and with
   * nothing otherwise.
   */
  finished: Promise<string | undefined>;
}

/**
 * The replays of one session, one at a time, and what outlives a single
 * replay: whether one runs, the proxies' disarming held back while an ended
 * agent's process is still being stopped, and the turns another host opened
 * while the proxies replay.
 */
export class ReplayDriver {
  private readonly turns: TurnHub;
  private readonly hooks: ReplayHooks | undefined;
  private readonly newMessageId: () => string;
  private readonly unsubscribe: () => void;
  private run: ReplayRun | undefined;
  /** Whether the agent's process has ended and what is left of it is still being stopped. */
  private agentStopping = false;
  /** Disarms the proxies of a replay that ended while the agent's process was being stopped. */
  private disarmOnceStopped: (() => void) | undefined;
  /** The provenance to write on a replayed turn as it opens, by the host message's id. */
  private readonly provenance = new Map<string, Record<string, unknown>>();
  /** Turns another host opened while the proxies replay, named on the terminal once their input comes. */
  private readonly foreign = new Set<string>();

  constructor(options: ReplayDriverOptions) {
    this.turns = options.turns;
    this.hooks = options.hooks;
    this.newMessageId = options.newMessageId;
    this.unsubscribe = this.turns.subscribe(event => {
      if (event.type === 'turn_opened') {
        const provenance =
          event.messageId === undefined ? undefined : this.provenance.get(event.messageId);
        if (provenance !== undefined && event.messageId !== undefined) {
          this.provenance.delete(event.messageId);
          this.hooks?.annotate(event.traceId, provenance);
        } else if (this.run !== undefined && this.run.state.mode !== 'live') {
          // With no proxy armed, another host's turn is an ordinary turn.
          this.foreign.add(event.traceId);
        }
      } else if (
        event.type === 'wire_event' &&
        this.foreign.has(event.traceId) &&
        isEventOfKind(event.event, 'wire_input')
      ) {
        this.foreign.delete(event.traceId);
        const source = this.run?.state.source ?? 'the record';
        this.hooks?.log(
          `A turn from another host opened while ${source} replays: ${briefLine(inputBriefOf(event.event))}, ` +
            `trace ${event.traceId}. Its model and tool calls meet the record the proxies are replaying.`,
        );
      } else if (event.type === 'turn_closed') {
        this.foreign.delete(event.traceId);
      }
    });
  }

  /** The replay running, as the read route returns it; none when none runs. */
  get state(): ReplayState | undefined {
    return this.run === undefined ? undefined : {...this.run.state};
  }

  /**
   * Replays a record as one new conversation: both proxies armed with the
   * record's calls, each recorded turn's wire input re-sent in order through
   * the sender, the earlier turns first. Resolves once the first turn opens;
   * the rest runs on, each turn's provenance written as it opens and its
   * verdict once it has closed, and the proxies disarmed after the last. A
   * turn that cannot be sent stops the replay, the rest reported as not
   * sent, and so does the end of the agent's process, the open turn having
   * failed and the proxies staying armed until that process has stopped.
   * Live, no pool is built and no proxy armed, so every model and tool call
   * goes out; no verdict is taken, and each turn's outcome is said on the
   * terminal as it closes.
   */
  async start(
    source: ReplaySource,
    mode: ReplayMode,
    sender: ReplaySender,
  ): Promise<ReplayStarted> {
    const hooks = this.hooks;
    if (hooks === undefined) {
      throw new MessageBoxError(422, 'Replay is not available in this session.');
    }
    if (this.run !== undefined) {
      throw new MessageBoxError(409, 'A replay is running. Wait for it to end.');
    }
    if (this.turns.openTurns().length > 0 || sender.turnOpen) {
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
    const run = new ReplayRun(source, mode, inputs, sender, {
      turns: this.turns,
      hooks,
      newMessageId: this.newMessageId,
      provenance: this.provenance,
      ended: () => {
        if (run.pool !== undefined) {
          // A replay the agent's end stopped stays armed until the process has stopped.
          if (this.agentStopping) this.disarmOnceStopped = () => hooks.disarm();
          else hooks.disarm();
        }
        this.run = undefined;
      },
    });
    this.run = run;
    if (run.pool !== undefined) {
      this.disarmOnceStopped = undefined;
      hooks.arm(run.pool);
    }
    return run.start();
  }

  /**
   * The agent's process ended, by a restart or on its own: a replay running
   * stops, its remaining turns reported not sent with the reason given.
   */
  agentEnded(reason: string): void {
    this.agentStopping = true;
    this.run?.stop(reason);
  }

  /**
   * Nothing of the ended process is running any more: the proxies a replay
   * it stopped had armed are disarmed now. Until then they answer from the
   * record, so a call the agent makes on its way out, its run going on after
   * its turn's connection was cut, does not reach the provider.
   */
  agentStopped(): void {
    this.agentStopping = false;
    this.disarmOnceStopped?.();
    this.disarmOnceStopped = undefined;
  }

  /** Stops following the session's turns. */
  close(): void {
    this.unsubscribe();
  }
}

/** What one replay works with of its driver. */
interface ReplayRunParts {
  turns: TurnHub;
  hooks: ReplayHooks;
  newMessageId: () => string;
  /** The driver's provenance, by the host message's id, which the run fills before each send. */
  provenance: Map<string, Record<string, unknown>>;
  /** Told as the run ends, before its end is reported: the proxies are disarmed and the driver is free. */
  ended(): void;
}

/** One replay: its record's turns sent in order, each closed turn judged, and its end reported. */
class ReplayRun {
  readonly state: ReplayState;
  /** The record's calls to serve; none for a live replay. */
  readonly pool: ReplayPool | undefined;
  private readonly recordedTurns: Array<{traceId: string; turn: Turn}>;
  private readonly replayed: ReplayedTurn[] = [];
  /** The turns of a live replay, which carry no verdict. */
  private readonly live: LiveReplayedTurn[] = [];
  /** Why the agent's process ended while this replay ran, once it has. */
  private agentEnded: string | undefined;

  constructor(
    private readonly source: ReplaySource,
    mode: ReplayMode,
    private readonly inputs: ReplayInput[],
    private readonly sender: ReplaySender,
    private readonly parts: ReplayRunParts,
  ) {
    this.state = {source: source.path, mode, turn: 0, turns: inputs.length};
    this.pool = mode === 'live' ? undefined : new ReplayPool(source.record, mode);
    this.recordedTurns = source.record.turns.map(turn => ({traceId: traceIdOf(turn), turn}));
  }

  /** The agent's process ended: the replay stops before its next turn, with the reason. */
  stop(reason: string): void {
    this.agentEnded ??= reason;
  }

  /** Sends the first turn and resolves once it opens; the rest runs on. */
  async start(): Promise<ReplayStarted> {
    const {source, mode, turns} = this.state;
    this.parts.turns.notify({type: 'replay_started', source, mode, turns});
    let first: SentTurn;
    try {
      first = await this.sendTurn(0);
    } catch (error) {
      this.notSent(0, messageOf(error));
      this.end();
      throw error;
    }
    void this.sendRest(first);
    return {traceId: first.traceId, turns};
  }

  /** Sends each turn after the first once the one before it has closed, then ends the replay. */
  private async sendRest(first: SentTurn): Promise<void> {
    try {
      /** Why the replay stops before its next turn: a closed turn's work failed, or the agent's process ended. */
      let stopped = await first.finished;
      for (let index = 1; index < this.inputs.length; index++) {
        stopped ??= this.agentEnded;
        if (stopped !== undefined) {
          this.notSent(index, stopped);
          break;
        }
        try {
          stopped = await (await this.sendTurn(index)).finished;
        } catch (error) {
          this.notSent(index, messageOf(error));
          break;
        }
      }
    } finally {
      this.end();
    }
  }

  /** Sends recorded turn `index`, its provenance ready for the turn's opening, and resolves once it opens. */
  private async sendTurn(index: number): Promise<SentTurn> {
    const {turns, newMessageId, provenance} = this.parts;
    const recorded = this.recordedTurns[index];
    const messageId = newMessageId();
    provenance.set(messageId, {
      // Written with forward slashes on every platform; the terminal's lines keep the platform's.
      'a2ui.replay.source': this.source.path.split(path.sep).join('/'),
      'a2ui.replay.turn': recorded.traceId,
      'a2ui.replay.mode': this.state.mode,
    });
    let sent: {traceId: string; closed: Promise<Turn>};
    try {
      sent = await this.sender.send(this.inputs[index], messageId);
    } finally {
      provenance.delete(messageId);
    }
    this.state.turn = index + 1;
    turns.notify({
      type: 'replay_turn',
      traceId: sent.traceId,
      recordedTurn: recorded.traceId,
      turn: index + 1,
      turns: this.inputs.length,
    });
    const {traceId} = sent;
    return {traceId, finished: sent.closed.then(turn => this.judge(index, traceId, turn))};
  }

  /**
   * A closed turn's work: live, its outcome said on the terminal; else its
   * verdict taken and written on its turn event, its calls never asked for
   * counted, and its line said. Never rejects: resolves with why the replay
   * stops at this turn, or with nothing.
   */
  private async judge(index: number, traceId: string, turn: Turn): Promise<string | undefined> {
    const {pool} = this;
    const recorded = this.recordedTurns[index];
    const number = index + 1;
    const of = `${this.source.path}, turn ${number} of ${this.inputs.length}`;
    if (pool === undefined) {
      this.live.push({traceId, recordedTurn: recorded.traceId});
      return this.say(`Re-run of ${of}: ${inWords(outcomeOf(turn))}.`, 'outcome', number);
    }
    const unconsumedOf = () =>
      pool.unserved().filter(call => call.traceId === recorded.traceId).length;
    let verdict: Verdict;
    let unconsumed = 0;
    try {
      verdict = verdictOf(recorded.turn, turn);
      await this.parts.hooks.amend(traceId, {
        'a2ui.replay.verdict': verdict.verdict,
        ...(verdict.reasons.length > 0 && {'a2ui.replay.reasons': verdict.reasons}),
      });
      unconsumed = unconsumedOf();
    } catch (error) {
      // A turn whose verdict could not be taken did not pass, and the replay stops at it.
      try {
        unconsumed = unconsumedOf();
      } catch {
        // The pool cannot say either; the turn has failed whatever the count.
      }
      this.replayed.push({traceId, recordedTurn: recorded.traceId, verdict: 'failed', unconsumed});
      const message = messageOf(error);
      this.say(
        `Replay of ${of}: failed (its verdict could not be taken: ${message}).`,
        'verdict',
        number,
      );
      return `The verdict of turn ${number} could not be taken: ${message}`;
    }
    this.replayed.push({
      traceId,
      recordedTurn: recorded.traceId,
      verdict: verdict.verdict,
      unconsumed,
    });
    return this.say(verdictLine(of, verdict, unconsumed), 'verdict', number);
  }

  /** Says a closed turn's line, and gives why the replay stops when the line cannot be said. */
  private say(line: string, what: string, number: number): string | undefined {
    try {
      this.parts.hooks.log(line);
      return undefined;
    } catch (error) {
      return `The ${what} of turn ${number} could not be said: ${messageOf(error)}`;
    }
  }

  /** Reports the recorded turns from `from` on as not sent, with the reason. */
  private notSent(from: number, reason: string): void {
    for (const {traceId} of this.recordedTurns.slice(from)) {
      (this.pool === undefined ? this.live : this.replayed).push({
        recordedTurn: traceId,
        notSent: reason,
      });
    }
  }

  /** Ends the replay: the driver told first, then the end reported, with the record's verdict unless live. */
  private end(): void {
    const {turns} = this.parts;
    const {source} = this.state;
    this.parts.ended();
    if (this.pool === undefined) {
      turns.notify({type: 'replay_ended', source, mode: 'live', turns: this.live});
      return;
    }
    turns.notify({
      type: 'replay_ended',
      source,
      mode: this.pool.mode,
      verdict: this.replayed.every(turn => 'verdict' in turn && turn.verdict === 'passed')
        ? 'passed'
        : 'failed',
      turns: this.replayed,
    });
  }
}

/** A judged turn's line: its verdict, why it failed, and the recorded calls it never asked for. */
function verdictLine(of: string, verdict: Verdict, unconsumed: number): string {
  return (
    `Replay of ${of}: ${verdict.verdict}` +
    (verdict.reasons.length > 0
      ? ` (${verdict.reasons.map(reason => reason.message).join(' ')})`
      : '') +
    (unconsumed > 0
      ? `; ${unconsumed} of the recorded calls ${unconsumed === 1 ? 'was' : 'were'} not asked for.`
      : '.')
  );
}

/** An error's message, or the thrown value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A recorded turn's trace id, from its turn event. */
function traceIdOf(turn: Turn): string {
  return turn.events.find(event => isEventOfKind(event, 'turn'))?.traceId ?? '';
}

/** A turn's input in brief, as a terminal line names it. */
function briefLine(input: InputBrief | undefined): string {
  if (input === undefined) return 'a message with no parts';
  if ('text' in input) return `“${input.text}”`;
  if ('action' in input) return `the action “${input.action}”`;
  // A data part that is not A2UI is named a data part.
  return `a ${input.partType === 'a2ui.data' ? 'data' : input.partType} part`;
}
