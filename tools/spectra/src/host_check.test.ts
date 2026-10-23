import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {hostNameOf, isAllowedHost} from './host_check.js';

describe('hostNameOf', () => {
  it('drops the port and lowercases', () => {
    assert.equal(hostNameOf('LocalHost:9820'), 'localhost');
    assert.equal(hostNameOf('127.0.0.1:9820'), '127.0.0.1');
    assert.equal(hostNameOf('[::1]:9820'), '[::1]');
    assert.equal(hostNameOf('[::1]'), '[::1]');
    assert.equal(hostNameOf('example.com.'), 'example.com');
    assert.equal(hostNameOf('example.com'), 'example.com');
  });
});

describe('isAllowedHost', () => {
  it('answers the loopback names', () => {
    for (const host of ['localhost:9820', '127.0.0.1:9820', '[::1]:9820']) {
      assert.ok(isAllowedHost(host, []), host);
    }
  });

  it('refuses any other name, and a request without one', () => {
    assert.ok(!isAllowedHost('evil.example', []));
    assert.ok(!isAllowedHost('localhost.evil.example', []));
    assert.ok(!isAllowedHost('127.0.0.2:9820', []));
    assert.ok(!isAllowedHost(undefined, []));
    assert.ok(!isAllowedHost('', []));
  });

  it('answers the names given with --allow-host', () => {
    const allowed = ['tunnel.example'];
    assert.ok(isAllowedHost('Tunnel.Example:443', allowed));
    assert.ok(!isAllowedHost('other.example', allowed));
  });
});
