import {a2uiExtensionVersion} from './extension_uri.js';
import {isRecord} from './protocol.js';

/** A2A's name for the JSON-RPC transport, in both versions' cards. */
export const JSONRPC = 'JSONRPC';

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
  const transports = [...new Set(cardInterfaces(card).interfaces.map(entry => entry.binding))];
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

/**
 * What the terminal says of where a card puts JSON-RPC: that it lists no
 * interface or no JSON-RPC interface, an error, or that it prefers another
 * transport; nothing for a card that puts JSON-RPC first.
 */
function transportLine(transport: TransportCheck): string | undefined {
  switch (transport.kind) {
    case 'no_interface':
      return (
        "The agent's card lists no interface to reach it at. A2A 1.0 requires the card's " +
        'supportedInterfaces, and A2A 0.3 its url, so hosts that follow the card cannot reach ' +
        'the agent either.'
      );
    case 'no_jsonrpc':
      return (
        `The agent's card lists no A2A JSON-RPC interface, only ${transport.transports.join(', ')}. ` +
        'Spectra captures A2A over JSON-RPC only.'
      );
    case 'jsonrpc_later':
      return (
        `The agent's card prefers ${transport.preferred} to JSON-RPC. ` +
        "Hosts that follow the card's preference bypass the wire proxy, and their turns are not captured."
      );
    case 'jsonrpc_first':
      return undefined;
  }
}

/** An A2UI extension the card advertises. */
export interface A2uiExtension {
  /** The version its URI names, such as `v0.9`. */
  version: string;
  /** Its `supportedCatalogIds`, in order. */
  catalogIds: string[];
}

/** What the card states, as the viewer shows it. */
export interface CardDetails {
  /**
   * The A2A versions the card states, in card order: in A2A 1.0, those of its
   * JSON-RPC entries of `supportedInterfaces`; in A2A 0.3, its
   * `protocolVersion`.
   */
  a2aVersions: string[];
  /** The A2UI extensions in the card's `capabilities.extensions`, in card order. */
  a2uiExtensions: A2uiExtension[];
  /** The first example of each of the card's skills, in card order. */
  examples: string[];
}

/** Reads what the viewer shows of the card. */
export function cardDetailsOf(card: Record<string, unknown>): CardDetails {
  const {fields, interfaces} = cardInterfaces(card);
  const declared: unknown[] =
    fields === '1.0'
      ? interfaces.filter(entry => entry.binding === JSONRPC).map(entry => entry.version)
      : [card.protocolVersion];
  const a2aVersions = [
    ...new Set(declared.filter((version): version is string => isText(version))),
  ];

  const extensions =
    isRecord(card.capabilities) && Array.isArray(card.capabilities.extensions)
      ? card.capabilities.extensions
      : [];
  const a2uiExtensions = extensions.flatMap((extension): A2uiExtension[] => {
    if (!isRecord(extension) || typeof extension.uri !== 'string') return [];
    const version = a2uiExtensionVersion(extension.uri);
    if (version === undefined) return [];
    const ids = isRecord(extension.params) ? extension.params.supportedCatalogIds : undefined;
    return [
      {
        version,
        catalogIds: Array.isArray(ids) ? ids.filter(isText) : [],
      },
    ];
  });

  const skills = Array.isArray(card.skills) ? card.skills : [];
  const examples = skills.flatMap(skill => {
    const first =
      isRecord(skill) && Array.isArray(skill.examples) ? skill.examples.find(isText) : undefined;
    return typeof first === 'string' ? [first.trim()] : [];
  });

  return {a2aVersions, a2uiExtensions, examples};
}

/** What Spectra reads of a card that answered, at each start under `run` and at the start otherwise. */
export interface AnsweredCard {
  /** The agent's name, when the card names one. */
  name?: string;
  /** What the card states, as the viewer shows it. */
  details: CardDetails;
  /** The terminal's sentence on where the card puts JSON-RPC, when it has one. */
  line?: string;
  /**
   * Whether a turn can start through the wire proxy. Not when the card lists
   * no interface, or no JSON-RPC interface: its sentence is then an error.
   */
  capturable: boolean;
}

/** Reads a card that answered. */
export function readAnsweredCard(card: Record<string, unknown>): AnsweredCard {
  const transport = checkTransport(card);
  const line = transportLine(transport);
  return {
    ...(typeof card.name === 'string' && {name: card.name}),
    details: cardDetailsOf(card),
    ...(line !== undefined && {line}),
    capturable: transport.kind !== 'no_interface' && transport.kind !== 'no_jsonrpc',
  };
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** One interface a card offers: its binding, and its URL, A2A version and tenant where it states them. */
export interface CardInterface {
  binding: string;
  url?: string;
  version?: string;
  tenant?: string;
}

/**
 * The card's interfaces in preference order, and which A2A version's fields
 * name them. In A2A 1.0, `supportedInterfaces` in order. In A2A 0.3, the
 * preferred transport at `url`, JSON-RPC when unstated and `url` is given,
 * then `additionalInterfaces`; an A2A 0.3 card states its version once, for
 * the card, not per interface.
 */
export function cardInterfaces(card: Record<string, unknown>): {
  fields: '0.3' | '1.0';
  interfaces: CardInterface[];
} {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  if (Array.isArray(card.supportedInterfaces)) {
    return {
      fields: '1.0',
      interfaces: card.supportedInterfaces.flatMap((entry): CardInterface[] => {
        if (!isRecord(entry) || typeof entry.protocolBinding !== 'string') return [];
        const url = text(entry.url);
        const version = text(entry.protocolVersion);
        const tenant = text(entry.tenant);
        return [
          {
            binding: entry.protocolBinding,
            ...(url !== undefined && {url}),
            ...(version !== undefined && {version}),
            ...(tenant !== undefined && {tenant}),
          },
        ];
      }),
    };
  }
  const url = text(card.url);
  const preferred = text(card.preferredTransport) ?? (url === undefined ? undefined : JSONRPC);
  const additional = Array.isArray(card.additionalInterfaces)
    ? card.additionalInterfaces.flatMap((entry): CardInterface[] => {
        if (!isRecord(entry) || typeof entry.transport !== 'string') return [];
        const entryUrl = text(entry.url);
        return [{binding: entry.transport, ...(entryUrl !== undefined && {url: entryUrl})}];
      })
    : [];
  return {
    fields: '0.3',
    interfaces: [
      ...(preferred === undefined ? [] : [{binding: preferred, ...(url !== undefined && {url})}]),
      ...additional,
    ],
  };
}
