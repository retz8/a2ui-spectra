import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import type {Turn} from '../record/turn_record.js';
import {
  BASIC_V0_9,
  BASIC_V0_9_1,
  BASIC_V1_0,
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
    assert.deepEqual(run(v09), {findings: [], skipped: [], legacyForm: []});
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
    assert.deepEqual(run(v10), {findings: [], skipped: [], legacyForm: []});
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
      legacyForm: [],
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
      legacyForm: [],
    });
  });

  it('skips a surface never created, and passes over one the turn deleted', () => {
    const never = run(
      testTurn({
        messages: [updateComponents('ghost', [{id: 'root', component: 'Text', text: 'Hi'}])],
      }),
    );
    assert.deepEqual(never, {
      findings: [],
      skipped: [{surfaceId: 'ghost', reason: 'not_created'}],
      legacyForm: [],
    });
    const deleted = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'root', component: 'Text', text: 'Hi', colour: 1}]),
          deleteSurface('s'),
        ],
      }),
    );
    assert.deepEqual(deleted, {findings: [], skipped: [], legacyForm: []});
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

  for (const form of ['@catalogId', 'catalogId'] as const) {
    it(`uses a v1.0 component's own catalog by its ${form}, and skips one whose catalog has no definition`, async () => {
      const registry = await CatalogRegistry.load([
        path.join(CATALOGS, 'custom_catalog_v1_0.json'),
      ]);
      const result = run(
        testTurn({
          messages: [
            v1.createSurface('s'),
            v1.updateComponents('s', [
              {id: 'root', component: 'Column', children: ['c', 'g', 'u']},
              {id: 'c', component: 'Chart', [form]: 'conformance/custom', caption: 'No values'},
              {id: 'g', component: 'Gauge', [form]: 'conformance/custom', value: 42},
              {id: 'u', component: 'Widget', [form]: 'example.com:unknown'},
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
      assert.deepEqual(
        result.legacyForm,
        form === '@catalogId'
          ? []
          : [
              {surfaceId: 's', componentId: 'c', keys: ['catalogId'], path: `${COMPONENTS}/1`},
              {surfaceId: 's', componentId: 'g', keys: ['catalogId'], path: `${COMPONENTS}/2`},
            ],
      );
    });
  }

  it('knows the v0.9 basic catalog under its v0.9.1 URL', () => {
    const result = run(
      testTurn({
        messages: [
          {version: 'v0.9.1', createSurface: {surfaceId: 's', catalogId: BASIC_V0_9_1}},
          {
            version: 'v0.9.1',
            updateComponents: {
              surfaceId: 's',
              components: [
                {id: 'root', component: 'Text', text: 'Hi', colour: 1},
                {id: 'list', component: 'List', children: [], listStyle: 'ordered'},
              ],
            },
          },
        ],
      }),
    );
    // The v0.9 file's List keeps listStyle, which the v0.9.1 file lacks; see finding 47.
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
    assert.deepEqual(result, {findings: [], skipped: [], legacyForm: []});
  });
});

const ENVELOPE_CATALOG = path.join(CATALOGS, 'envelope_catalog_v1_0.json');
const CUSTOM_CATALOG = path.join(CATALOGS, 'custom_catalog_v1_0.json');

/** One v1.0 component on a surface of the basic catalog, or of another catalog, and the catalog check's result. */
async function judgeOne(
  component: Record<string, unknown>,
  surfaceCatalog?: string,
): Promise<CheckResult> {
  const registry = await CatalogRegistry.load([CUSTOM_CATALOG, ENVELOPE_CATALOG]);
  return run(
    testTurn({
      messages: [
        v1.createSurface('s', surfaceCatalog),
        v1.updateComponents('s', [{id: 'root', ...component}]),
      ],
    }),
    [],
    registry,
  );
}

const ROOT = `${COMPONENTS}/0`;

/** The findings as code, pointer inside the component and message. */
function brief(result: CheckResult): Array<[string, string, string]> {
  return result.findings.map(({code, path: at, message}) => [
    code,
    (at ?? '').replace(ROOT, ''),
    message,
  ]);
}

describe("the catalog check on a v1.0 component's envelope keys", () => {
  const required = (at: string) => ({
    condition: {'@call': 'required', args: {value: {'@path': at}}},
    message: 'Required.',
  });
  const forms: Array<{key: string; type: string; extra: Record<string, unknown>; value: unknown}> =
    [
      {key: 'accessibility', type: 'Text', extra: {text: 'Hi'}, value: {label: 'Greeting'}},
      {key: 'metadata', type: 'Text', extra: {text: 'Hi'}, value: {extensions: {note: 'x'}}},
      {
        key: 'checks',
        type: 'TextField',
        extra: {label: 'Name', value: {'@path': '/name'}},
        value: [required('/name')],
      },
    ];
  for (const {key, type, extra, value} of forms) {
    it(`passes the @${key} with no legacy form, the bare ${key} listed, and rejects both in web core's sentence`, async () => {
      const at = await judgeOne({component: type, ...extra, [`@${key}`]: value});
      assert.deepEqual(at, {findings: [], skipped: [], legacyForm: []});
      const bare = await judgeOne({component: type, ...extra, [key]: value});
      assert.deepEqual(bare, {
        findings: [],
        skipped: [],
        legacyForm: [{surfaceId: 's', componentId: 'root', keys: [key], path: ROOT}],
      });
      const both = await judgeOne({component: type, ...extra, [key]: value, [`@${key}`]: value});
      assert.deepEqual(both.findings, [
        {
          code: 'VALIDATION_FAILED',
          surfaceId: 's',
          path: `${ROOT}/${key}`,
          message: `Component 'root' cannot specify both '@${key}' and legacy '${key}'.`,
        },
      ]);
      assert.deepEqual(both.legacyForm, []);
    });
  }

  it("passes the @catalogId with no legacy form, the bare catalogId listed, and rejects both in web core's sentence", async () => {
    const chart = {component: 'Chart', values: [1, 2]};
    assert.deepEqual(await judgeOne({...chart, '@catalogId': 'conformance/custom'}), {
      findings: [],
      skipped: [],
      legacyForm: [],
    });
    assert.deepEqual((await judgeOne({...chart, catalogId: 'conformance/custom'})).legacyForm, [
      {surfaceId: 's', componentId: 'root', keys: ['catalogId'], path: ROOT},
    ]);
    const both = await judgeOne({
      ...chart,
      catalogId: 'conformance/custom',
      '@catalogId': 'conformance/custom',
    });
    assert.deepEqual(brief(both), [
      [
        'VALIDATION_FAILED',
        '/catalogId',
        "Component 'root' cannot specify both '@catalogId' and legacy 'catalogId'.",
      ],
    ]);
  });

  it('lists the bare keys in the order the component writes them, and the rest of a both-forms component is judged', async () => {
    const result = await judgeOne({
      component: 'TextField',
      checks: [required('/name')],
      label: 'Name',
      accessibility: {label: 'Your name'},
      metadata: {},
      '@metadata': {extensions: {}},
      colour: 'red',
    });
    assert.deepEqual(result.legacyForm, [
      {surfaceId: 's', componentId: 'root', keys: ['checks', 'accessibility'], path: ROOT},
    ]);
    assert.deepEqual(brief(result), [
      [
        'VALIDATION_FAILED',
        '/metadata',
        "Component 'root' cannot specify both '@metadata' and legacy 'metadata'.",
      ],
      ['VALIDATION_FAILED', '', "must have required property 'value'"],
      ['VALIDATION_FAILED', '/colour', 'must NOT have unevaluated properties: colour'],
    ]);
  });

  it("judges a bare key the component's schema declares as its own property as that property, beside its @ key", async () => {
    const tag = await judgeOne(
      {component: 'Tag', label: 'New', metadata: 'Free text.', '@metadata': {}},
      'spectra/envelope',
    );
    assert.deepEqual(tag, {findings: [], skipped: [], legacyForm: []});
    const wrong = await judgeOne(
      {component: 'Tag', label: 'New', metadata: {}},
      'spectra/envelope',
    );
    assert.deepEqual(brief(wrong), [['VALIDATION_FAILED', '/metadata', 'must be string']]);
    assert.deepEqual(wrong.legacyForm, []);
    const poll = await judgeOne(
      {component: 'Poll', question: 'Yes?', checks: 3, '@checks': []},
      'spectra/envelope',
    );
    assert.deepEqual(poll, {findings: [], skipped: [], legacyForm: []});
  });

  it('reads a bare checks the schema declares as check rules as the envelope key', async () => {
    const result = await judgeOne(
      {component: 'Rule', text: 'Hi', checks: [{condition: {'@path': '/x'}}]},
      'spectra/envelope',
    );
    assert.deepEqual(result, {
      findings: [],
      skipped: [],
      legacyForm: [{surfaceId: 's', componentId: 'root', keys: ['checks'], path: ROOT}],
    });
  });

  it('leaves a bare checks on a component that takes no checks a property its schema rejects', async () => {
    const result = await judgeOne({component: 'Text', text: 'Hi', checks: [required('/name')]});
    assert.deepEqual(brief(result), [
      ['VALIDATION_FAILED', '/checks', 'must NOT have unevaluated properties: checks'],
    ]);
    assert.deepEqual(result.legacyForm, []);
  });

  it('counts a null value as carried, alone and beside the @ key', async () => {
    const alone = await judgeOne({component: 'Text', text: 'Hi', accessibility: null});
    assert.deepEqual(brief(alone), [['VALIDATION_FAILED', '/accessibility', 'must be object']]);
    assert.deepEqual(alone.legacyForm, [
      {surfaceId: 's', componentId: 'root', keys: ['accessibility'], path: ROOT},
    ]);
    const both = await judgeOne({
      component: 'Text',
      text: 'Hi',
      accessibility: null,
      '@accessibility': {label: 'Hi'},
    });
    assert.deepEqual(brief(both), [
      [
        'VALIDATION_FAILED',
        '/accessibility',
        "Component 'root' cannot specify both '@accessibility' and legacy 'accessibility'.",
      ],
    ]);
  });

  it("decides a bare catalogId by the component's schema in the surface's catalog", async () => {
    // The surface's catalog declares Pin's catalogId as its own property: the bare key is not followed.
    const own = await judgeOne(
      {component: 'Pin', catalogId: 'conformance/custom'},
      'spectra/envelope',
    );
    assert.deepEqual(own, {findings: [], skipped: [], legacyForm: []});
    // The basic catalog defines no Pin: the bare key routes it, though the catalog it names declares one.
    const routed = await judgeOne({component: 'Pin', catalogId: 'spectra/envelope'});
    assert.deepEqual(routed, {
      findings: [],
      skipped: [],
      legacyForm: [{surfaceId: 's', componentId: 'root', keys: ['catalogId'], path: ROOT}],
    });
  });

  it('judges no bare key where the deciding definition is unknown, and always follows the @catalogId', async () => {
    const unknown = await judgeOne({
      component: 'Widget',
      '@catalogId': 'example.com:unknown',
      accessibility: {label: 'Hi'},
    });
    assert.deepEqual(unknown, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
      legacyForm: [],
    });
    const noDefault = await judgeOne(
      {component: 'Chart', catalogId: 'conformance/custom', caption: 'No values'},
      'example.com:unknown',
    );
    assert.deepEqual(noDefault, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
      legacyForm: [],
    });
    const followed = await judgeOne(
      {
        component: 'Chart',
        '@catalogId': 'conformance/custom',
        caption: 'No values',
        accessibility: {},
      },
      'example.com:unknown',
    );
    assert.deepEqual(brief(followed), [
      ['VALIDATION_FAILED', '', "must have required property 'values'"],
    ]);
    assert.deepEqual(followed.legacyForm, [
      {surfaceId: 's', componentId: 'root', keys: ['accessibility'], path: ROOT},
    ]);
  });

  it('lists no component whose id is not a string, and judges its bare keys all the same', async () => {
    const registry = await CatalogRegistry.load([CUSTOM_CATALOG, ENVELOPE_CATALOG]);
    const result = run(
      testTurn({
        messages: [
          v1.createSurface('s'),
          v1.updateComponents('s', [{component: 'Text', text: 'Hi', accessibility: {label: 3}}]),
        ],
      }),
      [],
      registry,
    );
    assert.deepEqual(result.legacyForm, []);
    assert.ok(
      result.findings.some(({path: at}) => at?.startsWith(`${ROOT}/accessibility/label`)),
      JSON.stringify(result.findings),
    );
  });

  it('judges a component whose type its catalog does not define on its type alone', async () => {
    const result = await judgeOne({
      component: 'Hologram',
      accessibility: {label: 'Hi'},
      '@accessibility': {label: 'Hi'},
      metadata: {},
    });
    assert.deepEqual(brief(result), [
      [
        'COMPONENT_UNKNOWN',
        '/component',
        `The catalog ${BASIC_V1_0} defines no component 'Hologram'.`,
      ],
    ]);
    assert.deepEqual(result.legacyForm, []);
  });

  it("judges the value under an accepted bare key as the @ key's, each pointer through the bare key", async () => {
    const result = await judgeOne({
      component: 'TextField',
      label: 'Name',
      value: {'@path': '/name'},
      checks: [
        {condition: {'@call': 'shout', args: {}}},
        {condition: {'@call': 'required', args: {}}},
        {message: 'No condition.'},
      ],
      accessibility: {label: 'Your name', loud: true},
    });
    assert.deepEqual(brief(result), [
      ['VALIDATION_FAILED', '/accessibility/loud', 'must NOT have additional properties: loud'],
      ['VALIDATION_FAILED', '/checks/2', "must have required property 'condition'"],
      [
        'FUNCTION_UNKNOWN',
        '/checks/0/condition/@call',
        `The catalog ${BASIC_V1_0} defines no function 'shout'.`,
      ],
      ['VALIDATION_FAILED', '/checks/1/condition/args', "must have required property 'value'"],
    ]);
    assert.deepEqual(result.legacyForm, [
      {surfaceId: 's', componentId: 'root', keys: ['checks', 'accessibility'], path: ROOT},
    ]);
  });

  it("judges a v1.0 function call in the catalog it names, else in the surface's, whatever the component's catalog", async () => {
    const chart = (caption: unknown) => ({
      component: 'Chart',
      '@catalogId': 'conformance/custom',
      values: [1],
      caption,
    });
    assert.deepEqual(await judgeOne(chart({'@call': 'formatString', args: {value: 'Hi'}})), {
      findings: [],
      skipped: [],
      legacyForm: [],
    });
    assert.deepEqual(brief(await judgeOne(chart({'@call': 'percent', args: {value: 0.5}}))), [
      [
        'FUNCTION_UNKNOWN',
        '/caption/@call',
        `The catalog ${BASIC_V1_0} defines no function 'percent'.`,
      ],
    ]);
    assert.deepEqual(
      await judgeOne(
        chart({'@call': 'percent', catalogId: 'conformance/custom', args: {value: 0.5}}),
      ),
      {findings: [], skipped: [], legacyForm: []},
    );
    const named = await judgeOne({
      component: 'Text',
      text: {'@call': 'percent', catalogId: 'conformance/custom', args: {value: 'half'}},
    });
    assert.deepEqual(brief(named), [['VALIDATION_FAILED', '/text/args/value', 'must be number']]);
    const nowhere = await judgeOne({
      component: 'Text',
      text: {'@call': 'shout', catalogId: 'example.com:unknown', args: {}},
    });
    assert.deepEqual(nowhere, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
      legacyForm: [],
    });
  });

  it("requires a v1.0 TextField's value", async () => {
    const result = await judgeOne({component: 'TextField', label: 'Name'});
    assert.deepEqual(brief(result), [
      ['VALIDATION_FAILED', '', "must have required property 'value'"],
    ]);
  });

  it('reads v0.9 and v0.9.1 as before: the bare accessibility and checks the envelope keys, an @ key not', () => {
    for (const version of ['v0.9', 'v0.9.1']) {
      const catalogId = version === 'v0.9' ? BASIC_V0_9 : BASIC_V0_9_1;
      const result = run(
        testTurn({
          messages: [
            {version, createSurface: {surfaceId: 's', catalogId}},
            {
              version,
              updateComponents: {
                surfaceId: 's',
                components: [
                  {
                    id: 'root',
                    component: 'TextField',
                    label: 'Name',
                    accessibility: {label: 'Your name'},
                    checks: [
                      {
                        condition: {call: 'required', args: {value: {path: '/name'}}},
                        message: 'Required.',
                      },
                    ],
                  },
                  {
                    id: 'b',
                    component: 'Text',
                    text: 'Hi',
                    '@accessibility': {label: 'Hi'},
                    '@checks': [],
                  },
                ],
              },
            },
          ],
        }),
      );
      assert.deepEqual(
        result.findings.map(({code, path: at, message}) => [code, at, message]),
        [
          [
            'VALIDATION_FAILED',
            `${COMPONENTS}/1/@accessibility`,
            'must NOT have unevaluated properties: @accessibility',
          ],
          [
            'VALIDATION_FAILED',
            `${COMPONENTS}/1/@checks`,
            'must NOT have unevaluated properties: @checks',
          ],
        ],
        version,
      );
      assert.deepEqual(result.legacyForm, [], version);
    }
  });
});
