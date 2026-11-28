/**
 * The React test page: the React preview adapter with the test catalog, in
 * which the thrower is a React component. `window.spectraTestPage` lets the
 * browser tests give the adapter another catalogs prop and unmount it. With
 * `options` in its address, the page gives the adapter a host's processor
 * options, whose channel to the agent records what it is sent.
 */
import {createComponentImplementation, type ReactCatalogComponent} from '@a2ui/react';
import {Catalog} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {SpectraPreview} from 'a2ui-spectra-preview-react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {
  hostProcessorOptions,
  OPTIONS_PARAMETER,
  TEST_CATALOG_ID,
  THROWER_FAILURE,
  throwerApi,
} from '../shared/thrower.ts';

const Thrower = createComponentImplementation(throwerApi, ({props}) => {
  if (props.fail === true) throw new Error(THROWER_FAILURE);
  return <span className="thrower">{props.text ?? 'Thrower'}</span>;
});

const testCatalog = new Catalog<ReactCatalogComponent>(
  TEST_CATALOG_ID,
  basicCatalog.protocolVersion,
  [...basicCatalog.components.values(), Thrower],
  [...basicCatalog.functions.values()],
  ...(basicCatalog.themeSchema === undefined ? [] : [basicCatalog.themeSchema]),
);

const root = createRoot(document.getElementById('root')!);
/** What the host's own channel to its agent is sent. */
const hostSent: unknown[] = [];
const processorOptions = new URLSearchParams(window.location.search).has(OPTIONS_PARAMETER)
  ? hostProcessorOptions(hostSent)
  : undefined;

function draw(catalogs: ReadonlyArray<Catalog<ReactCatalogComponent>>): void {
  root.render(
    <StrictMode>
      <SpectraPreview catalogs={catalogs} processorOptions={processorOptions} />
    </StrictMode>,
  );
}

draw([testCatalog]);

Object.assign(window, {
  spectraTestPage: {
    /** Gives the adapter a catalogs prop of other catalogs. */
    changeCatalogs: () => draw([basicCatalog as Catalog<ReactCatalogComponent>]),
    unmount: () => root.unmount(),
    hostSent,
    /** The catalog the page gives the adapter, and the thrower's implementation in it. */
    testCatalog,
    Thrower,
  },
});
