import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readCatalog} from '../testing/recordings.ts';
import {catalogsOf, type KnownCatalog} from './catalogs.ts';

const BASIC_V0_9 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const BASIC_V0_9_1 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';
const BASIC_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const CIRCLECI =
  'https://github.com/retz8/a2uiverse-apps/blob/main/circleci/circleci-catalog/catalogs/v0.9.1/catalog.json';

/** The listing the API serves with the CircleCI catalog configured. */
export function listingWithCircleci(): KnownCatalog[] {
  const circleci = readCatalog('a2uiverse_circleci_v0_9_1');
  return [
    {
      id: BASIC_V0_9,
      aliases: [BASIC_V0_9_1],
      protocolVersion: '0.9',
      source: 'built-in',
      title: 'A2UI Basic Catalog',
      definition: {},
    },
    {
      id: BASIC_V1_0,
      aliases: [],
      protocolVersion: '1.0',
      source: 'built-in',
      title: 'A2UI Basic Catalog',
      definition: {},
    },
    {
      id: CIRCLECI,
      aliases: [],
      protocolVersion: '0.9',
      source: 'configured',
      title: 'CircleCI Catalog',
      definition: circleci,
    },
  ];
}

describe('catalogsOf', () => {
  it("builds web core's basic catalogs, one under the v0.9.1 URL, and each configured definition", () => {
    const catalogs = catalogsOf(listingWithCircleci());
    assert.deepEqual(
      catalogs.map(catalog => [catalog.id, catalog.protocolVersion, catalog.components.size]),
      [
        [BASIC_V0_9, '0.9', 18],
        [BASIC_V1_0, '1.0', 18],
        [BASIC_V0_9_1, '0.9', 18],
        [CIRCLECI, '0.9', 14],
      ],
    );
  });

  it('leaves out a configured definition web core cannot load, and holds with no listing', () => {
    const [, , ...rest] = catalogsOf([
      ...listingWithCircleci().slice(0, 2),
      {
        id: 'broken',
        aliases: [],
        protocolVersion: '0.9',
        source: 'configured',
        // A 1.0 component name that is not an identifier, which web core refuses.
        definition: {protocolVersion: '1.0', catalogId: 'broken', components: {'1bad': {}}},
      },
    ]);
    assert.deepEqual(
      rest.map(catalog => catalog.id),
      [BASIC_V0_9_1],
    );
    assert.equal(catalogsOf(undefined).length, 3);
  });
});
