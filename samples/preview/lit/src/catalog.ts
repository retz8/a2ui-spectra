/**
 * The sample catalog in Lit: the v0.9 basic catalog's components and
 * functions and the custom slider, under the id its definition,
 * `samples/preview/catalog.json`, carries.
 */
import {basicCatalog, type LitComponentApi} from '@a2ui/lit/v0_9';
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
