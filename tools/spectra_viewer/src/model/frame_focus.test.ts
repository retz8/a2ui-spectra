import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {stopBeside} from './frame_focus.ts';

describe('stopBeside', () => {
  const stops = ['rail', 'switcher', 'frame', 'divider', 'tree', 'composer'];

  it('gives focus leaving a page forward to the stop after the pane', () => {
    assert.equal(stopBeside(stops, 'frame', 'after', false), 'divider');
  });

  it('gives focus leaving a page backward to the stop before the pane', () => {
    assert.equal(stopBeside(stops, 'frame', 'before', false), 'switcher');
  });

  it("wraps a Tab pressed past the viewer's last stop to its first", () => {
    assert.equal(stopBeside(stops, 'frame', 'before', true), 'rail');
  });

  it('with no page shown, wraps forward to the first stop and backward to the last', () => {
    assert.equal(stopBeside(stops, undefined, 'before', false), 'rail');
    assert.equal(stopBeside(stops, undefined, 'after', false), 'composer');
  });
});
