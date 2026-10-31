import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {a2uiDelivery, byStart, modelCall, rawCall, T0} from '../testing/model_calls.ts';
import type {Prices} from './cost.ts';
import {failureOf, figuresOf, hitRatioOf, rowTextOf, usageOf} from './model_calls.ts';
import {problemsOf, failedModelCallsOf} from './problems.ts';
import {timelineOf} from './steps.ts';
import {insideLineOf} from './turn_calls.ts';

const START = Number(T0 / 1_000_000n);

describe('a model call’s row', () => {
  it('names the model as requested and the provider, or the host and the method and path for a call recorded raw', () => {
    const gemini = modelCall({
      spanId: 'a'.repeat(16),
      start: 70,
      end: 1880,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
    });
    assert.deepEqual(rowTextOf(gemini), {label: 'gemini-3.6-flash', target: 'Gemini'});
    assert.deepEqual(rowTextOf(rawCall('b'.repeat(16), 0, 1)), {
      label: 'openrouter.ai',
      target: 'POST /api/v1/chat/completions',
    });
  });

  it('is a step among the others by start time, named by its span id, the surfaces as they stood at its end', () => {
    const call = modelCall({spanId: 'c'.repeat(16), start: 45, end: 2600});
    const during = a2uiDelivery('d'.repeat(16), 1000);
    const after = a2uiDelivery('e'.repeat(16), 3000);
    const events = byStart(call, during, after);
    const rows = timelineOf(events, START);
    const row = rows.find(item => item.id === 'c'.repeat(16));
    assert.ok(row?.row === 'step');
    assert.equal(row.kind, 'call');
    assert.equal(row.icon, 'model');
    assert.equal(row.offsetMs, 45);
    assert.deepEqual(row.position, {eventIndex: 1});
    assert.deepEqual(
      rows.map(item => item.id),
      ['c'.repeat(16), `message-${'d'.repeat(16)}.0`, `message-${'e'.repeat(16)}.0`],
    );
    // In flight, the latest state shows.
    const inFlight = timelineOf([modelCall({spanId: 'f'.repeat(16), start: 45})], START)[0];
    assert.ok(inFlight.row === 'step');
    assert.equal(inFlight.position, undefined);
  });

  it('leaves out a span the receiver placed', () => {
    const span = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      attributes: {'a2ui.received.attributes': {}},
    });
    assert.deepEqual(timelineOf([span], START), []);
  });
});

describe('the usage', () => {
  it('shows every figure the API has, 0 when the record lacks it, Cache write on Anthropic alone', () => {
    const anthropic = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      usage: {input: 24562, output: 640, cacheRead: 22400, cacheWrite: 1850},
    });
    assert.deepEqual(
      figuresOf(anthropic).map(f => `${f.name} ${f.value}`),
      ['Input 24562', 'Output 640', 'Reasoning 0', 'Cache read 22400', 'Cache write 1850'],
    );
    const gemini = modelCall({
      spanId: 'b'.repeat(16),
      start: 0,
      end: 1,
      provider: 'gcp.gemini',
      usage: {input: 100, output: 5},
    });
    assert.deepEqual(
      figuresOf(gemini).map(f => f.name),
      ['Input', 'Output', 'Reasoning', 'Cache read'],
    );
    assert.equal(hitRatioOf(usageOf(gemini)), 0);
  });

  it('has a hit ratio of the cache reads over the input tokens, cached ones included, and none without input', () => {
    assert.equal(hitRatioOf({input: 100, cacheRead: 64}), 0.64);
    assert.equal(hitRatioOf({output: 5}), undefined);
  });
});

describe('a failed model call', () => {
  const failed = (type: string, extra: Record<string, unknown> = {}, message?: string) =>
    modelCall({
      spanId: 'a'.repeat(16),
      start: 66,
      end: 312,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
      attributes: {'error.type': type, ...extra},
      status: {code: 2, ...(message !== undefined && {message})},
    });

  it('reads by the error’s kind, the code, the provider’s own status and the API on the second line', () => {
    assert.deepEqual(
      failureOf(
        failed(
          '429',
          {
            'http.response.status_code': 429,
            'a2ui.http.response.body': {
              error: {code: 429, message: 'Resource exhausted.', status: 'RESOURCE_EXHAUSTED'},
            },
          },
          'Resource exhausted.',
        ),
      ),
      {
        sentence: 'The model API answered 429 Too Many Requests.',
        code: 'HTTP 429 · RESOURCE_EXHAUSTED · Gemini API',
        note: 'Resource exhausted.',
      },
    );
    assert.equal(
      failureOf(failed('overloaded_error', {'gen_ai.provider.name': 'anthropic'}))?.sentence,
      'The stream carried an error: overloaded_error.',
    );
    assert.deepEqual(failureOf(failed('ECONNREFUSED')), {
      sentence: 'The provider could not be reached: ECONNREFUSED.',
      code: 'ECONNREFUSED · Gemini API',
    });
    assert.equal(
      failureOf(failed('aborted'))?.sentence,
      'The connection closed before the response ended.',
    );
    assert.equal(failureOf(modelCall({spanId: 'b'.repeat(16), start: 0, end: 1})), undefined);
  });

  it('is a problem on its row, counted as the listing counts it', () => {
    const call = failed('429', {'http.response.status_code': 429});
    const events = [call, modelCall({spanId: 'b'.repeat(16), start: 400, end: 900})];
    const problems = problemsOf(events, timelineOf(events, START), []);
    assert.deepEqual(
      problems.map(problem => problem.stepId),
      ['a'.repeat(16)],
    );
    assert.equal(failedModelCallsOf(events), 1);
  });
});

describe('the header’s second line', () => {
  const prices: Prices = {
    release: 'v1.106.6',
    date: '2026-10-28',
    entries: {
      'claude-sonnet-5-5': {
        litellm_provider: 'anthropic',
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
        cache_read_input_token_cost: 0.3e-6,
        cache_creation_input_token_cost: 3.75e-6,
      },
    },
    overrides: {},
  };

  it('times the first token and the first component, counts the calls, sums their tokens, cache share and cost', () => {
    const events = byStart(
      modelCall({
        spanId: 'a'.repeat(16),
        start: 52,
        end: 6100,
        chunks: [1950, 3000],
        usage: {input: 24562, output: 640, cacheRead: 22400, cacheWrite: 1850},
      }),
      a2uiDelivery('d'.repeat(16), 2300),
    );
    assert.equal(
      insideLineOf(events, START, prices)?.join(' · '),
      'First token 1.9 s · First component 2.3 s · 1 model call · 24.6k in · 640 out · 91% from cache · Est. $0.024 · LiteLLM prices 2026-10-28',
    );
  });

  it('counts a call unpriced and calls recorded raw, and has no cache share or cost without them', () => {
    const unknown = modelCall({
      spanId: 'a'.repeat(16),
      start: 10,
      end: 900,
      model: 'my-model',
      usage: {input: 800, output: 20},
    });
    const priced = modelCall({
      spanId: 'b'.repeat(16),
      start: 1000,
      end: 2000,
      usage: {input: 1000, output: 10},
    });
    assert.equal(
      insideLineOf([unknown, priced], START, prices)?.join(' · '),
      'First token 900 ms · 2 model calls · 1.8k in · 30 out · Est. $0.0032 · 1 call unpriced · LiteLLM prices 2026-10-28',
    );
    const raw = [rawCall('c'.repeat(16), 44, 1900), rawCall('d'.repeat(16), 1950, 6400)];
    assert.equal(
      insideLineOf(raw, START, prices)?.join(' · '),
      'First token 1.9 s · 2 model calls · 2 calls recorded raw',
    );
    assert.equal(insideLineOf([a2uiDelivery('e'.repeat(16), 10)], START, prices), undefined);
  });

  it("notes the config's prices when every priced call used them, and grows as a live turn's calls end", () => {
    const withOverride: Prices = {
      ...prices,
      overrides: {'claude-sonnet-5-5': {input: 1, output: 2}},
    };
    const ended = modelCall({
      spanId: 'a'.repeat(16),
      start: 10,
      end: 900,
      usage: {input: 1000, output: 100},
    });
    const inFlight = modelCall({spanId: 'b'.repeat(16), start: 1000, usage: {input: 5000}});
    assert.equal(
      insideLineOf([ended, inFlight], START, withOverride)?.join(' · '),
      'First token 900 ms · 2 model calls · 1.0k in · 100 out · Est. $0.0012 · Prices from the config',
    );
  });
});
