/**
 * The React sample's preview page: the sample catalog and the v1.0 basic
 * catalog drawn through the React preview adapter, inside the providers a
 * host using them wraps its surfaces in.
 */
import {renderMarkdown} from '@a2ui/markdown-it';
import {MarkdownContext} from '@a2ui/react/v0_9';
import {SpectraPreview} from 'a2ui-spectra-preview-react';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {basicV10, sampleCatalog} from './catalog.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarkdownContext.Provider value={renderMarkdown}>
      <SpectraPreview catalogs={[sampleCatalog, basicV10]} />
    </MarkdownContext.Provider>
  </StrictMode>,
);
