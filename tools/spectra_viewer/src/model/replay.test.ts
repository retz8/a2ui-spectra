import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {messageKey} from './messages.ts';
import type {Turn, TurnRecordEvent} from './record.ts';
import {
  type ComponentNode,
  replay,
  replayRecord,
  type SurfaceView,
  type TreeNode,
} from './replay.ts';

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

/** A tree as `type#id` lines, children indented. */
function outline(node: TreeNode, depth = 0): string[] {
  const line =
    '  '.repeat(depth) + ('missing' in node ? `missing ${node.id}` : `${node.type}#${node.id}`);
  return 'missing' in node
    ? [line]
    : [line, ...node.children.flatMap(child => outline(child, depth + 1))];
}

/** A surface's tree, failing when the surface is not nested. */
function nested(surface: SurfaceView): {tree: TreeNode; notUnderRoot: ComponentNode[]} {
  assert.ok('tree' in surface.structure, `${surface.surfaceId} is not nested`);
  return surface.structure;
}

/** A surface's components as `type#id`, failing when the surface is nested. */
function unnested(surface: SurfaceView): string[] {
  assert.ok('unnested' in surface.structure, `${surface.surfaceId} is nested`);
  return surface.structure.unnested.map(node => `${node.type}#${node.id}`);
}

describe('replay', () => {
  it("builds the booking wizard's second turn on the surface its first turn created", () => {
    const result = replayRecord(readRecording('strathweb_booking_wizard/send_then_stream'));
    assert.deepEqual(result.rejections, []);
    assert.deepEqual(
      result.surfaces.map(({surfaceId, catalogId, touched}) => ({surfaceId, catalogId, touched})),
      [{surfaceId: 'table_booking', catalogId: V09_BASIC, touched: true}],
    );
    const [surface] = result.surfaces;
    const {tree, notUnderRoot} = nested(surface);
    assert.deepEqual(outline(tree).slice(0, 2), ['Card#root', '  Column#wizard']);
    // The second step replaces the step's children; the first step's components stay behind.
    assert.deepEqual(
      notUnderRoot.map(node => node.id),
      ['textField_1', 'slider_1', 'choicePicker_1', 'button_1'],
    );
    assert.equal((surface.dataModel as {step: number}).step, 2);
  });

  it("lists the TypeScript restaurant finder's second createSurface of stub-notice as rejected", () => {
    const result = replayRecord(readRecording('node_restaurant_finder/stream_v1_0_booking'));
    assert.deepEqual(result.rejections, [
      {
        key: messageKey(3, 0),
        surfaceId: 'stub-notice',
        code: 'INTEGRITY_ERROR',
        message: 'Surface stub-notice already exists.',
      },
    ]);
  });

  it('puts the surfaces the turn touched first, then the others as not changed', () => {
    const result = replayRecord(readRecording('node_restaurant_finder/stream_v1_0_booking'));
    assert.deepEqual(
      result.surfaces.map(({surfaceId, catalogId, touched}) => ({surfaceId, catalogId, touched})),
      [
        {surfaceId: 'stub-notice', catalogId: V10_BASIC, touched: true},
        {surfaceId: 'confirmation', catalogId: V10_BASIC, touched: true},
        {surfaceId: 'default', catalogId: V10_BASIC, touched: false},
      ],
    );
  });

  it("lists only the turn's own rejections, not those of earlier turns", () => {
    const result = replayRecord(readRecording('angular_client/python_restaurant_finder_booking'));
    assert.deepEqual(
      result.rejections.map(({surfaceId, message}) => ({surfaceId, message})),
      [{surfaceId: 'confirmation', message: 'Surface confirmation already exists.'}],
    );
    assert.deepEqual(
      result.surfaces.map(({surfaceId, touched}) => ({surfaceId, touched})),
      [
        {surfaceId: 'confirmation', touched: true},
        {surfaceId: 'default', touched: false},
        {surfaceId: 'booking-form', touched: false},
      ],
    );
  });

  it('lists the components of a surface on a catalog that is not basic unnested, in the order they came', () => {
    const result = replay(
      [],
      readRecording('a2uiverse_circleci/runs_then_confirm_rerun').turns[0].events,
    );
    assert.deepEqual(result.rejections, []);
    const [surface] = result.surfaces;
    assert.equal(surface.surfaceId, 'circleci-1');
    assert.equal(
      surface.catalogId,
      'https://github.com/retz8/a2uiverse-apps/blob/main/circleci/circleci-catalog/catalogs/v0.9.1/catalog.json',
    );
    const components = unnested(surface);
    assert.equal(components.length, 16);
    assert.deepEqual(components.slice(0, 4), [
      'Panel#root',
      'Stack#body',
      'Heading#heading',
      'List#run-list',
    ]);
  });

  it('lists a basic surface unnested once a v1.0 component names a catalog that is not basic', () => {
    const result = replay(
      [],
      turnOf(
        {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: V10_BASIC}},
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's',
            components: [
              {id: 'root', component: 'Gauge', catalogId: 'https://example.com/gauges.json'},
            ],
          },
        },
      ).events,
    );
    assert.deepEqual(result.rejections, []);
    assert.deepEqual(unnested(result.surfaces[0]), ['Gauge#root']);
  });

  it('shows a child id with no component as missing, and components no parent reaches apart', () => {
    const result = replay(
      [],
      turnOf(
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: V09_BASIC}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [
              {id: 'root', component: 'Column', children: ['title', 'gone']},
              {id: 'title', component: 'Text', text: 'Hello'},
              {id: 'stray', component: 'Card', child: 'stray-text'},
              {id: 'stray-text', component: 'Text', text: 'Nobody shows me'},
            ],
          },
        },
      ).events,
    );
    assert.deepEqual(result.rejections, []);
    const {tree, notUnderRoot} = nested(result.surfaces[0]);
    assert.deepEqual(outline(tree), ['Column#root', '  Text#title', '  missing gone']);
    assert.deepEqual(
      notUnderRoot.flatMap(node => outline(node)),
      ['Card#stray', '  Text#stray-text'],
    );
    assert.deepEqual('missing' in tree ? undefined : tree.children[0], {
      id: 'title',
      type: 'Text',
      properties: {text: 'Hello'},
      children: [],
    });
  });

  it('shows a missing root as missing, with every component apart', () => {
    const result = replay(
      [],
      turnOf(
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: V09_BASIC}},
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'title', component: 'Text', text: 'Hi'}],
          },
        },
      ).events,
    );
    const {tree, notUnderRoot} = nested(result.surfaces[0]);
    assert.deepEqual(outline(tree), ['missing root']);
    assert.deepEqual(
      notUnderRoot.flatMap(node => outline(node)),
      ['Text#title'],
    );
  });

  it('lists a surface the turn deleted apart from the live ones', () => {
    const create = {version: 'v0.9', createSurface: {surfaceId: 'old', catalogId: V09_BASIC}};
    const result = replay(
      [turnOf(create)],
      turnOf({version: 'v0.9', deleteSurface: {surfaceId: 'old'}}).events,
    );
    assert.deepEqual(result.surfaces, []);
    assert.deepEqual(result.deleted, ['old']);
    assert.deepEqual(result.rejections, []);
  });

  it('goes on after a rejected message', () => {
    const result = replay(
      [],
      turnOf(
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'nowhere',
            components: [{id: 'root', component: 'Text', text: 'Hi'}],
          },
        },
        {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: V09_BASIC}},
      ).events,
    );
    assert.deepEqual(
      result.rejections.map(({key, surfaceId, code}) => ({key, surfaceId, code})),
      [{key: messageKey(0, 0, 0), surfaceId: 'nowhere', code: 'INTEGRITY_ERROR'}],
    );
    assert.deepEqual(
      result.surfaces.map(surface => surface.surfaceId),
      ['s'],
    );
  });
});
