/**
 * The Lit sample's preview page: the sample catalog and the v1.0 basic
 * catalog drawn through the Lit preview adapter's element, placed where a
 * host using them places its surfaces.
 */
import 'a2ui-spectra-preview-lit';
import {html, render} from 'lit';

import {basicV10, sampleCatalog} from './catalog.ts';

render(
  html`<a2ui-spectra-preview .catalogs=${[sampleCatalog, basicV10]}></a2ui-spectra-preview>`,
  document.getElementById('root')!,
);
