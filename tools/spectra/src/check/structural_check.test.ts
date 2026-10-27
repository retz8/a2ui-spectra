import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import type {Turn} from '../record/turn_record.js';
import {
  createSurface,
  deleteSurface,
  pointer,
  testTurn,
  updateComponents,
  updateDataModel,
  v1,
} from '../testing/turns.js';
import type {CheckResult} from './check_event.js';
import {feedConversation} from './conversation.js';
import {checkStructural} from './structural_check.js';

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
    return checkStructural(conversation);
  } finally {
    conversation.dispose();
  }
}

const COMPONENTS = `${pointer(1)}/updateComponents/components`;

describe('the structural check', () => {
  it('passes a tree every child of which resolves and every component of which the root reaches', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: ['a', 'b']},
            {id: 'a', component: 'Text', text: 'A'},
            {id: 'b', component: 'Button', child: 'l', action: {event: {name: 'go'}}},
            {id: 'l', component: 'Text', text: 'Go'},
          ]),
        ],
      }),
    );
    assert.deepEqual(result, {findings: [], skipped: []});
  });

  it('reports a child id no component defines, at the child id', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: ['a', 'time']},
            {id: 'a', component: 'Text', text: 'A'},
          ]),
        ],
      }),
    );
    assert.deepEqual(result.findings, [
      {
        code: 'CHILD_NOT_FOUND',
        surfaceId: 's',
        path: `${COMPONENTS}/0/children/1`,
        message:
          "The component 'root' names a child 'time' that no component in the surface 's' defines.",
      },
    ]);
  });

  it('reports a component the root does not reach, at the component', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Text', text: 'A'},
            {id: 'lost', component: 'Text', text: 'B'},
          ]),
        ],
      }),
    );
    assert.deepEqual(result.findings, [
      {
        code: 'COMPONENT_UNREACHABLE',
        surfaceId: 's',
        path: `${COMPONENTS}/1`,
        message: "The component 'lost' in the surface 's' is not reachable from 'root'.",
      },
    ]);
  });

  it('reports a surface with no root as a finding of the whole surface, saying when web core emptied it', () => {
    const plain = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'main', component: 'Text', text: 'A'}]),
        ],
      }),
    );
    assert.deepEqual(
      plain.findings.map(({code, path: at, message}) => [code, at, message]),
      [
        ['ROOT_MISSING', undefined, "The surface 's' has no component with the id 'root'."],
        [
          'COMPONENT_UNREACHABLE',
          `${COMPONENTS}/0`,
          "The component 'main' in the surface 's' is not reachable from 'root'.",
        ],
      ],
    );
    const refused = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: ['b']},
            {id: 'b', component: 'Text', text: 'B', colour: 'red'},
          ]),
        ],
      }),
    );
    assert.deepEqual(refused.findings, [
      {
        code: 'ROOT_MISSING',
        surfaceId: 's',
        message:
          "The surface 's' has no component with the id 'root': web core refused the updateComponents that carried one.",
      },
    ]);
  });

  it("turns web core's refusal of a cycle and of a duplicate id into findings on the message", () => {
    const cycle = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: ['a']},
            {id: 'a', component: 'Column', children: ['root']},
          ]),
        ],
      }),
    );
    assert.deepEqual(
      cycle.findings.map(({code, path: at}) => [code, at]),
      [
        ['ROOT_MISSING', undefined],
        ['CYCLIC_REFERENCE', `${pointer(1)}/updateComponents`],
      ],
    );
    assert.match(cycle.findings[1].message, /Circular reference/);
    const duplicate = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Text', text: 'A'},
            {id: 'root', component: 'Text', text: 'B'},
          ]),
        ],
      }),
    );
    assert.deepEqual(
      duplicate.findings.map(({code, path: at, message}) => [code, at, message]),
      [
        [
          'ROOT_MISSING',
          undefined,
          "The surface 's' has no component with the id 'root': web core refused the updateComponents that carried one.",
        ],
        [
          'DUPLICATE_COMPONENT_ID',
          `${pointer(1)}/updateComponents`,
          "Duplicate component ID: 'root'",
        ],
      ],
    );
  });

  it("reports a broken composition rule with A2UI's own codes, on upstream's composition catalog", async () => {
    const registry = await CatalogRegistry.load([
      path.join(CATALOGS, 'composition_catalog_v1_0.json'),
    ]);
    const parent = run(
      testTurn({
        messages: [
          v1.createSurface('s', 'conformance/composition'),
          // Text may sit under a Column only, so a Text root is an unallowed parent.
          v1.updateComponents('s', [{id: 'root', component: 'Text', text: 'Alone'}]),
        ],
      }),
      [],
      registry,
    );
    assert.deepEqual(
      parent.findings.map(({code, path: at}) => [code, at]),
      [
        ['ROOT_MISSING', undefined],
        ['UNALLOWED_PARENT', `${pointer(1)}/updateComponents`],
      ],
    );
    assert.match(parent.findings[1].message, /cannot be placed under parent 'Surface'/);
    const child = run(
      testTurn({
        capabilities: {
          'v1.0': {
            supportedCatalogIds: [],
            inlineCatalogs: [
              {
                catalogId: 'inline/boxes',
                protocolVersion: '1.0',
                components: {
                  Box: {
                    type: 'object',
                    properties: {
                      component: {const: 'Box'},
                      children: {$ref: 'common_types.json#/$defs/ChildList'},
                    },
                    required: ['component'],
                    allowedParents: ['Surface', 'Box'],
                    allowedChildren: ['Box'],
                  },
                  Note: {
                    type: 'object',
                    properties: {component: {const: 'Note'}, text: {type: 'string'}},
                    required: ['component'],
                  },
                },
                $defs: {
                  anyComponent: {oneOf: [{$ref: '#/components/Box'}, {$ref: '#/components/Note'}]},
                  anyFunction: {not: {}},
                },
              },
            ],
          },
        },
        messages: [
          v1.createSurface('s', 'inline/boxes'),
          v1.updateComponents('s', [
            {id: 'root', component: 'Box', children: ['n']},
            {id: 'n', component: 'Note', text: 'Hi'},
          ]),
        ],
      }),
    );
    assert.deepEqual(
      child.findings.map(({code, path: at}) => [code, at]),
      [
        ['ROOT_MISSING', undefined],
        ['UNALLOWED_CHILD', `${pointer(1)}/updateComponents`],
      ],
    );
    assert.match(child.findings[1].message, /cannot contain child 'n'/);
  });

  it('reports a surface no createSurface created, on the first message naming it', () => {
    const result = run(
      testTurn({
        messages: [
          updateDataModel('ghost', {a: 1}),
          updateComponents('ghost', [{id: 'root', component: 'Text', text: 'Hi'}]),
        ],
      }),
    );
    assert.deepEqual(result, {
      findings: [
        {
          code: 'SURFACE_NOT_CREATED',
          surfaceId: 'ghost',
          path: `${pointer(0)}/updateDataModel`,
          message: "No createSurface in the conversation created the surface 'ghost'.",
        },
      ],
      skipped: [],
    });
  });

  it('skips a surface whose createSurface web core refused, and one whose catalog has no definition', () => {
    const refused = run(
      testTurn({
        messages: [
          createSurface('s', undefined, {theme: {primaryColor: 3}}),
          updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi'}]),
        ],
      }),
    );
    assert.deepEqual(refused, {
      findings: [],
      skipped: [
        {
          surfaceId: 's',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          reason: 'not_created',
        },
      ],
    });
    const unknown = run(
      testTurn({
        messages: [
          createSurface('s', 'example.com:unknown'),
          updateComponents('s', [{id: 'main', component: 'Thing'}]),
        ],
      }),
    );
    assert.deepEqual(unknown, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
    });
  });

  it('passes over a surface the turn deleted', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'main', component: 'Text', text: 'A'}]),
          deleteSurface('s'),
        ],
      }),
    );
    assert.deepEqual(result, {findings: [], skipped: []});
  });

  it('gives a finding on a component an earlier turn carried no path, naming the component', () => {
    const earlier = testTurn({
      messages: [
        createSurface('s'),
        updateComponents('s', [
          {id: 'root', component: 'Column', children: ['a', 'gone']},
          {id: 'a', component: 'Text', text: {path: '/a'}},
        ]),
      ],
    });
    assert.deepEqual(
      run(earlier).findings.map(({path: at}) => at),
      [`${COMPONENTS}/0/children/1`],
    );
    const later = testTurn({messages: [updateDataModel('s', {a: 'A'})]});
    assert.deepEqual(run(later, [earlier]).findings, [
      {
        code: 'CHILD_NOT_FOUND',
        surfaceId: 's',
        message:
          "The component 'root' names a child 'gone' that no component in the surface 's' defines.",
      },
    ]);
  });

  it('does not re-check a surface the turn did not touch', () => {
    const earlier = testTurn({
      messages: [
        createSurface('s'),
        updateComponents('s', [{id: 'root', component: 'Column', children: ['gone']}]),
      ],
    });
    const later = testTurn({
      messages: [
        createSurface('t'),
        updateComponents('t', [{id: 'root', component: 'Text', text: 'T'}]),
      ],
    });
    assert.deepEqual(run(later, [earlier]), {findings: [], skipped: []});
  });
});
