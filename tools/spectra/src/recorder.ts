import {randomBytes} from 'node:crypto';

import type {TurnListener, TurnNotification} from './a2a/turn.js';
import type {CatalogRegistry} from './catalog/registry.js';
import {checkEvents, checkTurn} from './check/checks.js';
import type {Output} from './output.js';
import {isEventOfKind, type Turn, type TurnEvent} from './record/turn_record.js';
import type {TurnStore} from './store/store.js';

export interface TurnRecorderOptions {
  /**
   * Called with each closed turn and its check events once its write has
   * finished, whether or not the write succeeded.
   */
  onRecorded?: (turn: Turn) => void;
  /** The catalogs the checks judge against; the built-in ones when not given. */
  catalogs?: CatalogRegistry;
  /** Nanoseconds since the Unix epoch. */
  now?: () => bigint;
  newSpanId?: () => string;
}

/**
 * Takes the adapter's turn notifications: each closed turn gets its four
 * check events, the schema, catalog, structural and binding checks run once
 * the store has read the conversation's earlier turns, and is written to the
 * store. A failed write is reported and the turn stays in the store's memory
 * for this run. Either way, the checked turn is then handed on.
 */
export class TurnRecorder {
  readonly #store: TurnStore;
  readonly #out: Output;
  readonly #catalogs: CatalogRegistry | undefined;
  readonly #now: () => bigint;
  readonly #newSpanId: () => string;
  readonly #onRecorded: (turn: Turn) => void;
  readonly #open = new Set<string>();
  readonly #writing = new Set<Promise<void>>();
  #onIdle: Array<() => void> = [];

  constructor(store: TurnStore, out: Output, options: TurnRecorderOptions = {}) {
    this.#store = store;
    this.#out = out;
    this.#catalogs = options.catalogs;
    this.#now = options.now ?? nowUnixNano;
    this.#newSpanId = options.newSpanId ?? (() => randomBytes(8).toString('hex'));
    this.#onRecorded = options.onRecorded ?? (() => {});
  }

  readonly onTurn: TurnListener = (notification: TurnNotification) => {
    if (notification.type === 'turn_opened') {
      this.#open.add(notification.traceId);
    } else if (notification.type === 'turn_closed') {
      this.#open.delete(notification.traceId);
      this.#record(notification.turn);
    }
  };

  /** Resolves once no turn is open and every write has finished. */
  idle(): Promise<void> {
    return new Promise(resolve => {
      this.#onIdle.push(resolve);
      this.#checkIdle();
    });
  }

  #record(turn: Turn): void {
    let checked = turn;
    const writing: Promise<void> = this.#store
      .write(turn, earlierTurns => {
        checked = this.#check(turn, earlierTurns);
        return checked;
      })
      .then(
        () => {},
        (error: unknown) => {
          this.#out.error(
            `${error instanceof Error ? error.message : String(error)}. ` +
              'The turn is kept in memory until Spectra stops.',
          );
        },
      )
      .then(() => this.#onRecorded(checked));
    this.#writing.add(writing);
    void writing.then(() => {
      this.#writing.delete(writing);
      this.#checkIdle();
    });
  }

  /** The turn with its check events; the turn as it came when it has no protocol version, or when the checks fail. */
  #check(turn: Turn, earlierTurns: readonly Turn[]): Turn {
    const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
    if (turnEvent === undefined) return turn;
    try {
      const checks = checkTurn(turn, earlierTurns, this.#catalogs);
      if (checks === undefined) return turn;
      const events = checkEvents(turnEvent, checks, () => ({
        spanId: this.#newSpanId(),
        timeUnixNano: this.#now(),
      }));
      return {events: [...turn.events, ...events]};
    } catch (error) {
      this.#out.error(
        `The checks failed on turn ${turnEvent.traceId}: ${error instanceof Error ? error.message : String(error)}. ` +
          'The turn is written unchecked.',
      );
      return turn;
    }
  }

  #checkIdle(): void {
    if (this.#open.size === 0 && this.#writing.size === 0) {
      const waiting = this.#onIdle;
      this.#onIdle = [];
      for (const resolve of waiting) resolve();
    }
  }
}

function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}
