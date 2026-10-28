/**
 * The conversation replay: what the agent's A2UI builds up to a turn, as a
 * host on that conversation holds it. The agent's messages of the earlier
 * turns, then the turn's own, go one by one into upstream web core's message
 * processor in its relaxed validation mode.
 */
import {Catalog} from '@a2ui/web_core/catalog';
import {MessageProcessor, RELAXED_VALIDATION} from '@a2ui/web_core/processing';
import type {SurfaceModel} from '@a2ui/web_core/state';

import {catalogsOf, inlineCatalogsOf, type ProcessorCatalog} from './catalogs.ts';
import {
  agentMessages,
  type AgentMessage,
  catalogIdsIn,
  componentPointer,
  surfaceIdOf,
} from './messages.ts';
import {isWireInput, type Turn, type TurnRecord, type TurnRecordEvent} from './record.ts';
import {isThrough, messageTypeOf, type Position} from './steps.ts';

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
  /** How many of the surface's `updateComponents` the processor rejected, when it has no components. */
  rejectedUpdates?: number;
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
  /** A JSON Pointer inside the message to where web core says it went wrong, when it says. */
  inner?: string;
}

export interface Replay {
  /** Every surface live after the turn: those the turn touched first, in the order it touched them. */
  surfaces: SurfaceView[];
  /** The surfaces the turn deleted. */
  deleted: string[];
  rejections: Rejection[];
}

type Processor = MessageProcessor;

let builtIn: ProcessorCatalog[] | undefined;

/** The catalogs when the server's listing is not known yet: the basic catalogs alone. */
function builtInCatalogs(): ProcessorCatalog[] {
  builtIn ??= catalogsOf(undefined);
  return builtIn;
}

/** The replay of a record's turn, the last, after the conversation's earlier turns embedded with it. */
export function replayRecord(record: TurnRecord, catalogs?: readonly ProcessorCatalog[]): Replay {
  return replay(
    record.turns.slice(0, -1),
    record.turns[record.turns.length - 1].events,
    undefined,
    catalogs,
  );
}

/**
 * The replay of a turn's events after the conversation's earlier turns: up to
 * a position, as the surfaces stood right after the step there, or through
 * the whole turn. The processor gets the catalogs given, the server's known
 * definitions, the catalogs the hosts of the conversation sent inline, and a
 * stand-in under any other catalog id the messages name.
 */
export function replay(
  earlierTurns: readonly Turn[],
  events: readonly TurnRecordEvent[],
  through?: Position,
  catalogs: readonly ProcessorCatalog[] = builtInCatalogs(),
): Replay {
  const earlier = earlierTurns.flatMap(turn => agentMessages(turn.events));
  const own = agentMessages(events).filter(
    message => through === undefined || isThrough(message, through),
  );
  const known = new Set(catalogs.map(catalog => catalog.id));
  const inline: ProcessorCatalog[] = [];
  for (const turnEvents of [...earlierTurns.map(turn => turn.events), events]) {
    for (const event of turnEvents) {
      if (!isWireInput(event)) continue;
      for (const catalog of inlineCatalogsOf(event.attributes['a2ui.wire.capabilities'], known)) {
        known.add(catalog.id);
        inline.push(catalog);
      }
    }
  }
  const standIns = standInCatalogs([...earlier, ...own], known);
  const standInIds = new Set(standIns.map(catalog => catalog.id));
  // The processor asks a schema-only catalog for no function here: it nests and validates only.
  const processor = new MessageProcessor(
    [...catalogs, ...inline, ...standIns] as Array<Catalog<never>>,
    undefined,
    {validationConfig: RELAXED_VALIDATION},
  );
  try {
    // Each surface's rejected updateComponents, the earlier turns' included.
    const rejectedUpdates = new Map<string, number>();
    const countRejected = (message: unknown, surfaceId: string | undefined) => {
      if (surfaceId !== undefined && messageTypeOf(message) === 'updateComponents') {
        rejectedUpdates.set(surfaceId, (rejectedUpdates.get(surfaceId) ?? 0) + 1);
      }
    };
    for (const {message} of earlier) {
      if (feed(processor, message) !== undefined) countRejected(message, surfaceIdOf(message));
    }
    const touched: string[] = [];
    const deleted = new Set<string>();
    const rejections: Rejection[] = [];
    for (const {key, message} of own) {
      const surfaceId = surfaceIdOf(message);
      if (surfaceId !== undefined && !touched.includes(surfaceId)) touched.push(surfaceId);
      const error = feed(processor, message);
      if (error !== undefined) {
        countRejected(message, surfaceId);
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
      surfaces: ordered.map(surface =>
        viewOf(surface, touched.includes(surface.id), standInIds, rejectedUpdates.get(surface.id)),
      ),
      deleted: [...deleted].filter(id => processor.getSurface(id) === undefined),
      rejections,
    };
  } finally {
    processor.dispose();
  }
}

/**
 * Feeds a copy of one message, since the processor keeps and changes the
 * objects it is given; returns the processor's error when it rejects it.
 */
function feed(
  processor: Processor,
  message: unknown,
): {code: string; message: string; inner?: string} | undefined {
  try {
    processor.processMessages(
      structuredClone(message) as Parameters<Processor['processMessages']>[0],
    );
    return undefined;
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as {code?: unknown}).code;
      return {code: typeof code === 'string' ? code : error.name, ...rejectionOf(error, message)};
    }
    return {code: 'ERROR', message: String(error)};
  }
}

/** A Zod issue as web core's validation errors carry them. */
interface ZodIssue {
  code: string;
  path: Array<string | number>;
  keys?: string[];
  unionErrors?: Array<{issues: ZodIssue[]}>;
}

const COMPONENT_FAILED = /^Validation failed for component '[^']*' \((.*)\): /;

const MESSAGE_FAILED = /^(Invalid \S+ message: )([\s\S]*)$/;

/**
 * Web core's sentence for a rejection, and where in the message it says the
 * message went wrong, from the Zod issues the error carries: a component that
 * fails its catalog's schema at the property inside it, and a message that
 * fails web core's own schema at the issue's path. When no branch of web
 * core's message union fits, the sentence keeps only the issues of the
 * branch of the message's own type.
 */
function rejectionOf(error: Error, message: unknown): {message: string; inner?: string} {
  const details = (error as {details?: unknown}).details;
  const issues = Array.isArray(details)
    ? (details as ZodIssue[])
    : ((details as {issues?: ZodIssue[]} | undefined)?.issues ?? []);
  if (issues.length === 0) return {message: error.message};
  const component = COMPONENT_FAILED.exec(error.message);
  if (component !== null) {
    const base = componentPointer(message, component[1]);
    return {
      message: error.message,
      ...(base !== undefined && {inner: base + issuePointer(issues[0])}),
    };
  }
  const failed = MESSAGE_FAILED.exec(error.message);
  if (failed === null) return {message: error.message};
  const leaves = issues.flatMap(issue => leavesOf(issue, messageTypeOf(message)));
  const kept = leaves.filter(leaf => leaf.kept);
  const pieces = failed[2].split('; ');
  return {
    message:
      pieces.length === leaves.length && kept.length > 0
        ? failed[1] + pieces.filter((_, index) => leaves[index].kept).join('; ')
        : error.message,
    ...(kept.length > 0 && {inner: issuePointer(kept[0].issue)}),
  };
}

/**
 * The issues web core's formatter writes for one issue, in its order: each
 * branch's issues for a union, kept only for the branch of the message's own
 * type when one is, its issues all under that type's key.
 */
function leavesOf(
  issue: ZodIssue,
  type: string | undefined,
): Array<{issue: ZodIssue; kept: boolean}> {
  const branches = issue.code === 'invalid_union' ? (issue.unionErrors ?? []) : [];
  if (branches.every(branch => branch.issues.length === 0)) return [{issue, kept: true}];
  const own = branches.find(
    branch =>
      branch.issues.length > 0 &&
      branch.issues.every(({path}) => path[0] !== undefined && path[0] === type),
  );
  return branches.flatMap(branch =>
    branch.issues
      .flatMap(inner => leavesOf(inner, type))
      .map(leaf => ({...leaf, kept: leaf.kept && (own === undefined || branch === own)})),
  );
}

/** A Zod issue's path as a JSON Pointer, ending at the key for an unrecognized one. */
function issuePointer(issue: ZodIssue): string {
  const path =
    issue.code === 'unrecognized_keys' && issue.keys?.length
      ? [...issue.path, issue.keys[0]]
      : issue.path;
  return path
    .map(segment => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

/**
 * A catalog with no component schemas under each catalog id the messages
 * name that no catalog is known under: a surface's, a component's or a
 * function call's. The relaxed mode lets any component and function through it.
 */
function standInCatalogs(
  messages: readonly AgentMessage[],
  known: ReadonlySet<string>,
): Array<Catalog<never>> {
  const versions = new Map<string, string>();
  for (const {message} of messages) {
    const version = versionOf(message)?.startsWith('v1.') ? '1.0' : '0.9';
    for (const id of catalogIdsIn(message)) {
      if (!known.has(id) && !versions.has(id)) versions.set(id, version);
    }
  }
  return [...versions].map(([id, version]) => new Catalog<never>(id, version, [], []));
}

function versionOf(message: unknown): string | undefined {
  const version = (message as {version?: unknown} | null)?.version;
  return typeof version === 'string' ? version : undefined;
}

function isDeleteSurface(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'deleteSurface' in message;
}

function viewOf(
  surface: SurfaceModel,
  touched: boolean,
  standInIds: ReadonlySet<string>,
  rejectedUpdates: number | undefined,
): SurfaceView {
  const empty = [...surface.componentsModel.keys].length === 0;
  return {
    surfaceId: surface.id,
    ...(surface.defaultCatalog !== undefined && {catalogId: surface.defaultCatalog.id}),
    touched,
    structure: structureOf(surface, standInIds),
    dataModel: plain(surface.dataModel.get('/')),
    ...(empty && rejectedUpdates !== undefined && {rejectedUpdates}),
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
