import type { Db } from "./db.js";

export function utcDay(offsetDays: number, now = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  return day.toISOString().slice(0, 10);
}

/** Singapore-day rollup: readings created, balance spent, and deposits. */
export async function writeDailySummary(pool: Db, day: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  await pool.query(
    `INSERT INTO daily_summaries (
       day, request_count, prompt_tokens, completion_tokens,
       upstream_cost_usd, charged_usd, markup_revenue_usd, deposit_usd, model_count
     )
     SELECT $1::date,
            (SELECT COUNT(*)::int FROM reading_cache WHERE day = $1::date),
            0,
            0,
            0,
            COALESCE((
              SELECT SUM(amount_usd) FROM charges
              WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
            ), 0),
            COALESCE((
              SELECT SUM(amount_usd) FROM charges
              WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
            ), 0),
            COALESCE((
              SELECT SUM(amount_usd) FROM deposits
              WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
            ), 0),
            (SELECT COUNT(*)::int FROM reading_cache WHERE day = $1::date AND source = 'llm')
     ON CONFLICT (day) DO UPDATE SET
       request_count = EXCLUDED.request_count,
       prompt_tokens = EXCLUDED.prompt_tokens,
       completion_tokens = EXCLUDED.completion_tokens,
       upstream_cost_usd = EXCLUDED.upstream_cost_usd,
       charged_usd = EXCLUDED.charged_usd,
       markup_revenue_usd = EXCLUDED.markup_revenue_usd,
       deposit_usd = EXCLUDED.deposit_usd,
       model_count = EXCLUDED.model_count,
       created_at = now()`,
    [day],
  );
}
