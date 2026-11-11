import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {agentRowsOf, catalogName, shownUrl, transportLine} from './agent_card.ts';
import type {KnownCatalog} from './catalogs.ts';

describe('the agent popover', () => {
  it('names the basic catalogs briefly, under either v0.9 URL, and any other catalog in full', () => {
    assert.equal(
      catalogName('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'),
      'basic, v0.9',
    );
    assert.equal(
      catalogName('https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json'),
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

  it('names a configured catalog by the title its definition carries', () => {
    const configured = [
      {
        id: 'https://example.com/catalog.json',
        aliases: [],
        protocolVersion: '0.9',
        source: 'configured' as const,
        title: 'Example Catalog',
        definition: {},
      },
      {
        id: 'untitled',
        aliases: [],
        protocolVersion: '1.0',
        source: 'configured' as const,
        definition: {},
      },
    ];
    assert.equal(catalogName('https://example.com/catalog.json', configured), 'Example Catalog');
    assert.equal(catalogName('untitled', configured), 'untitled');
    assert.equal(
      catalogName('https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json', configured),
      'basic, v1.0',
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

describe("the agent popover's rows", () => {
  const NOTES = 'https://example.com/notes.json';
  const clock = (time: string) => time.slice(11, 19);
  const notes: KnownCatalog = {
    id: NOTES,
    aliases: [],
    protocolVersion: '0.9',
    source: 'configured',
    title: 'Notes',
    path: './inline_catalog_0.9.json',
    readTime: '2026-11-11T14:50:12.000Z',
    definition: {},
  };
  const failed: KnownCatalog = {
    ...notes,
    failedRead: {
      time: '2026-11-11T14:58:31.000Z',
      error: 'JSON Parse error: Property name must be a string literal',
    },
  };
  const context = {
    agentUrl: 'http://localhost:10002/',
    mode: 'run' as const,
    proxyAddress: 'http://127.0.0.1:9821/',
    fixturesFolder: 'a2ui-spectra-fixtures',
  };
  const lines = {
    line: './inline_catalog_0.9.json did not read at 14:58:31 · checking against the definition read at 14:50:12',
    error: 'JSON Parse error: Property name must be a string literal',
  };

  it('are the address, the transport, each A2UI version with its catalogs, and the mode', () => {
    assert.deepEqual(
      agentRowsOf(
        {
          ...context,
          a2aVersions: ['0.3.0'],
          a2uiExtensions: [{version: 'v0.9', catalogIds: [NOTES]}],
        },
        [notes],
        clock,
      ),
      [
        {label: 'Address', value: 'http://localhost:10002'},
        {label: 'Transport', value: 'A2A 0.3 · JSON-RPC'},
        {label: 'A2UI', value: 'v0.9'},
        {label: 'Catalog', value: 'Notes'},
        {label: 'Mode', value: 'Launched by Spectra (run)'},
      ],
    );
    assert.deepEqual(
      agentRowsOf({...context, mode: 'attach', a2aVersions: [], a2uiExtensions: []}, [], clock).map(
        row => row.value,
      ),
      [
        'http://localhost:10002',
        'A2A, version not stated · JSON-RPC',
        'None advertised',
        'Attached to a running agent (attach)',
      ],
    );
  });

  it("puts a failed read's two lines under the catalog's row, and drops them once a read succeeds", () => {
    const advertised = {
      ...context,
      a2aVersions: ['0.3.0'],
      a2uiExtensions: [{version: 'v0.9', catalogIds: [NOTES]}],
    };
    assert.deepEqual(agentRowsOf(advertised, [failed], clock)[3], {
      label: 'Catalog',
      value: 'Notes',
      failedRead: lines,
    });
    assert.deepEqual(agentRowsOf(advertised, [notes], clock)[3], {
      label: 'Catalog',
      value: 'Notes',
    });
  });

  it('gives a failed file whose id the card does not advertise a Catalog row of its own, before the mode', () => {
    const rows = agentRowsOf(
      {
        ...context,
        a2aVersions: ['0.3.0'],
        a2uiExtensions: [
          {
            version: 'v0.9',
            catalogIds: ['https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'],
          },
        ],
      },
      [failed],
      clock,
    );
    assert.deepEqual(
      rows.map(row => row.label),
      ['Address', 'Transport', 'A2UI', 'Catalog', 'Catalog', 'Mode'],
    );
    assert.deepEqual(rows[4], {label: 'Catalog', value: 'Notes', failedRead: lines});
    // A file that reads has no row the card does not give it.
    assert.equal(agentRowsOf({...context, a2uiExtensions: []}, [notes], clock).length, 3);
  });

  it('shows the failed file under run before any card has answered, between the address and the mode', () => {
    assert.deepEqual(agentRowsOf(context, [failed], clock), [
      {label: 'Address', value: 'http://localhost:10002'},
      {label: 'Catalog', value: 'Notes', failedRead: lines},
      {label: 'Mode', value: 'Launched by Spectra (run)'},
    ]);
    assert.deepEqual(
      agentRowsOf(context, [notes], clock).map(row => row.label),
      ['Address', 'Mode'],
    );
  });
});
