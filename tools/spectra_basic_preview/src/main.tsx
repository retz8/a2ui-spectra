/**
 * Spectra's built-in preview page: the basic catalogs of v0.9 and v1.0, and
 * the v0.9 one again under the v0.9.1 basic catalog's URL, drawn with
 * upstream's React renderer through the React preview adapter, as an
 * adopter's page draws its own catalog.
 */
import {renderMarkdown} from '@a2ui/markdown-it';
import {MarkdownContext, type ReactCatalogComponent} from '@a2ui/react/v0_9';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v0_9';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';
import {SpectraPreview} from 'a2ui-spectra-preview-react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

/** The v0.9.1 basic catalog's URL: a second id of the v0.9 basic catalog. */
const BASIC_V0_9_1 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';

const basicV09 = basicCatalogV09 as unknown as Catalog<ReactCatalogComponent>;
const basicV10 = basicCatalogV10 as unknown as Catalog<ReactCatalogComponent>;
const basicV091 = new Catalog<ReactCatalogComponent>(
  BASIC_V0_9_1,
  basicV09.protocolVersion,
  [...basicV09.components.values()],
  [...basicV09.functions.values()],
  ...(basicV09.themeSchema === undefined ? [] : [basicV09.themeSchema]),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarkdownContext.Provider value={renderMarkdown}>
      <SpectraPreview catalogs={[basicV09, basicV091, basicV10]} />
    </MarkdownContext.Provider>
  </StrictMode>,
);
