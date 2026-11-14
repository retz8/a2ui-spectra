/**
 * The sample catalog in Lit: the v0.9 basic catalog's components and
 * functions and the custom slider, under the id its definition,
 * `samples/preview/catalog.json`, carries. Beside it, the v1.0 basic catalog,
 * which the Lit renderer draws through web core's own elements.
 */
import {basicCatalog, type LitComponentApi} from '@a2ui/lit/v0_9';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v0_9';

import {customSlider} from './custom_slider.ts';

export const SAMPLE_CATALOG_ID =
  'https://github.com/retz8/a2ui-spectra/blob/main/samples/preview/catalog.json';

export const sampleCatalog = new Catalog<LitComponentApi>(
  SAMPLE_CATALOG_ID,
  basicCatalog.protocolVersion,
  [...basicCatalog.components.values(), customSlider as LitComponentApi],
  [...basicCatalog.functions.values()],
  ...(basicCatalog.themeSchema === undefined ? [] : [basicCatalog.themeSchema]),
);

/** The v1.0 basic catalog, under its own id. */
export const basicV10 = basicCatalogV10 as unknown as Catalog<LitComponentApi>;
