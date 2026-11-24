import type { SessionUser } from "./accounts.js";
import { leaderboard, type BoardRow } from "./board.js";
import { PRICE_USD, PRODUCT, priceAmount, type PriceKey } from "./catalog.js";
import type { Db } from "./db.js";
import type { Llm } from "./llm.js";
import { log } from "./log.js";
import { formatUsd } from "./money.js";
import {
  buildCompat,
  buildOmen,
  buildTarot,
  buildTicker,
  buildWallet,
  questionKey,
  randomSlug,
  type Reading,
} from "./reading.js";
import { formatSpend, spend, type SpendOk } from "./spend.js";
import { sgDay, usSessionDate } from "./time.js";
import { DISCLAIMER, NON_REFUNDABLE, asksForTrade, classifySecret, normalizeAddress } from "./text.js";
import { lookupWalletBirth, type WalletBirth } from "./walletLookup.js";

export class ProductError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProductError";
  }
}

export interface Stored {
  cacheKey: string;
  kind: string;
  day: string;
  title: string;
  summary: string;
  payload: Reading;
  source: "template" | "llm";
  slug: string;
  fullSlug: string;
}

export interface ReadingView {
  kind: string;
  day: string;
  title: string;
  summary: string;
  mood: string;
  moodNote: string;
  cards: Reading["cards"];
  sections: Reading["sections"];
  quote: string;
  candles: Reading["candles"];
  weekCandles: Reading["weekCandles"];
  score: number | null;
  scoreLabel: string | null;
  tags: string[];
  subject: string | null;
  extras: Reading["extras"];
  disclaimer: string;
  nonRefundable: string;
  locked: boolean;
  priceUsd: string | null;
  sharePath: string;
  imagePath: string;
  source: "template" | "llm";
  note?: string;
}

export interface UnlockBody {
  reading: ReadingView;
  chargedUsd: string;
  balanceUsd: string;
  via: SpendOk["via"];
}

interface EnsureSpec {
  key: string;
  kind: string;
  day: string;
  slug?: string;
  build: () => Reading;
  skipLlm?: boolean;
}

export function assertAck(body: unknown): void {
  if (!body || typeof body !== "object" || (body as { ack?: unknown }).ack !== true) {
    throw new ProductError(400, "ack_required", `请先确认：${NON_REFUNDABLE}。${DISCLAIMER}。`);
  }
}

export function present(stored: Stored, access: "free" | "full", price: string | null, note?: string): ReadingView {
  const reading = stored.payload;
  const full = access === "full";
  const slug = full ? stored.fullSlug : stored.slug;
  const cards = full || reading.kind !== "tarot" ? reading.cards : reading.cards.slice(0, 1);
  return {
    kind: reading.kind,
    day: reading.day,
    title: reading.title,
    summary: reading.summary,
    mood: reading.mood,
    moodNote: reading.moodNote,
    cards,
    sections: full ? reading.sections : [],
    quote: full ? reading.quote : reading.summary,
    candles: reading.candles,
    weekCandles: full || reading.kind === "omen" ? reading.weekCandles : [],
    score: reading.score,
    scoreLabel: reading.scoreLabel,
    tags: reading.tags,
    subject: reading.subject,
    extras: publicExtras(reading),
    disclaimer: reading.disclaimer || DISCLAIMER,
    nonRefundable: NON_REFUNDABLE,
    locked: !full,
    priceUsd: full ? null : price,
    sharePath: `/s/${slug}`,
    imagePath: `/s/${slug}.png?layout=${full ? "story" : "card"}`,
    source: stored.source,
    note,
  };
}

export async function home(pool: Db, llm: Llm | null, user: SessionUser | null) {
  const day = sgDay();
  const usSession = usSessionDate();
  const sg = await ensureOmen(pool, llm, "sg", day);
  const us = await ensureOmen(pool, llm, "us", usSession);
  const unlocked = await unlockedSet(pool, user, [sg.cacheKey, us.cacheKey]);
  return {
    day,
    usSession,
    disclaimer: DISCLAIMER,
    nonRefundable: NON_REFUNDABLE,
    owner: { name: PRODUCT.ownerName, handle: PRODUCT.ownerHandle, url: PRODUCT.ownerUrl },
    prices: PRICE_USD,
    sg: present(sg, access(user, unlocked, sg.cacheKey), PRICE_USD.omenFull),
    us: present(us, access(user, unlocked, us.cacheKey), PRICE_USD.omenFull),
    leaderboard: await leaderboard(pool, day),
    passActive: user?.passActive ?? false,
  };
}

export async function openOmen(pool: Db, llm: Llm | null, user: SessionUser | null, edition: "sg" | "us") {
  const day = edition === "sg" ? sgDay() : usSessionDate();
  const stored = await ensureOmen(pool, llm, edition, day);
  const unlocked = await unlockedSet(pool, user, [stored.cacheKey]);
  return present(stored, access(user, unlocked, stored.cacheKey), PRICE_USD.omenFull);
}

export async function unlockOmen(pool: Db, llm: Llm | null, user: SessionUser, edition: "sg" | "us"): Promise<UnlockBody> {
  const day = edition === "sg" ? sgDay() : usSessionDate();
  const key = omenKey(edition, day);
  const paid = await charge(pool, user, key, "omen", "omenFull");
  const stored = await ensureOmen(pool, llm, edition, day);
  await touch(pool, user.id, stored.cacheKey);
  return { reading: present(stored, "full", null), ...formatSpend(paid) };
}

export async function openWallet(
  pool: Db,
  llm: Llm | null,
  user: SessionUser | null,
  addressInput: string,
  tier: "free" | "full",
  fetchImpl: typeof fetch = fetch,
): Promise<ReadingView | UnlockBody> {
  const address = normalizeAddress(addressInput);
  if (!address) throw secretOrInvalid(addressInput);
  const day = sgDay();
  const birth = await rememberBirth(pool, address, fetchImpl);
  const key = `wallet:${address}:${day}:${birth.firstSeen ?? "none"}`;
  if (tier === "free") {
    const stored = await ensure(pool, llm, {
      key,
      kind: "wallet",
      day,
      build: () => buildWallet(address, day, birth.firstSeen, birth.chain),
    });
    if (user) await touch(pool, user.id, stored.cacheKey);
    return present(stored, "free", PRICE_USD.walletFull);
  }
  if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整命盘。");
  const paid = await charge(pool, user, key, "wallet", "walletFull");
  const stored = await ensure(pool, llm, {
    key,
    kind: "wallet",
    day,
    build: () => buildWallet(address, day, birth.firstSeen, birth.chain),
  });
  await touch(pool, user.id, stored.cacheKey);
  return { reading: present(stored, "full", null), ...formatSpend(paid) };
}

export async function openTarot(
  pool: Db,
  llm: Llm | null,
  user: SessionUser,
  question: string,
  tier: "free" | "full",
): Promise<ReadingView | UnlockBody> {
  const day = sgDay();
  const normalized = normalizeQuestion(question);
  if (!normalized) throw new ProductError(400, "bad_question", "问题请写 2 到 200 个字。");
  if (tier === "free") {
    const key = `tarot:${user.id}:${day}:free`;
    const existing = await readKey(pool, key);
    if (existing) {
      return present(existing, "free", PRICE_USD.tarotFull, "今天的免费一抽已经用过了。换问题请看完整的三张牌。");
    }
    const stored = await ensure(pool, llm, {
      key,
      kind: "tarot",
      day,
      build: () => buildTarot(user.id, day, normalized, asksForTrade(normalized)),
    });
    await touch(pool, user.id, stored.cacheKey);
    return present(stored, "free", PRICE_USD.tarotFull);
  }
  const key = `tarot:${user.id}:${day}:${questionKey(normalized)}`;
  const paid = await charge(pool, user, key, "tarot", "tarotFull");
  const free = await readKey(pool, `tarot:${user.id}:${day}:free`);
  const sameQuestion = free?.payload.extras.question === clipQuestion(normalized);
  const stored = await ensure(pool, llm, {
    key,
    kind: "tarot",
    day,
    skipLlm: sameQuestion,
    build: () =>
      sameQuestion && free
        ? { ...free.payload, extras: { ...free.payload.extras } }
        : buildTarot(user.id, day, normalized, asksForTrade(normalized)),
  });
  await touch(pool, user.id, stored.cacheKey);
  return { reading: present(stored, "full", null), ...formatSpend(paid) };
}

export async function openTicker(
  pool: Db,
  llm: Llm | null,
  user: SessionUser | null,
  symbol: string,
  masked: string,
  tier: "free" | "full",
): Promise<ReadingView | UnlockBody> {
  const day = sgDay();
  const seedId = user ? user.id : "public";
  const key = `ticker:${seedId}:${day}:${symbol}`;
  if (tier === "free") {
    const stored = await ensure(pool, llm, {
      key,
      kind: "ticker",
      day,
      build: () => buildTicker(seedId, day, masked),
    });
    if (user) await touch(pool, user.id, stored.cacheKey);
    return present(
      stored,
      "free",
      PRICE_USD.tickerFull,
      user ? undefined : "登录后可以看你自己的缘分，并打开完整牌面。",
    );
  }
  if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整币缘。");
  const paid = await charge(pool, user, key, "ticker", "tickerFull");
  const stored = await ensure(pool, llm, {
    key,
    kind: "ticker",
    day,
    build: () => buildTicker(user.id, day, masked),
  });
  await touch(pool, user.id, stored.cacheKey);
  return { reading: present(stored, "full", null), ...formatSpend(paid) };
}

export async function openCompat(
  pool: Db,
  llm: Llm | null,
  user: SessionUser | null,
  input: {
    mode: "orange" | "code" | "wallets";
    code?: string;
    left?: string;
    right?: string;
    tier: "free" | "full";
    nicknames: { byId: (id: string) => Promise<{ id: string; nickname: string } | null>; byCode: (code: string) => Promise<{ id: string; nickname: string } | null> };
  },
): Promise<ReadingView | UnlockBody> {
  const day = sgDay();
  if (input.mode === "orange") {
    if (!user) {
      const stored = await ensure(pool, llm, {
        key: `compat:orange:guest:${day}`,
        kind: "compat",
        day,
        build: () => buildCompat("guest", day, "路人", PRODUCT.ownerName, true),
      });
      return present(stored, "free", PRICE_USD.compatFull, "这是今天路人与大橙子的公开玩笑分。登录后看你自己的。");
    }
    return pairReading(pool, llm, user, input.tier, {
      key: `compat:orange:${user.id}:${day}`,
      left: user.nickname,
      right: PRODUCT.ownerName,
      seed: `orange:${user.id}`,
      withOwner: true,
    });
  }
  if (input.mode === "code") {
    const code = (input.code ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]{6,16}$/.test(code)) throw new ProductError(400, "bad_code", "邀请码不对。");
    const other = await input.nicknames.byCode(code);
    if (!other) throw new ProductError(404, "not_found", "没有这个邀请码。");
    if (!user) {
      const stored = await ensure(pool, llm, {
        key: `compat:invite:${code}:${day}`,
        kind: "compat",
        day,
        build: () => buildCompat(`invite:${code}`, day, "你", other.nickname, false),
      });
      return present(stored, "free", PRICE_USD.compatFull, `登录后跟 ${other.nickname} 看你们俩的合盘。这是邀请，不是返佣。`);
    }
    if (other.id === user.id) throw new ProductError(400, "self", "这是你自己的链接。发给朋友，合盘才成立。");
    const [lo, hi] = [user.id, other.id].sort();
    const left = lo === user.id ? user.nickname : other.nickname;
    const right = lo === user.id ? other.nickname : user.nickname;
    return pairReading(pool, llm, user, input.tier, {
      key: `compat:pair:${day}:${lo}:${hi}`,
      left,
      right,
      seed: `pair:${lo}:${hi}`,
      withOwner: false,
    });
  }
  const leftAddress = normalizeAddress(input.left ?? "");
  const rightAddress = normalizeAddress(input.right ?? "");
  if (!leftAddress || !rightAddress) throw secretOrInvalid(input.left ?? "", input.right ?? "");
  if (leftAddress === rightAddress) throw new ProductError(400, "self", "两个地址是同一个，合盘需要两个人。");
  const [first, second] = [leftAddress, rightAddress].sort();
  return pairReading(pool, llm, user, input.tier, {
    key: `compat:wallets:${day}:${first}:${second}`,
    left: mask(first),
    right: mask(second),
    seed: `wallets:${first}:${second}`,
    withOwner: false,
  });
}

export async function history(pool: Db, userId: string) {
  const rows = await pool.query<{
    cache_key: string;
    kind: string;
    title: string;
    slug: string;
    created_at: Date;
  }>(
    `SELECT c.cache_key, c.kind, c.title, c.slug, ur.created_at
     FROM user_readings ur
     JOIN reading_cache c ON c.cache_key = ur.cache_key
     WHERE ur.user_id = $1
     ORDER BY ur.created_at DESC
     LIMIT 30`,
    [userId],
  );
  return rows.rows.map((row) => ({
    kind: row.kind,
    title: row.title,
    sharePath: `/s/${row.slug}`,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function loadBySlug(pool: Db, slug: string): Promise<{ stored: Stored; access: "free" | "full" } | null> {
  const result = await pool.query<CacheRow>(
    `SELECT cache_key, kind, day::text AS day, title, summary, payload, source, slug, full_slug
     FROM reading_cache WHERE slug = $1 OR full_slug = $1`,
    [slug],
  );
  const row = result.rows[0];
  if (!row) return null;
  const stored = mapStored(row);
  return { stored, access: row.full_slug === slug ? "full" : "free" };
}

export async function ensureOmen(pool: Db, llm: Llm | null, edition: "sg" | "us", day: string): Promise<Stored> {
  return ensure(pool, llm, {
    key: omenKey(edition, day),
    kind: "omen",
    day,
    slug: `omen-${edition}-${day}`,
    build: () => buildOmen(edition, day),
  });
}

export async function rememberBirth(pool: Db, address: string, fetchImpl: typeof fetch): Promise<WalletBirth> {
  const existing = await pool.query<{ first_seen: string | null; chain: string | null; source: string; fetched_at: Date }>(
    `SELECT first_seen::text, chain, source, fetched_at FROM wallet_birthdays WHERE address = $1`,
    [address],
  );
  const row = existing.rows[0];
  if (row && (row.source === "found" || Date.now() - row.fetched_at.getTime() < 24 * 60 * 60 * 1000)) {
    const chain = row.chain === "ethereum" || row.chain === "bsc" ? row.chain : null;
    return { firstSeen: row.first_seen, chain, source: row.source };
  }
  let birth: WalletBirth;
  try {
    birth = await lookupWalletBirth(address, fetchImpl);
  } catch (err) {
    log("warn", "wallet lookup failed", { name: err instanceof Error ? err.name : "error" });
    birth = { firstSeen: null, chain: null, source: "miss" };
  }
  await pool.query(
    `INSERT INTO wallet_birthdays (address, first_seen, chain, source, fetched_at)
     VALUES ($1, $2::date, $3, $4, now())
     ON CONFLICT (address) DO UPDATE
     SET first_seen = EXCLUDED.first_seen, chain = EXCLUDED.chain, source = EXCLUDED.source, fetched_at = now()`,
    [address, birth.firstSeen, birth.chain, birth.source],
  );
  return birth;
}

async function pairReading(
  pool: Db,
  llm: Llm | null,
  user: SessionUser | null,
  tier: "free" | "full",
  spec: { key: string; left: string; right: string; seed: string; withOwner: boolean },
): Promise<ReadingView | UnlockBody> {
  const day = sgDay();
  const build = () => buildCompat(spec.seed, day, spec.left, spec.right, spec.withOwner);
  if (tier === "free") {
    const stored = await ensure(pool, llm, { key: spec.key, kind: "compat", day, build });
    if (user) await touch(pool, user.id, stored.cacheKey);
    return present(stored, "free", PRICE_USD.compatFull);
  }
  if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整合盘。");
  const paid = await charge(pool, user, spec.key, "compat", "compatFull");
  const stored = await ensure(pool, llm, { key: spec.key, kind: "compat", day, build });
  await touch(pool, user.id, stored.cacheKey);
  return { reading: present(stored, "full", null), ...formatSpend(paid) };
}

async function charge(pool: Db, user: SessionUser, ref: string, kind: string, price: PriceKey): Promise<SpendOk> {
  const paid = await spend(pool, {
    userId: user.id,
    amount: priceAmount(price),
    ref,
    kind,
    coverWithPass: true,
  });
  if (!paid.ok) {
    throw new ProductError(402, "insufficient_balance", `余额不够。${NON_REFUNDABLE}。`, {
      balanceUsd: formatUsd(paid.balance),
      priceUsd: PRICE_USD[price],
    });
  }
  return paid;
}

async function ensure(pool: Db, llm: Llm | null, spec: EnsureSpec): Promise<Stored> {
  const existing = await readKey(pool, spec.key);
  if (existing) return existing;
  let reading = spec.build();
  let source: Stored["source"] = "template";
  if (llm && !spec.skipLlm) {
    try {
      const polished = await llm.polish(reading);
      if (polished) {
        reading = polished;
        source = "llm";
      }
    } catch (err) {
      log("warn", "llm polish threw", { name: err instanceof Error ? err.name : "error" });
    }
  }
  let slug = spec.slug ?? randomSlug("s");
  let fullSlug = randomSlug("f");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await pool.query(
        `INSERT INTO reading_cache (cache_key, kind, day, title, summary, payload, source, slug, full_slug)
         VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (cache_key) DO NOTHING`,
        [spec.key, spec.kind, spec.day, reading.title, reading.summary, JSON.stringify(reading), source, slug, fullSlug],
      );
      break;
    } catch (err) {
      if (!isUnique(err) || attempt === 1) throw err;
      slug = spec.slug ?? randomSlug("s");
      fullSlug = randomSlug("f");
    }
  }
  const stored = await readKey(pool, spec.key);
  if (!stored) throw new ProductError(500, "store_failed", "牌面没有写进数据库。");
  return stored;
}

async function readKey(pool: Db, key: string): Promise<Stored | null> {
  const result = await pool.query<CacheRow>(
    `SELECT cache_key, kind, day::text AS day, title, summary, payload, source, slug, full_slug
     FROM reading_cache WHERE cache_key = $1`,
    [key],
  );
  const row = result.rows[0];
  return row ? mapStored(row) : null;
}

async function touch(pool: Db, userId: string, cacheKey: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_readings (user_id, cache_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, cacheKey],
  );
}

async function unlockedSet(pool: Db, user: SessionUser | null, keys: string[]): Promise<Set<string>> {
  if (!user) return new Set();
  if (user.passActive) return new Set(keys);
  if (keys.length === 0) return new Set();
  const rows = await pool.query<{ ref: string }>(
    `SELECT ref FROM charges WHERE user_id = $1 AND ref = ANY($2::text[])`,
    [user.id, keys],
  );
  return new Set(rows.rows.map((row) => row.ref));
}

function access(user: SessionUser | null, unlocked: Set<string>, key: string): "free" | "full" {
  if (user?.passActive) return "full";
  return unlocked.has(key) ? "full" : "free";
}

function omenKey(edition: "sg" | "us", day: string): string {
  return `omen:${edition}:${day}`;
}

interface CacheRow {
  cache_key: string;
  kind: string;
  day: string;
  title: string;
  summary: string;
  payload: unknown;
  source: "template" | "llm";
  slug: string;
  full_slug: string;
}

function mapStored(row: CacheRow): Stored {
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Reading) : (row.payload as Reading);
  return {
    cacheKey: row.cache_key,
    kind: row.kind,
    day: row.day,
    title: row.title,
    summary: row.summary,
    payload,
    source: row.source === "llm" ? "llm" : "template",
    slug: row.slug,
    fullSlug: row.full_slug,
  };
}

function publicExtras(reading: Reading): Reading["extras"] {
  const extras = { ...reading.extras };
  delete extras.question;
  if (reading.kind === "tarot") extras.question = reading.extras.question ?? null;
  return extras;
}

function normalizeQuestion(input: string): string | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 200) return null;
  return text;
}

function clipQuestion(question: string): string {
  return question.length > 42 ? `${question.slice(0, 41)}…` : question;
}

function secretOrInvalid(...inputs: string[]): ProductError {
  const secret = inputs.some((input) => {
    const kind = classifySecret(input);
    return kind === "key" || kind === "mnemonic";
  });
  if (secret) {
    return new ProductError(400, "private_key", "不要把私钥或助记词发给任何网站，包括橙签。这里只收公开地址。");
  }
  return new ProductError(400, "bad_address", "请粘贴公开的 0x 地址，42 位。");
}

function mask(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isUnique(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export type { BoardRow };
