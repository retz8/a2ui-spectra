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

/** A base class and a subclass no other test guards. */
function freshClasses() {
  class FreshBase {
    fail = false;
    performUpdate(): void {
      if (this.fail) throw new RangeError('Invalid time value');
    }
  }
  class FreshElement extends FreshBase {}
  return {FreshBase, FreshElement};
}

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

  it('hands each error it catches on to the console', t => {
    const {FreshBase, FreshElement} = freshClasses();
    const logged = t.mock.method(console, 'error', () => {});
    const stop = guardElementUpdates(FreshBase, () => {});
    const element = new FreshElement();
    element.fail = true;
    element.performUpdate();
    stop();
    assert.equal(logged.mock.callCount(), 1);
    assert.ok(logged.mock.calls[0].arguments.some(argument => argument instanceof RangeError));
  });

  it('reports to the latest guard not stopped, and leaves the class as it was once every guard is', t => {
    t.mock.method(console, 'error', () => {});
    const {FreshBase, FreshElement} = freshClasses();
    const update = FreshBase.prototype.performUpdate;
    const first: unknown[] = [];
    const second: unknown[] = [];
    const stopFirst = guardElementUpdates(FreshBase, (_, error) => first.push(error));
    const stopSecond = guardElementUpdates(FreshBase, (_, error) => second.push(error));
    const element = new FreshElement();
    element.fail = true;
    element.performUpdate();
    stopSecond();
    element.performUpdate();
    assert.equal(second.length, 1);
    assert.equal(first.length, 1);
    stopFirst();
    stopFirst();
    assert.throws(() => element.performUpdate(), RangeError);
    assert.equal(FreshBase.prototype.performUpdate, update);
    assert.deepEqual(Object.getOwnPropertySymbols(FreshBase.prototype), []);
    // A subclass's prototype that inherited the update is left without one of its own.
    const inherited = freshClasses();
    guardElementUpdates(inherited.FreshElement, () => {})();
    assert.equal(
      Object.prototype.hasOwnProperty.call(inherited.FreshElement.prototype, 'performUpdate'),
      false,
    );
  });
});
