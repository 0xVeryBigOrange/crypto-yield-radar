import { applyMarkup, type TokenPrice } from "./billing.js";
import type { Db } from "./db.js";
import { withTx } from "./db.js";
import { log } from "./log.js";
import { formatFull, formatPrice, parseDecimal } from "./money.js";
import type { CatalogModel, UpstreamProvider } from "./upstream.js";

export interface PricedModel extends TokenPrice {
  id: string;
  name: string;
  contextLength: number | null;
  updatedAt: string;
}

export interface PublicPrice {
  id: string;
  name: string;
  contextLength: number | null;
  promptPerMillion: string;
  completionPerMillion: string;
  updatedAt: string;
}

let cache: { at: number; map: Map<string, PricedModel> } | null = null;
let refreshing: Promise<number> | null = null;
let lastRefreshAttempt = 0;

export function clearPriceCache(): void {
  cache = null;
}

export async function getPricedModel(pool: Db, id: string): Promise<PricedModel | null> {
  const map = await loadPrices(pool);
  return map.get(id) ?? null;
}

export async function listPrices(pool: Db, markup: bigint): Promise<PublicPrice[]> {
  const map = await loadPrices(pool);
  return [...map.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.contextLength,
      promptPerMillion: formatPrice(applyMarkup(model.promptPerToken, markup) * 1_000_000n),
      completionPerMillion: formatPrice(applyMarkup(model.completionPerToken, markup) * 1_000_000n),
      updatedAt: model.updatedAt,
    }));
}

export async function refreshPrices(pool: Db, provider: UpstreamProvider): Promise<number> {
  if (refreshing) return refreshing;
  refreshing = writePrices(pool, provider).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function refreshPricesIfStale(
  pool: Db,
  provider: UpstreamProvider,
  maxAgeMs: number,
): Promise<void> {
  if (Date.now() - lastRefreshAttempt < maxAgeMs) return;
  lastRefreshAttempt = Date.now();
  try {
    const count = await refreshPrices(pool, provider);
    log("info", "refreshed model prices", { models: count });
  } catch (err) {
    log("error", "model price refresh failed", {
      name: err instanceof Error ? err.name : "error",
    });
  }
}

async function loadPrices(pool: Db): Promise<Map<string, PricedModel>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const result = await pool.query<{
    model_id: string;
    name: string;
    prompt_per_token: string;
    completion_per_token: string;
    request_price: string;
    context_length: number | null;
    updated_at: Date | string;
  }>(
    `SELECT model_id, name, prompt_per_token::text, completion_per_token::text,
            request_price::text, context_length, updated_at
     FROM model_prices`,
  );
  const map = new Map<string, PricedModel>();
  for (const row of result.rows) {
    map.set(row.model_id, {
      id: row.model_id,
      name: row.name,
      promptPerToken: parseDecimal(row.prompt_per_token),
      completionPerToken: parseDecimal(row.completion_per_token),
      request: parseDecimal(row.request_price),
      contextLength: row.context_length,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    });
  }
  cache = { at: Date.now(), map };
  return map;
}

async function writePrices(pool: Db, provider: UpstreamProvider): Promise<number> {
  const models = await provider.listModels();
  const parsed: Array<CatalogModel & { prompt: string; completion: string; requestPrice: string }> = [];
  for (const model of models) {
    try {
      parsed.push({
        ...model,
        prompt: formatFull(parseDecimal(model.promptPerToken)),
        completion: formatFull(parseDecimal(model.completionPerToken)),
        requestPrice: formatFull(parseDecimal(model.request || "0")),
      });
    } catch {
      /* skip a row the upstream priced in a form we cannot bill */
    }
  }
  if (parsed.length === 0) throw new Error("upstream returned no priced models");
  await withTx(pool, async (client) => {
    for (const model of parsed) {
      await client.query(
        `INSERT INTO model_prices (
           model_id, name, prompt_per_token, completion_per_token, request_price, context_length, updated_at
         ) VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, now())
         ON CONFLICT (model_id) DO UPDATE SET
           name = EXCLUDED.name,
           prompt_per_token = EXCLUDED.prompt_per_token,
           completion_per_token = EXCLUDED.completion_per_token,
           request_price = EXCLUDED.request_price,
           context_length = EXCLUDED.context_length,
           updated_at = now()`,
        [model.id, model.name, model.prompt, model.completion, model.requestPrice, model.contextLength],
      );
    }
    await client.query(`DELETE FROM model_prices WHERE NOT (model_id = ANY($1::text[]))`, [
      parsed.map((model) => model.id),
    ]);
  });
  clearPriceCache();
  return parsed.length;
}
