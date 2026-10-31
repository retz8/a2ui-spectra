import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

import {modelCall, rawCall} from '../testing/model_calls.ts';
import {
  callCostOf,
  costOf,
  formatCost,
  formatShare,
  formatTokensBrief,
  type PriceEntry,
  priceOf,
  type Prices,
} from './cost.ts';

/** The table as Spectra copied it, in the tool's workspace. */
const COPIED = JSON.parse(
  readFileSync(
    new URL('../../../spectra/src/prices/model_prices_and_context_window.json', import.meta.url),
    'utf8',
  ),
) as Record<string, PriceEntry>;

function pricesOf(
  entries: Record<string, PriceEntry>,
  overrides: Prices['overrides'] = {},
): Prices {
  return {release: 'v1.106.6', date: '2026-10-28', entries, overrides};
}

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`);

describe('priceOf', () => {
  const entries: Record<string, PriceEntry> = {
    'gemini/gemini-3.6-flash': {litellm_provider: 'gemini', input_cost_per_token: 1},
    'claude-sonnet-5-5': {litellm_provider: 'anthropic', input_cost_per_token: 2},
    'gemini-3.6-flash': {litellm_provider: 'openai', input_cost_per_token: 3},
  };

  it("takes the config's price for the model as requested first", () => {
    const override = {input: 1, output: 2};
    const call = modelCall({spanId: 'a'.repeat(16), start: 0, end: 1, model: 'claude-sonnet-5-5'});
    assert.deepEqual(priceOf(call, pricesOf(entries, {'claude-sonnet-5-5': override})), {
      source: 'config',
      override,
    });
  });

  it("then the entry of the call's provider whose key, less gemini/, is the model as requested, else as responded", () => {
    const gemini = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
    });
    assert.deepEqual(priceOf(gemini, pricesOf(entries)), {
      source: 'table',
      entry: entries['gemini/gemini-3.6-flash'],
    });
    const responded = modelCall({
      spanId: 'b'.repeat(16),
      start: 0,
      end: 1,
      model: 'claude-latest',
      attributes: {'gen_ai.response.model': 'claude-sonnet-5-5'},
    });
    assert.equal(priceOf(responded, pricesOf(entries)).source, 'table');
  });

  it('strips and adds nothing to a model id, and names the model it has no price for', () => {
    const versioned = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash-001',
    });
    assert.deepEqual(priceOf(versioned, pricesOf(entries)), {
      source: 'none',
      model: 'gemini-3.6-flash-001',
    });
    const prefixed = modelCall({
      spanId: 'b'.repeat(16),
      start: 0,
      end: 1,
      provider: 'gcp.gemini',
      model: 'gemini/gemini-3.6-flash',
    });
    assert.equal(priceOf(prefixed, pricesOf(entries)).source, 'none');
  });
});

describe('costOf', () => {
  it('prices the uncached input, the cache reads and writes, and the output each at its own rate', () => {
    const entry: PriceEntry = {
      litellm_provider: 'anthropic',
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
      cache_read_input_token_cost: 0.3e-6,
      cache_creation_input_token_cost: 3.75e-6,
    };
    const usage = {input: 24562, output: 640, cacheRead: 22400, cacheWrite: 1850};
    close(
      costOf(usage, {source: 'table', entry}),
      312 * 3e-6 + 22400 * 0.3e-6 + 1850 * 3.75e-6 + 640 * 15e-6,
    );
  });

  it("prices the reasoning tokens at the entry's reasoning rate, the rest of the output at the output rate", () => {
    const entry: PriceEntry = {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 4e-6,
      output_cost_per_reasoning_token: 10e-6,
    };
    close(
      costOf({input: 100, output: 50, reasoning: 20}, {source: 'table', entry}),
      100e-6 + 20 * 10e-6 + 30 * 4e-6,
    );
    // Without a reasoning rate, all of the output is at the output rate.
    const plain: PriceEntry = {input_cost_per_token: 1e-6, output_cost_per_token: 4e-6};
    close(
      costOf({input: 100, output: 50, reasoning: 20}, {source: 'table', entry: plain}),
      100e-6 + 50 * 4e-6,
    );
  });

  it('prices every kind of token the entry prices above a threshold the input exceeds at that rate, tiers aside', () => {
    const entry: PriceEntry = {
      input_cost_per_token: 1e-6,
      input_cost_per_token_above_200k_tokens: 2e-6,
      input_cost_per_token_above_200k_tokens_priority: 9e-6,
      output_cost_per_token: 10e-6,
      output_cost_per_token_above_200k_tokens: 15e-6,
      cache_read_input_token_cost: 0.1e-6,
      cache_read_input_token_cost_above_200k_tokens: 0.2e-6,
      output_cost_per_token_batches: 1e-9,
    };
    close(costOf({input: 200_000, output: 10}, {source: 'table', entry}), 200_000e-6 + 10 * 10e-6);
    close(
      costOf({input: 300_000, output: 10, cacheRead: 100_000}, {source: 'table', entry}),
      200_000 * 2e-6 + 100_000 * 0.2e-6 + 10 * 15e-6,
    );
  });

  it('takes the highest threshold the input exceeds, and the input rate for a cache rate the entry lacks', () => {
    const entry: PriceEntry = {
      input_cost_per_token: 1e-6,
      input_cost_per_token_above_128k_tokens: 2e-6,
      input_cost_per_token_above_272k_tokens: 3e-6,
      output_cost_per_token: 1e-6,
    };
    close(costOf({input: 300_000, cacheWrite: 100_000}, {source: 'table', entry}), 300_000 * 3e-6);
    close(costOf({input: 150_000}, {source: 'table', entry}), 150_000 * 2e-6);
  });

  it("prices by the config's override per million tokens, a cache price it lacks at the input price", () => {
    const usage = {input: 1_000_000, output: 1_000_000, reasoning: 500_000, cacheRead: 400_000};
    close(costOf(usage, {source: 'config', override: {input: 1, output: 2}}), 1 + 2);
    close(
      costOf(usage, {source: 'config', override: {input: 1, output: 2, cacheRead: 0.1}}),
      0.6 + 0.04 + 2,
    );
  });
});

describe('callCostOf on the copied table', () => {
  it("prices the custom-components example's Gemini and Anthropic models", () => {
    const prices = pricesOf(COPIED);
    const gemini = modelCall({
      spanId: 'a'.repeat(16),
      start: 0,
      end: 1,
      provider: 'gcp.gemini',
      model: 'gemini-3.6-flash',
      usage: {input: 10_000, output: 1000, reasoning: 400, cacheRead: 4000},
    });
    const cost = callCostOf(gemini, prices);
    assert.ok(cost.kind === 'priced');
    // v1.106.6: input $0.75, cache read $0.075, output and reasoning $3.75 per million tokens.
    close(cost.usd, 6000 * 0.75e-6 + 4000 * 0.075e-6 + 1000 * 3.75e-6);
    const haiku = modelCall({
      spanId: 'b'.repeat(16),
      start: 0,
      end: 1,
      model: 'claude-haiku-5-5',
      usage: {input: 100, output: 10},
    });
    assert.equal(callCostOf(haiku, prices).kind, 'priced');
  });

  it('has none for a call recorded raw or with no input tokens, and names an unknown model', () => {
    const prices = pricesOf(COPIED);
    assert.deepEqual(callCostOf(rawCall('a'.repeat(16), 0, 1), prices), {kind: 'none'});
    assert.deepEqual(callCostOf(modelCall({spanId: 'b'.repeat(16), start: 0, end: 1}), prices), {
      kind: 'none',
    });
    assert.deepEqual(
      callCostOf(
        modelCall({spanId: 'c'.repeat(16), start: 0, end: 1, model: 'my-model', usage: {input: 1}}),
        prices,
      ),
      {kind: 'unpriced', model: 'my-model'},
    );
  });
});

describe('the figures', () => {
  it('round a cost to two significant figures and at most four decimals', () => {
    assert.deepEqual([0.0241, 0.2, 0.00087, 0.11, 1.234].map(formatCost), [
      '$0.024',
      '$0.20',
      '$0.0009',
      '$0.11',
      '$1.2',
    ]);
  });

  it('read a token total in brief above a thousand, and a share as a percentage', () => {
    assert.deepEqual([9100, 24562, 640].map(formatTokensBrief), ['9.1k', '24.6k', '640']);
    assert.equal(formatShare(22400 / 24562), '91%');
  });
});
