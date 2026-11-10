import {type AgentCard, waitForAgentCard} from './agent_card.js';
import {
  LineSplitter,
  type LogAdded,
  LogBuffer,
  type LogSnapshot,
  type NewLogEntry,
  type RestartCause,
} from './agent_log.js';
import {
  type AgentExit,
  type AgentProcess,
  describeExit,
  forceKilledLine,
  startAgentProcess,
  STOP_GRACE_MS,
} from './agent_process.js';
import type {AgentCommand} from './args.js';
import type {Output} from './output.js';

/** Where the agent's process stands under `run`. */
export type AgentState =
  /** From the command's start until the first card attempt has failed or answered. */
  | {state: 'starting'}
  /** Until the card answers, with why there is none yet, in the terminal's words. */
  | {state: 'waiting'; reason: string}
  /** The process alive and its card answered once. */
  | {state: 'running'}
  /** During the cut and the stop of a restart. */
  | {state: 'restarting'}
  /** Nothing of the process group running, with the exit line in the terminal's words. */
  | {state: 'down'; exit: string};

/** A state with its number in the session's order, shared with the session's events. */
export type NumberedAgentState = AgentState & {seq: number};

export type {RestartCause};

/** One event of the session: a restart, or an exit the agent took on its own. */
export type AgentSessionEvent =
  | {
      type: 'agent_restarted';
      seq: number;
      /** When the restart began, as an ISO 8601 UTC time to the millisecond. */
      time: string;
      cause: RestartCause;
    }
  | {
      type: 'agent_exited';
      seq: number;
      /** When the command's own process exited, as an ISO 8601 UTC time to the millisecond. */
      time: string;
      /** The exit line, in the terminal's words after "The agent's process". */
      exit: string;
    };

/** What the stream sends of the agent's process: its states, its events, and its output as it enters the buffer. */
export type AgentLiveEvent =
  | ({type: 'agent_state'} & NumberedAgentState)
  | AgentSessionEvent
  | ({type: 'agent_log'} & LogAdded);

/** What `GET /api/agent` gives. */
export interface AgentSnapshot {
  /** The command as launched, its arguments as given, as the terminal names it. */
  command: string;
  state: NumberedAgentState;
  /** The session's events, every one, oldest first. */
  events: AgentSessionEvent[];
}

/** What the supervisor asks of the session it runs in. */
export interface AgentSessionHooks {
  /** The state changed; called before the state's event is sent, so the box refuses by it already. */
  stateChanged(state: AgentState['state']): void;
  /** A card answered; called before the running state's event is sent. */
  cardAnswered(card: AgentCard): void;
  /** The process ended, by a restart or on its own, with the sentence a stopped replay reports. */
  processEnded(reason: string): void;
  /** Ends the open turns' connections at the wire proxy. */
  cutOpenTurns(): void;
}

export interface AgentSupervisorOptions {
  command: AgentCommand;
  /** Variables added to Spectra's environment for the command: the redirection. */
  env: Record<string, string>;
  cardUrl: URL;
  /** Headers sent with each card fetch. */
  headers: Readonly<Record<string, string>>;
  out: Output;
  /** The terminal's wait line for a reason, with the hint about the agent's URL or without. */
  waitLine(reason: string, hint: boolean): string;
  session: AgentSessionHooks;
  /** Takes each state and each event for the live stream. */
  notify(event: AgentLiveEvent): void;
  /** The time a stopped process gets before it is force-killed. */
  graceMs?: number;
  /** How long the card wait sleeps between attempts. */
  cardIntervalMs?: number;
}

/**
 * How long a stopped divider waits for the ended process's streams to end,
 * so that it follows the process's last line. They end with the process,
 * unless something outside its process group still holds them open, which a
 * restart does not wait on.
 */
const OUTPUT_DRAIN_MS = 250;

/** One start of the command. */
interface Launch {
  process: AgentProcess;
  /** Ends this launch's card wait. */
  wait: AbortController;
  /** Whether this launch's card has answered. */
  cardAnswered: boolean;
  /** How the command's own process ended, once it has, and when. */
  exit?: AgentExit;
  exitTime?: string;
  /** Whether Spectra stopped it, by a restart or its own stop. */
  stoppedBySpectra: boolean;
  /** Whether nothing of it is running any more and its end has been dealt with. */
  ended: boolean;
  /** Whether its stopped divider has been written. */
  dividerWritten: boolean;
}

/**
 * The agent's process under `run`: starts the command, reads the card at each
 * start, and restarts it on request. Spectra outlives whatever the process
 * does: an exit leaves the state down, and only Spectra's own stop ends it.
 * Each state and each event is numbered in one order. The command's output
 * is echoed as it arrives and kept, with a divider at each start and stop.
 */
export class AgentSupervisor {
  readonly #options: AgentSupervisorOptions;
  readonly #command: string;
  readonly #graceMs: number;
  #seq = 0;
  #state: NumberedAgentState;
  readonly #events: AgentSessionEvent[] = [];
  #launch: Launch | undefined;
  /** The starts, restarts and exits, dealt with one at a time. */
  #queue: Promise<void> = Promise.resolve();
  /** Whether a restart was accepted and has not reached its spawn yet. */
  #restartPending = false;
  /** Whether Spectra's own stop has begun; nothing is spawned from then on. */
  #stopping = false;
  #cardAnsweredOnce = false;
  readonly #log = new LogBuffer();

  constructor(options: AgentSupervisorOptions) {
    this.#options = options;
    this.#command = [options.command.command, ...options.command.args].join(' ');
    this.#graceMs = options.graceMs ?? STOP_GRACE_MS;
    this.#state = {state: 'starting', seq: ++this.#seq};
    options.session.stateChanged('starting');
  }

  /** Starts the command for the first time. */
  start(): void {
    this.#spawn();
  }

  /** The command as launched, the state as it stands and the session's events. */
  snapshot(): AgentSnapshot {
    return {command: this.#command, state: {...this.#state}, events: [...this.#events]};
  }

  /** The agent's output as the buffer holds it. */
  logs(): LogSnapshot {
    return this.#log.snapshot();
  }

  /** Whether the command's own process is running. */
  get alive(): boolean {
    return this.#launch !== undefined && this.#launch.exit === undefined;
  }

  /**
   * Asks for a restart, and returns at once. Running, it is the cut, the
   * stop, the spawn and the wait for the card; down, the spawn and the wait;
   * during a card wait, the starting process stopped and the command spawned
   * again. While a restart is on its way to its spawn, nothing is added.
   */
  restart(cause: RestartCause): void {
    if (this.#stopping || this.#restartPending) {
      return;
    }
    this.#restartPending = true;
    void this.#enqueue(() => this.#restart(cause));
  }

  /** Spectra's own stop has begun: the card wait ends, and nothing is spawned from now on. */
  beginStop(): void {
    this.#stopping = true;
    this.#launch?.wait.abort();
  }

  /** Stops the command and everything it started, in whatever state it is. */
  async stop(): Promise<void> {
    this.beginStop();
    await this.#enqueue(async () => {
      const launch = this.#launch;
      if (launch === undefined || launch.ended) {
        return;
      }
      launch.stoppedBySpectra = true;
      await this.#stopProcess(launch);
    });
  }

  /** Force-kills the command and everything it started, at once. */
  kill(): void {
    this.#launch?.process.kill();
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    this.#queue = this.#queue.then(task).catch((error: unknown) => {
      this.#options.out.error(
        `Spectra failed while handling the agent's process: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return this.#queue;
  }

  #setState(state: AgentState): void {
    this.#state = {...state, seq: ++this.#seq};
    this.#options.session.stateChanged(state.state);
    this.#options.notify({type: 'agent_state', ...this.#state});
  }

  #record(event: AgentSessionEvent): void {
    this.#events.push(event);
    this.#options.notify(event);
  }

  /** Enters the entries into the buffer and sends them on, together. */
  #enter(entries: NewLogEntry[]): void {
    if (entries.length === 0) return;
    this.#options.notify({type: 'agent_log', ...this.#log.add(entries)});
  }

  /** Starts the command and its card wait. */
  #spawn(): void {
    const {command, env, out} = this.#options;
    out.info(`Starting the agent: ${this.#command}`);
    this.#enter([{type: 'started', command: this.#command}]);
    const splitters = {stdout: new LineSplitter(), stderr: new LineSplitter()};
    const line =
      (stream: 'stdout' | 'stderr') =>
      (text: string): NewLogEntry => ({
        type: 'line',
        stream,
        text,
      });
    const launch: Launch = {
      process: startAgentProcess(command.command, command.args, {
        env,
        graceMs: this.#graceMs,
        // Each chunk is echoed as it arrived, on the stream it was written to, then split into lines for the buffer.
        onOutput: (stream, chunk) => {
          (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
          this.#enter(splitters[stream].push(chunk).map(line(stream)));
        },
      }),
      wait: new AbortController(),
      cardAnswered: false,
      stoppedBySpectra: false,
      ended: false,
      dividerWritten: false,
    };
    // What a stream held unfinished at its end is its last line.
    void launch.process.outputEnded.then(() => {
      this.#enter([
        ...splitters.stdout.end().map(line('stdout')),
        ...splitters.stderr.end().map(line('stderr')),
      ]);
    });
    const first = this.#launch === undefined;
    this.#launch = launch;
    if (!first) {
      this.#setState({state: 'starting'});
    }
    void launch.process.exited.then(exit => this.#exited(launch, exit));
    void this.#waitForCard(launch);
  }

  /** Reads the card once this launch answers it; the card is not asked for again until the next start. */
  async #waitForCard(launch: Launch): Promise<void> {
    const {cardUrl, headers, out, waitLine, session, cardIntervalMs} = this.#options;
    const card = await waitForAgentCard(cardUrl, {
      signal: launch.wait.signal,
      headers,
      ...(cardIntervalMs !== undefined && {intervalMs: cardIntervalMs}),
      onWaiting: reason => {
        if (launch.wait.signal.aborted) {
          return;
        }
        out.info(waitLine(reason, !this.#cardAnsweredOnce));
        this.#setState({state: 'waiting', reason});
      },
    });
    if (card === undefined || launch.wait.signal.aborted || launch !== this.#launch) {
      return;
    }
    launch.cardAnswered = true;
    this.#cardAnsweredOnce = true;
    out.info(
      typeof card.name === 'string' && card.name.trim() !== ''
        ? `The agent's card answered: ${card.name}.`
        : "The agent's card answered.",
    );
    session.cardAnswered(card);
    this.#setState({state: 'running'});
  }

  /** The command's own process exited: on its own, unless Spectra stopped it. */
  #exited(launch: Launch, exit: AgentExit): void {
    launch.exit = exit;
    launch.exitTime = new Date().toISOString();
    if (launch.stoppedBySpectra) {
      return;
    }
    launch.wait.abort();
    void this.#enqueue(() => this.#settleOwnExit(launch));
  }

  /**
   * An exit the agent took on its own: what is left of its process group is
   * stopped, then the state is down with the exit line.
   */
  async #settleOwnExit(launch: Launch): Promise<void> {
    if (launch.ended || launch.stoppedBySpectra || launch.exit === undefined) {
      return;
    }
    const {out, session} = this.#options;
    const exit = describeExit(launch.exit);
    session.processEnded(`The agent's process ${exit}.`);
    await this.#stopProcess(launch);
    if (this.#stopping) {
      return;
    }
    await this.#writeStopped(launch);
    const when =
      launch.cardAnswered || launch.exit.error !== undefined ? '' : ' before its card answered';
    out.info(`The agent's process ${exit}${when}. Restart it from the viewer.`);
    this.#record({
      type: 'agent_exited',
      seq: ++this.#seq,
      time: launch.exitTime ?? new Date().toISOString(),
      exit,
    });
    this.#setState({state: 'down', exit});
  }

  async #restart(cause: RestartCause): Promise<void> {
    const {out, session} = this.#options;
    try {
      if (this.#stopping) {
        return;
      }
      const launch = this.#launch;
      // An exit the agent took on its own just before is reported first.
      if (launch !== undefined) {
        await this.#settleOwnExit(launch);
      }
      if (this.#stopping) {
        return;
      }
      out.info(`Restarting the agent: ${causeSentence(cause)}`);
      this.#record({
        type: 'agent_restarted',
        seq: ++this.#seq,
        time: new Date().toISOString(),
        cause,
      });
      if (launch !== undefined && !launch.ended) {
        launch.stoppedBySpectra = true;
        launch.wait.abort();
        session.processEnded('The agent was restarted.');
        this.#setState({state: 'restarting'});
        session.cutOpenTurns();
        await this.#stopProcess(launch);
        if (!this.#stopping) {
          await this.#writeStopped(launch, cause);
        }
      }
    } finally {
      this.#restartPending = false;
    }
    if (!this.#stopping) {
      this.#spawn();
    }
  }

  /**
   * Writes the ended process's stopped divider, once, after its last line:
   * with its exit line, and the cause when a restart stopped it.
   */
  async #writeStopped(launch: Launch, cause?: RestartCause): Promise<void> {
    if (launch.dividerWritten) return;
    launch.dividerWritten = true;
    const exit = launch.exit ?? (await launch.process.exited);
    await Promise.race([
      launch.process.outputEnded,
      new Promise<void>(resolve => setTimeout(resolve, OUTPUT_DRAIN_MS).unref()),
    ]);
    this.#enter([{type: 'stopped', exit: describeExit(exit), ...(cause !== undefined && {cause})}]);
  }

  /** Stops the launch's process group with the stop signal, then the force-kill after the grace. */
  async #stopProcess(launch: Launch): Promise<void> {
    const {forceKilled} = await launch.process.stop();
    launch.ended = true;
    if (forceKilled) {
      this.#options.out.info(forceKilledLine(this.#graceMs));
    }
  }
}

/** A restart's cause as the terminal's sentence. */
function causeSentence(cause: RestartCause): string {
  switch (cause.kind) {
    case 'press':
      return 'Restart was pressed in the viewer.';
    case 'save':
      return `${cause.file} changed.`;
  }
}
