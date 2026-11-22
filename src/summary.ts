import type { Db } from "./db.js";

export function utcDay(offsetDays: number, now = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  return day.toISOString().slice(0, 10);
}

export async function writeDailySummary(pool: Db, day: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  await pool.query(
    `INSERT INTO daily_summaries (
       day, request_count, prompt_tokens, completion_tokens,
       upstream_cost_usd, charged_usd, markup_revenue_usd, deposit_usd, model_count
     )
     SELECT $1::date,
            u.request_count,
            u.prompt_tokens,
            u.completion_tokens,
            u.upstream_cost_usd,
            u.charged_usd,
            u.markup_revenue_usd,
            d.deposit_usd,
            m.model_count
     FROM (
       SELECT COUNT(*)::int AS request_count,
              COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
              COALESCE(SUM(upstream_cost_usd), 0) AS upstream_cost_usd,
              COALESCE(SUM(charged_usd), 0) AS charged_usd,
              COALESCE(SUM(charged_usd - upstream_cost_usd), 0) AS markup_revenue_usd
       FROM usage_logs
       WHERE status IN ('settled', 'settled_short')
         AND created_at >= $1::date
         AND created_at < ($1::date + INTERVAL '1 day')
     ) u
     CROSS JOIN (
       SELECT COALESCE(SUM(amount_usd), 0) AS deposit_usd
       FROM deposits
       WHERE created_at >= $1::date
         AND created_at < ($1::date + INTERVAL '1 day')
     ) d
     CROSS JOIN (
       SELECT COUNT(*)::int AS model_count FROM model_prices
     ) m
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
