/**
 * The sample catalog in Angular: the v0.9 basic catalog's components and
 * functions and the custom slider, under the id its definition,
 * `samples/preview/catalog.json`, carries. Beside it, the Angular renderer's
 * own v1.0 basic catalog, whose components are web core's own elements.
 */
import {BasicCatalogBase} from '@a2ui/angular';
import {AngularCatalog, BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {BasicCatalogThemeSchema} from '@a2ui/web_core/v0_9/basic_catalog';

import {customSlider} from './custom_slider.component';

export const SAMPLE_CATALOG_ID =
  'https://github.com/retz8/a2ui-spectra/blob/main/samples/preview/catalog.json';

export const sampleCatalog = new AngularCatalog(
  SAMPLE_CATALOG_ID,
  '0.9',
  [...BASIC_COMPONENTS, customSlider],
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
);

/** The v1.0 basic catalog, under its own id. */
export const basicV10 = new BasicCatalogBase();
