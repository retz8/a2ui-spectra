/**
 * The sample catalog in React: the v0.9 basic catalog's components and
 * functions and the custom slider, under the id its definition,
 * `samples/preview/catalog.json`, carries. Beside it, the v1.0 basic catalog,
 * which the React renderer draws through web core's own elements.
 */
import type {ReactCatalogComponent} from '@a2ui/react/v0_9';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {Catalog} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';

import {CustomSlider} from './CustomSlider.tsx';

export const SAMPLE_CATALOG_ID =
  'https://github.com/retz8/a2ui-spectra/blob/main/samples/preview/catalog.json';

const basic = basicCatalog as unknown as Catalog<ReactCatalogComponent>;

export const sampleCatalog = new Catalog<ReactCatalogComponent>(
  SAMPLE_CATALOG_ID,
  basic.protocolVersion,
  [...basic.components.values(), CustomSlider],
  [...basic.functions.values()],
  ...(basic.themeSchema === undefined ? [] : [basic.themeSchema]),
);

/** The v1.0 basic catalog, under its own id. */
export const basicV10 = basicCatalogV10 as unknown as Catalog<ReactCatalogComponent>;
