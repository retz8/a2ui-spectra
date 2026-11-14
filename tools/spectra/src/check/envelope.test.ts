/**
 * The differential test of the v1.0 envelope keys, and of the catalog a
 * function call inside a component runs in: each case is fed to web core's
 * message processor and to Spectra's catalog check, which must agree on
 * whether the component is accepted, on the key web core stored each bare
 * key's value under, and on the sentence of the rejection of both forms.
 * When upstream removes its fallback to the bare keys (issue #4082) and the
 * pin moves, the bare-key cases fail here, and Spectra removes its own.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import {BASIC_V1_0, pointer, testTurn, v1} from '../testing/turns.js';
import {checkCatalog} from './catalog_check.js';
import {feedConversation} from './conversation.js';
import {ENVELOPE_KEYS} from './envelope.js';

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
const CUSTOM = 'conformance/custom';
const ENVELOPE = 'spectra/envelope';

interface EnvelopeCase {
  name: string;
  /** The surface's catalog; the v1.0 basic catalog when not given. */
  surfaceCatalog?: string;
  /** The component, `root`, the one `updateComponents` carries. */
  component: Record<string, unknown>;
}

const rule = (path: string) => ({
  condition: {'@call': 'required', args: {value: {'@path': path}}},
  message: 'Required.',
});
/** A check rule whose condition is a binding, for a catalog that defines no functions. */
const bound = (path: string) => ({condition: {'@path': path}, message: 'Required.'});
const text = (extra: Record<string, unknown>) => ({
  id: 'root',
  component: 'Text',
  text: 'Hi',
  ...extra,
});
const field = (extra: Record<string, unknown>) => ({
  id: 'root',
  component: 'TextField',
  label: 'Name',
  value: {'@path': '/name'},
  ...extra,
});

const CASES: EnvelopeCase[] = [
  {name: 'the @ accessibility', component: text({'@accessibility': {label: 'Hi'}})},
  {name: 'a bare accessibility', component: text({accessibility: {label: 'Hi'}})},
  {
    name: 'accessibility in both forms',
    component: text({accessibility: {label: 'Hi'}, '@accessibility': {label: 'Hi'}}),
  },
  {name: 'a bare accessibility of null', component: text({accessibility: null})},
  {
    name: 'accessibility of null in both forms',
    component: text({accessibility: null, '@accessibility': {label: 'Hi'}}),
  },
  {name: 'a bare accessibility of the wrong shape', component: text({accessibility: {label: 3}})},
  {name: 'the @ metadata', component: text({'@metadata': {extensions: {note: 'x'}}})},
  {name: 'a bare metadata', component: text({metadata: {extensions: {note: 'x'}}})},
  {name: 'metadata in both forms', component: text({metadata: {}, '@metadata': {}})},
  {name: 'the @ checks', component: field({'@checks': [rule('/name')]})},
  {name: 'a bare checks', component: field({checks: [rule('/name')]})},
  {name: 'checks in both forms', component: field({checks: [rule('/name')], '@checks': []})},
  {
    name: 'a bare checks with a call missing its arguments',
    component: field({checks: [{condition: {'@call': 'required', args: {}}}]}),
  },
  {name: 'a bare checks on a component that takes none', component: text({checks: []})},
  {name: 'the @ checks on a component that takes none', component: text({'@checks': []})},
  {
    name: 'the @ catalogId',
    component: {id: 'root', component: 'Chart', '@catalogId': CUSTOM, values: [1]},
  },
  {
    name: 'a bare catalogId',
    component: {id: 'root', component: 'Chart', catalogId: CUSTOM, values: [1]},
  },
  {
    name: 'catalogId in both forms',
    component: {
      id: 'root',
      component: 'Chart',
      catalogId: CUSTOM,
      '@catalogId': CUSTOM,
      values: [1],
    },
  },
  {
    name: "a call in a component of another catalog, running in the surface's",
    component: {
      id: 'root',
      component: 'Chart',
      '@catalogId': CUSTOM,
      values: [1],
      caption: {'@call': 'formatString', args: {value: 'Hi'}},
    },
  },
  {
    name: 'a call naming its catalog, its arguments judged there',
    component: text({
      text: {'@call': 'percent', catalogId: CUSTOM, args: {value: 'half'}},
    }),
  },
  {
    name: "a bare metadata the component's schema declares",
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Tag', label: 'New', metadata: 'Free text.'},
  },
  {
    name: "a bare metadata the component's schema declares, beside the @ metadata",
    surfaceCatalog: ENVELOPE,
    component: {
      id: 'root',
      component: 'Tag',
      label: 'New',
      metadata: 'Free text.',
      '@metadata': {},
    },
  },
  {
    name: "a bare catalogId the component's schema in the surface's catalog declares",
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Pin', catalogId: CUSTOM},
  },
  {
    name: "a bare catalogId routing to a catalog whose schema declares one, the surface's not",
    component: {id: 'root', component: 'Pin', catalogId: ENVELOPE},
  },
  {
    name: "a bare checks the component's schema declares, beside the @ checks",
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Poll', question: 'Yes?', checks: 3, '@checks': []},
  },
  {
    name: 'a bare checks the schema declares as check rules',
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Rule', text: 'Hi', checks: [bound('/x')]},
  },
  {
    name: 'the @ checks where the schema declares them under the bare name',
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Rule', text: 'Hi', '@checks': [bound('/x')]},
  },
  {
    name: 'checks in both forms where the schema declares them under the bare name',
    surfaceCatalog: ENVELOPE,
    component: {id: 'root', component: 'Rule', text: 'Hi', checks: [], '@checks': []},
  },
];

describe('the v1.0 envelope keys, web core and the catalog check', () => {
  let registry: CatalogRegistry;
  before(async () => {
    registry = await CatalogRegistry.load([
      path.join(CATALOGS, 'custom_catalog_v1_0.json'),
      path.join(CATALOGS, 'envelope_catalog_v1_0.json'),
    ]);
  });

  for (const c of CASES) {
    it(`agree on ${c.name}`, () => {
      const turn = testTurn({
        messages: [
          v1.createSurface('s', c.surfaceCatalog ?? BASIC_V1_0),
          v1.updateComponents('s', [c.component]),
        ],
      });
      const conversation = feedConversation(turn, [], registry);
      try {
        const rejection = conversation.own[1].rejection;
        const result = checkCatalog(conversation);
        const at = `${pointer(1)}/updateComponents/components/0`;
        const findings = result.findings.filter(({path: where}) => where?.startsWith(at));
        const listed = result.legacyForm?.find(entry => entry.path === at)?.keys ?? [];
        assert.equal(
          findings.length === 0,
          rejection === undefined,
          `web core ${rejection === undefined ? 'accepted' : `rejected: ${rejection.message}`}; the catalog check found ${JSON.stringify(findings)}`,
        );
        const both = /^Component '.*' cannot specify both '@(\w+)' and legacy '\w+'\.$/.exec(
          rejection?.message ?? '',
        );
        if (both !== null) {
          assert.ok(
            findings.some(
              finding =>
                finding.code === 'VALIDATION_FAILED' &&
                finding.message === rejection?.message &&
                finding.path === `${at}/${both[1]}`,
            ),
            `the catalog check reports web core's sentence at the bare key: ${JSON.stringify(findings)}`,
          );
        }
        if (rejection !== undefined) return;
        const model = conversation.surfaces.get('s')?.componentsModel.get('root');
        assert.ok(model);
        const properties = model.properties as Record<string, unknown>;
        for (const key of ENVELOPE_KEYS) {
          if (!Object.hasOwn(c.component, key)) continue;
          // A bare key web core read as the envelope key is gone from the properties.
          const stored = Object.hasOwn(properties, key) ? key : `@${key}`;
          assert.equal(
            listed.includes(key) ? `@${key}` : key,
            stored,
            `the bare ${key}: web core stored it under ${stored}`,
          );
          if (stored === '@metadata') assert.deepEqual(model.metadata, c.component.metadata);
          if (stored === '@catalogId') assert.equal(model.catalog.id, c.component.catalogId);
          if (stored === '@accessibility' || stored === '@checks') {
            assert.deepEqual(properties[stored], c.component[key]);
          }
        }
      } finally {
        conversation.dispose();
      }
    });
  }
});
