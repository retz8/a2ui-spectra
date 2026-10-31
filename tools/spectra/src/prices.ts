/**
 * LiteLLM's price table, copied at a pinned release and trimmed to the
 * entries of the three providers the model proxy reads in full, each entry
 * as the release has it. `_dev/tools/copy_litellm_prices.py` writes the copy
 * and its NOTICE in `prices/`. The viewer estimates each call's cost from it.
 */
import entries from './prices/model_prices_and_context_window.json' with {type: 'json'};
import release from './prices/release.json' with {type: 'json'};
import type {PriceOverride} from './config.js';

/** What `GET /api/prices` answers. */
export interface PricesAnswer {
  /** The release the table was copied at, such as `v1.106.6`. */
  release: string;
  /** Its date, as `YYYY-MM-DD`. */
  date: string;
  /** The table's entries, keyed as the release keys them. */
  entries: Readonly<Record<string, unknown>>;
  /** The config file's prices, by model id as requested. */
  overrides: Readonly<Record<string, PriceOverride>>;
}

/** The table, with the config's overrides. */
export function pricesAnswer(overrides: Readonly<Record<string, PriceOverride>>): PricesAnswer {
  return {
    release: release.release,
    date: release.date,
    entries: entries as Readonly<Record<string, unknown>>,
    overrides,
  };
}
