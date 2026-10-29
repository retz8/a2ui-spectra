import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  type ActionMessage,
  componentTypeOf,
  dataModelKeyOf,
  dataModelMapOf,
  dataModelVersionOf,
  foldedAtFirst,
  shownMessageOf,
} from './host_message.ts';
import type {Turn, TurnRecordEvent} from './record.ts';
import {replay, type SurfaceView} from './replay.ts';

const V09_BASIC = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const V10_BASIC = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

/** A turn whose one wire output holds these A2UI messages as an array. */
function turnOf(...messages: unknown[]): Turn {
  const event: TurnRecordEvent = {
    traceId: '0'.repeat(32),
    spanId: '1'.repeat(16),
    parentSpanId: '2'.repeat(16),
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {role: 'assistant', parts: [{type: 'a2ui', content: messages}]},
    },
  };
  return {events: [event]};
}

/** A v0.9.1 conversation: a form that asks for its data model, a notice that does not, and a deleted one that did. */
function surfaces(): SurfaceView[] {
  const version = 'v0.9.1';
  const created = (surfaceId: string, sendDataModel: boolean) => ({
    version,
    createSurface: {surfaceId, catalogId: V09_BASIC, ...(sendDataModel && {sendDataModel})},
  });
  const components = (surfaceId: string) => ({
    version,
    updateComponents: {
      surfaceId,
      components: [
        {id: 'root', component: 'Column', children: ['name', 'send']},
        {id: 'name', component: 'TextField', label: 'Name', value: {path: '/name'}},
        {id: 'send', component: 'Button', child: 'label', action: {event: {name: 'send'}}},
        {id: 'label', component: 'Text', text: 'Send'},
      ],
    },
  });
  const earlier = turnOf(
    created('form', true),
    components('form'),
    {version, updateDataModel: {surfaceId: 'form', path: '/name', value: 'Ada'}},
    created('notice', false),
    created('gone', true),
  );
  const own = turnOf({version, deleteSurface: {surfaceId: 'gone'}});
  return replay([earlier], own.events).surfaces;
}

const action: ActionMessage = {
  version: 'v0.9.1',
  action: {
    name: 'send',
    surfaceId: 'form',
    sourceComponentId: 'send',
    timestamp: '2026-10-29T10:00:00.000Z',
    context: {},
  },
};

describe('the host message', () => {
  it("replays each surface's version and whether it asked for its data model", () => {
    assert.deepEqual(
      surfaces().map(({surfaceId, sendDataModel, version}) => ({
        surfaceId,
        sendDataModel,
        version,
      })),
      [
        {surfaceId: 'form', sendDataModel: true, version: 'v0.9.1'},
        {surfaceId: 'notice', sendDataModel: undefined, version: 'v0.9.1'},
      ],
    );
  });

  it('sends the data model of every live surface that asked for it, the shown one from the page', () => {
    const replayed = surfaces();
    assert.deepEqual(dataModelMapOf(replayed, 'v0.9.1'), {
      version: 'v0.9.1',
      surfaces: {form: {name: 'Ada'}},
    });
    assert.deepEqual(
      dataModelMapOf(replayed, 'v0.9.1', {surfaceId: 'form', dataModel: {name: 'Ada Lovelace'}}),
      {version: 'v0.9.1', surfaces: {form: {name: 'Ada Lovelace'}}},
    );
    assert.equal(dataModelMapOf(replayed, 'v1.0'), undefined, 'A v0.9.1 surface is not v1.0.');
    assert.equal(
      dataModelMapOf(
        replayed.filter(surface => surface.surfaceId === 'notice'),
        'v0.9.1',
      ),
      undefined,
      'No surface asked for it.',
    );
    assert.equal(dataModelVersionOf(replayed), 'v0.9.1');
  });

  it('puts the data model under its version’s key', () => {
    assert.equal(dataModelKeyOf('v0.9'), 'a2uiClientDataModel');
    assert.equal(dataModelKeyOf('v0.9.1'), 'a2uiClientDataModel');
    assert.equal(dataModelKeyOf('v1.0'), 'a2uiRendererDataModel');
  });

  it("shows the action in the record's form, its content the message in A2A 0.3 and a list in 1.0", () => {
    const dataModel = {version: 'v0.9.1', surfaces: {form: {name: 'Ada'}}};
    assert.deepEqual(shownMessageOf(action, dataModel, '0.3'), {
      role: 'user',
      parts: [{type: 'a2ui', content: action}],
      metadata: {a2uiClientDataModel: dataModel},
    });
    assert.deepEqual(shownMessageOf(action, undefined, '1.0'), {
      role: 'user',
      parts: [{type: 'a2ui', content: [action]}],
    });
    assert.deepEqual(foldedAtFirst(dataModel), ['/metadata/a2uiClientDataModel/surfaces/form']);
    assert.deepEqual(foldedAtFirst(undefined), []);
  });

  it("names the pressed component's type from the surface's tree", () => {
    const [form] = surfaces();
    assert.equal(componentTypeOf(form, 'send'), 'Button');
    assert.equal(componentTypeOf(form, 'nowhere'), undefined);
    assert.equal(componentTypeOf(undefined, 'send'), undefined);
  });

  it("takes v1.0's surfaces under v1.0", () => {
    const own = turnOf(
      {version: 'v1.0', createSurface: {surfaceId: 'a', catalogId: V10_BASIC, sendDataModel: true}},
      {version: 'v1.0', updateDataModel: {surfaceId: 'a', path: '/n', value: 1}},
    );
    assert.deepEqual(dataModelMapOf(replay([], own.events).surfaces, 'v1.0'), {
      version: 'v1.0',
      surfaces: {a: {n: 1}},
    });
  });
});
