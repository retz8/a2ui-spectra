/**
 * The receiver's spans and logs, placed in their turns.
 *
 * A span carrying a turn's trace id belongs to that turn, open, waiting for
 * its calls or written. Any other belongs to the turn of this run whose time
 * range holds its start, when exactly one does. A span placed in a turn not
 * yet handed on joins it when it is; one placed in a written turn amends the
 * record in the store, the turn's end and its checks unchanged. A span
 * already in its turn is ignored.
 *
 * A log record carrying span context is attached to its span, which is
 * translated again with it; one whose span has not arrived is held until it
 * does, and goes with its span when the span is not placed. What is not
 * recorded is counted in one terminal line per export request and reason.
 */
import {
  type CallEvent,
  isEventOfKind,
  type Turn,
  type TurnRecordEvent,
} from '../record/turn_record.js';
import type {RunTurn} from '../placement.js';
import {assembleTurn, type PlacedSpan, spanKey} from './assemble.js';
import type {ReceivedLog, ReceivedSpan, Scope} from './otlp.js';

/** What the receiver needs of the placer: this run's turns and the calls of those still open. */
export interface TurnsOfRun {
  turnOf(traceId: string): RunTurn | undefined;
  turnsHolding(unixNano: bigint): RunTurn[];
  callsOf(traceId: string): readonly CallEvent[];
}

/** What the receiver needs of the store: amending a written turn. */
export interface AmendableStore {
  amend(
    traceId: string,
    change: (turn: Turn) => Turn,
  ): Promise<{previous: Turn; turn: Turn} | undefined>;
}

export interface SpanReceiverOptions {
  turns: TurnsOfRun;
  store: AmendableStore;
  /** Takes the events an export added to a turn or changed in it. */
  onAmended?: (traceId: string, events: TurnRecordEvent[]) => void;
  /** Takes the counted line for what was not recorded, and a failed amendment's error. */
  log: (line: string) => void;
}

interface Placed extends PlacedSpan {
  logs: ReceivedLog[];
  turn: string;
}

/** Why a span or a log is not recorded. */
type Reason = 'no_turn' | 'several_turns' | 'no_span_context';

const REASONS: Readonly<Record<Reason, string>> = {
  no_turn: "their start falls in no turn's time range",
  several_turns: 'their start falls in the time ranges of two or more turns',
  no_span_context: 'they carry no span context',
};

/** What one export request dropped for one reason. */
class Tally {
  spans = 0;
  logs = 0;
  readonly scopes = new Set<string>();
  first: bigint | undefined;
  last: bigint | undefined;

  add(kind: 'span' | 'log', scope: Scope, unixNano: string): void {
    if (kind === 'span') this.spans++;
    else this.logs++;
    this.scopes.add(scope.name === '' ? 'no scope' : scope.name);
    const time = BigInt(unixNano);
    if (this.first === undefined || time < this.first) this.first = time;
    if (this.last === undefined || time > this.last) this.last = time;
  }
}

export class SpanReceiver {
  readonly #options: SpanReceiverOptions;
  /** Every span placed this run, by its trace and span id. */
  readonly #placed = new Map<string, Placed>();
  /** The spans placed in each turn, in the order they were placed. */
  readonly #byTurn = new Map<string, Placed[]>();
  /** Log records whose span has not arrived, by the span's trace and span id. */
  readonly #held = new Map<string, ReceivedLog[]>();
  /** The spans not placed, by trace and span id, with why; their later logs follow them. */
  readonly #dropped = new Map<string, Reason>();
  /** For each turn not yet written, each event's last form sent on the live stream, by span id. */
  readonly #sent = new Map<string, Map<string, string>>();
  readonly #amending = new Set<Promise<void>>();
  #onIdle: Array<() => void> = [];

  constructor(options: SpanReceiverOptions) {
    this.#options = options;
  }

  /** Takes the spans of one trace export request. */
  takeSpans(spans: readonly ReceivedSpan[]): void {
    const dropped = new Map<Reason, Tally>();
    const touched = new Set<string>();
    for (const span of spans) {
      const key = spanKey(span.traceId, span.spanId);
      if (this.#placed.has(key)) continue;
      const placed = this.#place(span);
      const held = this.#held.get(key) ?? [];
      this.#held.delete(key);
      if (typeof placed !== 'string') {
        const reason = placed.reason;
        this.#dropped.set(key, reason);
        const tally = tallyOf(dropped, reason);
        tally.add('span', span.scope, span.startTimeUnixNano);
        for (const log of held) tally.add('log', log.scope, log.timeUnixNano);
        continue;
      }
      const entry: Placed = {span, logs: held, turn: placed};
      this.#placed.set(key, entry);
      const list = this.#byTurn.get(placed) ?? [];
      list.push(entry);
      this.#byTurn.set(placed, list);
      touched.add(placed);
    }
    this.#report(dropped);
    for (const turn of touched) this.#amend(turn);
  }

  /** Takes the log records of one log export request. */
  takeLogs(logs: readonly ReceivedLog[]): void {
    const dropped = new Map<Reason, Tally>();
    const touched = new Set<string>();
    for (const log of logs) {
      if (log.traceId === undefined || log.spanId === undefined) {
        tallyOf(dropped, 'no_span_context').add('log', log.scope, log.timeUnixNano);
        continue;
      }
      const key = spanKey(log.traceId, log.spanId);
      const placed = this.#placed.get(key);
      const reason = this.#dropped.get(key);
      if (placed !== undefined) {
        placed.logs.push(log);
        touched.add(placed.turn);
      } else if (reason !== undefined) {
        tallyOf(dropped, reason).add('log', log.scope, log.timeUnixNano);
      } else {
        const held = this.#held.get(key) ?? [];
        held.push(log);
        this.#held.set(key, held);
      }
    }
    this.#report(dropped);
    for (const turn of touched) this.#amend(turn);
  }

  /**
   * The turn, as the placer hands it on, with the spans placed in it while it
   * was open: the placer's last step before the turn is written.
   */
  readonly assemble = (turn: Turn): Turn => {
    const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
    if (turnEvent === undefined) return turn;
    this.#sent.delete(turnEvent.traceId);
    return assembleTurn(turn, this.#byTurn.get(turnEvent.traceId) ?? []);
  };

  /** Resolves once every amendment of a written turn has finished. */
  idle(): Promise<void> {
    return new Promise(resolve => {
      this.#onIdle.push(resolve);
      this.#checkIdle();
    });
  }

  /** The turn a span belongs to, by its trace id, then by its start. */
  #place(span: ReceivedSpan): string | {reason: Reason} {
    const byTrace = this.#options.turns.turnOf(span.traceId);
    if (byTrace !== undefined) return byTrace.traceId;
    const holding = this.#options.turns.turnsHolding(BigInt(span.startTimeUnixNano));
    if (holding.length === 1) return holding[0].traceId;
    return {reason: holding.length === 0 ? 'no_turn' : 'several_turns'};
  }

  /** Brings a turn the export touched up to date: in memory and on the live stream, or in the store. */
  #amend(traceId: string): void {
    const turn = this.#options.turns.turnOf(traceId);
    const placed = this.#byTurn.get(traceId) ?? [];
    if (turn === undefined) return;
    if (turn.state !== 'written') {
      this.#sendOpen(turn, placed);
      return;
    }
    const amending: Promise<void> = this.#options.store
      .amend(traceId, stored => assembleTurn(stored, placed))
      .then(
        result => {
          if (result === undefined) return;
          const changed = changedEvents(result.previous.events, result.turn.events);
          if (changed.length > 0) this.#options.onAmended?.(traceId, changed);
        },
        (error: unknown) => {
          this.#options.log(
            `The spans received for turn ${traceId} could not be written: ${error instanceof Error ? error.message : String(error)}. ` +
              'The amended turn is kept in memory until Spectra stops.',
          );
        },
      );
    this.#amending.add(amending);
    void amending.then(() => {
      this.#amending.delete(amending);
      this.#checkIdle();
    });
  }

  /**
   * Sends what changed in a turn not yet written: its turn as it stands, from
   * a stand-in turn event over the calls ended so far and the spans placed,
   * each event compared with its last form sent.
   */
  #sendOpen(turn: RunTurn, placed: readonly PlacedSpan[]): void {
    const standIn: Turn = {
      events: [
        {
          traceId: turn.traceId,
          spanId: turn.spanId,
          name: 'invoke_agent',
          kind: 3,
          startTimeUnixNano: turn.startTimeUnixNano.toString(),
          endTimeUnixNano: (turn.endTimeUnixNano ?? turn.startTimeUnixNano).toString(),
          attributes: {
            'a2ui.event.kind': 'turn',
            'gen_ai.operation.name': 'invoke_agent',
            'a2ui.turn.outcome': 'completed',
            'a2ui.turn.capture_paths': [],
            'a2ui.turn.writer.name': '',
            'a2ui.turn.writer.version': '',
          },
          status: {code: 0},
        },
        ...this.#options.turns.callsOf(turn.traceId),
      ],
    };
    const assembled = assembleTurn(standIn, placed).events.filter(
      event => !isEventOfKind(event, 'turn'),
    );
    const sent = this.#sent.get(turn.traceId) ?? new Map<string, string>();
    this.#sent.set(turn.traceId, sent);
    const changed = assembled.filter(event => {
      const form = JSON.stringify(event);
      const isCall = !('a2ui.received.attributes' in event.attributes);
      // A call is sent only once its links make it differ from what the proxies sent.
      if (isCall && (event.links ?? []).length === 0 && !sent.has(event.spanId)) return false;
      if (sent.get(event.spanId) === form) return false;
      sent.set(event.spanId, form);
      return true;
    });
    if (changed.length > 0) this.#options.onAmended?.(turn.traceId, changed);
  }

  /** One line per reason for what one export request did not record. */
  #report(dropped: Map<Reason, Tally>): void {
    for (const [reason, tally] of dropped) {
      const counts = [
        tally.spans > 0 ? `${tally.spans} span${tally.spans === 1 ? '' : 's'}` : undefined,
        tally.logs > 0 ? `${tally.logs} log record${tally.logs === 1 ? '' : 's'}` : undefined,
      ]
        .filter(part => part !== undefined)
        .join(' and ');
      const scopes = [...tally.scopes];
      const from =
        scopes.length === 1
          ? scopes[0]
          : `${scopes.slice(0, -1).join(', ')} and ${scopes[scopes.length - 1]}`;
      const first = isoTime(tally.first);
      const last = isoTime(tally.last);
      const when = first === last ? `at ${first}` : `from ${first} to ${last}`;
      this.#options.log(
        `The receiver did not record ${counts} from ${from}, which started ${when}: ${REASONS[reason]}.`,
      );
    }
  }

  #checkIdle(): void {
    if (this.#amending.size === 0) {
      const waiting = this.#onIdle;
      this.#onIdle = [];
      for (const resolve of waiting) resolve();
    }
  }
}

function tallyOf(tallies: Map<Reason, Tally>, reason: Reason): Tally {
  const tally = tallies.get(reason) ?? new Tally();
  tallies.set(reason, tally);
  return tally;
}

/** The events of a turn as amended that are new or differ from the turn before, by span id. */
function changedEvents(
  previous: readonly TurnRecordEvent[],
  next: readonly TurnRecordEvent[],
): TurnRecordEvent[] {
  const before = new Map(
    previous.map(event => [spanKey(event.traceId, event.spanId), JSON.stringify(event)]),
  );
  return next.filter(
    event => before.get(spanKey(event.traceId, event.spanId)) !== JSON.stringify(event),
  );
}

function isoTime(unixNano: bigint | undefined): string {
  return new Date(Number((unixNano ?? 0n) / 1_000_000n)).toISOString();
}
