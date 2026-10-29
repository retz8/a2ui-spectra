/**
 * The core's web core part: what every web adapter does with web core's
 * message processor, whichever framework draws its surfaces. The adapter
 * makes the processor, with the action handler made here, and has it
 * watched: each surface it creates reports web core's errors, and its data
 * model as it appears and on every change. Web core's universal elements,
 * which both basic catalogs and every Lit component are drawn with, are
 * guarded at their updates, naming the component that threw.
 */
import type {
  ActionListener,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {A2uiLitElement} from '@a2ui/web_core/v0_9/universal';

import {guardElementUpdates, type UpdatingElementClass} from './guard.js';
import type {PageEvents} from './page.js';

/** A plain copy of a data model, holding none of the processor's live state. */
export function plainCopy(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/**
 * The action handler to make a processor with: each action is reported with
 * its surface's data model at that moment. The handler is made before the
 * processor, so it reaches the processor through `processor`.
 */
export function actionHandlerFor<T extends ComponentApi>(
  events: PageEvents,
  processor: () => MessageProcessor<T> | undefined,
): ActionListener {
  return action => {
    const surface = processor()?.getSurface(action.surfaceId);
    events.action(action, plainCopy(surface?.dataModel.get('/')));
  };
}

/**
 * Watches a processor the adapter made: each surface it creates reports the
 * errors web core sends through its error channel, and its data model as it
 * appears and whenever the agent's messages or typing change it. `onSurface`
 * is called with each surface once it is watched. Returns the way to stop.
 */
export function watchProcessor<T extends ComponentApi>(
  processor: MessageProcessor<T>,
  events: PageEvents,
  onSurface?: (surface: SurfaceModel<T>) => void,
): () => void {
  const stops: Array<() => void> = [];
  const created = processor.onSurfaceCreated(surface => {
    const errors = surface.onError.subscribe(error => {
      const componentId = (error as {componentId?: unknown}).componentId;
      events.surfaceError({
        code: error.code,
        message: error.message,
        ...(typeof componentId === 'string' && {componentId}),
      });
    });
    const report = () => events.dataModel(surface.id, plainCopy(surface.dataModel.get('/')));
    const model = surface.dataModel.subscribe('/', report);
    stops.push(
      () => errors.unsubscribe(),
      () => model.unsubscribe(),
    );
    report();
    onSurface?.(surface);
  });
  stops.push(() => created.unsubscribe());
  return () => {
    for (const stop of stops) stop();
  };
}

/** The component a failure belongs to. */
interface Identity {
  componentId?: string;
  componentType?: string;
}

/** What a component's model gives its identity. */
interface ModelLike {
  id?: unknown;
  type?: unknown;
}

export function identityOf(model: ModelLike | undefined): Identity {
  return {
    ...(typeof model?.id === 'string' && {componentId: model.id}),
    ...(typeof model?.type === 'string' && {componentType: model.type}),
  };
}

/** What a universal element knows of the component it draws. */
interface ElementLike {
  node?: {componentId?: unknown; type?: unknown};
  context?: {componentModel?: ModelLike};
}

/**
 * Guards web core's universal elements at their updates: a throw is reported
 * with the component the element draws, and the rest of the surface stays
 * drawn. Each call replaces the report the guard gives to.
 */
export function guardUniversalElements(report: PageEvents['componentFailed']): void {
  guardElementUpdates(A2uiLitElement as unknown as UpdatingElementClass, (element, error) => {
    const {node, context} = element as ElementLike;
    const identity =
      node !== undefined
        ? identityOf({id: node.componentId, type: node.type})
        : identityOf(context?.componentModel);
    report({...identity, error});
  });
}
