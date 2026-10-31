import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {ListedTurn} from '../api.ts';
import type {SurfaceView} from '../model/replay.ts';
import {keepsPending, type PendingAction, pendingOf, type Press} from './press.ts';
import {actionRefusalOf, composerOf} from './selectors.ts';
import type {SpectraState} from './spectra.ts';

function stateOf(turns: ListedTurn[], live: SpectraState['live'] = new Map()): SpectraState {
  return {
    loaded: true,
    turns,
    live,
    closed: new Map(),
    records: new Map(),
    box: {conversations: [{conversationId: 'c', turns: ['a', 'b']}]},
  };
}

const row = (traceId: string, conversationId?: string): ListedTurn => ({
  traceId,
  startTime: '2026-10-24T09:00:00.000Z',
  ...(conversationId !== undefined && {conversationId}),
});

/** A surface as the replay gives it: a Button under its root. */
function surfaceOf(surfaceId: string, dataModel: unknown, fields: Partial<SurfaceView> = {}) {
  const view: SurfaceView = {
    surfaceId,
    touched: true,
    structure: {
      tree: {
        id: 'root',
        type: 'Column',
        properties: {},
        children: [{id: 'book', type: 'Button', properties: {}, children: []}],
      },
      notUnderRoot: [],
    },
    dataModel,
    ...fields,
  };
  return view;
}

function pressIn(context: Press['context'], dataModel: unknown = {partySize: 4}): Press {
  return {
    action: {
      name: 'book',
      surfaceId: 'booking',
      sourceComponentId: 'book',
      timestamp: '2026-10-29T10:00:00.000Z',
      context: {restaurantName: 'Han Dynasty'},
    },
    dataModel,
    context,
  };
}

describe('a press', () => {
  it("puts the action in its surface's version in the composer, with every surface's data model that asked, the pressed one from the page", () => {
    const pending = pendingOf(
      pressIn({
        traceId: 'b',
        stepId: 'step-3',
        version: 'v0.9',
        surfaces: [
          surfaceOf('booking', {partySize: 2}, {sendDataModel: true, version: 'v0.9.1'}),
          surfaceOf('cart', {items: 1}, {sendDataModel: true, version: 'v0.9.1'}),
          surfaceOf('notice', {seen: true}, {version: 'v0.9.1'}),
        ],
      }),
    );
    assert.deepEqual(pending, {
      traceId: 'b',
      stepId: 'step-3',
      componentType: 'Button',
      message: {
        version: 'v0.9.1',
        action: {
          name: 'book',
          surfaceId: 'booking',
          sourceComponentId: 'book',
          timestamp: '2026-10-29T10:00:00.000Z',
          context: {restaurantName: 'Han Dynasty'},
        },
      },
      dataModel: {version: 'v0.9.1', surfaces: {booking: {partySize: 4}, cart: {items: 1}}},
    });
  });

  it('carries no data model when no surface asked for it, and keeps the render it was pressed in', () => {
    const earlier = pendingOf(
      pressIn({traceId: 'a', stepId: 'step-1', surfaces: [surfaceOf('booking', {})]}),
    );
    assert.equal(earlier.dataModel, undefined);
    assert.equal(earlier.traceId, 'a');
    assert.equal(earlier.stepId, 'step-1');
    assert.equal(earlier.message.version, 'v0.9', 'With no version known, it is v0.9.');
  });
});

describe('keepsPending', () => {
  const pending: PendingAction = pendingOf(pressIn({traceId: 'b', surfaces: []}));
  const turns = [row('d', 'other'), row('b', 'c'), row('a', 'c')];

  it('keeps the action across the turns of its conversation', () => {
    assert.ok(keepsPending(stateOf(turns), pending, {traceId: 'b'}));
    assert.ok(keepsPending(stateOf(turns), pending, {traceId: 'a'}));
  });

  it('drops it with a turn of another conversation, a new conversation or no turn in view', () => {
    assert.ok(!keepsPending(stateOf(turns), pending, {traceId: 'd'}));
    assert.ok(!keepsPending(stateOf(turns), pending, {traceId: 'b', startsNew: true}));
    assert.ok(!keepsPending(stateOf(turns), pending, {}));
  });

  it('reads an open turn’s conversation from the live stream', () => {
    const live = new Map([
      [
        'e',
        {
          traceId: 'e',
          conversationId: 'c',
          startTime: '2026-10-24T09:01:00.000Z',
          events: [],
          wire: [],
          calls: new Map(),
        },
      ],
    ]);
    assert.ok(keepsPending(stateOf(turns, live), pending, {traceId: 'e'}));
  });
});

describe('actionRefusalOf', () => {
  it('sends an action only in a conversation the box started and the agent named', () => {
    const state = stateOf([row('b', 'c'), row('x', 'elsewhere')]);
    assert.equal(actionRefusalOf(composerOf(state, {traceId: 'b'}).target), undefined);
    assert.equal(
      actionRefusalOf(composerOf(state, {traceId: 'x'}).target),
      'Started by another host or in an earlier run · an action can only be sent in a conversation the message box started',
    );
    assert.equal(
      actionRefusalOf({kind: 'unnamed'}),
      'The agent named no conversation · an action can only be sent in a conversation the agent named',
    );
  });

  it('holds while a turn is open in the conversation, as text does', () => {
    const state = stateOf([row('b', 'c')]);
    state.box = {conversations: [{conversationId: 'c', turns: ['b'], openTurn: 'b'}]};
    assert.equal(composerOf(state, {traceId: 'b'}).waiting, 'A turn is open');
  });
});
