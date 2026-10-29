/**
 * The Lit sample's preview page: the sample catalog drawn through the Lit
 * preview adapter's element, placed where a host using this catalog places
 * its surfaces.
 */
import 'a2ui-spectra-preview-lit';
import {html, render} from 'lit';

import {sampleCatalog} from './catalog.ts';

render(
  html`<a2ui-spectra-preview .catalogs=${[sampleCatalog]}></a2ui-spectra-preview>`,
  document.getElementById('root')!,
);
