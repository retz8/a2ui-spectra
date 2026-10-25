import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {catalogName, shownUrl, transportLine} from './agent_card.ts';

describe('the agent popover', () => {
  it('names the basic catalogs briefly and any other catalog in full', () => {
    assert.equal(
      catalogName('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'),
      'basic, v0.9',
    );
    assert.equal(
      catalogName('https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'),
      'basic, v1.0',
    );
    assert.equal(
      catalogName('https://a2ui.org/specification/v0_8/standard_catalog_definition.json'),
      'https://a2ui.org/specification/v0_8/standard_catalog_definition.json',
    );
  });

  it('lists every A2A version the card states, as major.minor, once each', () => {
    assert.equal(transportLine(['0.3.0']), 'A2A 0.3 · JSON-RPC');
    assert.equal(transportLine(['1.0', '0.3']), 'A2A 1.0, 0.3 · JSON-RPC');
    assert.equal(transportLine(['1.0', '1.0.0']), 'A2A 1.0 · JSON-RPC');
    assert.equal(transportLine([]), 'A2A, version not stated · JSON-RPC');
  });

  it("drops a bare origin's slash and keeps a path as it is", () => {
    assert.equal(shownUrl('http://localhost:10012/'), 'http://localhost:10012');
    assert.equal(shownUrl('http://localhost:10012/a2a/'), 'http://localhost:10012/a2a/');
  });
});
