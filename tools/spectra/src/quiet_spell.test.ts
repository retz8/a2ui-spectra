import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {quietSpell} from './quiet_spell.js';

describe('a quiet spell', () => {
  it('calls once, the spell after the last notice, however many notices came', ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});
    let calls = 0;
    const spell = quietSpell(() => calls++, 100);
    spell.notice();
    mock.timers.tick(60);
    spell.notice();
    mock.timers.tick(60);
    spell.notice();
    mock.timers.tick(99);
    assert.equal(calls, 0, 'Each notice starts the spell again.');
    mock.timers.tick(1);
    assert.equal(calls, 1);
    mock.timers.tick(500);
    assert.equal(calls, 1, 'Nothing more without a notice.');
  });

  it('calls again for notices after a call, and not at all once cancelled', ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});
    let calls = 0;
    const spell = quietSpell(() => calls++, 100);
    spell.notice();
    mock.timers.tick(100);
    spell.notice();
    mock.timers.tick(100);
    assert.equal(calls, 2);
    spell.notice();
    spell.cancel();
    mock.timers.tick(500);
    assert.equal(calls, 2);
  });
});
