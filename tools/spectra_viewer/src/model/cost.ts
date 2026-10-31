/**
 * A model call's estimated cost, from LiteLLM's price table as Spectra copied
 * it or from the config's price for the model, and how cost and token counts
 * read. Computed when shown; the record does not carry it.
 */
import {isReadInFull, type Usage, usageOf} from './model_calls.ts';
import type {ModelCallEvent} from './record.ts';

/** A model's price from the config, in USD per million tokens. */
export interface PriceOverride {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** What `GET /api/prices` serves. */
export interface Prices {
  /** The table's release, such as `v1.106.6`. */
  release: string;
  /** Its date, as `YYYY-MM-DD`. */
  date: string;
  /** LiteLLM's entries, keyed as its table keys them. */
  entries: Readonly<Record<string, PriceEntry>>;
  /** The config's prices, by model id as requested. */
  overrides: Readonly<Record<string, PriceOverride>>;
}

/** An entry of LiteLLM's table: its provider and its prices per token, among other fields. */
export interface PriceEntry {
  litellm_provider?: string;
  [field: string]: unknown;
}

/** The price a call is matched to: the config's, a table entry, or none. */
export type CallPrice =
  | {source: 'config'; override: PriceOverride}
  | {source: 'table'; entry: PriceEntry}
  | {source: 'none'; model: string};

/** The record's provider names, as LiteLLM's table names them. */
const TABLE_PROVIDERS: Record<string, string> = {
  'gcp.gemini': 'gemini',
  openai: 'openai',
  anthropic: 'anthropic',
};

/**
 * The price for a call: the config's for the model id as requested, first;
 * then, among the table's entries of the call's provider, the one whose key,
 * less the `gemini/` prefix, is the model id as requested, else as the
 * response named it. Nothing is stripped from or added to a model id.
 */
export function priceOf(call: ModelCallEvent, prices: Prices): CallPrice {
  const requested = call.attributes['gen_ai.request.model'];
  const responded = call.attributes['gen_ai.response.model'];
  const model = typeof requested === 'string' ? requested : undefined;
  if (model !== undefined && Object.prototype.hasOwnProperty.call(prices.overrides, model)) {
    return {source: 'config', override: prices.overrides[model]};
  }
  const provider = TABLE_PROVIDERS[String(call.attributes['gen_ai.provider.name'])];
  const ids = [model, typeof responded === 'string' ? responded : undefined];
  for (const id of ids) {
    if (id === undefined || provider === undefined) continue;
    for (const [key, entry] of Object.entries(prices.entries)) {
      if (entry.litellm_provider === provider && key.replace(/^gemini\//, '') === id) {
        return {source: 'table', entry};
      }
    }
  }
  return {source: 'none', model: model ?? (typeof responded === 'string' ? responded : '')};
}

/** The four rates a threshold can move, by the prefix of their keys. */
const RATE_KEYS = {
  input: 'input_cost_per_token',
  output: 'output_cost_per_token',
  cacheRead: 'cache_read_input_token_cost',
  cacheWrite: 'cache_creation_input_token_cost',
} as const;

type Rates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** The reasoning tokens' own rate, when the entry has one. */
  reasoning?: number;
};

function rate(entry: PriceEntry, key: string): number | undefined {
  const value = entry[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An above-threshold key: one of the four rates, `_above_<N>[k]_tokens`, with no tier after it. */
const THRESHOLD_KEY =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_(\d+)(k?)_tokens$/;

/**
 * An entry's rates per token for a call of `inputTokens`: its own, then, for
 * each threshold the input exceeds, lowest first, each rate the entry prices
 * above that threshold, as LiteLLM's own calculation does. A cache rate the
 * entry lacks is the input rate.
 */
function entryRates(entry: PriceEntry, inputTokens: number): Rates {
  const rates: Partial<Rates> = {
    input: rate(entry, RATE_KEYS.input) ?? 0,
    output: rate(entry, RATE_KEYS.output) ?? 0,
    cacheRead: rate(entry, RATE_KEYS.cacheRead),
    cacheWrite: rate(entry, RATE_KEYS.cacheWrite),
    reasoning: rate(entry, 'output_cost_per_reasoning_token'),
  };
  const thresholds = Object.keys(entry)
    .flatMap(key => {
      const match = THRESHOLD_KEY.exec(key);
      const value = rate(entry, key);
      if (match === null || value === undefined) return [];
      const [, prefix, digits, k] = match;
      const name = (Object.keys(RATE_KEYS) as Array<keyof typeof RATE_KEYS>).find(
        kind => RATE_KEYS[kind] === prefix,
      )!;
      return [{name, tokens: Number(digits) * (k === 'k' ? 1000 : 1), value}];
    })
    .sort((a, b) => a.tokens - b.tokens);
  for (const {name, tokens, value} of thresholds) {
    if (inputTokens > tokens) rates[name] = value;
  }
  return {
    input: rates.input!,
    output: rates.output!,
    cacheRead: rates.cacheRead ?? rates.input!,
    cacheWrite: rates.cacheWrite ?? rates.input!,
    ...(rates.reasoning !== undefined && {reasoning: rates.reasoning}),
  };
}

/** The config's rates per token: per million as written, a cache price it lacks the input price. */
function overrideRates(override: PriceOverride): Rates {
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return {
    input: perToken(override.input),
    output: perToken(override.output),
    cacheRead: perToken(override.cacheRead ?? override.input),
    cacheWrite: perToken(override.cacheWrite ?? override.input),
  };
}

/**
 * The cost of a call's usage at a price: the uncached input, the input less
 * the cache read and cache write tokens, at the input rate; the cache read
 * and write tokens at theirs; the reasoning tokens at the reasoning rate when
 * there is one and the rest of the output at the output rate.
 */
export function costOf(usage: Usage, price: Exclude<CallPrice, {source: 'none'}>): number {
  const input = usage.input ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const output = usage.output ?? 0;
  const rates =
    price.source === 'config' ? overrideRates(price.override) : entryRates(price.entry, input);
  const reasoning = rates.reasoning === undefined ? 0 : Math.min(usage.reasoning ?? 0, output);
  return (
    Math.max(0, input - cacheRead - cacheWrite) * rates.input +
    cacheRead * rates.cacheRead +
    cacheWrite * rates.cacheWrite +
    reasoning * (rates.reasoning ?? 0) +
    (output - reasoning) * rates.output
  );
}

/** A call's estimate: its cost and where its price came from, or why it has none. */
export type CallCost =
  | {kind: 'priced'; usd: number; source: 'config' | 'table'}
  | {kind: 'unpriced'; model: string}
  /** No usage to price: a call recorded raw, or one with no input tokens, such as a failed call. */
  | {kind: 'none'};

export function callCostOf(call: ModelCallEvent, prices: Prices | undefined): CallCost {
  const usage = usageOf(call);
  if (!isReadInFull(call) || usage.input === undefined || prices === undefined)
    return {kind: 'none'};
  const price = priceOf(call, prices);
  if (price.source === 'none') return {kind: 'unpriced', model: price.model};
  return {kind: 'priced', usd: costOf(usage, price), source: price.source};
}

/** A cost in dollars, to two significant figures and at most four decimals: $0.024, $0.20, $0.0009. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  const rounded = Number(usd.toPrecision(2));
  const magnitude = Math.floor(Math.log10(Math.abs(rounded)));
  return `$${rounded.toFixed(Math.min(4, Math.max(0, 1 - magnitude)))}`;
}

/** A token total in brief: "9.1k" above a thousand, "640" below. */
export function formatTokensBrief(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/** A token count in full, "24,562". */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US');
}

/** A share as a whole percentage, "91%". */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}
