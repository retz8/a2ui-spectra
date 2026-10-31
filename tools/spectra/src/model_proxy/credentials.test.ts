import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  isCredentialParameter,
  isCredentialRequestHeader,
  isCredentialResponseHeader,
  removeFromHeaders,
  removeFromUrl,
} from './credentials.js';

describe('credentials', () => {
  it('names the request headers that carry one, by list and by pattern', () => {
    for (const name of [
      'authorization',
      'Proxy-Authorization',
      'x-api-key',
      'X-Goog-Api-Key',
      'api-key',
      'cookie',
      'x-auth-token',
      'Idempotency-Key',
      'x-secret',
      'x-password',
    ]) {
      assert.ok(isCredentialRequestHeader(name), name);
    }
    for (const name of ['content-type', 'accept', 'user-agent', 'anthropic-version', 'host']) {
      assert.equal(isCredentialRequestHeader(name), false, name);
    }
  });

  it('names set-cookie as the one response header, the pattern not applying', () => {
    assert.ok(isCredentialResponseHeader('Set-Cookie'));
    assert.equal(isCredentialResponseHeader('www-authenticate'), false);
    assert.equal(isCredentialResponseHeader('x-request-token'), false);
  });

  it('names the URL parameters that carry one', () => {
    for (const name of ['key', 'api_key', 'access_token', 'apiKey', 'auth', 'client_secret']) {
      assert.ok(isCredentialParameter(name), name);
    }
    assert.equal(isCredentialParameter('alt'), false);
    assert.equal(isCredentialParameter('beta'), false);
  });

  it('replaces each credential value in headers, keeping the name', () => {
    assert.deepEqual(
      removeFromHeaders(
        {
          'Content-Type': ['application/json'],
          'x-goog-api-key': ['AIza-secret'],
          Cookie: ['a=1', 'b=2'],
        },
        'request',
      ),
      {
        'content-type': ['application/json'],
        'x-goog-api-key': ['REMOVED'],
        cookie: ['REMOVED', 'REMOVED'],
      },
    );
    assert.deepEqual(
      removeFromHeaders({'set-cookie': ['s=1'], 'x-request-token': ['kept']}, 'response'),
      {'set-cookie': ['REMOVED'], 'x-request-token': ['kept']},
    );
  });

  it('replaces the credentials in a URL, keeping the parameter names and the rest', () => {
    assert.equal(
      removeFromUrl(
        'https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?key=AIza&alt=sse',
      ),
      'https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?key=REMOVED&alt=sse',
    );
    assert.equal(
      removeFromUrl('https://user:pass@h.example/p?x=1'),
      'https://REMOVED@h.example/p?x=1',
    );
    assert.equal(
      removeFromUrl('https://h.example/p?access_token=t&api%5Fkey=k'),
      'https://h.example/p?access_token=REMOVED&api%5Fkey=REMOVED',
    );
    assert.equal(removeFromUrl('https://h.example/p'), 'https://h.example/p');
    assert.equal(removeFromUrl('not a url'), 'not a url');
  });
});
