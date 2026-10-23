/** Where A2A puts an agent's card, under the agent's base address. */
export const AGENT_CARD_PATH = '.well-known/agent-card.json';

/** The agent card's address for an agent's base address. A path is kept. */
export function agentCardUrl(agentUrl: URL): URL {
  const url = new URL(agentUrl.href);
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  url.pathname += AGENT_CARD_PATH;
  return url;
}

export type AgentCard = Record<string, unknown>;

/**
 * Fetches the agent's card once. Returns the card when the agent answers with
 * a JSON object, and nothing when it does not answer or answers otherwise.
 */
export async function fetchAgentCard(
  cardUrl: URL,
  signal?: AbortSignal,
  timeoutMs = 2000,
): Promise<AgentCard | undefined> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(cardUrl, {
      headers: {accept: 'application/json'},
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const card: unknown = await response.json();
    return isObject(card) ? card : undefined;
  } catch {
    return undefined;
  }
}

export interface WaitOptions {
  /** Ends the wait. */
  signal: AbortSignal;
  /** Called once, when the first attempt finds no card. */
  onWaiting?: () => void;
  intervalMs?: number;
}

/**
 * Waits, with no time limit, until the agent's card answers. Resolves with
 * the card, or with nothing when the signal ends the wait first.
 */
export async function waitForAgentCard(
  cardUrl: URL,
  {signal, onWaiting, intervalMs = 500}: WaitOptions,
): Promise<AgentCard | undefined> {
  let waiting = false;
  while (!signal.aborted) {
    const card = await fetchAgentCard(cardUrl, signal);
    if (card !== undefined) {
      return card;
    }
    if (signal.aborted) {
      break;
    }
    if (!waiting) {
      waiting = true;
      onWaiting?.();
    }
    await sleep(intervalMs, signal);
  }
  return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, {once: true});
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function isObject(value: unknown): value is AgentCard {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
