import type { Db } from "./db.js";
import { log } from "./log.js";
import { refreshPrices } from "./pricing.js";
import { utcDay, writeDailySummary } from "./summary.js";
import type { UpstreamProvider } from "./upstream.js";

export interface DailyResult {
  day: string;
  models: number | null;
  priceRefresh: "ok" | "skipped" | "failed";
}

/** Refresh cached prices, store yesterday's UTC summary, and drop stale rate-limit rows. */
export async function runDailyJob(pool: Db, provider: UpstreamProvider | null): Promise<DailyResult> {
  let models: number | null = null;
  let priceRefresh: DailyResult["priceRefresh"] = "skipped";
  if (provider) {
    try {
      models = await refreshPrices(pool, provider);
      priceRefresh = "ok";
      log("info", "daily price refresh", { models });
    } catch (err) {
      priceRefresh = "failed";
      log("error", "daily price refresh failed", { name: err instanceof Error ? err.name : "error" });
    }
  } else {
    log("warn", "UPSTREAM_API_KEY is not set; skipped the price refresh");
  }
  const day = utcDay(-1);
  await writeDailySummary(pool, day);
  await pool.query(`DELETE FROM rate_buckets WHERE window_start < now() - INTERVAL '2 days'`);
  log("info", "daily summary stored", { day });
  return { day, models, priceRefresh };
}
