import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Report} from 'a2ui-spectra-preview';

import {readRecording} from '../testing/recordings.ts';
import {
  type PreviewPageState,
  previewProblemsOf,
  routeOf,
  surfaceFeedOf,
  targetOf,
} from './preview.ts';
import {turnProblemsOf} from './problems.ts';
import {isTurnEvent, unixMillis} from './record.ts';
import {replay} from './replay.ts';
import {timelineOf} from './steps.ts';

const BASIC_V0_9 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const BASIC_V0_9_1 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';
const BASIC_V1_0 = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const CUSTOM = 'https://example.com/catalogs/booking.json';

/** The built-in page as it says it is ready: the two basic catalogs and the alias. */
const BUILT_IN: PreviewPageState = {
  id: 'built-in',
  label: 'built-in',
  status: 'ready',
  claims: [
    {catalogId: BASIC_V0_9, protocolVersion: '0.9'},
    {catalogId: BASIC_V0_9_1, protocolVersion: '0.9'},
    {catalogId: BASIC_V1_0, protocolVersion: '1.0'},
  ],
};

function page(id: string, change: Partial<PreviewPageState>): PreviewPageState {
  return {id, label: id, status: 'ready', claims: [], ...change};
}

/** A recording's last turn with its timeline and the problems the viewer has of its own. */
function turnOf(name: string) {
  const {turns} = readRecording(name);
  const earlier = turns.slice(0, -1);
  const {events} = turns[turns.length - 1];
  const start = events.find(isTurnEvent);
  assert.ok(start);
  const timeline = timelineOf(events, unixMillis(start.startTimeUnixNano));
  const {problems} = turnProblemsOf(events, timeline, replay(earlier, events).rejections);
  const stepOf = (key: string) =>
    timeline.find(row => row.row === 'step' && row.messageKey === key)?.id;
  return {earlier, events, timeline, problems, stepOf};
}

describe('surfaceFeedOf', () => {
  it("lists the messages naming the surface, the earlier turns' first, then the turn's own up to the step", () => {
    const {turns} = readRecording('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf(turns.slice(0, -1), turns[1].events, {eventIndex: 4}, 'stub-notice');
    assert.deepEqual(
      feed.map(({key, message}) => [
        key,
        Object.keys(message as object).find(k => k !== 'version'),
      ]),
      [
        [undefined, 'createSurface'],
        [undefined, 'updateComponents'],
        ['3.0', 'createSurface'],
        ['3.1', 'updateComponents'],
      ],
    );
  });

  it("stops at the step's position", () => {
    const {turns} = readRecording('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf([], turns[0].events, {eventIndex: 5}, 'default');
    assert.deepEqual(
      feed.map(({key}) => key),
      ['4.2', '4.3', '5.0'],
    );
  });
});

describe('targetOf', () => {
  it("names the catalog and the version the surface's createSurface states", () => {
    const {turns} = readRecording('angular_client/python_restaurant_finder_booking');
    assert.deepEqual(targetOf(surfaceFeedOf([], turns[0].events, undefined, 'default')), {
      catalogIds: [BASIC_V0_9],
      protocolVersion: 'v0.9',
    });
  });

  it("adds the catalogs a v1.0 surface's components name of their own", () => {
    const feed = [
      {message: {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: BASIC_V1_0}}},
      {
        message: {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Booking', catalogId: CUSTOM}],
          },
        },
      },
    ];
    assert.deepEqual(targetOf(feed), {catalogIds: [BASIC_V1_0, CUSTOM], protocolVersion: 'v1.0'});
  });
});

describe('routeOf', () => {
  it('sends the basic catalogs of every version to the built-in page, the v0.9.1 alias by its claim', () => {
    for (const [catalogId, version] of [
      [BASIC_V0_9, 'v0.9'],
      [BASIC_V0_9, 'v0.9.1'],
      [BASIC_V0_9_1, 'v0.9.1'],
      [BASIC_V1_0, 'v1.0'],
    ]) {
      const route = routeOf([BUILT_IN], {catalogIds: [catalogId], protocolVersion: version});
      assert.equal(
        route.kind === 'page' && route.page.id,
        'built-in',
        `${catalogId} at ${version}`,
      );
    }
  });

  it("matches the version with web core's compatibility rule", () => {
    const route = routeOf([BUILT_IN], {catalogIds: [BASIC_V0_9], protocolVersion: 'v1.0'});
    assert.deepEqual(route, {kind: 'none', catalogId: BASIC_V0_9, unanswered: []});
  });

  it('gives the surface to the first configured page that claims it, the built-in page last', () => {
    const themed = page('http://localhost:5174/preview', {
      claims: [{catalogId: BASIC_V0_9, protocolVersion: '0.9'}],
    });
    const other = page('http://localhost:5175/preview', {
      claims: [{catalogId: CUSTOM, protocolVersion: '0.9'}],
    });
    const route = routeOf([other, themed, BUILT_IN], {
      catalogIds: [BASIC_V0_9],
      protocolVersion: 'v0.9',
    });
    assert.equal(route.kind === 'page' && route.page.id, themed.id);
  });

  it('holds the surface while a page ahead of the one that claims it has not answered yet', () => {
    const waiting = page('http://localhost:5174/preview', {status: 'waiting'});
    assert.deepEqual(
      routeOf([waiting, BUILT_IN], {catalogIds: [BASIC_V0_9], protocolVersion: 'v0.9'}),
      {kind: 'waiting'},
    );
  });

  it('names the catalog no page claims, and the pages that have not answered', () => {
    const unanswered = page('http://localhost:5174/preview', {status: 'unanswered'});
    const old = page('http://localhost:5175/preview', {status: 'mismatch', protocol: 2});
    const route = routeOf([unanswered, old, BUILT_IN], {
      catalogIds: [BASIC_V1_0, CUSTOM],
      protocolVersion: 'v1.0',
    });
    assert.deepEqual(route, {kind: 'none', catalogId: CUSTOM, unanswered: [unanswered, old]});
  });

  it('passes over a page that answered but does not claim the surface, and one that has not answered', () => {
    const custom = page('http://localhost:5174/preview', {
      claims: [{catalogId: CUSTOM, protocolVersion: '1.0'}],
    });
    const unanswered = page('http://localhost:5175/preview', {status: 'unanswered'});
    const route = routeOf([custom, unanswered, BUILT_IN], {
      catalogIds: [BASIC_V1_0],
      protocolVersion: 'v1.0',
    });
    assert.equal(route.kind === 'page' && route.page.id, 'built-in');
  });
});

describe('previewProblemsOf', () => {
  it("puts a component's failure on the step whose message last carried it, marking its line", () => {
    const {events, timeline, stepOf} = turnOf('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf([], events, undefined, 'confirmation');
    const report: Report = {
      kind: 'component',
      componentId: 'confirm_image',
      componentType: 'Image',
      error: 'TypeError: Failed to construct URL',
    };
    const {problems, folded, lines} = previewProblemsOf(
      [report],
      feed,
      'confirmation',
      timeline,
      [],
    );
    // 5.0 and 6.0 both carry the image; the later is the step that last carried it.
    assert.deepEqual(problems, [
      {
        stepId: stepOf('6.0'),
        sentence: 'Image confirm_image did not render.',
        code: 'TypeError: Failed to construct URL',
        note: 'Preview page · not recorded',
        surfaceId: 'confirmation',
        inner: '/updateComponents/components/3',
      },
    ]);
    assert.deepEqual(folded, []);
    assert.deepEqual(lines, ['Image confirm_image did not render.']);
  });

  it('puts a failure with no component, and one of a component from an earlier turn, on the last step', () => {
    const {earlier, events, timeline} = turnOf('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf(earlier, events, {eventIndex: 3}, 'stub-notice');
    const last = timeline[timeline.length - 1].id;
    const {problems} = previewProblemsOf(
      [
        {kind: 'component', error: 'Error: lost'},
        // The earlier turn's message carried it: this turn has no step for it.
        {kind: 'component', componentId: 'root', componentType: 'Text', error: 'Error: gone'},
      ],
      feed.slice(0, 2),
      'stub-notice',
      timeline,
      [],
    );
    assert.deepEqual(
      problems.map(({stepId, sentence}) => [stepId, sentence]),
      [
        [last, 'A component did not render.'],
        [last, 'Text root did not render.'],
      ],
    );
  });

  it("counts a refused message on its step, and folds it under the viewer's own problem there", () => {
    const {
      events,
      timeline,
      problems: own,
      stepOf,
    } = turnOf('angular_client/python_restaurant_finder_booking');
    // The booking's last turn: the confirmation, created twice, which the viewer's replay rejects.
    const feed = surfaceFeedOf([], events, undefined, 'confirmation');
    const duplicate = feed.findIndex(({key}) => key === '16.0');
    const update = feed.findIndex(({key}) => key === '17.0');
    const reports: Report[] = [
      {
        kind: 'refused',
        index: duplicate,
        code: 'INTEGRITY_ERROR',
        error: 'Surface confirmation already exists.',
      },
      {
        kind: 'refused',
        index: update,
        code: 'VALIDATION_ERROR',
        error: 'Invalid updateComponents message',
      },
    ];
    const {problems, folded, lines} = previewProblemsOf(
      reports,
      feed,
      'confirmation',
      timeline,
      own,
    );
    assert.deepEqual(folded, [
      {
        stepId: stepOf('16.0'),
        sentence: 'Surface confirmation already exists.',
        lead: 'The preview page also refused this message',
      },
    ]);
    assert.deepEqual(problems, [
      {
        stepId: stepOf('17.0'),
        sentence: 'The preview page refused this message.',
        code: 'VALIDATION_ERROR: Invalid updateComponents message',
        note: 'Preview page · not recorded',
        surfaceId: 'confirmation',
      },
    ]);
    assert.equal(lines.length, 2);
  });

  it("puts web core's error on the surface on the last step, folded when the viewer has a problem there", () => {
    const {events, timeline} = turnOf('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf([], events, undefined, 'confirmation');
    const last = timeline[timeline.length - 1].id;
    const report: Report = {
      kind: 'surface',
      code: 'UNRESOLVED_CHILD_REFERENCE',
      error:
        "Unresolved child reference 'x' at '/': no component with this id exists on the surface.",
    };
    const counted = previewProblemsOf([report], feed, 'confirmation', timeline, []);
    assert.deepEqual(counted.problems, [
      {
        stepId: last,
        sentence: report.error,
        code: 'UNRESOLVED_CHILD_REFERENCE · A2UI web core in the preview page',
        note: 'Preview page · not recorded',
        surfaceId: 'confirmation',
      },
    ]);
    const own = [{stepId: last, sentence: 'The turn failed.', code: 'outcome failed'}];
    const quiet = previewProblemsOf([report], feed, 'confirmation', timeline, own);
    assert.deepEqual(quiet.problems, []);
    assert.deepEqual(quiet.folded, [
      {stepId: last, sentence: report.error, lead: 'The preview page also reported'},
    ]);
  });

  it("always counts a component's failure, even on a step with the viewer's own problem", () => {
    const {events, timeline, stepOf} = turnOf('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf([], events, undefined, 'confirmation');
    const own = [{stepId: stepOf('5.0')!, sentence: 'A finding', code: 'VALIDATION_FAILED'}];
    const {problems} = previewProblemsOf(
      [{kind: 'component', componentId: 'confirm_title', componentType: 'Text', error: 'Error: x'}],
      feed,
      'confirmation',
      timeline,
      own,
    );
    assert.equal(problems.length, 1);
  });
});
