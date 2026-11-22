import type { Express } from "express";
import { safeEqual } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { allowAttempt, asyncRoute, sendApiError } from "../http.js";
import { adjustBalance } from "../ledger.js";
import { parseDecimal, formatUsd } from "../money.js";
import { refreshPrices } from "../pricing.js";
import { utcDay, writeDailySummary } from "../summary.js";
import type { UpstreamProvider } from "../upstream.js";

export function registerAdminRoutes(
  app: Express,
  deps: { config: Config; pool: Db; provider: UpstreamProvider | null },
): void {
  app.use("/api/admin", (req, res, next) => {
    if (!deps.config.adminToken) {
      sendApiError(res, 503, "admin_disabled", "Set ADMIN_TOKEN to enable the admin API.");
      return;
    }
    const header = req.header("x-admin-token") ?? "";
    if (!header || !safeEqual(header, deps.config.adminToken)) {
      if (!allowAttempt(`admin:${req.ip}`, 8, 10 * 60 * 1000)) {
        sendApiError(res, 429, "rate_limited", "Too many admin attempts.");
        return;
      }
      sendApiError(res, 401, "unauthorized", "Admin token rejected.");
      return;
    }
    next();
  });

  app.get("/api/admin/overview", asyncRoute(async (_req, res) => {
    const totals = await deps.pool.query<{
      users: string;
      deposits: string;
      charged: string;
      upstream: string;
      revenue: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users)::text AS users,
         (SELECT COALESCE(SUM(amount_usd), 0) FROM deposits)::text AS deposits,
         (SELECT COALESCE(SUM(charged_usd), 0) FROM usage_logs WHERE status IN ('settled', 'settled_short'))::text AS charged,
         (SELECT COALESCE(SUM(upstream_cost_usd), 0) FROM usage_logs WHERE status IN ('settled', 'settled_short'))::text AS upstream,
         (SELECT COALESCE(SUM(charged_usd - upstream_cost_usd), 0) FROM usage_logs WHERE status IN ('settled', 'settled_short'))::text AS revenue`,
    );
    const row = totals.rows[0];
    const adjustments = await deps.pool.query<{
      id: string;
      email: string;
      delta_usd: string;
      reason: string;
      created_at: Date;
    }>(
      `SELECT a.id, u.email, a.delta_usd::text, a.reason, a.created_at
       FROM balance_adjustments a JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 50`,
    );
    res.json({
      users: Number(row?.users ?? 0),
      depositsUsd: money(row?.deposits),
      chargedUsd: money(row?.charged),
      upstreamUsd: money(row?.upstream),
      markupRevenueUsd: money(row?.revenue),
      adjustments: adjustments.rows.map((item) => ({
        id: item.id,
        email: item.email,
        deltaUsd: formatUsd(parseDecimal(item.delta_usd)),
        reason: item.reason,
        createdAt: item.created_at.toISOString(),
      })),
    });
  }));

  app.get("/api/admin/users", asyncRoute(async (_req, res) => {
    const rows = await deps.pool.query<{
      id: string;
      email: string;
      balance_usd: string;
      reserved_usd: string;
      created_at: Date;
    }>(
      `SELECT id, email, balance_usd::text, reserved_usd::text, created_at
       FROM users ORDER BY created_at DESC LIMIT 500`,
    );
    res.json({
      users: rows.rows.map((row) => ({
        id: row.id,
        email: row.email,
        balanceUsd: formatUsd(parseDecimal(row.balance_usd)),
        reservedUsd: formatUsd(parseDecimal(row.reserved_usd)),
        createdAt: row.created_at.toISOString(),
      })),
    });
  }));

  app.get("/api/admin/deposits", asyncRoute(async (_req, res) => {
    const rows = await deps.pool.query<{
      id: string;
      email: string;
      chain: string;
      tx_hash: string;
      token_symbol: string;
      amount_usd: string;
      confirmations: number;
      created_at: Date;
    }>(
      `SELECT d.id, u.email, d.chain, d.tx_hash, d.token_symbol, d.amount_usd::text, d.confirmations, d.created_at
       FROM deposits d JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC LIMIT 200`,
    );
    res.json({
      deposits: rows.rows.map((row) => ({
        id: row.id,
        email: row.email,
        chain: row.chain,
        txHash: row.tx_hash,
        token: row.token_symbol,
        amountUsd: formatUsd(parseDecimal(row.amount_usd)),
        confirmations: row.confirmations,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }));

  app.get("/api/admin/summaries", asyncRoute(async (_req, res) => {
    const rows = await deps.pool.query(
      `SELECT day::text, request_count, prompt_tokens::text, completion_tokens::text,
              upstream_cost_usd::text, charged_usd::text, markup_revenue_usd::text,
              deposit_usd::text, model_count, created_at
       FROM daily_summaries ORDER BY day DESC LIMIT 90`,
    );
    res.json({
      summaries: rows.rows.map((row) => ({
        day: row.day,
        requestCount: row.request_count,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        upstreamUsd: formatUsd(parseDecimal(row.upstream_cost_usd)),
        chargedUsd: formatUsd(parseDecimal(row.charged_usd)),
        markupRevenueUsd: formatUsd(parseDecimal(row.markup_revenue_usd)),
        depositUsd: formatUsd(parseDecimal(row.deposit_usd)),
        modelCount: row.model_count,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
    });
  }));

  app.post("/api/admin/adjustments", asyncRoute(async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!email || reason.length < 3 || reason.length > 200) {
      sendApiError(res, 400, "bad_adjustment", "Email and a reason of 3 to 200 characters are required.");
      return;
    }
    let delta: bigint;
    try {
      delta = parseDecimal(String(req.body?.deltaUsd ?? ""));
    } catch {
      sendApiError(res, 400, "bad_amount", "deltaUsd must be a decimal USD amount.");
      return;
    }
    if (delta === 0n) {
      sendApiError(res, 400, "bad_amount", "deltaUsd cannot be zero.");
      return;
    }
    const result = await adjustBalance(deps.pool, { email, delta, reason });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      sendApiError(res, status, result.code, result.code === "not_found" ? "User not found." : "Balance cannot go below zero.");
      return;
    }
    res.json({ email, balanceUsd: result.balance });
  }));

  app.post("/api/admin/refresh", asyncRoute(async (_req, res) => {
    if (!deps.provider) {
      sendApiError(res, 503, "upstream_unconfigured", "UPSTREAM_API_KEY is not set.");
      return;
    }
    const models = await refreshPrices(deps.pool, deps.provider);
    await writeDailySummary(deps.pool, utcDay(0));
    await writeDailySummary(deps.pool, utcDay(-1));
    res.json({ models, summarized: [utcDay(0), utcDay(-1)] });
  }));
}

function money(value: string | undefined): string {
  return formatUsd(parseDecimal(value ?? "0"));
}
