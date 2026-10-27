/**
 * A conversation fed through upstream web core: the agent's A2UI messages of
 * the earlier turns, then this turn's, one by one into web core's message
 * processor in its relaxed validation mode, with every catalog the registry
 * knows, the catalogs the hosts sent inline anywhere in the conversation, and
 * a stand-in catalog with no component schemas under any other catalog id the
 * messages name. The viewer's replay feeds the processor the same way, so
 * what the server counts and checks agrees with what the viewer shows.
 *
 * What the checks and the rejection count read from it: the surfaces as they
 * stand at the turn's close; this turn's messages, each with web core's
 * rejection of it when there was one; the surfaces this turn touched; the
 * surfaces a `createSurface` named; each surface's catalog id; and where
 * each component's standing definition was carried.
 */
import {Catalog} from '@a2ui/web_core/catalog';
import {MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/processing';
import type {SurfaceModel} from '@a2ui/web_core/state';

import {
  CatalogRegistry,
  type InlineDefinition,
  type ProcessorCatalog,
} from '../catalog/registry.js';
import {isEventOfKind, type Turn} from '../record/turn_record.js';
import {agentMessages} from './schema_check.js';

/** One A2UI message the agent sent, as the conversation fed it. */
export interface FedMessage {
  /** The JSON Pointer from the turn object to the message. */
  path: string;
  message: unknown;
  /** The key naming the message type, such as `updateComponents`. */
  type?: string;
  surfaceId?: string;
  version?: string;
  /** Web core's rejection, when it threw on the message. */
  rejection?: Rejection;
}

/** Web core's rejection of a message: the error's code and sentence. */
export interface Rejection {
  code: string;
  message: string;
}

/** Where a component's standing definition was carried. */
export interface Carrier {
  /** Whether the message is this turn's, not an earlier turn's. */
  own: boolean;
  /** The JSON Pointer from the turn object to the component object in the message. */
  path: string;
  /** The component as the message carried it. */
  component: Record<string, unknown>;
  version?: string;
}

/** A definition the conversation can judge against: the registry's or an inline one. */
export interface ResolvedCatalog {
  id: string;
  /** `0.9` or `1.0`. */
  protocolVersion: string;
  definition: Record<string, unknown>;
  catalog: ProcessorCatalog;
}

export class Conversation {
  /** The surfaces as they stand at the turn's close, by id. */
  readonly surfaces: ReadonlyMap<string, SurfaceModel>;
  /** This turn's agent messages, in order. */
  readonly own: readonly FedMessage[];
  /** The surfaces this turn's messages name, in order of first naming. */
  readonly touched: readonly string[];
  /** Every surface a `createSurface` of the conversation named, accepted or not. */
  readonly created: ReadonlySet<string>;
  /** The surfaces this turn deleted and that are gone at the close. */
  readonly deletedByTurn: ReadonlySet<string>;
  /** Each surface's catalog id, from the last `createSurface` naming it. */
  readonly catalogIdOf: ReadonlyMap<string, string>;
  readonly #registry: CatalogRegistry;
  readonly #inline: ReadonlyMap<string, InlineDefinition>;
  readonly #carriers: ReadonlyMap<string, Carrier>;
  readonly #processor: MessageProcessor;

  constructor(
    processor: MessageProcessor,
    registry: CatalogRegistry,
    inline: ReadonlyMap<string, InlineDefinition>,
    own: FedMessage[],
    created: Set<string>,
    catalogIdOf: Map<string, string>,
    carriers: Map<string, Carrier>,
  ) {
    this.#processor = processor;
    this.#registry = registry;
    this.#inline = inline;
    this.#carriers = carriers;
    this.surfaces = processor.getSurfaces() as ReadonlyMap<string, SurfaceModel>;
    this.own = own;
    this.created = created;
    this.catalogIdOf = catalogIdOf;
    const touched: string[] = [];
    const deleted = new Set<string>();
    for (const {surfaceId, type, rejection} of own) {
      if (surfaceId === undefined) continue;
      if (!touched.includes(surfaceId)) touched.push(surfaceId);
      if (type === 'deleteSurface' && rejection === undefined) deleted.add(surfaceId);
    }
    this.touched = touched;
    this.deletedByTurn = new Set([...deleted].filter(id => !this.surfaces.has(id)));
  }

  /** Where a component's standing definition was carried; nothing for a component not in the state. */
  carrier(surfaceId: string, componentId: string): Carrier | undefined {
    return this.#carriers.get(carrierKey(surfaceId, componentId));
  }

  /**
   * The definition under a catalog id, in the Phase 4 order: the registry's,
   * built in or configured, else one a host of the conversation sent inline.
   * Nothing for an id the conversation cannot judge against.
   */
  resolve(catalogId: string): ResolvedCatalog | undefined {
    const known = this.#registry.get(catalogId);
    if (known !== undefined) {
      const catalog = this.#registry.catalogs().find(entry => entry.id === catalogId);
      if (catalog !== undefined) {
        return {
          id: catalogId,
          protocolVersion: known.protocolVersion,
          definition: known.definition,
          catalog,
        };
      }
    }
    const inline = this.#inline.get(catalogId);
    return (
      inline && {
        id: inline.id,
        protocolVersion: inline.protocolVersion,
        definition: inline.definition,
        catalog: inline.catalog,
      }
    );
  }

  /** How many of this turn's messages web core rejected. */
  get rejectionCount(): number {
    return this.own.filter(({rejection}) => rejection !== undefined).length;
  }

  /** Releases the processor; the surfaces are not read after this. */
  dispose(): void {
    this.#processor.dispose();
  }
}

/**
 * Feeds the conversation through web core: the earlier turns' agent messages,
 * then the turn's own. Dispose the result when done with its surfaces.
 */
export function feedConversation(
  turn: Turn,
  earlierTurns: readonly Turn[] = [],
  registry: CatalogRegistry = CatalogRegistry.builtIn(),
): Conversation {
  const turns = [...earlierTurns, turn];
  const inline = inlineDefinitions(registry, turns);
  const fed = turns.map((each, index) =>
    agentMessages(each).map(({message, path}) => ({
      ...describe(message, path),
      own: index === turns.length - 1,
    })),
  );
  const messages = fed.flat();
  const known = new Set([...registry.catalogs().map(catalog => catalog.id), ...inline.keys()]);
  const standIns = standInCatalogs(
    messages.map(({message}) => message),
    known,
  );
  // The processor asks a schema-only catalog for no function here: it nests and validates only.
  const processor = new MessageProcessor(
    [
      ...registry.catalogs(),
      ...[...inline.values()].map(({catalog}) => catalog),
      ...standIns,
    ] as Array<Catalog<never>>,
    undefined,
    {validationConfig: RELAXED_VALIDATION},
  );
  const created = new Set<string>();
  const catalogIdOf = new Map<string, string>();
  const carriers = new Map<string, Carrier>();
  const own: FedMessage[] = [];
  for (const {own: isOwn, ...fedMessage} of messages) {
    const rejection = feed(processor, fedMessage.message);
    const message = rejection === undefined ? fedMessage : {...fedMessage, rejection};
    if (isOwn) own.push(message);
    noteMessage(message, isOwn, created, catalogIdOf, carriers);
  }
  return new Conversation(processor, registry, inline, own, created, catalogIdOf, carriers);
}

/** The catalogs every host of the conversation sent inline, by id, the first definition under an id kept. */
function inlineDefinitions(
  registry: CatalogRegistry,
  turns: readonly Turn[],
): Map<string, InlineDefinition> {
  const inline = new Map<string, InlineDefinition>();
  for (const turn of turns) {
    for (const event of turn.events) {
      if (!isEventOfKind(event, 'wire_input')) continue;
      for (const definition of registry.inlineDefinitions(
        event.attributes['a2ui.wire.capabilities'],
      )) {
        if (!inline.has(definition.id)) inline.set(definition.id, definition);
      }
    }
  }
  return inline;
}

/**
 * The catalogs for web core's processor on a conversation: every catalog the
 * registry knows, the catalogs its hosts sent inline, each id once, and a
 * stand-in under each other catalog id the messages name.
 */
export function processorCatalogs(
  registry: CatalogRegistry,
  turns: readonly Turn[],
  messages: readonly unknown[],
): ProcessorCatalog[] {
  const inline = inlineDefinitions(registry, turns);
  const catalogs = [...registry.catalogs(), ...[...inline.values()].map(({catalog}) => catalog)];
  return [...catalogs, ...standInCatalogs(messages, new Set(catalogs.map(catalog => catalog.id)))];
}

/** The message type, surface and version a message names, with its pointer. */
function describe(message: unknown, path: string): FedMessage {
  const described: FedMessage = {path, message};
  if (!isObject(message)) return described;
  if (typeof message.version === 'string') described.version = message.version;
  for (const [key, value] of Object.entries(message)) {
    if (key === 'version' || !isObject(value)) continue;
    described.type = key;
    if (typeof value.surfaceId === 'string') described.surfaceId = value.surfaceId;
    break;
  }
  return described;
}

/** What a message tells about surfaces and components, once fed. */
function noteMessage(
  message: FedMessage,
  own: boolean,
  created: Set<string>,
  catalogIdOf: Map<string, string>,
  carriers: Map<string, Carrier>,
): void {
  const {type, surfaceId, path, version, rejection} = message;
  if (type === undefined || surfaceId === undefined || !isObject(message.message)) return;
  const body = message.message[type];
  if (!isObject(body)) return;
  if (type === 'createSurface') {
    created.add(surfaceId);
    if (typeof body.catalogId === 'string') catalogIdOf.set(surfaceId, body.catalogId);
  }
  if (rejection !== undefined || !Array.isArray(body.components)) return;
  body.components.forEach((component: unknown, index) => {
    if (!isObject(component) || typeof component.id !== 'string') return;
    carriers.set(carrierKey(surfaceId, component.id), {
      own,
      path: `${path}/${type}/components/${index}`,
      component,
      ...(version !== undefined && {version}),
    });
  });
}

function carrierKey(surfaceId: string, componentId: string): string {
  return `${surfaceId}\u0000${componentId}`;
}

/**
 * Feeds a copy of one message, since the processor keeps and changes the
 * objects it is given; web core's rejection when it threw on it.
 */
function feed(processor: MessageProcessor, message: unknown): Rejection | undefined {
  try {
    processor.processMessages(
      structuredClone(message) as Parameters<MessageProcessor['processMessages']>[0],
    );
    return undefined;
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as {code?: unknown}).code;
      return {code: typeof code === 'string' ? code : error.name, message: error.message};
    }
    return {code: 'ERROR', message: String(error)};
  }
}

/**
 * A catalog with no component schemas under each catalog id the messages
 * name that no catalog is known under: a surface's, a component's or a
 * function call's. The relaxed mode lets any component and function through it.
 */
function standInCatalogs(
  messages: readonly unknown[],
  known: ReadonlySet<string>,
): Array<Catalog<never>> {
  const versions = new Map<string, string>();
  for (const message of messages) {
    const version = versionOf(message)?.startsWith('v1.') ? '1.0' : '0.9';
    for (const id of catalogIdsIn(message)) {
      if (!known.has(id) && !versions.has(id)) versions.set(id, version);
    }
  }
  return [...versions].map(([id, version]) => new Catalog<never>(id, version, [], []));
}

/** Every string under a `catalogId` key, at any depth. */
function catalogIdsIn(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) catalogIdsIn(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'catalogId' && typeof item === 'string') found.push(item);
      else catalogIdsIn(item, found);
    }
  }
  return found;
}

function versionOf(message: unknown): string | undefined {
  const version = (message as {version?: unknown} | null)?.version;
  return typeof version === 'string' ? version : undefined;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
