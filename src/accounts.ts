import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, hashSession, newSessionToken, normalizeEmail, verifyPassword } from "./auth.js";
import type { Db } from "./db.js";
import { formatUsd, parseDecimal } from "./money.js";
import { sgDay } from "./time.js";
import { nicknameFromEmail } from "./text.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export interface SessionUser {
  id: string;
  email: string;
  balanceUsd: string;
  reservedUsd: string;
  createdAt: string;
  nickname: string;
  referralCode: string;
  passUntil: string | null;
  passActive: boolean;
  checkinStreak: number;
  lastCheckin: string | null;
  checkedInToday: boolean;
}

export interface PublicProfile {
  id: string;
  nickname: string;
}

export async function createUser(
  pool: Db,
  email: string,
  password: string,
  nickname: string,
  referralCode: string | null,
): Promise<SessionUser> {
  const referred = referralCode ? await profileByCode(pool, referralCode) : null;
  const passwordHash = await hashPassword(password);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, nickname, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, email, passwordHash, nickname, newReferralCode(), referred?.id ?? null],
      );
      const user = await getUser(pool, id);
      if (!user) throw new Error("user missing");
      return user;
    } catch (err) {
      const constraint = pgConstraint(err);
      if (constraint == null || !constraint.includes("referral")) throw err;
    }
  }
  throw new Error("could not allocate a referral code");
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
    nickname: string | null;
    referral_code: string | null;
    pass_until: Date | null;
    checkin_streak: number;
    last_checkin: string | null;
  }>(
    `SELECT id, email, balance_usd::text, reserved_usd::text, created_at, nickname, referral_code,
            pass_until, checkin_streak, last_checkin::text
     FROM users WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  let nickname = row.nickname;
  let referralCode = row.referral_code;
  if (!nickname || !referralCode) {
    nickname = nickname || nicknameFromEmail(row.email);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = referralCode || newReferralCode();
      try {
        await pool.query(
          `UPDATE users SET nickname = COALESCE(nickname, $2), referral_code = COALESCE(referral_code, $3) WHERE id = $1`,
          [id, nickname, candidate],
        );
        referralCode = candidate;
        break;
      } catch (err) {
        const constraint = pgConstraint(err);
        if (!constraint?.includes("referral") || attempt === 2) throw err;
      }
    }
    if (!referralCode) throw new Error("referral code missing");
  }
  const today = sgDay();
  return {
    id: row.id,
    email: row.email,
    balanceUsd: formatUsd(parseDecimal(row.balance_usd)),
    reservedUsd: formatUsd(parseDecimal(row.reserved_usd)),
    createdAt: row.created_at.toISOString(),
    nickname,
    referralCode,
    passUntil: row.pass_until ? row.pass_until.toISOString() : null,
    passActive: row.pass_until != null && row.pass_until.getTime() > Date.now(),
    checkinStreak: row.checkin_streak ?? 0,
    lastCheckin: row.last_checkin,
    checkedInToday: row.last_checkin === today,
  };
}

export async function updateNickname(pool: Db, userId: string, nickname: string): Promise<void> {
  await pool.query(`UPDATE users SET nickname = $2 WHERE id = $1`, [userId, nickname]);
}

export async function profileByCode(pool: Db, code: string): Promise<PublicProfile | null> {
  const result = await pool.query<{ id: string; nickname: string | null }>(
    `SELECT id, nickname FROM users WHERE referral_code = $1`,
    [code.trim().toLowerCase()],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, nickname: row.nickname || "橙友" };
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

export function newReferralCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

export function publicUser(user: SessionUser) {
  return {
    email: user.email,
    nickname: user.nickname,
    balanceUsd: user.balanceUsd,
    reservedUsd: user.reservedUsd,
    createdAt: user.createdAt,
    referralCode: user.referralCode,
    passUntil: user.passUntil,
    passActive: user.passActive,
    checkinStreak: user.checkinStreak,
    lastCheckin: user.lastCheckin,
    checkedInToday: user.checkedInToday,
  };
}

let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
}

function pgConstraint(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
    return String((err as { constraint?: string }).constraint ?? "");
  }
  return null;
}

export { normalizeEmail };
