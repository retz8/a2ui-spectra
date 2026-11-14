import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Report} from 'a2ui-spectra-preview';

import {readRecording} from '../testing/recordings.ts';
import {
  ANSWER_MS,
  type Answering,
  HOLD_MS,
  loadOf,
  NOT_LOADED,
  owesAnswer,
  pageNoteOf,
  pongOf,
  type PreviewPageState,
  previewProblemsOf,
  readyOf,
  RELOADING_NOTE_MS,
  routeOf,
  stillLoading,
  surfaceFeedOf,
  targetOf,
  timedOut,
  unansweredLine,
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
      {message: {version: '1.0', createSurface: {surfaceId: 's', catalogId: BASIC_V1_0}}},
      {
        message: {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Booking', catalogId: CUSTOM}],
          },
        },
      },
    ];
    assert.deepEqual(targetOf(feed), {catalogIds: [BASIC_V1_0, CUSTOM], protocolVersion: '1.0'});
  });

  it("adds the catalogs a v1.0 surface's components name of their own under @catalogId", () => {
    const feed = [
      {message: {version: '1.0', createSurface: {surfaceId: 's', catalogId: BASIC_V1_0}}},
      {
        message: {
          version: '1.0',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Booking', '@catalogId': CUSTOM}],
          },
        },
      },
    ];
    assert.deepEqual(targetOf(feed), {catalogIds: [BASIC_V1_0, CUSTOM], protocolVersion: '1.0'});
  });
});

describe('routeOf', () => {
  it('sends the basic catalogs of every version to the built-in page, the v0.9.1 alias by its claim', () => {
    for (const [catalogId, version] of [
      [BASIC_V0_9, 'v0.9'],
      [BASIC_V0_9, 'v0.9.1'],
      [BASIC_V0_9_1, 'v0.9.1'],
      [BASIC_V1_0, '1.0'],
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
    const route = routeOf([BUILT_IN], {catalogIds: [BASIC_V0_9], protocolVersion: '1.0'});
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
      protocolVersion: '1.0',
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
      protocolVersion: '1.0',
    });
    assert.equal(route.kind === 'page' && route.page.id, 'built-in');
  });
});

describe("a page's load and its document's answer", () => {
  const SPEAKS = 2;
  const claims = [{catalogId: CUSTOM, protocolVersion: '0.9'}];
  const ready = {protocol: SPEAKS, claims};

  it('numbers the loads from 1, each one more, and the document at the latest is asked', () => {
    const first = loadOf({status: 'waiting', answering: NOT_LOADED});
    assert.deepEqual(first, {status: 'waiting', answering: {load: 1, answered: 0}});
    assert.equal(owesAnswer(NOT_LOADED), false);
    assert.equal(owesAnswer(first.answering), true);
    const second = loadOf({status: 'waiting', answering: first.answering});
    assert.deepEqual(second.answering, {load: 2, answered: 0});
  });

  it('asks again at a ready that comes while a load is unanswered, and the page is ready once the answer comes', () => {
    // The order of a page on a dev server: its load, then its ready.
    const loaded = loadOf({status: 'waiting', answering: NOT_LOADED});
    // The document's adapter has not started: the ping at the load is not heard, and no answer comes.
    const step = readyOf(loaded.answering, ready, SPEAKS);
    assert.deepEqual(step, {kind: 'ask', answering: {load: 1, answered: 0, claims}});
    const answer = pongOf(step.answering, 1);
    assert.deepEqual(answer, {answering: {load: 1, answered: 1, claims}, claims});
    assert.equal(owesAnswer(answer!.answering), false);
  });

  it('makes the page ready at a ready that comes with no load unanswered, and reloading at the load after it', () => {
    // The order of a built page: its ready, then its load.
    const step = readyOf(NOT_LOADED, ready, SPEAKS);
    assert.deepEqual(step, {kind: 'ready', answering: {load: 0, answered: 0, claims}, claims});
    const loaded = loadOf({status: 'ready', answering: step.answering});
    assert.deepEqual(loaded, {status: 'reloading', answering: {load: 1, answered: 0, claims}});
    // The same document answers the load's ping, with the claims it said.
    assert.deepEqual(pongOf(loaded.answering, 1), {
      answering: {load: 1, answered: 1, claims},
      claims,
    });
  });

  it("takes a second ready of an answered document as the page ready again, React's development mode mounting twice", () => {
    const answered: Answering = {load: 1, answered: 1, claims};
    assert.deepEqual(readyOf(answered, ready, SPEAKS), {
      kind: 'ready',
      answering: answered,
      claims,
    });
    // Before the answer, each of the two readies asks again, and only the first answer counts.
    const unanswered: Answering = {load: 1, answered: 0};
    const first = readyOf(unanswered, ready, SPEAKS);
    const second = readyOf(first.answering, ready, SPEAKS);
    assert.equal(first.kind, 'ask');
    assert.equal(second.kind, 'ask');
    const answer = pongOf(second.answering, 1);
    assert.ok(answer);
    assert.equal(pongOf(answer.answering, 1), undefined);
  });

  it("counts an answer only for the latest load's number", () => {
    // Two reloads in quick succession: the first document is gone before it answers.
    const first = loadOf({status: 'ready', answering: {load: 1, answered: 1, claims}});
    const second = loadOf(first);
    assert.deepEqual(second, {status: 'reloading', answering: {load: 3, answered: 1, claims}});
    assert.equal(pongOf(second.answering, 2), undefined);
    assert.equal(pongOf(second.answering, 1), undefined);
    assert.equal(pongOf(second.answering, 4), undefined);
    const later = [{catalogId: BASIC_V0_9, protocolVersion: '0.9'}];
    const step = readyOf(second.answering, {protocol: SPEAKS, claims: later}, SPEAKS);
    assert.equal(step.kind, 'ask');
    // The page is ready with the claims of the ready that came last.
    assert.deepEqual(pongOf(step.answering, 3), {
      answering: {load: 3, answered: 3, claims: later},
      claims: later,
    });
  });

  it('takes no answer from a page that speaks another version of the protocol', () => {
    const loaded = loadOf({status: 'waiting', answering: NOT_LOADED});
    const step = readyOf(loaded.answering, {protocol: 1, claims}, SPEAKS);
    assert.deepEqual(step, {kind: 'mismatch', answering: {load: 1, answered: 0}});
    assert.equal(pongOf(step.answering, 1), undefined);
    // A mismatch forgets what an earlier document of the page claimed.
    const dropped = readyOf({load: 2, answered: 2, claims}, {protocol: 3, claims}, SPEAKS);
    assert.deepEqual(dropped, {kind: 'mismatch', answering: {load: 2, answered: 2}});
    // An upgraded document at the next load is asked and answers.
    const next = loadOf({status: 'mismatch', answering: step.answering});
    assert.equal(next.status, 'mismatch');
    const upgraded = readyOf(next.answering, ready, SPEAKS);
    assert.equal(upgraded.kind, 'ask');
    assert.deepEqual(pongOf(upgraded.answering, 2)?.claims, claims);
  });

  it('sends only a ready page to reloading at a load', () => {
    for (const status of ['waiting', 'loading', 'reloading', 'unanswered', 'mismatch'] as const) {
      assert.equal(loadOf({status, answering: NOT_LOADED}).status, status);
    }
    assert.equal(loadOf({status: 'ready', answering: NOT_LOADED}).status, 'reloading');
  });
});

describe('a page whose iframe has not loaded', () => {
  const url = 'http://localhost:5174/preview';

  it('holds the surfaces behind it while it waits, and is passed by once it is still loading', () => {
    const waiting = page(url, {status: 'waiting'});
    const target = {catalogIds: [BASIC_V0_9], protocolVersion: 'v0.9'};
    assert.deepEqual(routeOf([waiting, BUILT_IN], target), {kind: 'waiting'});
    const loading = stillLoading(waiting);
    assert.deepEqual(loading, {...waiting, status: 'loading'});
    assert.deepEqual(routeOf([loading, BUILT_IN], target), {kind: 'page', page: BUILT_IN});
    assert.equal(HOLD_MS, 5000);
  });

  it('is named as still loading under a surface nothing else can draw, where a page that loaded and stayed silent has not answered', () => {
    const loading = page(url, {status: 'loading'});
    const silent = page('http://localhost:5175/preview', {status: 'unanswered'});
    const old = page('http://localhost:5176/preview', {status: 'mismatch', protocol: 1});
    const route = routeOf([loading, silent, old, BUILT_IN], {
      catalogIds: [CUSTOM],
      protocolVersion: 'v0.9',
    });
    assert.deepEqual(route, {kind: 'none', catalogId: CUSTOM, unanswered: [loading, silent, old]});
    assert.equal(unansweredLine(loading, 2), `${url} is still loading`);
    assert.equal(unansweredLine(silent, 2), 'http://localhost:5175/preview has not answered');
    assert.equal(
      unansweredLine(old, 2),
      'http://localhost:5176/preview: preview page speaks protocol 1, this Spectra speaks 2',
    );
  });

  it('is passed by only while it waits: a page in any other state is left as it is', () => {
    for (const status of ['loading', 'ready', 'reloading', 'unanswered', 'mismatch'] as const) {
      const other = page(url, {status});
      assert.equal(stillLoading(other), other);
    }
  });
});

describe('a document that does not answer in time', () => {
  const url = 'http://localhost:5174/preview';

  it('leaves its page unanswered, claiming nothing, whether it was waiting, still loading or reloading', () => {
    const claims = [{catalogId: CUSTOM, protocolVersion: '0.9'}];
    for (const status of ['waiting', 'loading', 'reloading'] as const) {
      const before = page(url, {status, claims});
      assert.deepEqual(timedOut(before), {...before, status: 'unanswered', claims: []});
    }
    assert.equal(ANSWER_MS, 5000);
  });

  it('leaves a page that speaks another version, or is unanswered already, as it is', () => {
    for (const status of ['mismatch', 'unanswered'] as const) {
      const before = page(url, {status});
      assert.equal(timedOut(before), before);
    }
  });
});

describe('a reloading page', () => {
  const booking = {catalogId: CUSTOM, protocolVersion: '0.9'};
  const basic = {catalogId: BASIC_V0_9, protocolVersion: '0.9'};

  it('keeps its claims: a surface it was drawing stays with it, one it never claimed routes on', () => {
    const reloading = page('http://localhost:5174/preview', {
      status: 'reloading',
      claims: [booking, basic],
    });
    const custom = routeOf([reloading, BUILT_IN], {catalogIds: [CUSTOM], protocolVersion: 'v0.9'});
    assert.deepEqual(custom, {kind: 'page', page: reloading});
    // The built-in page claims the basic catalog too, and the page ahead of it still holds the surface.
    const held = routeOf([reloading, BUILT_IN], {
      catalogIds: [BASIC_V0_9],
      protocolVersion: 'v0.9',
    });
    assert.deepEqual(held, {kind: 'page', page: reloading});
    const other = routeOf([reloading, BUILT_IN], {
      catalogIds: [BASIC_V1_0],
      protocolVersion: 'v1.0',
    });
    assert.deepEqual(other, {kind: 'page', page: BUILT_IN});
  });

  it('loses its claims when it has not answered in time: the surface falls to a later page, or to no preview', () => {
    const reloading = page('http://localhost:5174/preview', {
      status: 'reloading',
      claims: [booking, basic],
    });
    const unanswered = timedOut(reloading);
    assert.deepEqual(unanswered, {...reloading, status: 'unanswered', claims: []});
    assert.deepEqual(
      routeOf([unanswered, BUILT_IN], {catalogIds: [BASIC_V0_9], protocolVersion: 'v0.9'}),
      {kind: 'page', page: BUILT_IN},
    );
    assert.deepEqual(
      routeOf([unanswered, BUILT_IN], {catalogIds: [CUSTOM], protocolVersion: 'v0.9'}),
      {kind: 'none', catalogId: CUSTOM, unanswered: [unanswered]},
    );
  });
});

describe("the Preview header's note of the page drawing the surface", () => {
  it("is the page's URL, or built-in, and says the page is reloading once it has been for a moment", () => {
    const url = 'http://localhost:5174/spectra-preview';
    assert.deepEqual(pageNoteOf(page(url, {})), {text: url, reloading: false});
    // A healthy page answers within milliseconds of its load: the note does not flicker for it.
    assert.deepEqual(pageNoteOf(page(url, {status: 'reloading'})), {text: url, reloading: false});
    assert.deepEqual(pageNoteOf(page(url, {status: 'reloading', reloadingNoted: true})), {
      text: `${url} · reloading`,
      reloading: true,
    });
    // The mark means nothing once the page has answered again.
    assert.deepEqual(pageNoteOf(page(url, {status: 'ready', reloadingNoted: true})), {
      text: url,
      reloading: false,
    });
    assert.deepEqual(pageNoteOf(BUILT_IN), {text: 'built-in', reloading: false});
    assert.equal(RELOADING_NOTE_MS, 200);
  });
});

describe('previewProblemsOf', () => {
  it("puts a component's failure on the step whose message last carried it, marking its id's line", () => {
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
        inner: '/updateComponents/components/3/id',
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

  it('folds a refused message of an earlier turn on the last step, uncounted, as that turn counts it', () => {
    const {earlier, events, timeline} = turnOf('node_restaurant_finder/stream_v1_0_booking');
    const feed = surfaceFeedOf(earlier, events, undefined, 'stub-notice');
    const last = timeline[timeline.length - 1].id;
    const index = feed.findIndex(({key}) => key === undefined);
    assert.ok(index >= 0, "The feed carries an earlier turn's message.");
    const {problems, folded, lines} = previewProblemsOf(
      [
        {
          kind: 'refused',
          index,
          code: 'INTEGRITY_ERROR',
          error: 'Surface stub-notice already exists.',
        },
      ],
      feed,
      'stub-notice',
      timeline,
      [],
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(folded, [
      {
        stepId: last,
        sentence: 'Surface stub-notice already exists.',
        lead: "The preview page also refused an earlier turn's message",
      },
    ]);
    assert.deepEqual(lines, ['The preview page refused this message.']);
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
