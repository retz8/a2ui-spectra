import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {ConfigError} from '../config.js';
import {isEventOfKind, type TurnRecord, type WireInputEvent} from '../record/turn_record.js';
import {CatalogRegistry, rereadLine} from './registry.js';

const BASIC_V0_9 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const BASIC_V0_9_1 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';
const BASIC_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const CIRCLECI =
  'https://github.com/retz8/a2uiverse-apps/blob/main/circleci/circleci-catalog/catalogs/v0.9.1/catalog.json';

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CONFORMANCE = findConformanceDir();
const CATALOGS = path.join(CONFORMANCE, 'test_data', 'catalogs');
const circleci = path.join(CATALOGS, 'a2uiverse_circleci_v0_9_1.json');
const custom = path.join(CATALOGS, 'custom_catalog_v1_0.json');
const composition = path.join(CATALOGS, 'composition_catalog_v1_0.json');

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
});

function write(name: string, content: unknown): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'spectra-catalogs-'));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

async function loadError(files: string[], pattern: RegExp) {
  await assert.rejects(
    CatalogRegistry.load(files),
    (error: unknown) => error instanceof ConfigError && pattern.test((error as Error).message),
    `Expected ${pattern}`,
  );
}

/** A small v0.9 definition, as a file names it. */
function v09Definition(catalogId: string, components = ['Note', 'Row']) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    catalogId,
    title: 'Notes',
    components: Object.fromEntries(
      components.map(name => [
        name,
        {
          type: 'object',
          properties: {component: {const: name}, text: {type: 'string'}},
          required: ['component'],
        },
      ]),
    ),
    functions: {
      shout: {type: 'object', properties: {call: {const: 'shout'}}, required: ['call']},
    },
    $defs: {
      anyComponent: {oneOf: components.map(name => ({$ref: `#/components/${name}`}))},
      anyFunction: {oneOf: [{$ref: '#/functions/shout'}]},
    },
  };
}

describe('the built-in catalogs', () => {
  const registry = CatalogRegistry.builtIn();

  it('knows the v0.9 and v1.0 basic catalogs, the v0.9.1 URL a second id of v0.9', () => {
    assert.deepEqual(
      registry.known.map(({id, aliases, protocolVersion, source, title}) => ({
        id,
        aliases,
        protocolVersion,
        source,
        title,
      })),
      [
        {
          id: BASIC_V0_9,
          aliases: [BASIC_V0_9_1],
          protocolVersion: '0.9',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
        {
          id: BASIC_V1_0,
          aliases: [],
          protocolVersion: '1.0',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
      ],
    );
    assert.equal(registry.get(BASIC_V0_9_1)?.id, BASIC_V0_9);
    assert.equal(registry.get(BASIC_V1_0)?.id, BASIC_V1_0);
    assert.equal(registry.get('https://example.com/catalog.json'), undefined);
    assert.equal(registry.get(BASIC_V0_9)?.definition.catalogId, BASIC_V0_9);
  });

  it("gives the processor web core's basic catalogs and a schema-only one under the alias", () => {
    const catalogs = registry.catalogs();
    assert.deepEqual(
      catalogs.map(catalog => [catalog.id, catalog.protocolVersion]),
      [
        [BASIC_V0_9, '0.9'],
        [BASIC_V1_0, '1.0'],
        [BASIC_V0_9_1, '0.9'],
      ],
    );
    assert.equal(catalogs[2].components.size, catalogs[0].components.size);
  });

  it('offers the basic catalog under each version, both URLs under v0.9.1', () => {
    assert.deepEqual(registry.offer(), {
      'v0.9': [BASIC_V0_9],
      'v0.9.1': [BASIC_V0_9, BASIC_V0_9_1],
      'v1.0': [BASIC_V1_0],
    });
  });
});

describe('configured catalogs', () => {
  it('loads a 0.9 definition and a 1.0 one, each under its own id and version', async () => {
    const registry = await CatalogRegistry.load([circleci, custom]);
    assert.deepEqual(
      registry.known.slice(2).map(({id, aliases, protocolVersion, source, file, title}) => ({
        id,
        aliases,
        protocolVersion,
        source,
        file,
        title,
      })),
      [
        {
          id: CIRCLECI,
          aliases: [],
          protocolVersion: '0.9',
          source: 'configured',
          file: circleci,
          title: 'CircleCI Catalog',
        },
        {
          id: 'conformance/custom',
          aliases: [],
          protocolVersion: '1.0',
          source: 'configured',
          file: custom,
          title: 'Conformance Custom Catalog (v1.0)',
        },
      ],
    );
    assert.equal(registry.get(CIRCLECI)?.source, 'configured');
    const catalogs = registry.catalogs();
    assert.deepEqual(
      catalogs.slice(3).map(catalog => catalog.id),
      [CIRCLECI, 'conformance/custom'],
    );
    assert.deepEqual([...catalogs[3].components.keys()].slice(0, 3), ['Stack', 'Panel', 'Heading']);
    assert.deepEqual([...catalogs[4].components.keys()], ['Chart', 'Gauge']);
  });

  it('offers each configured catalog under the versions its protocol version matches', async () => {
    const registry = await CatalogRegistry.load([circleci, custom]);
    assert.deepEqual(registry.offer(), {
      'v0.9': [BASIC_V0_9, CIRCLECI],
      'v0.9.1': [BASIC_V0_9, BASIC_V0_9_1, CIRCLECI],
      'v1.0': [BASIC_V1_0, 'conformance/custom'],
    });
  });

  it('keeps the composition rules a 1.0 definition carries', async () => {
    const registry = await CatalogRegistry.load([composition]);
    const column = registry.catalogs()[3].components.get('Column');
    assert.deepEqual(column?.allowedParents, ['Surface', 'Column']);
    assert.deepEqual(column?.allowedChildren, ['Text', 'Column']);
  });

  it('stops on a file that does not load', async () => {
    const missing = path.join(CATALOGS, 'missing.json');
    await loadError([missing], new RegExp(`catalog ${missing} does not exist`));
    const broken = write('broken.json', '{');
    await loadError([broken], /broken\.json is not valid JSON/);
    const list = write('list.json', '[]');
    await loadError([list], /list\.json must hold a JSON object/);
    const noId = write('no_id.json', {components: {}});
    await loadError([noId], /no_id\.json names no catalogId/);
  });

  it('validates a 1.0 definition against the catalog definition meta-schema', async () => {
    const extraDef = write('extra_def.json', {
      protocolVersion: '1.0',
      catalogId: 'test/extra',
      components: {},
      $defs: {anyComponent: {oneOf: []}, anyFunction: {oneOf: []}, Helper: {}},
    });
    await loadError([extraDef], /extra_def\.json is not a 1\.0 catalog definition: .*\$defs/);
    const surface = write('surface.json', {
      protocolVersion: '1.0',
      catalogId: 'test/surface',
      components: {Surface: {}},
      $defs: {anyComponent: {oneOf: []}, anyFunction: {oneOf: []}},
    });
    await loadError([surface], /surface\.json is not a 1\.0 catalog definition: .*components/);
  });

  it('takes a 0.9 definition that parses, carries a catalogId and is a schema', async () => {
    const notSchema = write('not_schema.json', {catalogId: 'test/not', type: 5});
    await loadError([notSchema], /not_schema\.json is not a JSON Schema: .*type/);
    const bare = write('bare.json', {catalogId: 'test/bare'});
    const registry = await CatalogRegistry.load([bare]);
    assert.equal(registry.get('test/bare')?.protocolVersion, '0.9');
  });

  it('stops when a component or function the maps name is not in its union', async () => {
    const definition = v09Definition('test/dropped');
    definition.$defs.anyComponent.oneOf.pop();
    const dropped = write('dropped.json', definition);
    await loadError(
      [dropped],
      /dropped\.json: the component 'Row' is not listed under \$defs\.anyComponent/,
    );
    const definition2 = v09Definition('test/functions');
    const functions = {
      ...definition2,
      functions: {
        ...definition2.functions,
        sum: {type: 'object', properties: {call: {const: 'sum'}}},
      },
    };
    const droppedFunction = write('dropped_function.json', functions);
    await loadError(
      [droppedFunction],
      /dropped_function\.json: the function 'sum' is not listed under \$defs\.anyFunction/,
    );
  });

  it('stops on an id two files carry, or a basic catalog id a file claims', async () => {
    const one = write('one.json', v09Definition('test/twice'));
    const two = write('two.json', v09Definition('test/twice'));
    await loadError(
      [one, two],
      new RegExp(
        `two\\.json carries the catalog id 'test/twice', which .*one\\.json already carries`,
      ),
    );
    const basic = write('basic.json', v09Definition(BASIC_V0_9));
    await loadError([basic], /basic\.json claims the basic catalog's id/);
    const alias = write('alias.json', v09Definition(BASIC_V0_9_1));
    await loadError([alias], /alias\.json claims the basic catalog's id/);
  });
});

describe('inline catalogs', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(
        CONFORMANCE,
        'test_data',
        'turn_record',
        'v0_1',
        'full_record_custom_components.json',
      ),
      'utf8',
    ),
  ) as TurnRecord;
  const capabilities = fixture.turns[0].events.find((event): event is WireInputEvent =>
    isEventOfKind(event, 'wire_input'),
  )?.attributes['a2ui.wire.capabilities'];

  it("builds the catalogs a host sent inline, under each version's key", () => {
    const registry = CatalogRegistry.builtIn();
    const inline = registry.inlineCatalogs(capabilities);
    assert.deepEqual(
      inline.map(catalog => [catalog.id, catalog.protocolVersion, catalog.components.size]),
      [['inline_catalog', '0.9', 20]],
    );
  });

  it('takes the legacy 0.9 shape, with functions as a list and a theme map and no $defs', () => {
    const registry = CatalogRegistry.builtIn();
    const [inline] = registry.inlineCatalogs({
      'v0.9.1': {
        supportedCatalogIds: [],
        inlineCatalogs: [
          {
            catalogId: 'legacy',
            components: {
              Note: {
                type: 'object',
                properties: {component: {const: 'Note'}, text: {type: 'string'}},
              },
              Row: {type: 'object', properties: {component: {const: 'Row'}}},
            },
            functions: [
              {name: 'shout', description: 'Loudly', parameters: {}, returnType: 'string'},
            ],
            theme: {accent: {type: 'string'}},
          },
        ],
      },
    });
    assert.equal(inline.id, 'legacy');
    assert.equal(inline.protocolVersion, '0.9');
    assert.deepEqual([...inline.components.keys()], ['Note', 'Row']);
    assert.deepEqual([...inline.functions.keys()], ['shout']);
    assert.ok(inline.themeSchema);
  });

  it("takes a 1.0 inline definition under v1.0's key as a file, and leaves out ids already known or repeated", async () => {
    const registry = await CatalogRegistry.load([custom]);
    const inline = registry.inlineCatalogs({
      '1.0': {
        supportedCatalogIds: [],
        inlineCatalogs: [
          {protocolVersion: '1.0', catalogId: 'conformance/custom', components: {}},
          {protocolVersion: '1.0', catalogId: BASIC_V1_0, components: {}},
          {
            protocolVersion: '1.0',
            catalogId: 'inline/one',
            components: {Dot: {type: 'object', properties: {component: {const: 'Dot'}}}},
            $defs: {anyComponent: {oneOf: [{$ref: '#/components/Dot'}]}, anyFunction: {oneOf: []}},
          },
          {protocolVersion: '1.0', catalogId: 'inline/one', components: {}},
          {components: {}},
        ],
      },
    });
    assert.deepEqual(
      inline.map(catalog => [catalog.id, catalog.protocolVersion, [...catalog.components.keys()]]),
      [['inline/one', '1.0', ['Dot']]],
    );
    assert.deepEqual(registry.inlineCatalogs(undefined), []);
  });
});

describe('the listing the API serves', () => {
  it('carries each known definition with its ids, version, source and title', async () => {
    const registry = await CatalogRegistry.load([custom]);
    const listing = registry.listing();
    assert.deepEqual(
      listing.catalogs.map(({id, aliases, protocolVersion, source, title}) => ({
        id,
        aliases,
        protocolVersion,
        source,
        title,
      })),
      [
        {
          id: BASIC_V0_9,
          aliases: [BASIC_V0_9_1],
          protocolVersion: '0.9',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
        {
          id: BASIC_V1_0,
          aliases: [],
          protocolVersion: '1.0',
          source: 'built-in',
          title: 'A2UI Basic Catalog',
        },
        {
          id: 'conformance/custom',
          aliases: [],
          protocolVersion: '1.0',
          source: 'configured',
          title: 'Conformance Custom Catalog (v1.0)',
        },
      ],
    );
    assert.equal(listing.catalogs[2].definition.catalogId, 'conformance/custom');
    assert.ok(!('file' in listing.catalogs[2]), 'The file path stays on the server.');
  });
});

describe('a configured file read again', () => {
  /** A clock that moves a second at each look. */
  function clock() {
    let at = Date.parse('2026-11-11T14:50:12.000Z');
    return () => {
      const now = new Date(at);
      at += 1000;
      return now;
    };
  }

  function rewrite(file: string, content: unknown) {
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }

  function configuredOf(registry: CatalogRegistry) {
    return registry.listing().catalogs.filter(catalog => catalog.source === 'configured');
  }

  it('replaces the definition with a good read, for the processor too', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([file], {now: clock()});
    rewrite(file, v09Definition('notes', ['Note', 'Row', 'Card']));
    assert.deepEqual(await registry.reread(file), {kind: 'read', id: 'notes'});
    assert.deepEqual(Object.keys(registry.get('notes')?.definition.components as object), [
      'Note',
      'Row',
      'Card',
    ]);
    assert.deepEqual([...registry.catalogs()[3].components.keys()], ['Note', 'Row', 'Card']);
    assert.equal(configuredOf(registry)[0].readTime, '2026-11-11T14:50:13.000Z');
  });

  it('keeps the last good definition on each failure the start has, and records the failed read', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const other = write('other.json', v09Definition('other'));
    const registry = await CatalogRegistry.load([file, other], {now: clock()});
    const failures: Array<[content: unknown, error: RegExp]> = [
      ['{"catalogId": ', /JSON/],
      ['[]', /^must hold a JSON object$/],
      [{title: 'No id'}, /^names no catalogId$/],
      [{catalogId: 'notes', type: 12}, /^is not a JSON Schema: /],
      [
        {...v09Definition('notes'), $defs: {anyComponent: {oneOf: [{$ref: '#/components/Note'}]}}},
        /^the component 'Row' is not listed under \$defs\.anyComponent, so it would not be known$/,
      ],
      [
        v09Definition('other'),
        /^carries the catalog id 'other', which .*other\.json already carries$/,
      ],
      [v09Definition(BASIC_V0_9), /^claims the basic catalog's id '.*'$/],
    ];
    for (const [content, error] of failures) {
      rewrite(file, content);
      const result = await registry.reread(file);
      assert.equal(result.kind, 'failed');
      assert.match(result.kind === 'failed' ? result.error : '', error);
      assert.deepEqual(registry.get('notes')?.definition, v09Definition('notes'));
      const listed = configuredOf(registry)[0];
      assert.equal(listed.readTime, '2026-11-11T14:50:12.000Z');
      assert.match(listed.failedRead?.error ?? '', error);
      assert.ok((listed.failedRead?.time ?? '') > listed.readTime!);
    }
    fs.rmSync(file);
    const gone = await registry.reread(file);
    assert.deepEqual(gone, {kind: 'failed', error: 'does not exist'});
    assert.equal(registry.get('other')?.source, 'configured');
  });

  it('takes a new catalog id, the old one no longer known, and the offer follows', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([file]);
    rewrite(file, v09Definition('notes/v2'));
    assert.deepEqual(await registry.reread(file), {
      kind: 'read',
      id: 'notes/v2',
      previousId: 'notes',
    });
    assert.equal(registry.get('notes'), undefined);
    assert.equal(registry.get('notes/v2')?.file, file);
    assert.deepEqual(registry.offer()['v0.9'], [BASIC_V0_9, 'notes/v2']);
    assert.deepEqual(
      registry
        .catalogs()
        .map(catalog => catalog.id)
        .slice(3),
      ['notes/v2'],
    );
  });

  it('takes a new protocol version, and the offer follows', async () => {
    const file = write('custom.json', fs.readFileSync(custom, 'utf8'));
    const registry = await CatalogRegistry.load([file]);
    assert.deepEqual(registry.offer()['v1.0'], [BASIC_V1_0, 'conformance/custom']);
    rewrite(file, v09Definition('conformance/custom'));
    assert.deepEqual(await registry.reread(file), {kind: 'read', id: 'conformance/custom'});
    assert.deepEqual(registry.offer(), {
      'v0.9': [BASIC_V0_9, 'conformance/custom'],
      'v0.9.1': [BASIC_V0_9, BASIC_V0_9_1, 'conformance/custom'],
      'v1.0': [BASIC_V1_0],
    });
  });

  it('changes nothing on a read that gives the same definition by value', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([file], {now: clock()});
    const before = registry.get('notes');
    rewrite(file, JSON.stringify(v09Definition('notes'), null, 2));
    assert.deepEqual(await registry.reread(file), {kind: 'unchanged'});
    assert.equal(registry.get('notes'), before);
    assert.equal(configuredOf(registry)[0].readTime, '2026-11-11T14:50:12.000Z');
  });

  it('clears a failed read with a good one, the same definition included', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([file], {now: clock()});
    rewrite(file, '{');
    assert.equal((await registry.reread(file)).kind, 'failed');
    assert.ok(configuredOf(registry)[0].failedRead !== undefined);
    rewrite(file, v09Definition('notes'));
    assert.deepEqual(await registry.reread(file), {kind: 'read', id: 'notes'});
    // A good read that is said moves the time of the definition in force, the definition the same or not.
    assert.equal(configuredOf(registry)[0].readTime, '2026-11-11T14:50:14.000Z');
    assert.equal(configuredOf(registry)[0].failedRead, undefined);
    assert.ok(!('failedRead' in configuredOf(registry)[0]));
  });

  it('lists each configured file with its path as the config names it and its read time, the built-in ones with neither', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([{file, path: './notes.json'}], {now: clock()});
    const [basic, , notes] = registry.listing().catalogs;
    assert.equal(notes.path, './notes.json');
    assert.equal(notes.readTime, '2026-11-11T14:50:12.000Z');
    assert.ok(!('path' in basic) && !('readTime' in basic) && !('failedRead' in basic));
    assert.ok(!('file' in notes), 'The file path stays on the server.');
  });

  it('leaves alone a file that is not a configured one', async () => {
    const file = write('notes.json', v09Definition('notes'));
    const registry = await CatalogRegistry.load([file]);
    assert.deepEqual(await registry.reread(path.join(path.dirname(file), 'stray.json')), {
      kind: 'unchanged',
    });
  });
});

describe("the terminal's line for a file read again", () => {
  it('says the definition was read again, and the new id when the file names one', () => {
    assert.deepEqual(rereadLine('./notes.json', {kind: 'read', id: 'notes'}), {
      line: './notes.json changed. Its catalog definition was read again.',
    });
    assert.deepEqual(
      rereadLine('./notes.json', {kind: 'read', id: 'notes/v2', previousId: 'notes'}),
      {
        line:
          './notes.json changed. Its catalog definition was read again. ' +
          'Its catalog id is now notes/v2, no longer notes.',
      },
    );
  });

  it('says a failed read with its reason as an error, and nothing for a read that changed nothing', () => {
    assert.deepEqual(rereadLine('./notes.json', {kind: 'failed', error: 'names no catalogId'}), {
      line:
        './notes.json changed and did not read: names no catalogId. ' +
        'The definition read before stays in force.',
      error: true,
    });
    assert.equal(rereadLine('./notes.json', {kind: 'unchanged'}), undefined);
  });
});
