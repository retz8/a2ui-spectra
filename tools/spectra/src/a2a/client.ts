/**
 * The message box's A2A client: the interface it speaks to, the requests it
 * sends with Spectra's offer, and what it reads back from a reply.
 */

import {type CatalogOffer, CatalogRegistry} from '../catalog/registry.js';
import type {BoxInput} from '../message_box.js';
import {type CardInterface, cardInterfaces, JSONRPC} from './card.js';
import {dataModelKeyFor, joinInputMetadata} from './metadata.js';
import {A2UI_MIME_TYPE, a2aPart} from './parts.js';
import {
  type A2aVersion,
  isRecord,
  jsonRpcRequest,
  readDelivery,
  type TaskState,
} from './protocol.js';
import {a2uiExtensionUri} from './extension_uri.js';
import {bodyJson} from '../proxying/forwarding.js';
import {SseParser} from '../proxying/sse.js';
import type {ReplayInput} from '../replay/inputs.js';

/** The A2UI extension URIs of every version Spectra supports, sent in the extensions header. */
export const A2UI_EXTENSION_URIS: readonly string[] = ['v0.9', 'v0.9.1', 'v1.0'].map(
  a2uiExtensionUri,
);

/**
 * The capabilities for an offer of catalog ids: v0.9 and v0.9.1 under
 * v0.9's key, v1.0 under v1.0's, keyed `1.0` as v1.0 names itself, each
 * version naming the ids offered under it.
 */
export function capabilitiesFor(offer: CatalogOffer): Record<string, unknown> {
  return {
    a2uiClientCapabilities: {
      'v0.9': {supportedCatalogIds: [...offer['v0.9']]},
      'v0.9.1': {supportedCatalogIds: [...offer['v0.9.1']]},
    },
    a2uiRendererCapabilities: {
      '1.0': {supportedCatalogIds: [...offer['v1.0']]},
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
  /**
   * The card lists no JSON-RPC interface the box speaks: those with a URL are
   * at the versions named here, `unversioned` when one states none, and with
   * neither no JSON-RPC interface gives a URL.
   */
  | {kind: 'none'; versions: string[]; unversioned: boolean};

/**
 * Chooses the interface the box speaks to. With `supportedInterfaces`, it is
 * the first JSON-RPC entry whose `protocolVersion` is 0.3 or 1.0, compared on
 * major.minor. A card without them is spoken to as A2A 0.3 at its first
 * JSON-RPC interface: its `url`, unless it prefers another transport, then
 * `additionalInterfaces`.
 */
export function chooseInterface(card: Record<string, unknown>): InterfaceChoice {
  const streaming = isRecord(card.capabilities) && card.capabilities.streaming === true;
  const {fields, interfaces} = cardInterfaces(card);
  const spoken = interfaces.filter(
    (entry): entry is CardInterface & {url: string} =>
      entry.binding === JSONRPC && entry.url !== undefined,
  );
  if (fields === '0.3') {
    const first = spoken[0];
    return first === undefined
      ? {kind: 'none', versions: [], unversioned: false}
      : {kind: 'found', version: '0.3', url: first.url, streaming};
  }
  const versions: string[] = [];
  let unversioned = false;
  for (const entry of spoken) {
    const declared = entry.version ?? '';
    const version = majorMinor(declared);
    if (version === '0.3' || version === '1.0') {
      const tenant = entry.tenant ?? '';
      return {kind: 'found', version, url: entry.url, ...(tenant !== '' && {tenant}), streaming};
    }
    if (declared === '') unversioned = true;
    else versions.push(declared);
  }
  return {kind: 'none', versions: [...new Set(versions)], unversioned};
}

function majorMinor(version: string): string | undefined {
  return /^(\d+\.\d+)(?:\.\d+)?$/.exec(version.trim())?.[1];
}

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
 * A message sent as it stands: its parts and its metadata already in the
 * interface's version's form, and the conversation it continues.
 */
export interface PreparedMessage {
  parts: unknown[];
  metadata?: Record<string, unknown>;
  messageId: string;
  contextId?: string;
  taskId?: string;
}

export interface PreparedRequestOptions {
  /** The A2UI extension URIs of the extensions header; none sends no header. Every version Spectra supports when not given. */
  extensions?: readonly string[];
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
  const metadata = {
    ...capabilities,
    ...(message.dataModel !== undefined && {
      [dataModelKeyFor(message.dataModel.version)]: message.dataModel,
    }),
  };
  const part =
    target.version === '0.3'
      ? 'text' in message
        ? {kind: 'text', text: message.text}
        : {kind: 'data', data: message.action, metadata: {mimeType: A2UI_MIME_TYPE}}
      : 'text' in message
        ? {text: message.text}
        : {data: [message.action], mediaType: A2UI_MIME_TYPE};
  return preparedRequest(
    target,
    {
      parts: [part],
      metadata,
      messageId: message.messageId,
      ...(message.contextId !== undefined && {contextId: message.contextId}),
      ...(message.taskId !== undefined && {taskId: message.taskId}),
    },
    id,
    {headers},
  );
}

/**
 * The send or stream request for the interface's A2A version carrying a
 * message as it stands: its parts and metadata verbatim, the extensions
 * header listing the URIs given, and the configured headers under the box's
 * own transport headers.
 */
export function preparedRequest(
  target: BoxInterface,
  message: PreparedMessage,
  id: number,
  {extensions = A2UI_EXTENSION_URIS, headers = {}}: PreparedRequestOptions = {},
): BoxRequest {
  const conversation = {
    ...(message.contextId !== undefined && {contextId: message.contextId}),
    ...(message.taskId !== undefined && {taskId: message.taskId}),
  };
  const configured = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const metadata = message.metadata === undefined ? {} : {metadata: message.metadata};
  const accept = target.streaming ? 'text/event-stream' : 'application/json';
  const extensionsHeader = (name: string) =>
    extensions.length > 0 ? {[name]: extensions.join(', ')} : {};
  if (target.version === '0.3') {
    return {
      headers: {
        ...configured,
        'content-type': 'application/json',
        accept,
        ...extensionsHeader('x-a2a-extensions'),
      },
      body: jsonRpcRequest(id, target.streaming ? 'message/stream' : 'message/send', {
        message: {
          kind: 'message',
          messageId: message.messageId,
          role: 'user',
          parts: message.parts,
          ...conversation,
          ...metadata,
        },
      }),
    };
  }
  return {
    headers: {
      ...configured,
      'content-type': 'application/json',
      accept,
      'a2a-version': '1.0',
      ...extensionsHeader('a2a-extensions'),
    },
    body: jsonRpcRequest(id, target.streaming ? 'SendStreamingMessage' : 'SendMessage', {
      ...(target.tenant !== undefined && {tenant: target.tenant}),
      message: {
        messageId: message.messageId,
        role: 'ROLE_USER',
        parts: message.parts,
        ...conversation,
        ...metadata,
      },
    }),
  };
}

/** The message a replayed input is sent as, and what the live conversation holds so far. */
export interface ReplayedMessage {
  messageId: string;
  contextId?: string;
  /** The live conversation's task, sent on only after a recorded turn that ended waiting for input. */
  taskId?: string;
}

/**
 * The send or stream request that re-sends a recorded input in the
 * interface's A2A version: its parts in that version's form, its metadata
 * joined back under A2A's keys, the extensions header naming the A2UI
 * extension of each version the host offered, none sending no header, and
 * the live conversation's task where the recorded turn before it ended
 * waiting for input.
 */
export function replayRequest(
  target: BoxInterface,
  input: ReplayInput,
  message: ReplayedMessage,
  id: number,
  headers: Readonly<Record<string, string>> = {},
): BoxRequest {
  const metadata = joinInputMetadata(input.metadata);
  return preparedRequest(
    target,
    {
      parts: input.parts.map(part => a2aPart(part, target.version)),
      ...(metadata !== undefined && {metadata}),
      messageId: message.messageId,
      ...(message.contextId !== undefined && {contextId: message.contextId}),
      ...(input.afterWaitingTurn && message.taskId !== undefined && {taskId: message.taskId}),
    },
    id,
    {extensions: input.offeredVersions.map(a2uiExtensionUri), headers},
  );
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
    const delivered = readDelivery(body, version);
    const reply = 'reply' in delivered ? delivered.reply : undefined;
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
        take(bodyJson(event.data));
      }
    }
    for (const event of sse.push(text.decode())) {
      take(bodyJson(event.data));
    }
  } else {
    take(bodyJson(await response.text()));
  }
  return summary;
}
