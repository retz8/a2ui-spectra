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

/** One attempt at the card: the card, or why there is none, as a clause after the card's address. */
export type CardAttempt =
  {card: AgentCard; missing?: undefined} | {card?: undefined; missing: string};

export interface FetchOptions {
  signal?: AbortSignal;
  /** Headers sent with the fetch, such as the configured credentials. */
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

/**
 * Fetches the agent's card once. Returns the card when the agent answers with
 * a JSON object, and else why not: the status it answered with, that its
 * body is not a JSON object, or that it did not answer.
 */
export async function fetchAgentCard(
  cardUrl: URL,
  {signal, headers = {}, timeoutMs = 2000}: FetchOptions = {},
): Promise<CardAttempt> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(cardUrl, {
      headers: {...headers, accept: 'application/json'},
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    return {
      missing: `it did not answer (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return {missing: `it answered ${response.status}`};
  }
  let card: unknown;
  try {
    card = await response.json();
  } catch {
    return {missing: `it answered ${response.status} with no JSON object`};
  }
  return isObject(card) ? {card} : {missing: `it answered ${response.status} with no JSON object`};
}

export interface WaitOptions extends Omit<FetchOptions, 'signal'> {
  /** Ends the wait. */
  signal: AbortSignal;
  /** Called with why there is no card yet, on the first miss and again whenever the reason changes. */
  onWaiting?: (reason: string) => void;
  intervalMs?: number;
}

/**
 * Waits, with no time limit, until the agent's card answers. Resolves with
 * the card, or with nothing when the signal ends the wait first.
 */
export async function waitForAgentCard(
  cardUrl: URL,
  {signal, headers, timeoutMs, onWaiting, intervalMs = 500}: WaitOptions,
): Promise<AgentCard | undefined> {
  let reported: string | undefined;
  while (!signal.aborted) {
    const attempt = await fetchAgentCard(cardUrl, {signal, headers, timeoutMs});
    if (attempt.card !== undefined) {
      return attempt.card;
    }
    if (signal.aborted) {
      break;
    }
    if (attempt.missing !== reported) {
      reported = attempt.missing;
      onWaiting?.(attempt.missing);
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
