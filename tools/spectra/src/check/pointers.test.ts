import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {comparePointers, propertyPathPointer, token} from './pointers.js';

describe('pointers', () => {
  it("turns web core's property path of a child reference into a pointer", () => {
    assert.equal(propertyPathPointer('child'), '/child');
    assert.equal(propertyPathPointer('children[2]'), '/children/2');
    assert.equal(propertyPathPointer('tabs[0].child'), '/tabs/0/child');
    assert.equal(propertyPathPointer('children.componentId'), '/children/componentId');
  });

  it('escapes a token as RFC 6901 has it', () => {
    assert.equal(token('a/b~c'), 'a~1b~0c');
    assert.equal(token(3), '3');
  });

  it('orders pointers by message and component, numbers as numbers, a missing pointer last', () => {
    const base = '/events/2/attributes/a2ui.wire.message/parts';
    const sorted = [
      undefined,
      `${base}/1/content/updateComponents/components/10/text`,
      `${base}/1/content/updateComponents/components/9/children/1`,
      `${base}/0/content/createSurface/theme`,
      `/events/12/attributes/a2ui.wire.message/parts/0/content`,
    ].sort(comparePointers);
    assert.deepEqual(sorted, [
      `${base}/0/content/createSurface/theme`,
      `${base}/1/content/updateComponents/components/9/children/1`,
      `${base}/1/content/updateComponents/components/10/text`,
      `/events/12/attributes/a2ui.wire.message/parts/0/content`,
      undefined,
    ]);
  });
});
