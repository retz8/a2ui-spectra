import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  hashOf,
  historyOf,
  readAddress,
  rememberAddress,
  sectionHash,
  sectionOf,
  writeAddress,
  writeFixtureAddress,
} from './address.ts';

const TRACE = 'f94fdb8f0e8f6531c1d2a3b4c5d6e7f8';
const OTHER = '09b758f035afb6d5a1b2c3d4e5f60718';

describe('the page address', () => {
  it('holds the turn, and the selected step by its id', () => {
    assert.equal(writeAddress(TRACE), `#/turns/${TRACE}`);
    assert.deepEqual(readAddress(`#/turns/${TRACE}`), {traceId: TRACE});
    for (const stepId of [
      'message-1a2b3c4d5e6f7081.2.4',
      'message-1a2b3c4d5e6f7081.0',
      'delivery-1a2b3c4d5e6f7081',
      'part-1a2b3c4d5e6f7081.1',
      'outcome',
    ]) {
      const hash = writeAddress(TRACE, stepId);
      assert.equal(hash, `#/turns/${TRACE}/steps/${stepId}`);
      assert.deepEqual(readAddress(hash), {traceId: TRACE, stepId});
    }
  });

  it('holds the selected tree node after the step, as its surface and component ids, each encoded', () => {
    const node = {surfaceId: 'restaurant card', componentId: 'book/button'};
    const hash = writeAddress(TRACE, 'e9f3a6c15b8d2704', node);
    assert.equal(
      hash,
      `#/turns/${TRACE}/steps/e9f3a6c15b8d2704/nodes/restaurant%20card/book%2Fbutton`,
    );
    assert.deepEqual(readAddress(hash), {traceId: TRACE, stepId: 'e9f3a6c15b8d2704', node});
    assert.deepEqual(readAddress(`#/turns/${TRACE}/steps/x/nodes/s`), {});
  });

  it('replaces the entry when the node changes, as a change of step does', () => {
    const node = {surfaceId: 's', componentId: 'c'};
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'x'}, {traceId: TRACE, stepId: 'x', node}, {own: false}),
      'replace',
    );
    assert.equal(
      historyOf(
        {traceId: TRACE, stepId: 'x', node},
        {traceId: TRACE, stepId: 'x', node},
        {own: false},
      ),
      'none',
    );
  });

  it('holds no turn when it is not a turn’s address', () => {
    for (const hash of [
      '',
      '#',
      '#/turns/',
      '#/turns/xyz',
      `#/turns/${TRACE}/steps/`,
      `#/turns/${TRACE}/x`,
    ]) {
      assert.deepEqual(readAddress(hash), {});
    }
  });
});

describe('historyOf', () => {
  it('adds an entry for another turn, whatever its step', () => {
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'outcome'}, {traceId: OTHER}, {own: false}),
      'push',
    );
    assert.equal(historyOf({}, {traceId: OTHER}, {own: false}), 'push');
  });

  it('replaces the entry for another step of the same turn', () => {
    assert.equal(
      historyOf({traceId: TRACE}, {traceId: TRACE, stepId: 'outcome'}, {own: false}),
      'replace',
    );
    assert.equal(
      historyOf({traceId: TRACE, stepId: 'outcome'}, {traceId: TRACE}, {own: false}),
      'replace',
    );
  });

  it('replaces the entry for the viewer’s own move, to another turn too', () => {
    assert.equal(historyOf({traceId: TRACE}, {traceId: OTHER}, {own: true}), 'replace');
    assert.equal(historyOf({}, {traceId: OTHER}, {own: true}), 'replace');
  });

  it('leaves the history as it is when the address stays', () => {
    assert.equal(
      historyOf(
        {traceId: TRACE, stepId: 'outcome'},
        {traceId: TRACE, stepId: 'outcome'},
        {own: false},
      ),
      'none',
    );
  });
});

describe('the address of the Fixtures section', () => {
  const NAME = 'nested/find-italian-restaurants';

  it('holds the fixture by its name, encoded, and its turn by the recorded trace id', () => {
    const hash = writeFixtureAddress(NAME, TRACE);
    assert.equal(hash, `#/fixtures/nested%2Ffind-italian-restaurants/turns/${TRACE}`);
    assert.deepEqual(readAddress(hash), {section: 'fixtures', fixture: NAME, traceId: TRACE});
  });

  it('follows the turn with the step and the node, as the Turns address carries them', () => {
    const node = {surfaceId: 'restaurant card', componentId: 'book/button'};
    const hash = writeFixtureAddress(NAME, TRACE, 'outcome', node);
    assert.equal(
      hash,
      `#/fixtures/nested%2Ffind-italian-restaurants/turns/${TRACE}/steps/outcome/nodes/restaurant%20card/book%2Fbutton`,
    );
    assert.deepEqual(readAddress(hash), {
      section: 'fixtures',
      fixture: NAME,
      traceId: TRACE,
      stepId: 'outcome',
      node,
    });
  });

  it('reads the bare forms: the section alone, and a fixture with no turn', () => {
    assert.equal(writeFixtureAddress(), '#/fixtures');
    assert.deepEqual(readAddress('#/fixtures'), {section: 'fixtures'});
    assert.equal(writeFixtureAddress('a'), '#/fixtures/a');
    assert.deepEqual(readAddress('#/fixtures/a'), {section: 'fixtures', fixture: 'a'});
  });

  it('reads as no address when its turn is not a turn', () => {
    for (const hash of ['#/fixtures/a/turns/xyz', '#/fixtures/a/b', `#/fixtures//turns/${TRACE}`]) {
      assert.deepEqual(readAddress(hash), {});
    }
  });

  it('writes back what it reads, in either section', () => {
    for (const hash of [
      '#/fixtures',
      '#/fixtures/a',
      `#/fixtures/a/turns/${TRACE}/steps/outcome`,
      `#/turns/${TRACE}`,
      `#/turns/${TRACE}/steps/outcome`,
    ]) {
      assert.equal(hashOf(readAddress(hash)), hash);
    }
    assert.equal(hashOf({}), '#/turns');
    assert.equal(sectionOf(readAddress('#/fixtures')), 'fixtures');
    assert.equal(sectionOf(readAddress(`#/turns/${TRACE}`)), 'turns');
  });
});

describe('historyOf, across the sections', () => {
  const inFixture = {section: 'fixtures', fixture: 'a', traceId: TRACE} as const;

  it('adds an entry on switching sections', () => {
    assert.equal(historyOf({traceId: TRACE}, inFixture, {own: false}), 'push');
    assert.equal(historyOf(inFixture, {traceId: TRACE}, {own: false}), 'push');
    assert.equal(historyOf({traceId: TRACE}, {section: 'fixtures'}, {own: false}), 'push');
  });

  it('adds an entry on selecting a fixture turn, of the same fixture or another', () => {
    assert.equal(historyOf(inFixture, {...inFixture, traceId: OTHER}, {own: false}), 'push');
    assert.equal(historyOf(inFixture, {...inFixture, fixture: 'b'}, {own: false}), 'push');
  });

  it('replaces the entry for a step or a node, and for the viewer’s own move', () => {
    const node = {surfaceId: 's', componentId: 'c'};
    assert.equal(historyOf(inFixture, {...inFixture, stepId: 'x'}, {own: false}), 'replace');
    assert.equal(
      historyOf({...inFixture, stepId: 'x'}, {...inFixture, stepId: 'x', node}, {own: false}),
      'replace',
    );
    assert.equal(historyOf({section: 'fixtures'}, inFixture, {own: true}), 'replace');
    assert.equal(historyOf(inFixture, inFixture, {own: false}), 'none');
  });
});

describe('the address each section was last on', () => {
  const turn = `#/turns/${TRACE}/steps/outcome`;
  const fixture = writeFixtureAddress('a', TRACE, 'outcome');

  it('keeps each section’s last address for the switch back', () => {
    let remembered = rememberAddress({}, turn);
    remembered = rememberAddress(remembered, fixture);
    assert.equal(sectionHash('turns', remembered), turn);
    assert.equal(sectionHash('fixtures', remembered), fixture);
  });

  it('goes to the bare address of a section not yet visited', () => {
    assert.equal(sectionHash('turns', {}), '#/turns');
    assert.equal(sectionHash('fixtures', {}), '#/fixtures');
  });

  it('is not moved by an address of Turns with no turn, and stays the same object when nothing changes', () => {
    const remembered = rememberAddress({}, turn);
    assert.equal(rememberAddress(remembered, ''), remembered);
    assert.equal(rememberAddress(remembered, '#/turns'), remembered);
    assert.equal(rememberAddress(remembered, turn), remembered);
  });
});
