/**
 * The Lit test page: the Lit preview adapter's element with the test
 * catalog, in which the thrower is a Lit element. `window.spectraTestPage`
 * gives the browser tests the catalogs and the element's class, to place a
 * new element themselves.
 */
import {A2uiLitElement, basicCatalog, type LitComponentApi} from '@a2ui/lit/v0_9';
import {Catalog} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {SpectraPreviewElement} from 'a2ui-spectra-preview-lit';
import {html, nothing} from 'lit';

import {TEST_CATALOG_ID, THROWER_FAILURE, throwerApi} from '../shared/thrower.ts';

class TestThrower extends A2uiLitElement<typeof throwerApi> {
  protected override readonly api = throwerApi;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    if (props.fail === true) throw new Error(THROWER_FAILURE);
    return html`<span class="thrower">${props.text ?? 'Thrower'}</span>`;
  }
}

customElements.define('test-thrower', TestThrower);

const thrower: WebComponentImplementation<typeof throwerApi.schema> = {
  ...throwerApi,
  tagName: 'test-thrower',
  element: TestThrower,
};

const testCatalog = new Catalog<LitComponentApi>(
  TEST_CATALOG_ID,
  basicCatalog.protocolVersion,
  [...basicCatalog.components.values(), thrower as LitComponentApi],
  [...basicCatalog.functions.values()],
  ...(basicCatalog.themeSchema === undefined ? [] : [basicCatalog.themeSchema]),
);

const element = document.createElement('a2ui-spectra-preview');
element.catalogs = [testCatalog];
document.getElementById('root')!.append(element);

Object.assign(window, {
  spectraTestPage: {catalogs: [testCatalog], otherCatalogs: [basicCatalog], SpectraPreviewElement},
});
