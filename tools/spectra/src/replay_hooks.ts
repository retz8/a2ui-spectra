/**
 * What the message box asks of the session during a replay: the two proxies
 * armed with the replay's pool and disarmed when it ends, the replay's
 * provenance and its verdict written onto its turns, and a terminal line.
 */
import type {ReplayHooks} from './message_box.js';
import type {TurnEvent, TurnRecordEvent} from './record/turn_record.js';
import type {ReplayPool} from './replay/pool.js';

/** A proxy a replay arms. */
interface ArmedProxy {
  arm(pool: ReplayPool): void;
  disarm(): void;
}

export interface ReplayHooksOptions {
  modelProxy: ArmedProxy;
  /** None when the config names no tool server. */
  toolProxy: ArmedProxy | undefined;
  /**
   * Whether the proxies stay armed once a replay has ended, as under the
   * headless commands: the agent still runs until Spectra stops it, or until
   * the next fixture's replay, and a call it makes then finds the ended
   * replay's pool, a miss with everything recorded, where a disarmed proxy
   * would send it on.
   */
  keepArmed: boolean;
  recorder: {
    annotate(traceId: string, attributes: Record<string, unknown>): void;
    amend(traceId: string, attributes: Record<string, unknown>): Promise<TurnEvent | undefined>;
  };
  /** Tells the live stream a written turn's events changed. */
  onAmended(traceId: string, events: TurnRecordEvent[]): void;
  log(line: string): void;
}

export function replayHooks(options: ReplayHooksOptions): ReplayHooks {
  const {modelProxy, toolProxy, keepArmed, recorder} = options;
  /** The pool of the replay under way, or of the last one. */
  let pool: ReplayPool | undefined;
  return {
    arm: armed => {
      pool = armed;
      modelProxy.arm(armed);
      toolProxy?.arm(armed);
    },
    disarm: () => {
      if (!keepArmed || pool === undefined) {
        modelProxy.disarm();
        toolProxy?.disarm();
        return;
      }
      // Disarming closes the carriers the tool proxy holds open; the pool goes back at once.
      toolProxy?.disarm();
      toolProxy?.arm(pool);
    },
    annotate: (traceId, attributes) => recorder.annotate(traceId, attributes),
    amend: async (traceId, attributes) => {
      const turnEvent = await recorder.amend(traceId, attributes);
      if (turnEvent !== undefined) options.onAmended(traceId, [turnEvent]);
    },
    log: options.log,
  };
}
