import type {TurnListener, TurnNotification} from './a2a/turn.js';
import {parseTraceparent} from './a2a/trace_context.js';
import {
  type CallEvent,
  type CapturePath,
  isEventOfKind,
  type Turn,
  type TurnEvent,
} from './record/turn_record.js';

/** A call the proxies ask to place, before it is forwarded. */
export interface CallToPlace {
  /** The call in words, for the line that says it was not placed: `a model call to api.anthropic.com, POST /v1/messages`. */
  what: string;
  /** The call's start, in nanoseconds since the Unix epoch. */
  startTimeUnixNano: string;
  /** The trace context the call carried, when it did: its `traceparent` header, or MCP's `_meta` one. */
  traceparent?: string | string[];
}

/** Where a call was placed: the turn whose events it joins. */
export interface PlacedCall {
  traceId: string;
  /** The turn event's span id, the call's parent. */
  parentSpanId: string;
  /** Hands the call's complete event over, once it has ended. */
  ended(event: CallEvent): void;
  /** Lets the turn go without an event, for a request that turned out to be no call. */
  release(): void;
}

/** A call that could not be placed, and the line that says so. */
export interface Unplaced {
  line: string;
}

export interface CallPlacerOptions {
  /** Takes the turns, with their calls, as the recorder does. */
  onTurn: TurnListener;
  /** Takes the line about a call that was not placed. */
  log: (line: string) => void;
  /** The capture paths every turn lists, besides the ones its calls prove: the proxies' under `run`. */
  alwaysCapturePaths?: CapturePath[];
  /**
   * Gives the turn, with its calls, its last events before it is handed on:
   * the receiver's spans placed in it while it was open.
   */
  assemble?: (turn: Turn) => Turn;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
}

/** Where a turn of this run stands: open on the wire, waiting for its calls, or handed on to be written. */
export type RunTurnState = 'open' | 'waiting' | 'written';

/** A turn of this run, with its time range: from its start to the agent's last reply, or to the present while it is open. */
export interface RunTurn {
  traceId: string;
  /** The turn event's span id. */
  spanId: string;
  startTimeUnixNano: bigint;
  /** The agent's last reply; none while the wire is open. */
  endTimeUnixNano?: bigint;
  state: RunTurnState;
}

interface OpenTurn {
  traceId: string;
  spanId: string;
  /** The turn as the wire closed it; none while the wire is open. */
  closed?: Turn;
  inFlight: number;
  calls: CallEvent[];
}

/**
 * Places each call in its turn and holds a turn, once the wire has closed it,
 * until the calls placed in it have ended; then hands it on with the calls
 * among its events.
 *
 * A call carrying a turn's trace id belongs to that turn, open or waiting
 * for its calls. Without trace context, or with a trace id that names no
 * turn, a call that starts while exactly one turn is open belongs to that
 * turn. A call that cannot be placed is not recorded: the terminal gets one
 * line saying what it was, when, and why.
 *
 * It also remembers every turn of this run with its time range, open,
 * waiting or written, for the receiver to place its spans by, and lets the
 * receiver give a turn its spans as it is handed on.
 */
export class CallPlacer {
  readonly #options: CallPlacerOptions;
  readonly #open = new Map<string, OpenTurn>();
  /** The trace ids of the turns handed on this run. */
  readonly #written = new Set<string>();
  /** Every turn of this run, with its range, remembered until Spectra stops. */
  readonly #runTurns = new Map<string, RunTurn>();

  constructor(options: CallPlacerOptions) {
    this.#options = options;
  }

  /** Takes the adapter's turn notifications. */
  readonly onTurn: TurnListener = (notification: TurnNotification) => {
    if (notification.type === 'turn_opened') {
      this.#open.set(notification.traceId, {
        traceId: notification.traceId,
        spanId: notification.spanId,
        inFlight: 0,
        calls: [],
      });
      this.#runTurns.set(notification.traceId, {
        traceId: notification.traceId,
        spanId: notification.spanId,
        startTimeUnixNano: BigInt(notification.startTimeUnixNano),
        state: 'open',
      });
      this.#options.onTurn(notification);
    } else if (notification.type === 'turn_closed') {
      const turn = this.#open.get(notification.traceId);
      if (turn === undefined) {
        this.#options.onTurn(notification);
        return;
      }
      turn.closed = notification.turn;
      const run = this.#runTurns.get(notification.traceId);
      const turnEvent = notification.turn.events.find(event => isEventOfKind(event, 'turn'));
      if (run !== undefined) {
        run.state = 'waiting';
        if (turnEvent?.endTimeUnixNano !== undefined) {
          run.endTimeUnixNano = BigInt(turnEvent.endTimeUnixNano);
        }
      }
      this.#handOnWhenDone(turn);
    } else {
      this.#options.onTurn(notification);
    }
  };

  /** The turn of this run with a trace id, open, waiting or written. */
  turnOf(traceId: string): RunTurn | undefined {
    return this.#runTurns.get(traceId);
  }

  /** The turns of this run whose time range holds a time, an open turn's ending at the present. */
  turnsHolding(unixNano: bigint): RunTurn[] {
    const now = (this.#options.now ?? nowUnixNano)();
    return [...this.#runTurns.values()].filter(
      turn => turn.startTimeUnixNano <= unixNano && unixNano <= (turn.endTimeUnixNano ?? now),
    );
  }

  /** The calls of a turn not yet handed on that have ended so far, in the order they ended. */
  callsOf(traceId: string): readonly CallEvent[] {
    return this.#open.get(traceId)?.calls ?? [];
  }

  /** Places a call, or returns nothing and logs why when it cannot be placed. */
  place(call: CallToPlace): PlacedCall | undefined {
    const result = this.tryPlace(call);
    if ('line' in result) {
      this.#options.log(result.line);
      return undefined;
    }
    return result;
  }

  /**
   * Places a call, or returns the line saying why it cannot be placed without
   * logging it, for a request that may turn out to be no call.
   */
  tryPlace(call: CallToPlace): PlacedCall | Unplaced {
    const traceId = parseTraceparent(call.traceparent)?.traceId;
    let turn: OpenTurn | undefined;
    let reason: string | undefined;
    if (traceId !== undefined && this.#open.has(traceId)) {
      turn = this.#open.get(traceId);
    } else if (traceId !== undefined && this.#written.has(traceId)) {
      reason = `its turn ${traceId} is already written`;
    } else if (this.#open.size === 1) {
      turn = [...this.#open.values()][0];
    } else if (this.#open.size === 0) {
      reason = 'no turn is open';
    } else {
      reason = `${this.#open.size} turns are open`;
    }
    if (turn === undefined) {
      return {
        line: `${capitalise(call.what)} at ${isoTime(call.startTimeUnixNano)} was not placed in a turn: ${reason}. It is not recorded.`,
      };
    }
    const placed = turn;
    placed.inFlight++;
    let done = false;
    return {
      traceId: placed.traceId,
      parentSpanId: placed.spanId,
      ended: event => {
        if (done) return;
        done = true;
        placed.inFlight--;
        placed.calls.push(event);
        this.#handOnWhenDone(placed);
      },
      release: () => {
        if (done) return;
        done = true;
        placed.inFlight--;
        this.#handOnWhenDone(placed);
      },
    };
  }

  #handOnWhenDone(turn: OpenTurn): void {
    if (turn.closed === undefined || turn.inFlight > 0) {
      return;
    }
    this.#open.delete(turn.traceId);
    this.#written.add(turn.traceId);
    const run = this.#runTurns.get(turn.traceId);
    if (run !== undefined) run.state = 'written';
    const withCalls = this.#withCalls(turn.closed, turn.calls);
    this.#options.onTurn({
      type: 'turn_closed',
      traceId: turn.traceId,
      turn: this.#options.assemble?.(withCalls) ?? withCalls,
    });
  }

  /** The turn with its calls among its events by start time, and the capture paths they prove. */
  #withCalls(turn: Turn, calls: CallEvent[]): Turn {
    const paths = new Set<CapturePath>(this.#options.alwaysCapturePaths ?? []);
    if (calls.some(call => isEventOfKind(call, 'model_call'))) {
      paths.add('model_proxy');
    }
    if (calls.some(call => isEventOfKind(call, 'tool_call'))) {
      paths.add('tool_proxy');
    }
    const events = turn.events.map(event =>
      isEventOfKind(event, 'turn') ? withCapturePaths(event, paths) : event,
    );
    const [turnEvent, ...rest] = events;
    const ordered = [...rest, ...calls].sort((a, b) =>
      compareUnixNano(a.startTimeUnixNano, b.startTimeUnixNano),
    );
    return {events: [turnEvent, ...ordered]};
  }
}

function withCapturePaths(event: TurnEvent, paths: Set<CapturePath>): TurnEvent {
  const existing = event.attributes['a2ui.turn.capture_paths'];
  const added = [...paths].filter(path => !existing.includes(path));
  if (added.length === 0) {
    return event;
  }
  return {
    ...event,
    attributes: {...event.attributes, 'a2ui.turn.capture_paths': [...existing, ...added]},
  };
}

function compareUnixNano(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}

function isoTime(unixNano: string): string {
  return new Date(Number(BigInt(unixNano) / 1_000_000n)).toISOString();
}
