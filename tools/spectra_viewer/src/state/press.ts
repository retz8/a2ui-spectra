/**
 * What the composer sends beside its text: the action pressed in the
 * preview, pending until it is sent, discarded, replaced by a newer press,
 * or dropped once its conversation is no longer in view; and the data model
 * at the step in view, which a text carries.
 */
import type {PreviewAction} from 'a2ui-spectra-preview';
import {useSyncExternalStore} from 'react';

import {
  type ActionMessage,
  componentTypeOf,
  type DataModelMap,
  dataModelMapOf,
} from '../model/host_message.ts';
import type {SurfaceView} from '../model/replay.ts';
import type {SpectraState} from './spectra.ts';

/** The turn and step a render was asked for, with the surfaces as they stood there. */
export interface RenderContext {
  traceId: string;
  stepId?: string;
  surfaces: readonly SurfaceView[];
  /** The shown surface's `createSurface` version. */
  version?: string;
}

/** A press as the page reported it, with the render it came from. */
export interface Press {
  action: PreviewAction;
  /** The pressed surface's data model at that moment. */
  dataModel: unknown;
  context: RenderContext;
}

/** An action pending in the composer. */
export interface PendingAction {
  /** The turn and step of the render it was pressed in. */
  traceId: string;
  stepId?: string;
  /** The type of the component pressed, when the replay knows it. */
  componentType?: string;
  message: ActionMessage;
  dataModel?: DataModelMap;
}

/**
 * The action a press puts in the composer: the A2UI message in the pressed
 * surface's version, and the data models of the surfaces that asked for
 * them, the pressed one from the page and the others at the render's step.
 */
export function pendingOf({action, dataModel, context}: Press): PendingAction {
  const surface = context.surfaces.find(view => view.surfaceId === action.surfaceId);
  const version = surface?.version ?? context.version ?? 'v0.9';
  const map = dataModelMapOf(context.surfaces, version, {surfaceId: action.surfaceId, dataModel});
  const componentType = componentTypeOf(surface, action.sourceComponentId);
  return {
    traceId: context.traceId,
    ...(context.stepId !== undefined && {stepId: context.stepId}),
    ...(componentType !== undefined && {componentType}),
    message: {version, action},
    ...(map !== undefined && {dataModel: map}),
  };
}

/** The conversation a turn belongs to, from the listing or its live stream. */
function conversationOf(state: SpectraState, traceId: string): string | undefined {
  return (
    state.turns.find(turn => turn.traceId === traceId)?.conversationId ??
    state.live.get(traceId)?.conversationId
  );
}

/**
 * Whether a pending action stays with the turn now in view: it does in a
 * turn of its own conversation, and not with a new conversation asked for.
 */
export function keepsPending(
  state: SpectraState,
  pending: PendingAction,
  inView: {traceId?: string; startsNew?: boolean},
): boolean {
  const {traceId} = inView;
  if (inView.startsNew === true || traceId === undefined) return false;
  if (traceId === pending.traceId) return true;
  const own = conversationOf(state, pending.traceId);
  return own !== undefined && own === conversationOf(state, traceId);
}

/** The data model a text carries, for the turn it was taken at. */
export interface DataModelInView {
  traceId: string;
  dataModel?: DataModelMap;
}

let pending: PendingAction | undefined;
let dataModelInView: DataModelInView | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts an action in the composer, in place of any pending; none takes it out. */
export function setPendingAction(next: PendingAction | undefined): void {
  if (next === pending) return;
  pending = next;
  notify();
}

export function usePendingAction(): PendingAction | undefined {
  return useSyncExternalStore(subscribe, () => pending);
}

export function setDataModelInView(next: DataModelInView | undefined): void {
  if (JSON.stringify(next) === JSON.stringify(dataModelInView)) return;
  dataModelInView = next;
  notify();
}

export function useDataModelInView(): DataModelInView | undefined {
  return useSyncExternalStore(subscribe, () => dataModelInView);
}
