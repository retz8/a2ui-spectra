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
import {
  actionHandlerFor,
  guardUniversalElements,
  watchProcessor,
} from 'a2ui-spectra-preview/web-core';
import {useEffect, useState} from 'react';

import {guardCatalog, reportFailuresTo} from './boundaries.js';

export interface SpectraPreviewProps {
  /**
   * The catalogs the page renders, implementations and all, as the real host
   * passes them to its message processor. They are the page's claims: each
   * catalog's id and protocol version tell Spectra which surfaces to send.
   * They are read once, as the component mounts.
   */
  catalogs: ReadonlyArray<Catalog<ReactCatalogComponent>>;
}

/** A processor the core made, and the way to stop watching it. */
interface Held {
  processor: MessageProcessor<ReactCatalogComponent>;
  generation: number;
  stopWatching: () => void;
  surfaceId?: string;
}

/** What is drawn: a processor's surface, keyed by the processor so a new one remounts. */
interface Drawn {
  generation: number;
  surface: SurfaceModel<ReactCatalogComponent>;
}

export function SpectraPreview({catalogs}: SpectraPreviewProps) {
  const [origin] = useState(() => viewerOriginOf(window.location.search));
  const [pageCatalogs] = useState(() => [...catalogs]);
  const [drawn, setDrawn] = useState<Drawn | undefined>();

  useEffect(() => {
    if (origin === undefined) return;
    for (const catalog of pageCatalogs) guardCatalog(catalog);
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
        guardUniversalElements(events.componentFailed);
        const processor: MessageProcessor<ReactCatalogComponent> =
          new MessageProcessor<ReactCatalogComponent>(
            [...pageCatalogs],
            actionHandlerFor(events, () => processor),
          );
        made += 1;
        const held: Held = {
          processor,
          generation: made,
          stopWatching: watchProcessor(processor, events, surface => {
            if (surface.id === held.surfaceId && shown === held) show(held);
          }),
        };
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
        held.stopWatching();
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
