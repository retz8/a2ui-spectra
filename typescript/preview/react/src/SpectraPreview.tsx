/**
 * The React preview adapter: one component, placed in the adopter's page
 * inside the providers their real host uses. It runs the preview protocol
 * through the core, with a web core message processor holding the page's
 * catalogs, and draws the surface each render names with upstream's
 * `A2uiSurface`. Opened on its own, outside Spectra, the page says what it is.
 */
import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react/v0_9';
import {type Catalog, MessageProcessor, type MessageProcessorOptions} from '@a2ui/web_core/v0_9';
import {STANDALONE_LINE, viewerOriginOf} from 'a2ui-spectra-preview';
import {
  type DrawnSurface,
  type MadeProcessor,
  startWebPreviewPage,
} from 'a2ui-spectra-preview/web-core';
import {useEffect, useState} from 'react';

import {guardCatalog, reportFailuresTo} from './boundaries.js';

/** What the page gives the preview component. */
export interface SpectraPreviewProps {
  /**
   * The catalogs the page renders, implementations and all, as the real host
   * passes them to its message processor. They are the page's claims: each
   * catalog's id and protocol version tell Spectra which surfaces to send.
   * They are read once, as the component mounts.
   */
  catalogs: ReadonlyArray<Catalog<ReactCatalogComponent>>;
  /**
   * The options the real host makes its message processor with, such as its
   * `validationConfig`, so that the preview validates as the host does. Its
   * channel to the agent, `outboundListener` and `errorHandler`, is not used,
   * and every refusal is reported. They are read once, as the component
   * mounts.
   */
  processorOptions?: MessageProcessorOptions;
}

type Made = MadeProcessor<ReactCatalogComponent>;

/**
 * The React preview adapter's component: draws the surfaces Spectra sends,
 * with the page's catalogs.
 */
export function SpectraPreview({catalogs, processorOptions}: SpectraPreviewProps) {
  const [origin] = useState(() => viewerOriginOf(window.location.search));
  const [pageCatalogs] = useState(() => [...catalogs]);
  const [hostOptions] = useState(() => processorOptions);
  const [drawn, setDrawn] = useState<DrawnSurface<ReactCatalogComponent, Made> | undefined>();

  useEffect(() => {
    if (origin === undefined) return;
    for (const catalog of pageCatalogs) guardCatalog(catalog);
    const page = startWebPreviewPage<ReactCatalogComponent, Made>({
      catalogs: pageCatalogs,
      viewerOrigin: origin,
      processorOptions: hostOptions,
      makeProcessor: ({actionHandler, options, componentFailed}) => {
        reportFailuresTo(componentFailed);
        const processor = new MessageProcessor<ReactCatalogComponent>(
          [...pageCatalogs],
          actionHandler,
          options,
        );
        return {processor, dispose: () => processor.dispose()};
      },
      draw: setDrawn,
    });
    return () => {
      page.stop();
      reportFailuresTo(undefined);
    };
  }, [origin, pageCatalogs, hostOptions]);

  if (origin === undefined) {
    return <p style={{margin: 16, font: '14px/1.5 system-ui, sans-serif'}}>{STANDALONE_LINE}</p>;
  }
  return drawn === undefined ? null : (
    <A2uiSurface key={`${drawn.generation}:${drawn.surface.id}`} surface={drawn.surface} />
  );
}
