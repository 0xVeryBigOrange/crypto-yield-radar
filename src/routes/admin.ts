import type { Express } from "express";
import { safeEqual } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { runDailyJob } from "../dailyJob.js";
import { allowAttempt, asyncRoute, sendApiError } from "../http.js";
import { adjustBalance } from "../ledger.js";
import type { Llm } from "../llm.js";
import { formatUsd, parseDecimal } from "../money.js";

export function registerAdminRoutes(app: Express, deps: { config: Config; pool: Db; llm: Llm | null }): void {
  app.use("/api/admin", (req, res, next) => {
    if (!deps.config.adminToken) {
      sendApiError(res, 503, "admin_disabled", "要先设置 ADMIN_TOKEN，管理接口才开门。");
      return;
    }
    const header = req.header("x-admin-token") ?? "";
    if (!header || !safeEqual(header, deps.config.adminToken)) {
      if (!allowAttempt(`admin:${req.ip}`, 8, 10 * 60 * 1000)) {
        sendApiError(res, 429, "rate_limited", "管理令牌试得太多了。");
        return;
      }
      sendApiError(res, 401, "unauthorized", "管理令牌不对。");
      return;
    }
    next();
  });

  app.get("/api/admin/overview", asyncRoute(async (_req, res) => {
    const totals = await deps.pool.query<{
      users: string;
      deposits: string;
      charged: string;
      passes: string;
      readings: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users)::text AS users,
         (SELECT COALESCE(SUM(amount_usd), 0) FROM deposits)::text AS deposits,
         (SELECT COALESCE(SUM(amount_usd), 0) FROM charges)::text AS charged,
         (SELECT COUNT(*) FROM users WHERE pass_until > now())::text AS passes,
         (SELECT COUNT(*) FROM reading_cache)::text AS readings`,
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
      passes: Number(row?.passes ?? 0),
      readings: Number(row?.readings ?? 0),
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
      nickname: string | null;
      balance_usd: string;
      pass_until: Date | null;
      referral_code: string | null;
      created_at: Date;
    }>(
      `SELECT id, email, nickname, balance_usd::text, pass_until, referral_code, created_at
       FROM users ORDER BY created_at DESC LIMIT 500`,
    );
    res.json({
      users: rows.rows.map((row) => ({
        id: row.id,
        email: row.email,
        nickname: row.nickname,
        balanceUsd: formatUsd(parseDecimal(row.balance_usd)),
        passUntil: row.pass_until ? row.pass_until.toISOString() : null,
        referralCode: row.referral_code,
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
      `SELECT day::text, request_count, charged_usd::text, markup_revenue_usd::text,
              deposit_usd::text, model_count, created_at
       FROM daily_summaries ORDER BY day DESC LIMIT 90`,
    );
    res.json({
      summaries: rows.rows.map((row) => ({
        day: row.day,
        readingCount: row.request_count,
        chargedUsd: formatUsd(parseDecimal(row.charged_usd)),
        depositUsd: formatUsd(parseDecimal(row.deposit_usd)),
        llmCount: row.model_count,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
    });
  }));

  app.post("/api/admin/adjustments", asyncRoute(async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!email || reason.length < 3 || reason.length > 200) {
      sendApiError(res, 400, "bad_adjustment", "需要邮箱，以及 3 到 200 字的原因。");
      return;
    }
    let delta: bigint;
    try {
      delta = parseDecimal(String(req.body?.deltaUsd ?? ""));
    } catch {
      sendApiError(res, 400, "bad_amount", "金额要写成数字。");
      return;
    }
    if (delta === 0n) {
      sendApiError(res, 400, "bad_amount", "金额不能是 0。");
      return;
    }
    const result = await adjustBalance(deps.pool, { email, delta, reason });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      sendApiError(res, status, result.code, result.code === "not_found" ? "没有这个用户。" : "余额不能扣成负数。");
      return;
    }
    res.json({ email, balanceUsd: result.balance });
  }));

  app.post("/api/admin/refresh", asyncRoute(async (_req, res) => {
    const result = await runDailyJob(deps.pool, deps.llm);
    res.json(result);
  }));
}

function money(value: string | undefined): string {
  return formatUsd(parseDecimal(value ?? "0"));
}
