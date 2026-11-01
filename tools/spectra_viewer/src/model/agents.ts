/**
 * The turn list's agents. The store keeps every turn written in the folder
 * Spectra was started from, whichever agent it ran beside; the list shows
 * the connected agent's turns, by the name on its card, until another agent,
 * or every agent, is picked.
 */

/** An agent by the name on its card, or every agent. */
export type AgentShown = {name: string} | 'all';

/** An agent the picker offers. */
export interface AgentChoice {
  name: string;
  turns: number;
  connected: boolean;
}

interface AgentTurn {
  traceId: string;
  agentName?: string;
}

/** The agent shown: the one picked, else the connected agent, else every agent when its card names none. */
export function agentShownOf(
  picked: AgentShown | undefined,
  connected: string | undefined,
): AgentShown {
  return picked ?? (connected === undefined ? 'all' : {name: connected});
}

/** Whether the agent shown takes in a turn. */
function shows(shown: AgentShown, turn: AgentTurn): boolean {
  return shown === 'all' || turn.agentName === shown.name;
}

/** The turns of the agent shown, in their order. */
export function turnsOfAgent<T extends AgentTurn>(turns: readonly T[], shown: AgentShown): T[] {
  return shown === 'all' ? [...turns] : turns.filter(turn => shows(shown, turn));
}

/**
 * The agents the picker offers: the connected agent first, with no turns
 * yet as well, then each other agent with turns in the order of its newest,
 * the turns listed newest first.
 */
export function agentChoicesOf(
  turns: readonly AgentTurn[],
  connected: string | undefined,
): AgentChoice[] {
  const counts = new Map<string, number>();
  if (connected !== undefined) counts.set(connected, 0);
  for (const {agentName} of turns) {
    if (agentName !== undefined) counts.set(agentName, (counts.get(agentName) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({
    name,
    turns: count,
    connected: name === connected,
  }));
}

/** Whether the list offers the picker: when its turns are of more than one agent, the connected one counted, or one names none. */
export function offersPicker(turns: readonly AgentTurn[], connected: string | undefined): boolean {
  return (
    agentChoicesOf(turns, connected).length > 1 ||
    (connected !== undefined && turns.some(turn => turn.agentName === undefined))
  );
}

/**
 * The agent to show for the selected turn, when a link, the browser's
 * history or the composer selects one the list does not show: its own, or
 * every agent when it names none. Nothing when the list shows it or does
 * not hold it.
 */
export function agentOfSelection(
  turns: readonly AgentTurn[],
  shown: AgentShown,
  traceId: string | undefined,
): AgentShown | undefined {
  const turn = turns.find(listed => listed.traceId === traceId);
  if (turn === undefined || shows(shown, turn)) return undefined;
  return turn.agentName === undefined ? 'all' : {name: turn.agentName};
}

/** The picker's label. */
export function agentLabel(shown: AgentShown): string {
  return shown === 'all' ? 'All agents' : shown.name;
}
