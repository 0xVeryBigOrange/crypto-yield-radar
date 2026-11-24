import type { Db } from "./db.js";
import { withTx } from "./db.js";
import { rngFrom } from "./rng.js";
import { previousDay, sgDay } from "./time.js";
import { CHECKIN_LINES } from "./copy.js";
import { pick } from "./rng.js";

export function checkinScore(userId: string, day: string, streak: number): number {
  const rng = rngFrom(`checkin|${userId}|${day}`);
  return 20 + Math.min(Math.max(streak, 1), 12) * 3 + Math.floor(rng() * 28);
}

export async function checkIn(pool: Db, userId: string, now = new Date()): Promise<{
  score: number;
  streak: number;
  already: boolean;
  line: string;
}> {
  const day = sgDay(now);
  return withTx(pool, async (client) => {
    const user = await client.query<{ checkin_streak: number; last_checkin: string | null }>(
      `SELECT checkin_streak, last_checkin::text FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const row = user.rows[0];
    if (!row) throw new Error("user not found");
    if (row.last_checkin === day) {
      const existing = await client.query<{ score: number; streak: number }>(
        `SELECT score, streak FROM checkins WHERE user_id = $1 AND day = $2::date`,
        [userId, day],
      );
      const score = existing.rows[0]?.score ?? checkinScore(userId, day, row.checkin_streak);
      return { score, streak: row.checkin_streak, already: true, line: "今天已经打过卡了。欧气不会因为多点一次就变多。" };
    }
    const streak = row.last_checkin === previousDay(day) ? row.checkin_streak + 1 : 1;
    const score = checkinScore(userId, day, streak);
    await client.query(
      `INSERT INTO checkins (user_id, day, score, streak) VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (user_id, day) DO NOTHING`,
      [userId, day, score, streak],
    );
    await client.query(`UPDATE users SET checkin_streak = $2, last_checkin = $3::date WHERE id = $1`, [
      userId,
      streak,
      day,
    ]);
    return { score, streak, already: false, line: pick(rngFrom(`checkin-line|${userId}|${day}`), CHECKIN_LINES) };
  });
}

export interface BoardRow {
  nickname: string;
  score: number;
  streak: number;
}

export async function leaderboard(pool: Db, day = sgDay()): Promise<BoardRow[]> {
  const rows = await pool.query<{ nickname: string; score: number; streak: number }>(
    `SELECT COALESCE(NULLIF(u.nickname, ''), '橙友' || RIGHT(u.id::text, 4)) AS nickname,
            c.score, c.streak
     FROM checkins c
     JOIN users u ON u.id = c.user_id
     WHERE c.day = $1::date
     ORDER BY c.score DESC, c.streak DESC, u.created_at ASC
     LIMIT 20`,
    [day],
  );
  return rows.rows.map((row) => ({ nickname: row.nickname, score: row.score, streak: row.streak }));
}
