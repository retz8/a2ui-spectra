/**
 * The conversation replay: what the agent's A2UI builds up to a turn, as a
 * host on that conversation holds it. The agent's messages of the earlier
 * turns, then the turn's own, go one by one into upstream web core's message
 * processor in its relaxed validation mode.
 */
import {Catalog} from '@a2ui/web_core/catalog';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/processing';
import type {SurfaceModel} from '@a2ui/web_core/state';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

import {agentMessages, type AgentMessage} from './messages.ts';
import type {Turn, TurnRecord, TurnRecordEvent} from './record.ts';

export interface ComponentNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  children: TreeNode[];
}

/** A child id no component has. */
export interface MissingNode {
  id: string;
  missing: true;
}

export type TreeNode = ComponentNode | MissingNode;

export interface SurfaceView {
  surfaceId: string;
  /** The surface's catalog; none for a v1.0 surface that names no default. */
  catalogId?: string;
  /** Whether the turn's own messages name the surface. */
  touched: boolean;
  structure: SurfaceStructure;
  dataModel: unknown;
}

/**
 * A surface's components: as a tree when its catalogs say which properties
 * hold child ids, else in the order they came, for a surface with a
 * component of a stand-in catalog, whose schemas are not known.
 */
export type SurfaceStructure =
  | {
      /** The tree from the surface's root. */
      tree: TreeNode;
      /** The components no parent reaches from the root, each with what it reaches. */
      notUnderRoot: ComponentNode[];
    }
  | {unnested: ComponentNode[]};

/** A message of the turn the processor rejected. */
export interface Rejection {
  /** The message, as `messageKey` names it. */
  key: string;
  surfaceId?: string;
  code: string;
  message: string;
}

export interface Replay {
  /** Every surface live after the turn: those the turn touched first, in the order it touched them. */
  surfaces: SurfaceView[];
  /** The surfaces the turn deleted. */
  deleted: string[];
  rejections: Rejection[];
}

type Processor = MessageProcessor;

const BASIC_CATALOG_IDS = new Set([basicCatalogV09.id, basicCatalogV10.id]);

/** The replay of a record's turn, the last, after the conversation's earlier turns embedded with it. */
export function replayRecord(record: TurnRecord): Replay {
  return replay(record.turns.slice(0, -1), record.turns[record.turns.length - 1].events);
}

/** The replay of a turn's events after the conversation's earlier turns. */
export function replay(earlierTurns: readonly Turn[], events: readonly TurnRecordEvent[]): Replay {
  const earlier = earlierTurns.flatMap(turn => agentMessages(turn.events));
  const own = agentMessages(events);
  const standIns = standInCatalogs([...earlier, ...own]);
  const standInIds = new Set(standIns.map(catalog => catalog.id));
  const processor = new MessageProcessor(
    [basicCatalogV09, basicCatalogV10, ...standIns],
    undefined,
    {validationConfig: RELAXED_VALIDATION},
  );
  try {
    for (const {message} of earlier) feed(processor, message);
    const touched: string[] = [];
    const deleted = new Set<string>();
    const rejections: Rejection[] = [];
    for (const {key, message} of own) {
      const surfaceId = surfaceIdOf(message);
      if (surfaceId !== undefined && !touched.includes(surfaceId)) touched.push(surfaceId);
      const error = feed(processor, message);
      if (error !== undefined) {
        rejections.push({key, ...(surfaceId !== undefined && {surfaceId}), ...error});
      } else if (surfaceId !== undefined && isDeleteSurface(message)) {
        deleted.add(surfaceId);
      }
    }
    const live = [...processor.getSurfaces().values()];
    const ordered = [
      ...touched.flatMap(id => live.filter(surface => surface.id === id)),
      ...live.filter(surface => !touched.includes(surface.id)),
    ];
    return {
      surfaces: ordered.map(surface => viewOf(surface, touched.includes(surface.id), standInIds)),
      deleted: [...deleted].filter(id => processor.getSurface(id) === undefined),
      rejections,
    };
  } finally {
    processor.dispose();
  }
}

/** Feeds one message; returns the processor's error when it rejects it. */
function feed(processor: Processor, message: unknown): {code: string; message: string} | undefined {
  try {
    processor.processMessages(message as Parameters<Processor['processMessages']>[0]);
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
 * name that is not a basic catalog's: a surface's, a component's or a
 * function call's. The relaxed mode lets any component and function through it.
 */
function standInCatalogs(messages: readonly AgentMessage[]): Array<Catalog<never>> {
  const versions = new Map<string, string>();
  for (const {message} of messages) {
    const version = versionOf(message)?.startsWith('v1.') ? '1.0' : '0.9';
    for (const id of catalogIdsIn(message)) {
      if (!BASIC_CATALOG_IDS.has(id) && !versions.has(id)) versions.set(id, version);
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

/** The surface a message names: the `surfaceId` of its one message type. */
function surfaceIdOf(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  for (const [key, body] of Object.entries(message)) {
    if (key === 'version' || typeof body !== 'object' || body === null) continue;
    const surfaceId = (body as {surfaceId?: unknown}).surfaceId;
    if (typeof surfaceId === 'string') return surfaceId;
  }
  return undefined;
}

function isDeleteSurface(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'deleteSurface' in message;
}

function viewOf(
  surface: SurfaceModel,
  touched: boolean,
  standInIds: ReadonlySet<string>,
): SurfaceView {
  return {
    surfaceId: surface.id,
    ...(surface.defaultCatalog !== undefined && {catalogId: surface.defaultCatalog.id}),
    touched,
    structure: structureOf(surface, standInIds),
    dataModel: plain(surface.dataModel.get('/')),
  };
}

function structureOf(surface: SurfaceModel, standInIds: ReadonlySet<string>): SurfaceStructure {
  const components = surface.componentsModel;
  const all = [...components.values];
  if (
    (surface.defaultCatalog !== undefined && standInIds.has(surface.defaultCatalog.id)) ||
    all.some(component => standInIds.has(component.catalog.id))
  ) {
    return {
      unnested: all.map(({id, type, properties}) => ({
        id,
        type,
        properties: plain(properties),
        children: [],
      })),
    };
  }
  const reached = new Set<string>();
  const build = (id: string, ancestors: ReadonlySet<string>): TreeNode => {
    const component = components.get(id);
    if (component === undefined) return {id, missing: true};
    reached.add(id);
    const children = ancestors.has(id)
      ? []
      : components.getChildIds(id).map(child => build(child, new Set(ancestors).add(id)));
    return {id, type: component.type, properties: plain(component.properties), children};
  };
  const tree = build(surface.rootId, new Set());
  const rest = [...components.keys].filter(id => !reached.has(id));
  const referenced = new Set(rest.flatMap(id => components.getChildIds(id)));
  const notUnderRoot: ComponentNode[] = [];
  // Those no stray component references first, so each heads what it reaches.
  for (const id of [...rest.filter(id => !referenced.has(id)), ...rest]) {
    if (!reached.has(id)) notUnderRoot.push(build(id, new Set()) as ComponentNode);
  }
  return {tree, notUnderRoot};
}

/** A copy that holds no live state of the processor's. */
function plain<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
