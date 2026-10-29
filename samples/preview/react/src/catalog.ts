/**
 * The sample catalog in React: the v0.9 basic catalog's components and
 * functions and the custom slider, under the id its definition,
 * `samples/preview/catalog.json`, carries.
 */
import type {ReactCatalogComponent} from '@a2ui/react/v0_9';
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
