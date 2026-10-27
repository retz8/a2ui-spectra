import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn} from '../record/turn_record.js';
import {
  createSurface,
  pointer,
  testTurn,
  updateComponents,
  updateDataModel,
  v1,
} from '../testing/turns.js';
import {checkBinding} from './binding_check.js';
import type {CheckResult} from './check_event.js';
import {feedConversation} from './conversation.js';

function run(turn: Turn, earlier: Turn[] = []): CheckResult {
  const conversation = feedConversation(turn, earlier);
  try {
    return checkBinding(conversation);
  } finally {
    conversation.dispose();
  }
}

const COMPONENTS = `${pointer(1)}/updateComponents/components`;

describe('the binding check', () => {
  it('reports a bound path with no value, and counts a present key as a value whatever it holds', () => {
    const form = (value: unknown) =>
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: ['f']},
            {id: 'f', component: 'TextField', label: 'Diet', value: {path: '/dietary'}},
          ]),
          updateDataModel('s', value),
        ],
      });
    assert.deepEqual(run(form({party: '2'})), {
      findings: [
        {
          code: 'BINDING_PATH_UNFILLED',
          surfaceId: 's',
          path: `${COMPONENTS}/1/value`,
          message: 'The data model has no value at /dietary.',
        },
      ],
      skipped: [],
    });
    assert.deepEqual(run(form({dietary: ''})).findings, []);
    assert.deepEqual(run(form({dietary: null})).findings, []);
  });

  it("finds bindings in v1.0's shape, in an action's context and user message, and inside a function call's arguments", () => {
    const result = run(
      testTurn({
        messages: [
          v1.createSurface('s'),
          v1.updateComponents('s', [
            {id: 'root', component: 'Column', children: ['t', 'b', 'f']},
            {id: 't', component: 'Text', text: {'@path': '/title'}},
            {
              id: 'b',
              component: 'Button',
              child: 't',
              action: {
                event: {
                  name: 'go',
                  userMessage: {'@path': '/said'},
                  context: {who: {'@path': '/who'}, fixed: 'yes'},
                },
              },
            },
            {
              id: 'f',
              component: 'TextField',
              label: 'Name',
              value: {'@path': '/name'},
              checks: [
                {
                  condition: {'@call': 'required', args: {value: {'@path': '/name'}}},
                  message: 'Required',
                },
              ],
            },
          ]),
          v1.updateDataModel('s', {title: 'Hi', name: ''}),
        ],
      }),
    );
    assert.deepEqual(
      result.findings.map(({path: at, message}) => [at, message]),
      [
        [`${COMPONENTS}/2/action/event/context/who`, 'The data model has no value at /who.'],
        [`${COMPONENTS}/2/action/event/userMessage`, 'The data model has no value at /said.'],
      ],
    );
  });

  it("resolves a template's bindings against each item, and names how many items lack one", () => {
    const list = (items: unknown) =>
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: {componentId: 'item', path: '/items'}},
            {id: 'item', component: 'Text', text: {path: 'name'}},
          ]),
          updateDataModel('s', {items}),
        ],
      });
    assert.deepEqual(run(list([{name: 'a'}, {other: 1}, {other: 2}])).findings, [
      {
        code: 'BINDING_PATH_UNFILLED',
        surfaceId: 's',
        path: `${COMPONENTS}/1/text`,
        message: 'The data model has no value at name in 2 of 3 items, the first at /items/1/name.',
      },
    ]);
    assert.deepEqual(run(list([{name: 'a'}, {name: 'b'}])).findings, []);
    assert.deepEqual(run(list([])).findings, []);
    assert.deepEqual(run(list('not a list')).findings, [
      {
        code: 'BINDING_LIST_NOT_ARRAY',
        surfaceId: 's',
        path: `${COMPONENTS}/0/children/path`,
        message:
          "The data model's value at /items is not a list, so the template 'item' draws no items.",
      },
    ]);
    const missing = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Column', children: {componentId: 'item', path: '/items'}},
            {id: 'item', component: 'Text', text: {path: 'name'}},
          ]),
        ],
      }),
    );
    assert.deepEqual(missing.findings, [
      {
        code: 'BINDING_PATH_UNFILLED',
        surfaceId: 's',
        path: `${COMPONENTS}/0/children/path`,
        message: 'The data model has no value at /items.',
      },
    ]);
  });

  it('resolves a relative path outside a template against the root', () => {
    const result = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [{id: 'root', component: 'Text', text: {path: 'title'}}]),
          updateDataModel('s', {title: 'Hi'}),
        ],
      }),
    );
    assert.deepEqual(result.findings, []);
  });

  it('gives a finding on a component an earlier turn carried no path, naming the component', () => {
    const earlier = testTurn({
      messages: [
        createSurface('s'),
        updateComponents('s', [{id: 'root', component: 'Text', text: {path: '/title'}}]),
        updateDataModel('s', {title: 'Hi'}),
      ],
    });
    assert.deepEqual(run(earlier).findings, []);
    const later = testTurn({messages: [updateDataModel('s', {other: 1})]});
    assert.deepEqual(run(later, [earlier]).findings, [
      {
        code: 'BINDING_PATH_UNFILLED',
        surfaceId: 's',
        message:
          "The data model has no value at /title, bound by the component 'root' in the surface 's'.",
      },
    ]);
  });

  it('skips a surface whose catalog has no definition and one never created, and leaves an unreachable component alone', () => {
    const unknown = run(
      testTurn({
        messages: [
          createSurface('s', 'example.com:unknown'),
          updateComponents('s', [{id: 'root', component: 'Thing', text: {path: '/nope'}}]),
        ],
      }),
    );
    assert.deepEqual(unknown, {
      findings: [],
      skipped: [{surfaceId: 's', catalogId: 'example.com:unknown', reason: 'no_definition'}],
    });
    const never = run(testTurn({messages: [updateDataModel('ghost', {a: 1})]}));
    assert.deepEqual(never, {findings: [], skipped: [{surfaceId: 'ghost', reason: 'not_created'}]});
    const orphan = run(
      testTurn({
        messages: [
          createSurface('s'),
          updateComponents('s', [
            {id: 'root', component: 'Text', text: 'Hi'},
            {id: 'lost', component: 'Text', text: {path: '/nope'}},
          ]),
        ],
      }),
    );
    assert.deepEqual(orphan.findings, []);
  });
});
