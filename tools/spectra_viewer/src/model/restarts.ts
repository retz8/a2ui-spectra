/**
 * The turn list's restart dividers: one row per restart or exit of the
 * agent's process under `run`, placed by time among the turn rows, drawn from
 * the session's events and never written into a record.
 */
import type {AgentSessionEvent} from '../api.ts';
import type {AgentShown} from './agents.ts';
import {causeWords} from './logs.ts';

/** A divider row of the turn list and of its strip. */
export interface RestartDivider {
  key: string;
  /** "Restarted · prompt_builder.py changed", "Restarted · Restart pressed", "Agent exited with code 1". */
  text: string;
  /** The turn row it sits directly above; none for one at the list's bottom. */
  above?: string;
}

/**
 * Whether the list draws its dividers for the agent it shows: when it shows
 * the connected agent or every agent, and not when it shows another agent.
 */
export function showsRestarts(shown: AgentShown, connected: string | undefined): boolean {
  return shown === 'all' || shown.name === connected;
}

/** A turn row, as the list orders them. */
interface PlacedTurn {
  traceId: string;
  startTime: string;
}

/** A row before it is placed: its events, a run of saves being one row. */
interface Row {
  events: AgentSessionEvent[];
}

function isSave(event: AgentSessionEvent): boolean {
  return event.type === 'agent_restarted' && event.cause.kind === 'save';
}

function textOf({events}: Row): string {
  const latest = events[events.length - 1];
  if (latest.type === 'agent_exited') return `Agent ${latest.exit}`;
  if (latest.cause.kind === 'save' && events.length > 1) {
    return `Restarted ${events.length} times · ${latest.cause.file} changed last`;
  }
  return `Restarted · ${causeWords(latest.cause)}`;
}

/**
 * The dividers, in the list's order, newest first. A divider sits directly
 * above the first turn, reading down the list, that started before its
 * restart, so every turn above it ran after that restart; a restart with no
 * earlier turn in the list sits at the list's bottom. Restarts caused by a
 * save, with no turn and no other event between them, are one row naming the
 * count and the latest file; a press and a death always keep their own row.
 * With no turn row there is none.
 *
 * `rows` are the list's turn rows as it reads down, every group open.
 */
export function restartDividersOf(
  events: readonly AgentSessionEvent[],
  rows: readonly PlacedTurn[],
): RestartDivider[] {
  if (rows.length === 0) return [];
  const starts = rows.map(turn => Date.parse(turn.startTime));
  const byTime = [...events].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.seq - b.seq,
  );
  const merged: Row[] = [];
  for (const event of byTime) {
    const run = merged[merged.length - 1];
    const before = run?.events[run.events.length - 1];
    const turnBetween =
      before !== undefined &&
      starts.some(start => start >= Date.parse(before.time) && start < Date.parse(event.time));
    if (
      run !== undefined &&
      before !== undefined &&
      isSave(before) &&
      isSave(event) &&
      !turnBetween
    ) {
      run.events.push(event);
    } else {
      merged.push({events: [event]});
    }
  }
  return merged
    .map((row): RestartDivider => {
      const latest = row.events[row.events.length - 1];
      const at = Date.parse(latest.time);
      const below = rows.find((_, index) => starts[index] < at);
      return {
        key: `restart:${row.events[0].seq}`,
        text: textOf(row),
        ...(below !== undefined && {above: below.traceId}),
      };
    })
    .reverse();
}
