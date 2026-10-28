import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {claimsOf} from './claims.js';

describe('claimsOf', () => {
  it("claims each catalog by its id and its definition's protocol version, in order", () => {
    assert.deepEqual(
      claimsOf([
        {
          id: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          protocolVersion: '0.9',
        },
        {id: 'https://example.com/mine.json', protocolVersion: '1.0'},
      ]),
      [
        {
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          protocolVersion: '0.9',
        },
        {catalogId: 'https://example.com/mine.json', protocolVersion: '1.0'},
      ],
    );
  });

  it('claims a catalog passed twice once', () => {
    const catalog = {id: 'https://example.com/mine.json', protocolVersion: '0.9'};
    assert.equal(claimsOf([catalog, catalog]).length, 1);
  });
});
