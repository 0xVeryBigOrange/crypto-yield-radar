import { randomUUID } from "node:crypto";
import {
  applyAdjust,
  applyMarkup,
  applyRelease,
  applyReserve,
  applySettle,
  impliedUpstream,
  type TokenCounts,
} from "./billing.js";
import type { Db } from "./db.js";
import { withTx } from "./db.js";
import { formatFull, formatUsd, parseDecimal } from "./money.js";
import type { ChainId } from "./payments.js";

interface UserMoney {
  balance: bigint;
  reserved: bigint;
}

export async function reserveFunds(
  pool: Db,
  userId: string,
  apiKeyId: string,
  amount: bigint,
): Promise<{ ok: true; id: string; available: string } | { ok: false; available: string }> {
  return withTx(pool, async (client) => {
    const row = await client.query<{ balance_usd: string; reserved_usd: string }>(
      `SELECT balance_usd::text, reserved_usd::text FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const current = readMoney(row.rows[0]);
    const next = applyReserve(current, amount);
    if (!next.ok) return { ok: false as const, available: formatUsd(current.balance) };
    await client.query(
      `UPDATE users SET balance_usd = $2::numeric, reserved_usd = $3::numeric WHERE id = $1`,
      [userId, formatFull(next.state.balance), formatFull(next.state.reserved)],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO reservations (id, user_id, api_key_id, amount_usd, status)
       VALUES ($1, $2, $3, $4::numeric, 'held')`,
      [id, userId, apiKeyId, formatFull(amount)],
    );
    return { ok: true as const, id, available: formatUsd(next.state.balance) };
  });
}

export async function settleReservation(
  pool: Db,
  opts: {
    reservationId: string;
    userId: string;
    apiKeyId: string;
    model: string;
    markup: bigint;
    upstreamCost: bigint | null;
    tokens: TokenCounts;
    settlement: "usage" | "estimated";
  },
): Promise<void> {
  await withTx(pool, async (client) => {
    const reservation = await client.query<{ amount_usd: string; status: string }>(
      `SELECT amount_usd::text, status FROM reservations WHERE id = $1 FOR UPDATE`,
      [opts.reservationId],
    );
    const held = reservation.rows[0];
    if (!held || held.status !== "held") return;
    const reservedAmount = parseDecimal(held.amount_usd);
    const user = await client.query<{ balance_usd: string; reserved_usd: string }>(
      `SELECT balance_usd::text, reserved_usd::text FROM users WHERE id = $1 FOR UPDATE`,
      [opts.userId],
    );
    const upstream = opts.upstreamCost ?? impliedUpstream(reservedAmount, opts.markup);
    const actual = opts.settlement === "estimated" ? reservedAmount : applyMarkup(upstream, opts.markup);
    const settled = applySettle(readMoney(user.rows[0]), reservedAmount, actual);
    const status = settled.shortfall > 0n ? "settled_short" : "settled";
    await client.query(
      `UPDATE users SET balance_usd = $2::numeric, reserved_usd = $3::numeric WHERE id = $1`,
      [opts.userId, formatFull(settled.state.balance), formatFull(settled.state.reserved)],
    );
    await client.query(`UPDATE reservations SET status = $2, updated_at = now() WHERE id = $1`, [
      opts.reservationId,
      status,
    ]);
    await client.query(
      `INSERT INTO usage_logs (
         id, user_id, api_key_id, reservation_id, model, prompt_tokens, completion_tokens,
         upstream_cost_usd, charged_usd, markup, status, settlement
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12
       )`,
      [
        randomUUID(),
        opts.userId,
        opts.apiKeyId,
        opts.reservationId,
        opts.model,
        opts.tokens.promptTokens,
        opts.tokens.completionTokens,
        formatFull(upstream),
        formatFull(settled.charged),
        formatFull(opts.markup),
        status,
        opts.settlement,
      ],
    );
  });
}

export async function releaseReservation(
  pool: Db,
  opts: { reservationId: string; userId: string; apiKeyId: string; model: string; markup: bigint },
): Promise<void> {
  await withTx(pool, async (client) => {
    const reservation = await client.query<{ amount_usd: string; status: string }>(
      `SELECT amount_usd::text, status FROM reservations WHERE id = $1 FOR UPDATE`,
      [opts.reservationId],
    );
    const held = reservation.rows[0];
    if (!held || held.status !== "held") return;
    const amount = parseDecimal(held.amount_usd);
    const user = await client.query<{ balance_usd: string; reserved_usd: string }>(
      `SELECT balance_usd::text, reserved_usd::text FROM users WHERE id = $1 FOR UPDATE`,
      [opts.userId],
    );
    const next = applyRelease(readMoney(user.rows[0]), amount);
    await client.query(
      `UPDATE users SET balance_usd = $2::numeric, reserved_usd = $3::numeric WHERE id = $1`,
      [opts.userId, formatFull(next.balance), formatFull(next.reserved)],
    );
    await client.query(`UPDATE reservations SET status = 'released', updated_at = now() WHERE id = $1`, [
      opts.reservationId,
    ]);
    await client.query(
      `INSERT INTO usage_logs (
         id, user_id, api_key_id, reservation_id, model, prompt_tokens, completion_tokens,
         upstream_cost_usd, charged_usd, markup, status, settlement
       ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, $6::numeric, 'released', 'none')`,
      [randomUUID(), opts.userId, opts.apiKeyId, opts.reservationId, opts.model, formatFull(opts.markup)],
    );
  });
}

export async function creditDeposit(
  pool: Db,
  opts: {
    userId: string;
    chain: ChainId;
    txHash: string;
    token: string;
    amountUsd: bigint;
    fromAddress: string;
    confirmations: number;
  },
): Promise<{ ok: true } | { ok: false; code: "already_credited" }> {
  return withTx(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO deposits (
         id, user_id, chain, tx_hash, token_symbol, amount_usd, from_address, confirmations
       ) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
       ON CONFLICT (chain, tx_hash) DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        opts.userId,
        opts.chain,
        opts.txHash,
        opts.token,
        formatFull(opts.amountUsd),
        opts.fromAddress,
        opts.confirmations,
      ],
    );
    if (inserted.rowCount === 0) return { ok: false as const, code: "already_credited" as const };
    await client.query(`UPDATE users SET balance_usd = balance_usd + $2::numeric WHERE id = $1`, [
      opts.userId,
      formatFull(opts.amountUsd),
    ]);
    return { ok: true as const };
  });
}

export async function adjustBalance(
  pool: Db,
  opts: { email: string; delta: bigint; reason: string },
): Promise<{ ok: true; balance: string } | { ok: false; code: "not_found" | "insufficient_balance" }> {
  return withTx(pool, async (client) => {
    const user = await client.query<{ id: string; balance_usd: string }>(
      `SELECT id, balance_usd::text FROM users WHERE email = $1 FOR UPDATE`,
      [opts.email],
    );
    const row = user.rows[0];
    if (!row) return { ok: false as const, code: "not_found" as const };
    const next = applyAdjust(parseDecimal(row.balance_usd), opts.delta);
    if (!next.ok) return { ok: false as const, code: "insufficient_balance" as const };
    await client.query(`UPDATE users SET balance_usd = $2::numeric WHERE id = $1`, [
      row.id,
      formatFull(next.balance),
    ]);
    await client.query(
      `INSERT INTO balance_adjustments (id, user_id, delta_usd, reason) VALUES ($1, $2, $3::numeric, $4)`,
      [randomUUID(), row.id, formatFull(opts.delta), opts.reason],
    );
    return { ok: true as const, balance: formatUsd(next.balance) };
  });
}

export async function consumeRateLimit(
  pool: Db,
  apiKeyId: string,
  limit: number,
): Promise<{ allowed: boolean; limit: number; remaining: number; resetEpoch: number }> {
  const result = await pool.query<{ hits: number }>(
    `INSERT INTO rate_buckets (api_key_id, window_start, hits)
     VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (api_key_id, window_start)
     DO UPDATE SET hits = rate_buckets.hits + 1
     WHERE rate_buckets.hits < $2
     RETURNING hits`,
    [apiKeyId, limit],
  );
  const resetEpoch = Math.ceil(Date.now() / 60_000) * 60;
  if (result.rowCount === 0) {
    return { allowed: false, limit, remaining: 0, resetEpoch };
  }
  const hits = result.rows[0]?.hits ?? limit;
  return { allowed: true, limit, remaining: Math.max(0, limit - hits), resetEpoch };
}

function readMoney(row: { balance_usd: string; reserved_usd: string } | undefined): UserMoney {
  if (!row) throw new Error("user not found");
  return { balance: parseDecimal(row.balance_usd), reserved: parseDecimal(row.reserved_usd) };
}
