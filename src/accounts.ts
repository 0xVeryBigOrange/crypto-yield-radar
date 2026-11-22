import { randomUUID } from "node:crypto";
import { generateApiKey, hashApiKey, hashPassword, hashSession, newSessionToken, verifyPassword } from "./auth.js";
import type { Db } from "./db.js";
import { formatUsd, parseDecimal } from "./money.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  balanceUsd: string;
  reservedUsd: string;
  createdAt: string;
}

export async function createUser(pool: Db, email: string, password: string): Promise<SessionUser> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [id, email, await hashPassword(password)],
  );
  return {
    id,
    email,
    balanceUsd: formatUsd(0n),
    reservedUsd: formatUsd(0n),
    createdAt: new Date().toISOString(),
  };
}

export async function authenticate(pool: Db, email: string, password: string): Promise<SessionUser | null> {
  const result = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = result.rows[0];
  const stored = row?.password_hash ?? (await dummyHash());
  const match = await verifyPassword(password, stored);
  if (!row || !match) return null;
  return getUser(pool, row.id);
}

export async function getUser(pool: Db, id: string): Promise<SessionUser | null> {
  const result = await pool.query<{
    id: string;
    email: string;
    balance_usd: string;
    reserved_usd: string;
    created_at: Date;
  }>(`SELECT id, email, balance_usd::text, reserved_usd::text, created_at FROM users WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    balanceUsd: formatUsd(parseDecimal(row.balance_usd)),
    reservedUsd: formatUsd(parseDecimal(row.reserved_usd)),
    createdAt: row.created_at.toISOString(),
  };
}

export async function openSession(pool: Db, userId: string, secret: string): Promise<string> {
  const token = newSessionToken();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, hashSession(token, secret), new Date(Date.now() + SESSION_MS)],
  );
  return token;
}

export async function userFromSession(pool: Db, token: string | undefined, secret: string): Promise<SessionUser | null> {
  if (!token) return null;
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
    [hashSession(token, secret)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return getUser(pool, row.user_id);
}

export async function closeSession(pool: Db, token: string | undefined, secret: string): Promise<void> {
  if (!token) return;
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashSession(token, secret)]);
}

export async function createKey(pool: Db, userId: string, name: string, rpm: number) {
  const key = generateApiKey();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, key_last4, rpm_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, name, key.hash, key.prefix, key.last4, rpm],
  );
  return { id, name, token: key.token, prefix: key.prefix, last4: key.last4, rpmLimit: rpm };
}

export async function listKeys(pool: Db, userId: string) {
  const result = await pool.query<{
    id: string;
    name: string;
    key_prefix: string;
    key_last4: string;
    rpm_limit: number;
    revoked_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, name, key_prefix, key_last4, rpm_limit, revoked_at, last_used_at, created_at
     FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    last4: row.key_last4,
    rpmLimit: row.rpm_limit,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function revokeKey(pool: Db, userId: string, keyId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [keyId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ApiPrincipal {
  userId: string;
  keyId: string;
  rpm: number;
}

export async function principalFromApiKey(pool: Db, token: string): Promise<ApiPrincipal | null> {
  const result = await pool.query<{ id: string; user_id: string; rpm_limit: number }>(
    `SELECT id, user_id, rpm_limit FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hashApiKey(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]);
  return { userId: row.user_id, keyId: row.id, rpm: row.rpm_limit };
}

let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
}
