/**
 * What the message box sends as a host, built in the viewer: a press in the
 * preview as one A2UI action message, in its surface's version; the data
 * model of every surface that asked for it, as upstream's client data model
 * has it; and the message as the composer shows it, in the turn record's form.
 */
import type {PreviewAction} from 'a2ui-spectra-preview';

import type {SurfaceView, TreeNode} from './replay.ts';

/** The A2A versions the box speaks. */
export type A2aVersion = '0.3' | '1.0';

/** One A2UI action message. */
export interface ActionMessage {
  version: string;
  action: PreviewAction;
}

/** The data models a host sends, each surface's by its id. */
export interface DataModelMap {
  version: string;
  surfaces: Record<string, unknown>;
}

/** The metadata key a data model goes under: v1.0's, or v0.9's for v0.9 and v0.9.1. */
export function dataModelKeyOf(version: string): string {
  return version.startsWith('v1.') ? 'a2uiRendererDataModel' : 'a2uiClientDataModel';
}

/** Whether two A2UI versions are of one protocol: v1.0's, or v0.9's with v0.9.1. */
function sameProtocol(one: string, other: string): boolean {
  return one.startsWith('v1.') === other.startsWith('v1.');
}

/**
 * The data models of every live surface that asked for them, for a message
 * in an A2UI version: the shown surface's from the page, with what was typed
 * in it, and every other one's as the replay left it. None when no surface
 * asked for it.
 */
export function dataModelMapOf(
  surfaces: readonly SurfaceView[],
  version: string,
  shown?: {surfaceId: string; dataModel: unknown},
): DataModelMap | undefined {
  const entries = surfaces
    .filter(
      surface =>
        surface.sendDataModel === true &&
        (surface.version === undefined || sameProtocol(surface.version, version)),
    )
    .map(surface => {
      const dataModel =
        surface.surfaceId === shown?.surfaceId ? shown.dataModel : surface.dataModel;
      return [surface.surfaceId, isObject(dataModel) ? dataModel : {}] as const;
    });
  return entries.length === 0 ? undefined : {version, surfaces: Object.fromEntries(entries)};
}

/** The version a text's data models go in: the first surface's that asked for them. */
export function dataModelVersionOf(surfaces: readonly SurfaceView[]): string | undefined {
  return surfaces.find(surface => surface.sendDataModel === true && surface.version !== undefined)
    ?.version;
}

/**
 * The host message as the composer shows it, in the turn record's form: the
 * A2UI part's content as the A2A part's data will be, the message itself in
 * A2A 0.3 and a list of it in 1.0, and the data model under its key.
 */
export function shownMessageOf(
  message: ActionMessage,
  dataModel: DataModelMap | undefined,
  a2a: A2aVersion | undefined,
): Record<string, unknown> {
  return {
    role: 'user',
    parts: [{type: 'a2ui', content: a2a === '1.0' ? [message] : message}],
    ...(dataModel !== undefined && {metadata: {[dataModelKeyOf(dataModel.version)]: dataModel}}),
  };
}

/** The paths of the shown message that start folded: each surface's data model. */
export function foldedAtFirst(dataModel: DataModelMap | undefined): string[] {
  if (dataModel === undefined) return [];
  const key = dataModelKeyOf(dataModel.version);
  return Object.keys(dataModel.surfaces).map(
    surfaceId => `/metadata/${key}/surfaces/${surfaceId.replace(/~/g, '~0').replace(/\//g, '~1')}`,
  );
}

/** A component's type, by its id, as the surface's structure has it. */
export function componentTypeOf(surface: SurfaceView | undefined, id: string): string | undefined {
  if (surface === undefined) return undefined;
  const {structure} = surface;
  const roots: TreeNode[] =
    'tree' in structure ? [structure.tree, ...structure.notUnderRoot] : structure.unnested;
  const walk = (node: TreeNode): string | undefined => {
    if ('missing' in node) return undefined;
    if (node.id === id) return node.type;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const root of roots) {
    const found = walk(root);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
