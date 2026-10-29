/**
 * The message box's A2A client: the interface it speaks to, the requests it
 * sends with Spectra's offer, and what it reads back from a reply.
 */

import {type CatalogOffer, CatalogRegistry} from '../catalog/registry.js';
import {JSONRPC} from './card.js';
import {dataModelKeyFor} from './metadata.js';
import {type A2aVersion, isRecord, readReply, type TaskState} from './protocol.js';
import {SseParser} from './sse.js';

/** The A2UI extension URIs of every version Spectra supports, sent in the extensions header. */
export const A2UI_EXTENSION_URIS: readonly string[] = [
  'https://a2ui.org/a2a-extension/a2ui/v0.9',
  'https://a2ui.org/a2a-extension/a2ui/v0.9.1',
  'https://a2ui.org/a2a-extension/a2ui/v1.0',
];

/**
 * The capabilities for an offer of catalog ids: v0.9 and v0.9.1 under
 * v0.9's key, v1.0 under v1.0's, each version naming the ids offered under it.
 */
export function capabilitiesFor(offer: CatalogOffer): Record<string, unknown> {
  return {
    a2uiClientCapabilities: {
      'v0.9': {supportedCatalogIds: [...offer['v0.9']]},
      'v0.9.1': {supportedCatalogIds: [...offer['v0.9.1']]},
    },
    a2uiRendererCapabilities: {
      'v1.0': {supportedCatalogIds: [...offer['v1.0']]},
    },
  };
}

/** The capabilities sent when no catalog is configured: each version's basic catalog. */
export const A2UI_CAPABILITIES: Readonly<Record<string, unknown>> = capabilitiesFor(
  CatalogRegistry.builtIn().offer(),
);

/** Where the box sends, and how. */
export interface BoxInterface {
  version: A2aVersion;
  url: string;
  /** The interface's tenant, set in every A2A 1.0 request; none when the interface sets none. */
  tenant?: string;
  /** Whether the card declares streaming, which picks the stream method over the send. */
  streaming: boolean;
}

export type InterfaceChoice =
  | ({kind: 'found'} & BoxInterface)
  /** The card lists JSON-RPC only at versions the box does not speak, named here. */
  | {kind: 'none'; versions: string[]};

/**
 * Chooses the interface the box speaks to. With `supportedInterfaces`, it is
 * the first JSON-RPC entry whose `protocolVersion` is 0.3 or 1.0, compared on
 * major.minor. A card without them is spoken to as A2A 0.3 at its first
 * JSON-RPC interface: its `url`, unless it prefers another transport, then
 * `additionalInterfaces`.
 */
export function chooseInterface(card: Record<string, unknown>): InterfaceChoice {
  const streaming = isRecord(card.capabilities) && card.capabilities.streaming === true;
  if (Array.isArray(card.supportedInterfaces)) {
    const versions: string[] = [];
    for (const entry of card.supportedInterfaces) {
      if (!isRecord(entry) || entry.protocolBinding !== JSONRPC || typeof entry.url !== 'string') {
        continue;
      }
      const declared = typeof entry.protocolVersion === 'string' ? entry.protocolVersion : '';
      const version = majorMinor(declared);
      if (version === '0.3' || version === '1.0') {
        const tenant = typeof entry.tenant === 'string' && entry.tenant !== '' ? entry.tenant : '';
        return {
          kind: 'found',
          version,
          url: entry.url,
          ...(tenant !== '' && {tenant}),
          streaming,
        };
      }
      versions.push(declared === '' ? 'no version' : declared);
    }
    return {kind: 'none', versions: [...new Set(versions)]};
  }
  const preferred = typeof card.preferredTransport === 'string' ? card.preferredTransport : JSONRPC;
  if (preferred === JSONRPC && typeof card.url === 'string') {
    return {kind: 'found', version: '0.3', url: card.url, streaming};
  }
  const additional = Array.isArray(card.additionalInterfaces) ? card.additionalInterfaces : [];
  for (const entry of additional) {
    if (isRecord(entry) && entry.transport === JSONRPC && typeof entry.url === 'string') {
      return {kind: 'found', version: '0.3', url: entry.url, streaming};
    }
  }
  return {kind: 'none', versions: []};
}

function majorMinor(version: string): string | undefined {
  return /^(\d+\.\d+)(?:\.\d+)?$/.exec(version.trim())?.[1];
}

/** The MIME type of a data part that carries A2UI, as the extension specification gives it. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/**
 * What a host message carries: a text, or one A2UI action message,
 * `{version, action}`, with the data model map, `{version, surfaces}`, when
 * a surface asked for it.
 */
export type BoxInput = ({text: string} | {action: Record<string, unknown>}) & {
  dataModel?: Record<string, unknown>;
};

/** The message the box sends, and the conversation it continues. */
export type BoxMessage = BoxInput & {
  messageId: string;
  contextId?: string;
  taskId?: string;
};

/** One JSON-RPC request, ready to post. */
export interface BoxRequest {
  headers: Record<string, string>;
  body: string;
}

export interface RequestOptions {
  /** The capabilities for the message's metadata; the basic catalogs alone when not given. */
  capabilities?: Readonly<Record<string, unknown>>;
  /** The configured headers, added to the request; the box's own transport headers win over them. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * The send or stream request for the interface's A2A version, with Spectra's
 * offer: every supported A2UI extension in the version's extensions header,
 * and the capabilities in the message's metadata, beside the data model
 * under its version's key. An action is one data part with A2UI's MIME
 * type: under A2A 0.3 its data is the message and the type is in the part's
 * metadata; under A2A 1.0 its data is a list of the one message and the type
 * is the part's media type.
 */
export function boxRequest(
  target: BoxInterface,
  message: BoxMessage,
  id: number,
  {capabilities = A2UI_CAPABILITIES, headers = {}}: RequestOptions = {},
): BoxRequest {
  const extensions = A2UI_EXTENSION_URIS.join(', ');
  const conversation = {
    ...(message.contextId !== undefined && {contextId: message.contextId}),
    ...(message.taskId !== undefined && {taskId: message.taskId}),
  };
  const configured = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const metadata = {
    ...capabilities,
    ...(message.dataModel !== undefined && {
      [dataModelKeyFor(message.dataModel.version)]: message.dataModel,
    }),
  };
  if (target.version === '0.3') {
    return {
      headers: {
        ...configured,
        'content-type': 'application/json',
        accept: target.streaming ? 'text/event-stream' : 'application/json',
        'x-a2a-extensions': extensions,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: target.streaming ? 'message/stream' : 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: message.messageId,
            role: 'user',
            parts: [
              'text' in message
                ? {kind: 'text', text: message.text}
                : {kind: 'data', data: message.action, metadata: {mimeType: A2UI_MIME_TYPE}},
            ],
            ...conversation,
            metadata,
          },
        },
      }),
    };
  }
  return {
    headers: {
      ...configured,
      'content-type': 'application/json',
      accept: target.streaming ? 'text/event-stream' : 'application/json',
      'a2a-version': '1.0',
      'a2a-extensions': extensions,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: target.streaming ? 'SendStreamingMessage' : 'SendMessage',
      params: {
        ...(target.tenant !== undefined && {tenant: target.tenant}),
        message: {
          messageId: message.messageId,
          role: 'ROLE_USER',
          parts: [
            'text' in message
              ? {text: message.text}
              : {data: [message.action], mediaType: A2UI_MIME_TYPE},
          ],
          ...conversation,
          metadata,
        },
      },
    }),
  };
}

/** What the box carries into its next send from a reply. */
export interface ReplySummary {
  contextId?: string;
  /** The task the reply was about, the last one it named. */
  taskId?: string;
  /** The last task state the reply carried. */
  state?: TaskState;
}

/**
 * Reads a reply to the end, a JSON-RPC response or a server-sent event
 * stream of them, for the conversation and the task it names.
 */
export async function readReplySummary(
  response: Response,
  version: A2aVersion,
): Promise<ReplySummary> {
  const summary: ReplySummary = {};
  const take = (body: unknown) => {
    if (!isRecord(body) || !('result' in body)) {
      return;
    }
    const reply = readReply(body.result, version);
    if (reply === undefined) {
      return;
    }
    const contextId = reply.kind === 'message' ? reply.message.contextId : reply.contextId;
    const taskId = reply.kind === 'message' ? reply.message.taskId : reply.taskId;
    summary.contextId ??= contextId;
    if (taskId !== undefined) {
      summary.taskId = taskId;
    }
    if ((reply.kind === 'task' || reply.kind === 'status-update') && reply.state) {
      summary.state = reply.state;
    }
  };
  if (/^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '')) {
    const sse = new SseParser();
    const text = new TextDecoder();
    for await (const chunk of response.body ?? []) {
      for (const event of sse.push(text.decode(chunk as Uint8Array, {stream: true}))) {
        take(parseJson(event.data));
      }
    }
    for (const event of sse.push(text.decode())) {
      take(parseJson(event.data));
    }
  } else {
    take(parseJson(await response.text()));
  }
  return summary;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
