import { INVITE_BONUS_USD, INVITE_CAP, INVITEE_BONUS_USD, SHARE_BONUS_USD } from "./catalog.js";
import type { Db } from "./db.js";
import { withTx } from "./db.js";
import { formatFull, parseDecimal } from "./money.js";

const MILESTONES: ReadonlyArray<{ kind: string; need: number; ref: string; credits: number }> = [
  { kind: "major", need: 22, ref: "set:major:22", credits: 1 },
  { kind: "tarot", need: 78, ref: "set:tarot:78", credits: 2 },
  { kind: "stick", need: 50, ref: "set:stick:50", credits: 1 },
  { kind: "stick", need: 100, ref: "set:stick:100", credits: 2 },
  { kind: "hex", need: 64, ref: "set:hex:64", credits: 2 },
  { kind: "rune", need: 24, ref: "set:rune:24", credits: 1 },
];

export async function grantReward(
  pool: Db,
  userId: string,
  ref: string,
  opts: { usd?: bigint; credits?: number },
): Promise<boolean> {
  const usd = opts.usd ?? 0n;
  const credits = opts.credits ?? 0;
  return withTx(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO reward_grants (user_id, ref, credits, amount_usd)
       VALUES ($1, $2, $3, $4::numeric)
       ON CONFLICT DO NOTHING
       RETURNING ref`,
      [userId, ref, credits, formatFull(usd)],
    );
    if ((inserted.rowCount ?? 0) === 0) return false;
    if (usd > 0n) {
      await client.query(`UPDATE users SET balance_usd = balance_usd + $2::numeric WHERE id = $1`, [userId, formatFull(usd)]);
    }
    if (credits > 0) {
      await client.query(`UPDATE users SET deep_credits = deep_credits + $2 WHERE id = $1`, [userId, credits]);
    }
    return true;
  });
}

export async function grantInvite(pool: Db, inviterId: string, newUserId: string): Promise<void> {
  const count = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM reward_grants WHERE user_id = $1 AND ref LIKE 'invite:%'`,
    [inviterId],
  );
  if ((count.rows[0]?.n ?? 0) >= INVITE_CAP) return;
  await grantReward(pool, inviterId, `invite:${newUserId}`, { usd: parseDecimal(INVITE_BONUS_USD) });
  await grantReward(pool, newUserId, `invited-by:${inviterId}`, { usd: parseDecimal(INVITEE_BONUS_USD) });
}

export async function grantShare(pool: Db, userId: string, day: string): Promise<boolean> {
  return grantReward(pool, userId, `share:${day}`, { usd: parseDecimal(SHARE_BONUS_USD) });
}

export function parseCollect(value: string | number | null | undefined): Array<{ kind: string; id: string }> {
  if (typeof value !== "string" || !value) return [];
  const items: Array<{ kind: string; id: string }> = [];
  for (const part of value.split("|")) {
    const split = part.indexOf(":");
    if (split <= 0) continue;
    const kind = part.slice(0, split).replace(/[^a-z]/g, "");
    const id = part.slice(split + 1).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    if (kind && id) items.push({ kind, id });
  }
  return items;
}

export async function recordCollection(pool: Db, userId: string, collect: string | number | null | undefined): Promise<string[]> {
  const items = parseCollect(collect);
  if (items.length === 0) return [];
  for (const item of items) {
    await pool.query(
      `INSERT INTO collection_items (user_id, kind, item_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, item.kind, item.id],
    );
  }
  const granted: string[] = [];
  for (const goal of MILESTONES) {
    const count = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM collection_items WHERE user_id = $1 AND kind = $2`,
      [userId, goal.kind],
    );
    if ((count.rows[0]?.n ?? 0) >= goal.need) {
      const ok = await grantReward(pool, userId, goal.ref, { credits: goal.credits });
      if (ok) granted.push(goal.ref);
    }
  }
  return granted;
}

export interface CollectionSnapshot {
  items: Array<{ kind: string; id: string }>;
  progress: Array<{ kind: string; need: number; have: number; ref: string; credits: number }>;
}

export async function collectionSnapshot(pool: Db, userId: string): Promise<CollectionSnapshot> {
  const rows = await pool.query<{ kind: string; item_id: string }>(
    `SELECT kind, item_id FROM collection_items WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  const items = rows.rows.map((row) => ({ kind: row.kind, id: row.item_id }));
  const progress = MILESTONES.map((goal) => ({
    kind: goal.kind,
    need: goal.need,
    have: items.filter((item) => item.kind === goal.kind).length,
    ref: goal.ref,
    credits: goal.credits,
  }));
  return { items, progress };
}
