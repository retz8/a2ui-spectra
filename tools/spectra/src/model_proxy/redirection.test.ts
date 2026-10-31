import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  attachLines,
  environmentOf,
  forwardTo,
  redirections,
  splitPrefix,
  type Target,
  variablesOf,
} from './redirection.js';

const ORIGIN = 'http://127.0.0.1:9822';

function targetOf(env: NodeJS.ProcessEnv, name: string): Target {
  const found = redirections(env, ORIGIN).find(item => item.name === name);
  assert.ok(found, name);
  return found.target;
}

describe('redirection', () => {
  it('sets the five variables to their own prefixes, in order', () => {
    assert.deepEqual(environmentOf(redirections({}, ORIGIN)), {
      GOOGLE_GEMINI_BASE_URL: `${ORIGIN}/GOOGLE_GEMINI_BASE_URL`,
      OPENAI_BASE_URL: `${ORIGIN}/OPENAI_BASE_URL`,
      ANTHROPIC_BASE_URL: `${ORIGIN}/ANTHROPIC_BASE_URL`,
      ANTHROPIC_API_BASE: `${ORIGIN}/ANTHROPIC_API_BASE`,
      GEMINI_API_BASE: `${ORIGIN}/GEMINI_API_BASE`,
    });
    assert.deepEqual(
      variablesOf(redirections({}, ORIGIN)).map(({name}) => name),
      [
        'GOOGLE_GEMINI_BASE_URL',
        'OPENAI_BASE_URL',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_API_BASE',
        'GEMINI_API_BASE',
      ],
    );
  });

  it("forwards to the providers' own APIs when nothing is set", () => {
    assert.deepEqual(targetOf({}, 'GOOGLE_GEMINI_BASE_URL'), {
      kind: 'base',
      base: 'https://generativelanguage.googleapis.com',
    });
    assert.deepEqual(targetOf({}, 'OPENAI_BASE_URL'), {
      kind: 'base',
      base: 'https://api.openai.com/v1',
    });
    assert.deepEqual(targetOf({}, 'ANTHROPIC_BASE_URL'), {
      kind: 'base',
      base: 'https://api.anthropic.com',
    });
    assert.deepEqual(targetOf({}, 'ANTHROPIC_API_BASE'), {
      kind: 'base',
      base: 'https://api.anthropic.com',
    });
    assert.deepEqual(targetOf({}, 'GEMINI_API_BASE'), {kind: 'litellm_gemini'});
  });

  it('forwards to what each client would have resolved from the original values', () => {
    const env = {
      GOOGLE_GEMINI_BASE_URL: 'https://gemini.example/',
      OPENAI_API_BASE: 'https://openai.example/v1',
      ANTHROPIC_BASE_URL: 'https://anthropic.example',
      GEMINI_API_BASE: 'https://litellm-gemini.example/v1beta',
    };
    assert.deepEqual(targetOf(env, 'GOOGLE_GEMINI_BASE_URL'), {
      kind: 'base',
      base: 'https://gemini.example',
    });
    assert.deepEqual(targetOf(env, 'OPENAI_BASE_URL'), {
      kind: 'base',
      base: 'https://openai.example/v1',
    });
    assert.deepEqual(
      targetOf({...env, OPENAI_BASE_URL: 'https://first.example/v1'}, 'OPENAI_BASE_URL'),
      {kind: 'base', base: 'https://first.example/v1'},
    );
    assert.deepEqual(targetOf(env, 'ANTHROPIC_BASE_URL'), {
      kind: 'base',
      base: 'https://anthropic.example',
    });
    assert.deepEqual(targetOf(env, 'ANTHROPIC_API_BASE'), {
      kind: 'base',
      base: 'https://anthropic.example',
    });
    assert.deepEqual(
      targetOf(
        {ANTHROPIC_API_BASE: 'https://litellm-anthropic.example/v1/messages'},
        'ANTHROPIC_API_BASE',
      ),
      {kind: 'base', base: 'https://litellm-anthropic.example'},
    );
    assert.deepEqual(targetOf(env, 'GEMINI_API_BASE'), {
      kind: 'base',
      base: 'https://litellm-gemini.example/v1beta',
    });
  });

  it('counts an original value that points at the model proxy itself, or is blank, as unset', () => {
    for (const value of [
      `${ORIGIN}/OPENAI_BASE_URL`,
      'http://localhost:9822/OPENAI_BASE_URL',
      ' ',
      '',
    ]) {
      assert.deepEqual(targetOf({OPENAI_BASE_URL: value}, 'OPENAI_BASE_URL'), {
        kind: 'base',
        base: 'https://api.openai.com/v1',
      });
    }
    assert.deepEqual(targetOf({OPENAI_BASE_URL: 'http://localhost:9999/x'}, 'OPENAI_BASE_URL'), {
      kind: 'base',
      base: 'http://localhost:9999/x',
    });
  });

  it("forwards a prefix's call to the target with the rest of its path", () => {
    assert.equal(
      forwardTo({kind: 'base', base: 'https://api.anthropic.com'}, '/v1/messages?beta=true'),
      'https://api.anthropic.com/v1/messages?beta=true',
    );
    assert.equal(
      forwardTo({kind: 'litellm_gemini'}, '/models/gemini-2.5-flash:streamGenerateContent?alt=sse'),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    assert.equal(
      forwardTo({kind: 'litellm_gemini'}, '/models/gemini-3-pro-preview:generateContent'),
      'https://generativelanguage.googleapis.com/v1alpha/models/gemini-3-pro-preview:generateContent',
    );
  });

  it('reads the variable a path names, and the rest', () => {
    assert.deepEqual(splitPrefix('/ANTHROPIC_BASE_URL/v1/messages?beta=true'), {
      name: 'ANTHROPIC_BASE_URL',
      rest: '/v1/messages?beta=true',
    });
    assert.deepEqual(splitPrefix('/GEMINI_API_BASE'), {name: 'GEMINI_API_BASE', rest: ''});
    assert.deepEqual(splitPrefix('/GEMINI_API_BASE?x=1'), {name: 'GEMINI_API_BASE', rest: '/?x=1'});
    assert.equal(splitPrefix('/v1/messages'), undefined);
    assert.equal(splitPrefix('/'), undefined);
    assert.equal(splitPrefix('/NOT_A_VARIABLE/v1'), undefined);
  });

  it('prints an export line per variable with where it forwards, credentials removed', () => {
    const {intro, exports, note} = attachLines(
      redirections({GEMINI_API_BASE: 'https://g.example/v1beta?key=secret'}, ORIGIN),
    );
    assert.match(intro, /set these in the agent's shell and restart it/);
    assert.deepEqual(exports, [
      `export GOOGLE_GEMINI_BASE_URL=${ORIGIN}/GOOGLE_GEMINI_BASE_URL  # forwards to https://generativelanguage.googleapis.com`,
      `export OPENAI_BASE_URL=${ORIGIN}/OPENAI_BASE_URL  # forwards to https://api.openai.com/v1`,
      `export ANTHROPIC_BASE_URL=${ORIGIN}/ANTHROPIC_BASE_URL  # forwards to https://api.anthropic.com`,
      `export ANTHROPIC_API_BASE=${ORIGIN}/ANTHROPIC_API_BASE  # forwards to https://api.anthropic.com`,
      `export GEMINI_API_BASE=${ORIGIN}/GEMINI_API_BASE  # forwards to https://g.example/v1beta?key=REMOVED`,
    ]);
    assert.match(note, /already sets one of them to another address/);
    assert.match(
      attachLines(redirections({}, ORIGIN)).exports[4],
      /forwards to https:\/\/generativelanguage\.googleapis\.com\/v1beta, or \/v1alpha for a gemini-3 model$/,
    );
  });
});
