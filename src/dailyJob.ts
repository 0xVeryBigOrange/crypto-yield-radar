import type { Db } from "./db.js";
import { log } from "./log.js";
import type { Llm } from "./llm.js";
import { ensureOmen } from "./product.js";
import { writeDailySummary } from "./summary.js";
import { sgDay, usSessionDate } from "./time.js";

export interface DailyResult {
  day: string;
  usSession: string;
  models: number | null;
  priceRefresh: "ok" | "skipped" | "failed";
  omen: "ready" | "failed";
}

/**
 * Materialize today's shared omens, fold the Singapore day into daily_summaries,
 * and drop personal readings older than 180 days. The GitHub workflow calls this
 * through POST /internal/daily; the omen date itself rolls at 00:00 Asia/Singapore.
 */
export async function runDailyJob(pool: Db, llm: Llm | null): Promise<DailyResult> {
  const day = sgDay();
  const usSession = usSessionDate();
  let priceRefresh: DailyResult["priceRefresh"] = llm ? "ok" : "skipped";
  let models: number | null = llm ? 0 : null;
  let omen: DailyResult["omen"] = "ready";
  try {
    const sg = await ensureOmen(pool, llm, "sg", day);
    const us = await ensureOmen(pool, llm, "us", usSession);
    if (llm) models = [sg, us].filter((item) => item.source === "llm").length;
    log("info", "daily omens ready", { day, usSession, models });
  } catch (err) {
    omen = "failed";
    if (llm) priceRefresh = "failed";
    log("error", "daily omen refresh failed", { name: err instanceof Error ? err.name : "error" });
  }
  await writeDailySummary(pool, day);
  await pool.query(`DELETE FROM reading_cache WHERE kind <> 'omen' AND created_at < now() - INTERVAL '180 days'`);
  return { day, usSession, models, priceRefresh, omen };
}
