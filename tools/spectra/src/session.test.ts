import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PortTakenError} from './server.js';
import {failureLine} from './session.js';

const ports = {
  viewer: {port: 9820, open: false, allowedHosts: []},
  proxyPort: 9821,
  modelProxyPort: 9822,
  receiverPort: 9823,
};

describe("the session's failure line", () => {
  it('names the option that chooses another port, for each port Spectra binds', () => {
    assert.equal(
      failureLine(new PortTakenError(9820), ports),
      'Port 9820 is taken. Choose another port with --port.',
    );
    assert.equal(
      failureLine(new PortTakenError(9821), ports),
      'Port 9821 is taken. Choose another port with --proxy-port.',
    );
    assert.equal(
      failureLine(new PortTakenError(9822), ports),
      'Port 9822 is taken. Choose another port with --model-proxy-port.',
    );
    assert.equal(
      failureLine(new PortTakenError(9823), ports),
      'Port 9823 is taken. Choose another port with --receiver-port.',
    );
  });

  it("takes a port that is none of those as a tool proxy's, under the headless commands' missing viewer too", () => {
    assert.equal(
      failureLine(new PortTakenError(9900), ports),
      'Port 9900 is taken. Choose another port with --tool-proxy-port.',
    );
    assert.equal(
      failureLine(new PortTakenError(9820), {...ports, viewer: undefined}),
      'Port 9820 is taken. Choose another port with --tool-proxy-port.',
    );
  });

  it('says a port the system refused as refused', () => {
    assert.equal(
      failureLine(new PortTakenError(80, true), {...ports, proxyPort: 80}),
      'The system would not give Spectra port 80. Choose another port with --proxy-port.',
    );
  });

  it("says any other failure with the error's own message", () => {
    assert.equal(
      failureLine(new Error('the disk is full'), ports),
      'Spectra failed: the disk is full',
    );
    assert.equal(failureLine('odd', ports), 'Spectra failed: odd');
  });
});
