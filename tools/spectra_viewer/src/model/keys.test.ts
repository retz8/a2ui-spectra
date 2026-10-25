import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {type KeyPress, pageKeyOf} from './keys.ts';

/** A key press on an element matching only the selectors given. */
const press = (key: string, fields: Partial<KeyPress> = {}, inside: string[] = []): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: {
    closest: (selector: string) => inside.some(tag => selector.includes(tag)) || null,
  } as unknown as EventTarget,
  ...fields,
});

describe('pageKeyOf', () => {
  it('reads the page’s keys of one character, Shift+n among them', () => {
    for (const key of ['/', '?', 'n', 'N', 'l']) assert.equal(pageKeyOf(press(key)), key);
  });

  it('reads no other key', () => {
    for (const key of ['a', 'L', 'Enter', 'ArrowDown', 'Escape']) {
      assert.equal(pageKeyOf(press(key)), undefined);
    }
  });

  it('does nothing with Ctrl, Cmd or Alt held', () => {
    assert.equal(pageKeyOf(press('n', {ctrlKey: true})), undefined);
    assert.equal(pageKeyOf(press('n', {metaKey: true})), undefined);
    assert.equal(pageKeyOf(press('/', {altKey: true})), undefined);
  });

  it('does nothing while typing in a field or inside a dialog', () => {
    for (const inside of ['input', 'textarea', 'contenteditable', 'role="dialog"']) {
      assert.equal(pageKeyOf(press('n', {}, [inside])), undefined);
    }
  });

  it('reads a key pressed on the page itself', () => {
    assert.equal(pageKeyOf(press('l', {target: null})), 'l');
  });
});
