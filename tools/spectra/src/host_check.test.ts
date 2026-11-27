import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  HOST_REFUSED,
  hostNameOf,
  isAllowedHost,
  isAllowedOrigin,
  ORIGIN_NOT_ALLOWED,
  PAGE_REFUSED,
  proxyRefusal,
} from './host_check.js';

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

describe('isAllowedOrigin', () => {
  it('takes an origin on a loopback name, any scheme of the web and any port', () => {
    for (const origin of ['http://localhost:5173', 'https://127.0.0.1', 'http://[::1]:3000']) {
      assert.ok(isAllowedOrigin(origin, []), origin);
    }
  });

  it('takes an origin on a name given with --allow-host, and refuses any other', () => {
    assert.ok(isAllowedOrigin('https://Tunnel.Example', ['tunnel.example']));
    assert.ok(!isAllowedOrigin('https://attacker.example', ['tunnel.example']));
    assert.ok(!isAllowedOrigin('http://localhost.attacker.example', []));
  });

  it("refuses the opaque origin, a scheme that is not the web's, and a value that is not an origin", () => {
    assert.ok(!isAllowedOrigin('null', []));
    assert.ok(!isAllowedOrigin('file://localhost', []));
    assert.ok(!isAllowedOrigin('localhost', []));
    assert.ok(!isAllowedOrigin('', []));
  });
});

describe('proxyRefusal', () => {
  it('refuses a Host that is not answered, before anything else', () => {
    assert.equal(proxyRefusal({host: 'r.attacker.example:9821'}, [], 'refused'), HOST_REFUSED);
    assert.equal(proxyRefusal({}, [], 'allowed hosts'), HOST_REFUSED);
    assert.equal(proxyRefusal({host: 'tunnel.example'}, ['tunnel.example'], 'refused'), undefined);
  });

  it('refuses any Origin on a proxy whose callers are not pages', () => {
    assert.equal(
      proxyRefusal({host: '127.0.0.1:9822', origin: 'http://localhost:5173'}, [], 'refused'),
      PAGE_REFUSED,
    );
    assert.equal(proxyRefusal({host: '127.0.0.1:9822'}, [], 'refused'), undefined);
  });

  it('refuses an Origin on another name where pages on the allowed names are callers', () => {
    const host = '127.0.0.1:9821';
    assert.equal(
      proxyRefusal({host, origin: 'https://attacker.example'}, [], 'allowed hosts'),
      ORIGIN_NOT_ALLOWED,
    );
    assert.equal(proxyRefusal({host, origin: 'null'}, [], 'allowed hosts'), ORIGIN_NOT_ALLOWED);
    assert.equal(
      proxyRefusal({host, origin: 'http://localhost:5173'}, [], 'allowed hosts'),
      undefined,
    );
    assert.equal(proxyRefusal({host}, [], 'allowed hosts'), undefined);
  });
});
