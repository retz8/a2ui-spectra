import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isFromViewer, viewerOriginOf} from './window.js';

describe('viewerOriginOf', () => {
  it("reads the viewer's origin from the page's query string", () => {
    assert.equal(
      viewerOriginOf('?a2ui-spectra-viewer=https%3A%2F%2Fvnw20xbg-5173.asse.devtunnels.ms'),
      'https://vnw20xbg-5173.asse.devtunnels.ms',
    );
    assert.equal(
      viewerOriginOf('?x=1&a2ui-spectra-viewer=http://localhost:9300'),
      'http://localhost:9300',
    );
  });

  it('gives none with no parameter, so the page is on its own', () => {
    assert.equal(viewerOriginOf(''), undefined);
    assert.equal(viewerOriginOf('?other=1'), undefined);
  });

  it('gives none for a value that is not an origin', () => {
    assert.equal(viewerOriginOf('?a2ui-spectra-viewer=http://localhost:9300/path'), undefined);
    assert.equal(viewerOriginOf('?a2ui-spectra-viewer=nonsense'), undefined);
  });
});

describe('isFromViewer', () => {
  const parent = {};

  it('takes a message from the parent window at the viewer origin', () => {
    assert.equal(
      isFromViewer(
        {origin: 'http://localhost:9300', source: parent},
        'http://localhost:9300',
        parent,
      ),
      true,
    );
  });

  it('ignores a message from another origin, or from another window', () => {
    assert.equal(
      isFromViewer(
        {origin: 'https://evil.example', source: parent},
        'http://localhost:9300',
        parent,
      ),
      false,
    );
    assert.equal(
      isFromViewer({origin: 'http://localhost:9300', source: {}}, 'http://localhost:9300', parent),
      false,
    );
  });
});
