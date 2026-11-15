import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {agentEnvironment, ownEnvironment, pythonVariables} from './environment.js';

describe("Spectra's own environment", () => {
  it('finds a variable by its exact name on macOS and Linux', () => {
    const own = ownEnvironment({anthropic_base_url: 'https://x.example'}, 'linux');
    assert.equal(own.ANTHROPIC_BASE_URL, undefined);
    assert.equal(own.anthropic_base_url, 'https://x.example');
  });

  it('finds a variable in any case on Windows', () => {
    const own = ownEnvironment({anthropic_base_url: 'https://x.example', Path: 'C:\\bin'}, 'win32');
    assert.equal(own.ANTHROPIC_BASE_URL, 'https://x.example');
    assert.equal(own.PATH, 'C:\\bin');
    assert.ok('Anthropic_Base_Url' in own);
    assert.equal(own.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
    assert.ok(!('OTEL_EXPORTER_OTLP_ENDPOINT' in own));
  });
});

describe("the agent's environment", () => {
  const own = {otel_exporter_otlp_endpoint: 'http://collector:4318', HOME: '/home/a'};
  const added = {OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9823'};

  it('replaces only the variable of the same name on macOS and Linux', () => {
    assert.deepEqual(agentEnvironment(own, added, 'darwin'), {...own, ...added});
  });

  it("replaces the developer's variable of that name in any case on Windows", () => {
    assert.deepEqual(agentEnvironment(own, added, 'win32'), {HOME: '/home/a', ...added});
  });
});

describe('the variables set for a Python agent', () => {
  it('sets PYTHONUNBUFFERED under run unless it is set, and nothing else off Windows', () => {
    assert.deepEqual(pythonVariables({}, {unbuffered: true}, 'linux'), {PYTHONUNBUFFERED: '1'});
    assert.deepEqual(pythonVariables({PYTHONUNBUFFERED: ''}, {unbuffered: true}, 'linux'), {});
    assert.deepEqual(pythonVariables({}, {unbuffered: false}, 'darwin'), {});
  });

  it('sets PYTHONIOENCODING=utf-8 on Windows unless it or PYTHONUTF8 is set, in any case', () => {
    assert.deepEqual(pythonVariables({}, {unbuffered: false}, 'win32'), {
      PYTHONIOENCODING: 'utf-8',
    });
    for (const env of [{PYTHONIOENCODING: 'cp1252'}, {PYTHONUTF8: '1'}, {pythonutf8: '0'}]) {
      assert.deepEqual(
        pythonVariables(ownEnvironment(env, 'win32'), {unbuffered: false}, 'win32'),
        {},
      );
    }
  });
});
