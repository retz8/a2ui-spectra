import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readerFor} from './index.js';

function api(method: string, host: string, path: string, standIn = false) {
  const [pathname, query = ''] = path.split('?');
  return readerFor(method, host, pathname, new URLSearchParams(query), standIn)?.api;
}

describe('readerFor', () => {
  it("names the four APIs on the providers' own hosts", () => {
    assert.equal(
      api(
        'POST',
        'generativelanguage.googleapis.com',
        '/v1beta/models/gemini-2.5-flash:generateContent',
      ),
      'gemini',
    );
    assert.equal(
      api(
        'POST',
        'generativelanguage.googleapis.com',
        '/v1alpha/models/gemini-3-pro:streamGenerateContent?alt=sse',
      ),
      'gemini',
    );
    assert.equal(api('POST', 'api.openai.com', '/v1/chat/completions'), 'openai_chat_completions');
    assert.equal(api('POST', 'api.openai.com', '/v1/responses'), 'openai_responses');
    assert.equal(api('POST', 'api.anthropic.com', '/v1/messages'), 'anthropic_messages');
    assert.equal(api('POST', 'api.anthropic.com:443', '/v1/messages'), 'anthropic_messages');
  });

  it('reads any other request raw: another host, another path, a Gemini stream without alt=sse, a GET', () => {
    assert.equal(api('POST', 'openrouter.ai', '/api/v1/chat/completions'), undefined);
    assert.equal(api('POST', 'api.openai.com', '/v1/embeddings'), undefined);
    assert.equal(
      api('POST', 'generativelanguage.googleapis.com', '/v1beta/models/g:countTokens'),
      undefined,
    );
    assert.equal(
      api('POST', 'generativelanguage.googleapis.com', '/v1beta/models/g:streamGenerateContent'),
      undefined,
    );
    assert.equal(api('GET', 'api.openai.com', '/v1/responses'), undefined);
    assert.equal(api('POST', 'api.anthropic.com', '/v1/oauth/token'), undefined);
  });

  it('reads the stand-in by path alone', () => {
    assert.equal(api('POST', '127.0.0.1:9999', '/v1/messages', true), 'anthropic_messages');
    assert.equal(
      api('POST', '127.0.0.1:9999', '/v1/chat/completions', true),
      'openai_chat_completions',
    );
    assert.equal(api('POST', '127.0.0.1:9999', '/v1beta/models/g:generateContent', true), 'gemini');
    assert.equal(api('POST', '127.0.0.1:9999', '/v1/messages', false), undefined);
  });
});
