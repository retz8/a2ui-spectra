import {isRecord} from './protocol.js';

/** A2A's name for the JSON-RPC transport, in both versions' cards. */
const JSONRPC = 'JSONRPC';

/** The scheme and authority of an absolute URL. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** The well-known paths an agent serves its card at: A2A's, and the deprecated one. */
const CARD_PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json'];

/** The JSON-RPC methods that return the extended card, in A2A 0.3 and 1.0. */
export const EXTENDED_CARD_METHODS = new Set([
  'agent/getAuthenticatedExtendedCard',
  'GetExtendedAgentCard',
]);

/** Whether a request path asks for the agent's card, under any base path. */
export function isCardPath(pathname: string): boolean {
  return CARD_PATHS.some(cardPath => pathname.endsWith(cardPath));
}

/**
 * The card with each JSON-RPC endpoint pointed at the proxy: the `url` and
 * the JSON-RPC entries of `additionalInterfaces` in A2A 0.3, and the
 * JSON-RPC entries of `supportedInterfaces` in A2A 1.0. Only the origin is
 * replaced; the rest of the URL is kept as written.
 */
export function rewriteCard(
  card: Record<string, unknown>,
  proxyOrigin: string,
): Record<string, unknown> {
  const rewritten = {...card};
  if (typeof card.url === 'string') {
    rewritten.url = withOrigin(card.url, proxyOrigin);
  }
  for (const [key, transportKey] of [
    ['additionalInterfaces', 'transport'],
    ['supportedInterfaces', 'protocolBinding'],
  ] as const) {
    const interfaces = card[key];
    if (Array.isArray(interfaces)) {
      rewritten[key] = interfaces.map(entry =>
        isRecord(entry) && entry[transportKey] === JSONRPC && typeof entry.url === 'string'
          ? {...entry, url: withOrigin(entry.url, proxyOrigin)}
          : entry,
      );
    }
  }
  return rewritten;
}

function withOrigin(url: string, origin: string): string {
  return ORIGIN.test(url) ? url.replace(ORIGIN, origin) : url;
}

/** Where the card puts JSON-RPC among the transports it lists, or that it lists none. */
export type TransportCheck =
  | {kind: 'jsonrpc_first'}
  | {kind: 'jsonrpc_later'; preferred: string}
  | {kind: 'no_jsonrpc'; transports: string[]}
  | {kind: 'no_interface'};

/**
 * Reads the card's transports in preference order: in A2A 0.3, the preferred
 * transport, JSON-RPC when unstated, then `additionalInterfaces`; in A2A 1.0,
 * `supportedInterfaces` in order.
 */
export function checkTransport(card: Record<string, unknown>): TransportCheck {
  const transports = [...new Set(transportsOf(card))];
  if (transports.length === 0) {
    return {kind: 'no_interface'};
  }
  if (transports[0] === JSONRPC) {
    return {kind: 'jsonrpc_first'};
  }
  if (transports.includes(JSONRPC)) {
    return {kind: 'jsonrpc_later', preferred: transports[0]};
  }
  return {kind: 'no_jsonrpc', transports};
}

function transportsOf(card: Record<string, unknown>): string[] {
  if (Array.isArray(card.supportedInterfaces)) {
    return card.supportedInterfaces.flatMap(entry =>
      isRecord(entry) && typeof entry.protocolBinding === 'string' ? [entry.protocolBinding] : [],
    );
  }
  const preferred =
    typeof card.preferredTransport === 'string'
      ? card.preferredTransport
      : typeof card.url === 'string'
        ? JSONRPC
        : undefined;
  const additional = Array.isArray(card.additionalInterfaces)
    ? card.additionalInterfaces.flatMap(entry =>
        isRecord(entry) && typeof entry.transport === 'string' ? [entry.transport] : [],
      )
    : [];
  return preferred === undefined ? additional : [preferred, ...additional];
}
