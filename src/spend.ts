import { randomUUID } from "node:crypto";
import { PASS_DAYS, priceAmount } from "./catalog.js";
import type { Db } from "./db.js";
import { withTx } from "./db.js";
import { formatFull, formatUsd, parseDecimal } from "./money.js";

export type SpendDecision =
  | { via: "replay" }
  | { via: "pass" }
  | { via: "balance"; charge: bigint }
  | { via: "insufficient" };

export function decideSpend(input: {
  balance: bigint;
  passActive: boolean;
  already: boolean;
  amount: bigint;
  coverWithPass: boolean;
}): SpendDecision {
  if (input.already) return { via: "replay" };
  if (input.coverWithPass && input.passActive) return { via: "pass" };
  if (input.amount < 0n) return { via: "insufficient" };
  if (input.balance < input.amount) return { via: "insufficient" };
  return { via: "balance", charge: input.amount };
}

export interface SpendOk {
  ok: true;
  charged: bigint;
  balance: bigint;
  via: "replay" | "pass" | "balance";
}

export interface SpendFail {
  ok: false;
  code: "insufficient_balance";
  balance: bigint;
}

export async function spend(
  pool: Db,
  opts: { userId: string; amount: bigint; ref: string; kind: string; coverWithPass: boolean },
): Promise<SpendOk | SpendFail> {
  return withTx(pool, async (client) => {
    const user = await client.query<{ balance_usd: string; pass_until: Date | null }>(
      `SELECT balance_usd::text, pass_until FROM users WHERE id = $1 FOR UPDATE`,
      [opts.userId],
    );
    const row = user.rows[0];
    if (!row) throw new Error("user not found");
    const balance = parseDecimal(row.balance_usd);
    const existing = await client.query<{ amount_usd: string }>(
      `SELECT amount_usd::text FROM charges WHERE user_id = $1 AND ref = $2`,
      [opts.userId, opts.ref],
    );
    const decision = decideSpend({
      balance,
      passActive: row.pass_until != null && row.pass_until.getTime() > Date.now(),
      already: (existing.rowCount ?? 0) > 0,
      amount: opts.amount,
      coverWithPass: opts.coverWithPass,
    });
    if (decision.via === "insufficient") return { ok: false as const, code: "insufficient_balance" as const, balance };
    if (decision.via === "replay") {
      return {
        ok: true as const,
        charged: parseDecimal(existing.rows[0]?.amount_usd ?? "0"),
        balance,
        via: "replay" as const,
      };
    }
    const charge = decision.via === "pass" ? 0n : decision.charge;
    if (charge > 0n) {
      await client.query(`UPDATE users SET balance_usd = balance_usd - $2::numeric WHERE id = $1`, [
        opts.userId,
        formatFull(charge),
      ]);
    }
    await client.query(
      `INSERT INTO charges (id, user_id, kind, amount_usd, ref) VALUES ($1, $2, $3, $4::numeric, $5)`,
      [randomUUID(), opts.userId, opts.kind, formatFull(charge), opts.ref],
    );
    return {
      ok: true as const,
      charged: charge,
      balance: balance - charge,
      via: decision.via,
    };
  });
}

export async function purchasePass(
  pool: Db,
  userId: string,
  idempotencyKey: string,
): Promise<SpendOk | SpendFail> {
  const amount = priceAmount("monthPass");
  const ref = `pass:${idempotencyKey}`;
  return withTx(pool, async (client) => {
    const user = await client.query<{ balance_usd: string }>(
      `SELECT balance_usd::text FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = user.rows[0];
    if (!row) throw new Error("user not found");
    const balance = parseDecimal(row.balance_usd);
    const existing = await client.query<{ amount_usd: string }>(
      `SELECT amount_usd::text FROM charges WHERE user_id = $1 AND ref = $2`,
      [userId, ref],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return {
        ok: true as const,
        charged: parseDecimal(existing.rows[0]?.amount_usd ?? "0"),
        balance,
        via: "replay" as const,
      };
    }
    if (balance < amount) return { ok: false as const, code: "insufficient_balance" as const, balance };
    await client.query(
      `UPDATE users
       SET balance_usd = balance_usd - $2::numeric,
           pass_until = GREATEST(COALESCE(pass_until, now()), now()) + ($3::int * INTERVAL '1 day')
       WHERE id = $1`,
      [userId, formatFull(amount), PASS_DAYS],
    );
    await client.query(
      `INSERT INTO charges (id, user_id, kind, amount_usd, ref) VALUES ($1, $2, 'pass', $3::numeric, $4)`,
      [randomUUID(), userId, formatFull(amount), ref],
    );
    return { ok: true as const, charged: amount, balance: balance - amount, via: "balance" as const };
  });
}

export function formatSpend(result: SpendOk): { chargedUsd: string; balanceUsd: string; via: SpendOk["via"] } {
  return {
    chargedUsd: formatUsd(result.charged),
    balanceUsd: formatUsd(result.balance),
    via: result.via,
  };
}
