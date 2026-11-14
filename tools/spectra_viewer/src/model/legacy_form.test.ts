import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  legacyByStep,
  legacyComponentCount,
  legacyEntriesOf,
  legacyKeysByPath,
  legacyKeysOfNode,
  legacyLinesOf,
} from './legacy_form.ts';
import type {LegacyFormEntry, Turn, TurnRecordEvent} from './record.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';

const V10_BASIC = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const TRACE = '0'.repeat(32);
const START = 1792800000000000000n;

function at(ms: number): string {
  return String(START + BigInt(ms) * 1_000_000n);
}

/** The turn event, opening the turn. */
function turnEvent(): TurnRecordEvent {
  return {
    traceId: TRACE,
    spanId: 'a'.repeat(16),
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: at(0),
    endTimeUnixNano: at(10),
    attributes: {'a2ui.event.kind': 'turn', 'a2ui.turn.outcome': 'completed'},
  };
}

/** A delivery from the agent whose parts each hold one A2UI message. */
function delivery(n: number, ...messages: unknown[]): TurnRecordEvent {
  return {
    traceId: TRACE,
    spanId: String(n).repeat(16),
    parentSpanId: 'a'.repeat(16),
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: at(n),
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {
        role: 'assistant',
        parts: messages.map(content => ({type: 'a2ui', content})),
      },
    },
  };
}

/** The catalog check event, listing these entries, or carrying no attribute at all. */
function catalogCheck(entries: LegacyFormEntry[] | undefined): TurnRecordEvent {
  return {
    traceId: TRACE,
    spanId: 'c'.repeat(16),
    parentSpanId: 'a'.repeat(16),
    name: 'check',
    kind: 1,
    startTimeUnixNano: at(9),
    attributes: {
      'a2ui.event.kind': 'check',
      'a2ui.check.name': 'catalog',
      'a2ui.check.passed': true,
      'a2ui.check.protocol_version': 'v1.0',
      'a2ui.check.findings': [],
      'a2ui.check.skipped': [],
      ...(entries !== undefined && {'a2ui.check.legacy_form': entries}),
    },
  };
}

function entry(
  event: number,
  part: number,
  index: number,
  componentId: string,
  keys: string[],
  surfaceId = 'booking',
): LegacyFormEntry {
  return {
    surfaceId,
    componentId,
    keys,
    path: `/events/${event}/attributes/a2ui.wire.message/parts/${part}/content/updateComponents/components/${index}`,
  };
}

const required = (path: string) => [
  {condition: {'@call': 'required', args: {value: {'@path': path}}}, message: 'Needed.'},
];

const create = {version: '1.0', createSurface: {surfaceId: 'booking', catalogId: V10_BASIC}};

/** The stub agent's booking form's first components, `name` and `date` bare, the button bare. */
const bareForm = {
  version: '1.0',
  updateComponents: {
    surfaceId: 'booking',
    components: [
      {id: 'root', component: 'Column', children: ['name', 'date', 'submit']},
      {
        id: 'name',
        component: 'TextField',
        checks: required('/name'),
        label: 'Name',
        value: {'@path': '/name'},
      },
      {
        id: 'date',
        component: 'DateTimeInput',
        checks: required('/date'),
        label: 'Date',
        value: {'@path': '/date'},
      },
      {
        id: 'submit',
        component: 'Button',
        accessibility: {label: 'Book the table'},
        child: 'submit_label',
        action: {event: {name: 'book'}},
      },
      {id: 'submit_label', component: 'Text', text: 'Book'},
    ],
  },
};

/** The TextField sent again, in the `@` form. */
const nameAgain = {
  version: '1.0',
  updateComponents: {
    surfaceId: 'booking',
    components: [
      {
        id: 'name',
        component: 'TextField',
        '@checks': required('/name'),
        label: 'Name',
        value: {'@path': '/name'},
      },
    ],
  },
};

/**
 * A turn: the turn event, a delivery creating the surface and sending the
 * bare form, a second delivery sending the TextField again in the `@` form
 * and the button bare again, and the catalog check.
 */
function bookingTurn(entries?: LegacyFormEntry[]): Turn {
  const buttonAgain = {
    version: '1.0',
    updateComponents: {surfaceId: 'booking', components: [bareForm.updateComponents.components[3]]},
  };
  return {
    events: [
      turnEvent(),
      delivery(1, create, bareForm),
      delivery(2, nameAgain, buttonAgain),
      catalogCheck(
        entries ?? [
          entry(1, 1, 1, 'name', ['checks']),
          entry(1, 1, 2, 'date', ['checks']),
          entry(1, 1, 3, 'submit', ['accessibility']),
          entry(2, 1, 0, 'submit', ['accessibility']),
        ],
      ),
    ],
  };
}

describe('the legacy form', () => {
  it('reads a catalog check event without the attribute as one with no entry', () => {
    const turn = bookingTurn();
    turn.events[3] = catalogCheck(undefined);
    assert.deepEqual(legacyEntriesOf(turn.events), []);
  });

  it('counts distinct components: one sent twice in the legacy form counts once', () => {
    const entries = legacyEntriesOf(bookingTurn().events);
    assert.equal(entries.length, 4);
    assert.equal(legacyComponentCount(entries), 3);
    // The same id on another surface is another component.
    assert.equal(
      legacyComponentCount([...entries, entry(1, 1, 1, 'name', ['checks'], 'other')]),
      4,
    );
  });

  it('counts each step’s own components, names its keys in the order they first appear, and points at each bare key', () => {
    const {events} = bookingTurn([
      // Listed out of order: the step reads its components top to bottom.
      entry(1, 1, 3, 'submit', ['accessibility']),
      entry(1, 1, 1, 'name', ['checks']),
      entry(1, 1, 2, 'date', ['checks', 'metadata']),
      entry(2, 1, 0, 'submit', ['accessibility']),
    ]);
    const rows = timelineOf(events, Number(START / 1_000_000n));
    const steps = legacyByStep(events, rows, legacyEntriesOf(events));
    const stepOf = (target: string) =>
      rows.find(row => row.row === 'step' && row.target === target)!;
    const first = steps.get(stepOf('booking · 5 components').id);
    assert.deepEqual(first, {
      count: 3,
      keys: ['checks', 'metadata', 'accessibility'],
      paths: [
        '/updateComponents/components/1/checks',
        '/updateComponents/components/2/checks',
        '/updateComponents/components/2/metadata',
        '/updateComponents/components/3/accessibility',
      ],
    });
    // The second delivery's button is its own step's: the steps' numbers add up to more than the turn's.
    const buttons = [...steps.values()].filter(step => step !== first);
    assert.deepEqual(buttons, [
      {count: 1, keys: ['accessibility'], paths: ['/updateComponents/components/0/accessibility']},
    ]);
    assert.equal(legacyComponentCount(legacyEntriesOf(events)), 3);
  });

  it('words the detail’s lines by the number of components and of keys', () => {
    const text = (count: number, keys: string[]) => {
      const {first, second} = legacyLinesOf(count, keys);
      return [
        first.lead + first.keys.join(', '),
        second.lead + second.keys.join(', ') + second.after,
      ];
    };
    assert.deepEqual(text(1, ['checks']), [
      '1 component carries a bare envelope key, the legacy form: checks',
      'The v1.0 form is @checks. The bare key is accepted during upstream’s transition.',
    ]);
    assert.deepEqual(text(1, ['checks', 'accessibility']), [
      '1 component carries bare envelope keys, the legacy form: checks, accessibility',
      'The v1.0 form is @checks, @accessibility. The bare keys are accepted during upstream’s transition.',
    ]);
    assert.deepEqual(text(3, ['checks']), [
      '3 components carry a bare envelope key, the legacy form: checks',
      'The v1.0 form is @checks. The bare key is accepted during upstream’s transition.',
    ]);
  });

  it('marks a node by its standing object: a component sent again with the @ key has the hourglass after the earlier step and none after the later', () => {
    const turn = bookingTurn();
    const keys = legacyKeysByPath(legacyEntriesOf(turn.events));
    const afterFirst = replay([], turn.events, {eventIndex: 1}).surfaces[0];
    const afterSecond = replay([], turn.events).surfaces[0];
    assert.deepEqual(legacyKeysOfNode(afterFirst, 'name', keys), ['checks']);
    assert.deepEqual(legacyKeysOfNode(afterFirst, 'submit', keys), ['accessibility']);
    assert.equal(legacyKeysOfNode(afterFirst, 'root', keys), undefined);
    assert.equal(legacyKeysOfNode(afterSecond, 'name', keys), undefined);
    // The button, sent bare again, keeps it; the date, not sent again, keeps it.
    assert.deepEqual(legacyKeysOfNode(afterSecond, 'submit', keys), ['accessibility']);
    assert.deepEqual(legacyKeysOfNode(afterSecond, 'date', keys), ['checks']);
  });

  it('marks no node standing from an earlier turn that this turn’s messages did not carry', () => {
    const earlier = bookingTurn();
    const later: Turn = {events: [turnEvent(), delivery(1, nameAgain), catalogCheck([])]};
    const keys = legacyKeysByPath(legacyEntriesOf(later.events));
    const [surface] = replay([earlier], later.events).surfaces;
    assert.equal(legacyKeysOfNode(surface, 'date', keys), undefined);
    assert.equal(legacyKeysOfNode(surface, 'name', keys), undefined);
    // Even with the earlier turn's entries at hand, an earlier object has no pointer into this turn.
    const earlierKeys = legacyKeysByPath(legacyEntriesOf(earlier.events));
    assert.equal(legacyKeysOfNode(surface, 'date', earlierKeys), undefined);
  });

  it('keeps each standing component as the message wrote it, where web core moves a bare key to the @ key', () => {
    const [surface] = replay([], bookingTurn().events, {eventIndex: 1}).surfaces;
    const written = surface.written?.get('name');
    assert.deepEqual(Object.keys(written!.object), ['id', 'component', 'checks', 'label', 'value']);
    assert.equal(
      written!.path,
      '/events/1/attributes/a2ui.wire.message/parts/1/content/updateComponents/components/1',
    );
    assert.ok('tree' in surface.structure);
    const stored = surface.structure.tree;
    const name = 'missing' in stored ? undefined : stored.children.find(node => node.id === 'name');
    assert.ok(name !== undefined && !('missing' in name));
    assert.ok('@checks' in name.properties && !('checks' in name.properties));
  });

  it('keeps no written object for a component whose message web core refused', () => {
    const both = structuredClone(bareForm);
    (both.updateComponents.components[1] as Record<string, unknown>)['@checks'] = required('/name');
    const [surface] = replay([], [turnEvent(), delivery(1, create, both)]).surfaces;
    assert.equal(surface.written, undefined);
    assert.equal(surface.rejectedUpdates, 1);
  });
});
