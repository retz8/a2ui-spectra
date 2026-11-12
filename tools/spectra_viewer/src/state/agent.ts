/**
 * What the page holds of the agent's process under `run`, as pure functions
 * the store applies: its command, its state and the session's events, and its
 * output buffer. A route gives each whole and the live stream gives what
 * changes; both carry numbers in one order, so what they both gave merges.
 */
import type {
  AgentProcessState,
  AgentSessionEvent,
  AgentSnapshot,
  LiveEvents,
  LogEntry,
  LogSnapshot,
} from '../api.ts';

/** The agent's process, as the page last knew it. */
export interface AgentProcess {
  /** The command as launched. */
  command: string;
  state: AgentProcessState;
  /** The session's restarts and exits, oldest first. */
  events: readonly AgentSessionEvent[];
}

/** What the stream says of the agent's process: a state, or one of the session's events. */
export type AgentHeard = {state: AgentProcessState} | {event: AgentSessionEvent};

/** The stream's event as the session's list holds it, with its type. */
export function sessionEventOf(
  type: AgentSessionEvent['type'],
  data: LiveEvents['agent_restarted'] | LiveEvents['agent_exited'],
): AgentSessionEvent {
  return {type, ...data} as AgentSessionEvent;
}

/** One thing the stream said, applied: a state with a higher number replaces the state, an event not yet held joins by its number. */
export function agentHeard(agent: AgentProcess, heard: AgentHeard): AgentProcess {
  if ('state' in heard) {
    return heard.state.seq > agent.state.seq ? {...agent, state: heard.state} : agent;
  }
  if (agent.events.some(event => event.seq === heard.event.seq)) return agent;
  return {
    ...agent,
    events: [...agent.events, heard.event].sort((a, b) => a.seq - b.seq),
  };
}

/** The route's answer, with what the stream said since it opened applied on top. */
export function agentRead(snapshot: AgentSnapshot, since: readonly AgentHeard[]): AgentProcess {
  return since.reduce<AgentProcess>(agentHeard, {
    command: snapshot.command,
    state: snapshot.state,
    events: snapshot.events,
  });
}

/** The highest number the route's answer holds: what the stream said up to it is in the answer. */
export function lastSeqOf(snapshot: AgentSnapshot): number {
  return Math.max(snapshot.state.seq, ...snapshot.events.map(event => event.seq));
}

/** The number a thing the stream said carries. */
export function seqOf(heard: AgentHeard): number {
  return 'state' in heard ? heard.state.seq : heard.event.seq;
}

/** The agent's output, as the page holds it: the buffer's entries in order, and its cap. */
export interface AgentLogs {
  entries: readonly LogEntry[];
  /** How many of the entries are output lines. */
  lines: number;
  /** How many output lines the buffer keeps, as the route said. */
  cap: number;
}

function withCount(entries: readonly LogEntry[], cap: number): AgentLogs {
  return {entries, lines: entries.filter(entry => entry.type === 'line').length, cap};
}

/**
 * What one `agent_log` adds: its entries not yet held, after the ones held,
 * and everything below the oldest number the buffer still holds dropped. The
 * cap is Spectra's: the page drops only what the event says has left.
 */
export function logsHeard(logs: AgentLogs, {entries, oldest}: LiveEvents['agent_log']): AgentLogs {
  const last = logs.entries[logs.entries.length - 1]?.n ?? 0;
  const added = entries.filter(entry => entry.n > last);
  const kept = [...logs.entries, ...added].filter(entry => entry.n >= oldest);
  return withCount(kept, logs.cap);
}

/** The route's answer, with what the stream said since it opened applied on top. */
export function logsRead(
  snapshot: LogSnapshot,
  since: ReadonlyArray<LiveEvents['agent_log']>,
): AgentLogs {
  return since.reduce<AgentLogs>(logsHeard, withCount(snapshot.entries, snapshot.cap));
}
