import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {bindingOf} from './bindings.ts';

describe('bindingOf', () => {
  it("shows a component's literal text, or the path it reads its text from", () => {
    assert.equal(bindingOf({text: 'Book Now'}), '“Book Now”');
    assert.equal(bindingOf({text: {path: '/title'}, variant: 'h2'}), '/title');
  });

  it('shows the list a component repeats over, and the event a button sends', () => {
    assert.equal(bindingOf({children: {componentId: 'card', path: '/items'}}), 'each of /items');
    assert.equal(bindingOf({child: 'label', action: {event: {name: 'book'}}}), 'book');
  });

  it("reads v1.0's binding as its surfaces hold it", () => {
    assert.equal(bindingOf({text: {'@path': 'name'}}), 'name');
    assert.equal(bindingOf({url: {'@path': 'imageUrl'}, variant: 'mediumFeature'}), 'imageUrl');
  });

  it('shows the first other property bound to a path, and nothing when none is', () => {
    assert.equal(bindingOf({label: 'Date', value: {path: '/date'}}), '/date');
    assert.equal(bindingOf({children: ['a', 'b']}), '');
  });
});
