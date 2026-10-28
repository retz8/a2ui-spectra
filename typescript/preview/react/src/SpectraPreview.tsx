/**
 * The React preview adapter: one component, placed in the adopter's page
 * inside the providers their real host uses. It runs the preview protocol
 * through the core, with a web core message processor holding the page's
 * catalogs, and draws the surface each render names with upstream's
 * `A2uiSurface`. Opened on its own, outside Spectra, the page says what it is.
 */
import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react/v0_9';
import {type Catalog, MessageProcessor, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {
  type PageEvents,
  type PreviewAdapter,
  STANDALONE_LINE,
  startPreviewPage,
  viewerOriginOf,
  windowErrors,
  windowTransport,
} from 'a2ui-spectra-preview';
import {useEffect, useState} from 'react';

import {guardCatalog, guardUniversalElements, reportFailuresTo} from './boundaries.js';

export interface SpectraPreviewProps {
  /**
   * The catalogs the page renders, implementations and all, as the real host
   * passes them to its message processor. They are the page's claims: each
   * catalog's id and protocol version tell Spectra which surfaces to send.
   * They are read once, as the component mounts.
   */
  catalogs: ReadonlyArray<Catalog<ReactCatalogComponent>>;
}

/** A processor the core made, and what it subscribed to. */
interface Held {
  processor: MessageProcessor<ReactCatalogComponent>;
  generation: number;
  stops: Array<() => void>;
  surfaceId?: string;
}

/** What is drawn: a processor's surface, keyed by the processor so a new one remounts. */
interface Drawn {
  generation: number;
  surface: SurfaceModel<ReactCatalogComponent>;
}

/** A plain copy of a data model, holding none of the processor's live state. */
function plain(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

export function SpectraPreview({catalogs}: SpectraPreviewProps) {
  const [origin] = useState(() => viewerOriginOf(window.location.search));
  const [pageCatalogs] = useState(() => [...catalogs]);
  const [drawn, setDrawn] = useState<Drawn | undefined>();

  useEffect(() => {
    if (origin === undefined) return;
    for (const catalog of pageCatalogs) guardCatalog(catalog);
    guardUniversalElements();
    let made = 0;
    let shown: Held | undefined;
    const show = (held: Held) => {
      shown = held;
      const surface =
        held.surfaceId === undefined ? undefined : held.processor.getSurface(held.surfaceId);
      setDrawn(before =>
        surface === undefined
          ? undefined
          : before?.surface === surface && before.generation === held.generation
            ? before
            : {generation: held.generation, surface},
      );
    };
    const adapter: PreviewAdapter<Held> = {
      createProcessor: (events: PageEvents) => {
        reportFailuresTo(events.componentFailed);
        const processor: MessageProcessor<ReactCatalogComponent> =
          new MessageProcessor<ReactCatalogComponent>([...pageCatalogs], action => {
            const surface = processor.getSurface(action.surfaceId);
            events.action(action, plain(surface?.dataModel.get('/')));
          });
        made += 1;
        const held: Held = {processor, generation: made, stops: []};
        const created = processor.onSurfaceCreated(surface => {
          const errors = surface.onError.subscribe(error => {
            const componentId = (error as {componentId?: unknown}).componentId;
            events.surfaceError({
              code: error.code,
              message: error.message,
              ...(typeof componentId === 'string' && {componentId}),
            });
          });
          held.stops.push(() => errors.unsubscribe());
          if (surface.id === held.surfaceId && shown === held) show(held);
        });
        held.stops.push(() => created.unsubscribe());
        return held;
      },
      feed: (held, message) => {
        held.processor.processMessages(
          message as Parameters<MessageProcessor<ReactCatalogComponent>['processMessages']>[0],
        );
      },
      mount: (held, surfaceId) => {
        held.surfaceId = surfaceId;
        show(held);
      },
      teardown: held => {
        for (const stop of held.stops) stop();
        held.processor.dispose();
        if (shown === held) {
          shown = undefined;
          setDrawn(undefined);
        }
      },
    };
    const page = startPreviewPage({
      catalogs: pageCatalogs,
      adapter,
      transport: windowTransport(origin),
      errors: windowErrors(),
    });
    return () => {
      page.stop();
      reportFailuresTo(undefined);
    };
  }, [origin, pageCatalogs]);

  if (origin === undefined) {
    return <p style={{margin: 16, font: '14px/1.5 system-ui, sans-serif'}}>{STANDALONE_LINE}</p>;
  }
  return drawn === undefined ? null : (
    <A2uiSurface key={`${drawn.generation}:${drawn.surface.id}`} surface={drawn.surface} />
  );
}
