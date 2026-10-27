import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import type {Turn} from '../record/turn_record.js';
import {
  BASIC_V0_9_1,
  createSurface,
  deleteSurface,
  pointer,
  testTurn,
  updateComponents,
  v1,
} from '../testing/turns.js';
import {checkCatalog} from './catalog_check.js';
import type {CheckResult} from './check_event.js';
import {feedConversation} from './conversation.js';

function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'conformance', 'conformance_schema.json'))) {
      return path.join(dir, 'conformance');
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CATALOGS = path.join(findConformanceDir(), 'test_data/catalogs');

function run(turn: Turn, earlier: Turn[] = [], registry?: CatalogRegistry): CheckResult {
  const conversation = feedConversation(turn, earlier, registry);
  try {
    return checkCatalog(conversation);
  } finally {
    conversation.dispose();
  }
}

const COMPONENTS = `${pointer(1)}/updateComponents/components`;

describe('the catalog check', () => {
  it('passes the basic catalog in both versions, bindings and function calls included', () => {
    const v09 = testTurn({
      messages: [
        createSurface('s'),
        updateComponents('s', [
          {id: 'root', component: 'Column', children: ['t', 'f']},
          {id: 't', component: 'Text', text: {path: '/title'}},
          {
            id: 'f',
            component: 'TextField',
            label: 'Name',
            value: {path: '/name'},
            checks: [
              {condition: {call: 'required', args: {value: {path: '/name'}}}, message: 'Required'},
            ],
          },
        ]),
      ],
    });
    assert.deepEqual(run(v09), {findings: [], skipped: []});
    const v10 = testTurn({
      messages: [
        v1.createSurface('s'),
        v1.updateComponents('s', [
          {id: 'root', component: 'Column', children: ['t']},
          {
            id: 't',
            component: 'Text',
            text: {'@call': 'formatString', args: {value: 'Hi ${/name}'}},
          },
        ]),
      ],
    });
    assert.deepEqual(run(v10), {findings: [], skipped: []});
  });

  it("reports a property the catalog does not define, at the property, in the version's shape", () => {
    const v09 = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {
              id: 'root',
              component: 'Button',
              child: 'l',
              action: {event: {name: 'go'}},
              colour: 'primary',
            },
            {id: 'l', component: 'Text', text: 'Go'},
          ]),
        ],
      }),
    );
    assert.deepEqual(v09, {
      findings: [
        {
          code: 'VALIDATION_FAILED',
          surfaceId: 's',
          path: `${COMPONENTS}/0/colour`,
          message: 'must NOT have unevaluated properties: colour',
        },
      ],
      skipped: [],
    });
    const v10 = run(
      testTurn({
        messages: [
          v1.createSurface('s'),
          v1.updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi', colour: 1}]),
        ],
      }),
    );
    assert.deepEqual(
      v10.findings.map(({code, path: at}) => [code, at]),
      [['VALIDATION_FAILED', `${COMPONENTS}/0/colour`]],
    );
  });

  it('reports a component type the catalog does not define, once, at the type', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'root', component: 'Hologram', depth: 3}]),
        ],
      }),
    );
    assert.deepEqual(result.findings, [
      {
        code: 'COMPONENT_UNKNOWN',
        surfaceId: 's',
        path: `${COMPONENTS}/0/component`,
        message: `The catalog ${BASIC_V0_9_1.replace('v0_9_1', 'v0_9')} defines no component 'Hologram'.`,
      },
    ]);
  });

  it("judges a function call against its own function's branch, in both versions", () => {
    const v09 = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Text', text: {call: 'shout', args: {}}},
            {id: 'a', component: 'Text', text: {call: 'required', args: {}}},
          ]),
        ],
      }),
    );
    assert.deepEqual(
      v09.findings.map(({code, path: at, message}) => [code, at, message]),
      [
        [
          'FUNCTION_UNKNOWN',
          `${COMPONENTS}/0/text/call`,
          `The catalog ${BASIC_V0_9_1.replace('v0_9_1', 'v0_9')} defines no function 'shout'.`,
        ],
        ['VALIDATION_FAILED', `${COMPONENTS}/1/text/args`, "must have required property 'value'"],
      ],
    );
    const v10 = run(
      testTurn({
        messages: [
          v1.createSurface('s'),
          v1.updateComponents('s', [
            {id: 'root', component: 'Text', text: {'@call': 'shout', args: {}}},
            {id: 'a', component: 'Text', text: {'@call': 'required', args: {}}},
            {id: 'b', component: 'Text', text: {'@call': '@index'}},
          ]),
        ],
      }),
    );
    assert.deepEqual(
      v10.findings.map(({code, path: at}) => [code, at]),
      [
        ['FUNCTION_UNKNOWN', `${COMPONENTS}/0/text/@call`],
        ['VALIDATION_FAILED', `${COMPONENTS}/1/text/args`],
      ],
    );
  });

  it("validates a v0.9 surface's theme against the catalog's theme", () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s', undefined, {theme: {primaryColor: 3}}),
          updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi'}]),
        ],
      }),
    );
    assert.deepEqual(
      result.findings.map(({code, path: at}) => [code, at]),
      [['VALIDATION_FAILED', `${pointer(0)}/createSurface/theme/primaryColor`]],
    );
  });

  it('skips a surface whose catalog has no definition, naming the id', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s', 'example.com:unknown'),
          updateComponents('s', [{id: 'root', component: 'Anything', x: 1}]),
        ],
      }),
    );
    assert.deepEqual(result, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
    });
  });

  it('skips a surface never created, and passes over one the turn deleted', () => {
    const never = run(
      testTurn({
        messages: [updateComponents('ghost', [{id: 'root', component: 'Text', text: 'Hi'}])],
      }),
    );
    assert.deepEqual(never, {findings: [], skipped: [{surfaceId: 'ghost', reason: 'not_created'}]});
    const deleted = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi', colour: 1}]),
          deleteSurface('s'),
        ],
      }),
    );
    assert.deepEqual(deleted, {findings: [], skipped: []});
  });

  it('judges the messages of a surface web core refused at creation against the catalog they named', () => {
    const refused = run(
      testTurn({
        messages: [
          createSurface('s', undefined, {theme: {primaryColor: 3}}),
          updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi', colour: 1}]),
        ],
      }),
    );
    assert.deepEqual(refused.skipped, []);
    assert.deepEqual(
      refused.findings.map(({path: at}) => at),
      [`${pointer(0)}/createSurface/theme/primaryColor`, `${COMPONENTS}/0/colour`],
    );
  });

  it("uses a v1.0 component's own catalog, and skips one whose catalog has no definition", async () => {
    const registry = await CatalogRegistry.load([path.join(CATALOGS, 'custom_catalog_v1_0.json')]);
    const result = run(
      testTurn({
        messages: [
          v1.createSurface('s'),
          v1.updateComponents('s', [
            {id: 'root', component: 'Column', children: ['c', 'g', 'u']},
            {id: 'c', component: 'Chart', catalogId: 'conformance/custom', caption: 'No values'},
            {id: 'g', component: 'Gauge', catalogId: 'conformance/custom', value: 42},
            {id: 'u', component: 'Widget', catalogId: 'example.com:unknown'},
          ]),
        ],
      }),
      [],
      registry,
    );
    assert.deepEqual(
      result.findings.map(({code, path: at, message}) => [code, at, message]),
      [['VALIDATION_FAILED', `${COMPONENTS}/1`, "must have required property 'values'"]],
    );
    assert.deepEqual(result.skipped, [
      {surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'},
    ]);
  });

  it('knows the v0.9 basic catalog under its v0.9.1 URL', () => {
    const result = run(
      testTurn({
        messages: [
          {version: 'v0.9.1', createSurface: {surfaceId: 's', catalogId: BASIC_V0_9_1}},
          {
            version: 'v0.9.1',
            updateComponents: {
              surfaceId: 's',
              components: [{id: 'root', component: 'Text', text: 'Hi', colour: 1}],
            },
          },
        ],
      }),
    );
    assert.deepEqual(
      result.findings.map(({code, path: at}) => [code, at]),
      [['VALIDATION_FAILED', `${COMPONENTS}/0/colour`]],
    );
    assert.deepEqual(result.skipped, []);
  });

  it("judges against a catalog the host sent inline in an earlier turn's message only", () => {
    const inline = {
      'v0.9': {
        supportedCatalogIds: [],
        inlineCatalogs: [
          {
            catalogId: 'inline/notes',
            components: {
              Note: {
                type: 'object',
                properties: {
                  id: {type: 'string'},
                  component: {const: 'Note'},
                  text: {type: 'string'},
                },
                required: ['id', 'component', 'text'],
                additionalProperties: false,
              },
            },
            $defs: {anyComponent: {oneOf: [{$ref: '#/components/Note'}]}},
          },
        ],
      },
    };
    const earlier = testTurn({
      capabilities: inline,
      messages: [createSurface('n', 'inline/notes')],
    });
    const later = testTurn({
      messages: [updateComponents('n', [{id: 'root', component: 'Note', text: 'Hi', colour: 1}])],
    });
    const result = run(later, [earlier]);
    assert.deepEqual(
      result.findings.map(({code, path: at, message}) => [code, at, message]),
      [
        [
          'VALIDATION_FAILED',
          `${pointer(0)}/updateComponents/components/0/colour`,
          'must NOT have additional properties: colour',
        ],
      ],
    );
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(run(later).skipped, [{surfaceId: 'n', reason: 'not_created'}]);
  });

  it("validates each component against its own message's version in a mixed turn", () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('old'),
          updateComponents('old', [{id: 'root', component: 'Text', text: {path: '/t'}}]),
          v1.createSurface('new'),
          v1.updateComponents('new', [{id: 'root', component: 'Text', text: {'@path': '/t'}}]),
        ],
      }),
    );
    assert.deepEqual(result, {findings: [], skipped: []});
  });
});
