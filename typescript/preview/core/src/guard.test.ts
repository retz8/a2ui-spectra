import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {guardElementUpdates} from './guard.js';

class Base {
  fail = false;
  updates = 0;
  performUpdate(): void {
    this.updates += 1;
    if (this.fail) throw new RangeError('Invalid time value');
  }
}

class Element extends Base {}

describe('guardElementUpdates', () => {
  it("reports a subclass instance's throwing update with the element, and keeps it in the page", () => {
    const failures: Array<[unknown, unknown]> = [];
    guardElementUpdates(Base, (element, error) => failures.push([element, error]));
    const element = new Element();
    element.performUpdate();
    element.fail = true;
    assert.doesNotThrow(() => element.performUpdate());
    assert.equal(element.updates, 2);
    assert.equal(failures.length, 1);
    assert.equal(failures[0][0], element);
    assert.ok(failures[0][1] instanceof RangeError);
  });

  it('wraps a class once, reporting to the latest handler', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    guardElementUpdates(Base, (_, error) => first.push(error));
    guardElementUpdates(Base, (_, error) => second.push(error));
    const element = new Element();
    element.fail = true;
    element.performUpdate();
    assert.equal(element.updates, 1);
    assert.equal(first.length, 0);
    assert.equal(second.length, 1);
  });
});
