/**
 * The core's web core part: what every web adapter does with web core's
 * message processor, whichever framework draws its surfaces. The adapter
 * makes the processor, with the action handler made here, and has it
 * watched: each surface it creates reports web core's errors, and its data
 * model as it appears and on every change. Web core's universal elements,
 * which both basic catalogs and every Lit component are drawn with, are
 * guarded at their updates, naming the component that threw.
 * `startWebPreviewPage` runs all of it for an adapter, which gives it only
 * the making of its processor and the drawing of a surface.
 */
import type {
  ActionListener,
  ComponentApi,
  MessageProcessor,
  MessageProcessorOptions,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {A2uiLitElement} from '@a2ui/web_core/v0_9/universal';

import type {ClaimedCatalog} from './claims.js';
import {guardElementUpdates, type UpdatingElementClass} from './guard.js';
import {type PageEvents, type PreviewAdapter, type PreviewPage, startPreviewPage} from './page.js';
import {windowErrors, windowTransport} from './window.js';

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

/** The component a failure names: a model's id and type, where they are strings. */
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
 * drawn. The latest guard not stopped is reported to. Returns the way to
 * stop it.
 */
export function guardUniversalElements(report: PageEvents['componentFailed']): () => void {
  // A2uiLitElement is an UpdatingElementClass here, because Lit declares `performUpdate`
  // protected, not missing: every instance has it.
  return guardElementUpdates(
    A2uiLitElement as unknown as UpdatingElementClass,
    (element, error) => {
      const {node, context} = element as ElementLike;
      const identity =
        node !== undefined
          ? identityOf({id: node.componentId, type: node.type})
          : identityOf(context?.componentModel);
      report({...identity, error});
    },
  );
}

/**
 * The options a preview's processor is made with, from the host's: those that
 * shape how messages are validated and processed pass through; every
 * refusal throws, so the page reports it; and the host's own channel to its
 * agent, its outbound listener and its error handler, is left out, so that
 * nothing in the preview goes out through it.
 */
function previewOptionsOf(host: MessageProcessorOptions | undefined): MessageProcessorOptions {
  const {version, validationConfig, adapterRegistry, defaultTimeoutMs, maxAgentCallCacheEntries} =
    host ?? {};
  return {
    ...(version !== undefined && {version}),
    ...(validationConfig !== undefined && {validationConfig}),
    ...(adapterRegistry !== undefined && {adapterRegistry}),
    ...(defaultTimeoutMs !== undefined && {defaultTimeoutMs}),
    ...(maxAgentCallCacheEntries !== undefined && {maxAgentCallCacheEntries}),
    reportErrorsOnly: false,
  };
}

/** What a web adapter's processor is made with. */
export interface ProcessorInputs {
  /** The action handler the processor dispatches each action to. */
  actionHandler: ActionListener;
  /** The processor's options, made from the host's. */
  options: MessageProcessorOptions;
  /** Where a component of the adapter's own framework that throws while drawing is reported. */
  componentFailed: PageEvents['componentFailed'];
}

/** A processor a web adapter made, with what else it holds for drawing it. */
export interface MadeProcessor<T extends ComponentApi> {
  processor: MessageProcessor<T>;
  /** Feeds one message; throws when the processor refuses it. The processor's own, unless given. */
  feed?(message: unknown): void;
  /** Disposes of the processor and what it holds. */
  dispose(): void;
}

/** What a web adapter draws: a processor's surface, keyed by the processor so a new one remounts. */
export interface DrawnSurface<T extends ComponentApi, M extends MadeProcessor<T>> {
  /** The processor's number among those the page made. */
  generation: number;
  surface: SurfaceModel<T>;
  made: M;
}

/** What a web adapter gives `startWebPreviewPage`. */
export interface WebPreviewPageOptions<T extends ComponentApi, M extends MadeProcessor<T>> {
  /** The page's catalogs: its claims. */
  catalogs: Iterable<ClaimedCatalog>;
  /** The viewer's origin, from the page's address. */
  viewerOrigin: string;
  /** The processor options the host gives its own processor, if any. */
  processorOptions?: MessageProcessorOptions;
  /** Makes a processor with the page's catalogs. */
  makeProcessor(inputs: ProcessorInputs): M;
  /** Draws this surface, or none; called when what is drawn changes. */
  draw(drawn: DrawnSurface<T, M> | undefined): void;
}

/** A processor the page made, and the surface it is to draw. */
interface Held<T extends ComponentApi, M extends MadeProcessor<T>> {
  made: M;
  generation: number;
  stopWatching: () => void;
  surfaceId?: string;
}

/**
 * Starts a web adapter's preview page on the window carrier: each processor
 * the core asks for is made by the adapter, with the action handler made
 * here, and watched; web core's universal elements are guarded while the
 * page runs, a throw reported to the current processor's events; the surface
 * each render names is handed to the adapter to draw once it exists, and
 * nothing once its processor is torn down.
 */
export function startWebPreviewPage<T extends ComponentApi, M extends MadeProcessor<T>>({
  catalogs,
  viewerOrigin,
  processorOptions,
  makeProcessor,
  draw,
}: WebPreviewPageOptions<T, M>): PreviewPage {
  const options = previewOptionsOf(processorOptions);
  /** Where a universal element that throws is reported: the current processor's events. */
  let failed: PageEvents['componentFailed'] | undefined;
  /** Counts the processors made, so that a new one's surface remounts. */
  let generation = 0;
  let shown: Held<T, M> | undefined;
  let drawn: DrawnSurface<T, M> | undefined;
  const show = (held: Held<T, M>) => {
    shown = held;
    const surface =
      held.surfaceId === undefined ? undefined : held.made.processor.getSurface(held.surfaceId);
    if (drawn?.surface === surface && drawn?.generation === held.generation) return;
    drawn =
      surface === undefined ? undefined : {generation: held.generation, surface, made: held.made};
    draw(drawn);
  };
  const adapter: PreviewAdapter<Held<T, M>> = {
    createProcessor: events => {
      failed = events.componentFailed;
      // The action handler is made before the processor, and reaches it once it is held.
      const made = makeProcessor({
        actionHandler: actionHandlerFor(events, () => held.made.processor),
        options,
        componentFailed: events.componentFailed,
      });
      generation += 1;
      const held: Held<T, M> = {
        made,
        generation,
        stopWatching: watchProcessor(made.processor, events, surface => {
          if (surface.id === held.surfaceId && shown === held) show(held);
        }),
      };
      return held;
    },
    feed: (held, message) => {
      if (held.made.feed !== undefined) held.made.feed(message);
      else {
        held.made.processor.processMessages(
          message as Parameters<MessageProcessor<T>['processMessages']>[0],
        );
      }
    },
    mount: (held, surfaceId) => {
      held.surfaceId = surfaceId;
      show(held);
    },
    teardown: held => {
      held.stopWatching();
      if (shown === held) {
        shown = undefined;
        drawn = undefined;
        draw(undefined);
      }
      held.made.dispose();
    },
  };
  const stopGuard = guardUniversalElements(failure => failed?.(failure));
  const page = startPreviewPage({
    catalogs,
    adapter,
    transport: windowTransport(viewerOrigin),
    errors: windowErrors(),
  });
  return {
    stop: () => {
      page.stop();
      stopGuard();
      failed = undefined;
    },
  };
}
