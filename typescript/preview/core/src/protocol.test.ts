import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isPageMessage, isReadyMessage, PREVIEW_PROTOCOL} from './protocol.js';

describe('the ready message, the part of the protocol every version holds', () => {
  it('is its type with a protocol number, whatever else it carries or leaves out', () => {
    assert.equal(isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: 1}), true);
    assert.equal(
      isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: PREVIEW_PROTOCOL, claims: []}),
      true,
    );
    assert.equal(
      isReadyMessage({type: 'a2ui-spectra-preview/ready', protocol: 3, adapters: ['react']}),
      true,
    );
  });

  it('is not one whose protocol is not a number', () => {
    for (const protocol of ['2', undefined, null, [2]]) {
      const message = {type: 'a2ui-spectra-preview/ready', protocol, claims: []};
      assert.equal(isReadyMessage(message), false, JSON.stringify(protocol));
      // Its type alone still makes it a page message, which the viewer then passes over.
      assert.equal(isPageMessage(message), true);
    }
    assert.equal(isReadyMessage({type: 'a2ui-spectra-preview/pong', protocol: 2}), false);
    assert.equal(isReadyMessage(null), false);
  });
});
