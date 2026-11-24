import type { Express, Request } from "express";
import {
  authenticate,
  closeSession,
  createUser,
  openSession,
  publicUser,
  updateNickname,
  userFromSession,
  type SessionUser,
} from "../accounts.js";
import { passwordOk, normalizeEmail } from "../auth.js";
import { checkIn } from "../board.js";
import { PRICE_USD, PRODUCT, WELCOME_DEEP_CREDITS } from "../catalog.js";
import { formatCoins, formatUsd, parseDecimal } from "../money.js";
import { collectionSnapshot, grantShare } from "../rewards.js";
import { sgDay } from "../time.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { allowAttempt, asyncRoute, readCookie, sendApiError, sessionCookie } from "../http.js";
import { log } from "../log.js";
import { creditDeposit } from "../ledger.js";
import { chainsPublic, createRpc, DEPOSIT_ADDRESS, verifyDeposit, type ChainId } from "../payments.js";
import { assertAck, history, ProductError } from "../product.js";
import { purchasePass } from "../spend.js";
import { DISCLAIMER, NON_REFUNDABLE, nicknameFromEmail, normalizeNickname } from "../text.js";

export interface AccountDeps {
  config: Config;
  pool: Db;
}

export function registerAccountRoutes(app: Express, deps: AccountDeps): void {
  app.get("/api/public-config", (_req, res) => {
    res.json({
      product: deps.config.appName || PRODUCT.name,
      productEn: PRODUCT.nameEn,
      owner: { name: PRODUCT.ownerName, handle: PRODUCT.ownerHandle, url: PRODUCT.ownerUrl },
      depositAddress: DEPOSIT_ADDRESS,
      minDepositUsd: formatUsd(deps.config.minDepositUsd),
      chains: chainsPublic(),
      confirmations: { ethereum: deps.config.minConfEth, bsc: deps.config.minConfBsc },
      prices: PRICE_USD,
      priceCoins: Object.fromEntries(Object.entries(PRICE_USD).map(([key, value]) => [key, formatCoins(parseDecimal(value))])),
      coinPerUsd: 100,
      welcomeCredits: WELCOME_DEEP_CREDITS,
      depositHint: "最低 1 USDT，1 USDT = 100 橙币。推荐 BSC，以太坊主网 gas 较贵。只收 USDT / USDC。",
      disclaimer: DISCLAIMER,
      nonRefundable: NON_REFUNDABLE,
    });
  });

  app.post("/api/auth/signup", asyncRoute(async (req, res) => {
    if (!allowAttempt(`signup:${req.ip}`, 10, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "尝试太多次了，等一会儿再来。");
      return;
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      sendApiError(res, 400, "bad_email", "邮箱看起来不对。");
      return;
    }
    if (!passwordOk(req.body?.password)) {
      sendApiError(res, 400, "weak_password", "密码需要 10 到 200 个字符。");
      return;
    }
    const nickname = normalizeNickname(req.body?.nickname, nicknameFromEmail(email));
    const ref = typeof req.body?.ref === "string" ? req.body.ref.trim().toLowerCase() : null;
    try {
      const user = await createUser(deps.pool, email, req.body.password, nickname, ref);
      const token = await openSession(deps.pool, user.id, deps.config.sessionSecret);
      res.setHeader("Set-Cookie", sessionCookie(token, deps.config.nodeEnv === "production", 30 * 24 * 60 * 60));
      res.status(201).json(publicUser(user));
    } catch (err) {
      if (isUniqueViolation(err)) {
        sendApiError(res, 409, "email_taken", "这个邮箱已经注册过了。");
        return;
      }
      throw err;
    }
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    if (!allowAttempt(`login:${req.ip}`, 10, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "尝试太多次了，等一会儿再来。");
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string") {
      sendApiError(res, 401, "invalid_login", "邮箱或密码不对。");
      return;
    }
    const user = await authenticate(deps.pool, email, password);
    if (!user) {
      sendApiError(res, 401, "invalid_login", "邮箱或密码不对。");
      return;
    }
    const token = await openSession(deps.pool, user.id, deps.config.sessionSecret);
    res.setHeader("Set-Cookie", sessionCookie(token, deps.config.nodeEnv === "production", 30 * 24 * 60 * 60));
    res.json(publicUser(user));
  }));

  app.post("/api/auth/logout", asyncRoute(async (req, res) => {
    await closeSession(deps.pool, readCookie(req.header("cookie"), "km_session"), deps.config.sessionSecret);
    res.setHeader("Set-Cookie", sessionCookie("", deps.config.nodeEnv === "production", 0));
    res.status(204).end();
  }));

  app.get("/api/me", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    res.json(publicUser(user));
  }));

  app.post("/api/profile", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    const raw = typeof req.body?.nickname === "string" ? req.body.nickname.trim().replace(/\s+/g, "").slice(0, 16) : "";
    if (!/^[\p{L}\p{N}_\-·]{1,16}$/u.test(raw)) {
      sendApiError(res, 400, "bad_nickname", "外号用 1 到 16 个字，字母、数字或中文。");
      return;
    }
    await updateNickname(deps.pool, user.id, raw);
    const fresh = await currentUser(req, deps);
    res.json(publicUser(fresh ?? user));
  }));

  app.get("/api/deposits", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    const rows = await deps.pool.query<{
      id: string;
      chain: string;
      tx_hash: string;
      token_symbol: string;
      amount_usd: string;
      confirmations: number;
      created_at: Date;
    }>(
      `SELECT id, chain, tx_hash, token_symbol, amount_usd::text, confirmations, created_at
       FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [user.id],
    );
    res.json({
      deposits: rows.rows.map((row) => ({
        id: row.id,
        chain: row.chain,
        txHash: row.tx_hash,
        token: row.token_symbol,
        amountUsd: formatUsd(parseDecimal(row.amount_usd)),
        confirmations: row.confirmations,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }));

  app.post("/api/deposits", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    try {
      assertAck(req.body);
    } catch (err) {
      if (err instanceof ProductError) {
        sendApiError(res, err.status, err.code, err.message);
        return;
      }
      throw err;
    }
    if (!allowAttempt(`deposit:${user.id}`, 20, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "查得太勤了，等一会儿再提交交易。");
      return;
    }
    const chain = parseChain(req.body?.chain);
    const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
    if (!chain) {
      sendApiError(res, 400, "bad_chain", "链只能是 ethereum 或 bsc。");
      return;
    }
    const rpc = createRpc(chain === "ethereum" ? deps.config.ethRpcUrl : deps.config.bscRpcUrl);
    let verified;
    try {
      verified = await verifyDeposit({
        rpc,
        chain,
        txHash,
        minConfirmations: chain === "ethereum" ? deps.config.minConfEth : deps.config.minConfBsc,
        minDepositUsd: deps.config.minDepositUsd,
      });
    } catch (err) {
      log("error", "deposit verification failed", { chain, name: err instanceof Error ? err.name : "error" });
      sendApiError(res, 502, "rpc_error", "暂时连不上这条链的节点。");
      return;
    }
    if (!verified.ok) {
      sendApiError(res, 400, verified.code, verified.message, {
        confirmations: verified.confirmations,
        required: verified.required,
        amountUsd: verified.amountUsd,
        minimumUsd: verified.minimumUsd,
      });
      return;
    }
    const credited = await creditDeposit(deps.pool, {
      userId: user.id,
      chain: verified.chain,
      txHash: verified.txHash,
      token: verified.token,
      amountUsd: verified.amountUsd,
      fromAddress: verified.fromAddress,
      confirmations: verified.confirmations,
    });
    if (!credited.ok) {
      sendApiError(res, 409, "already_credited", "这笔交易已经入过账了。");
      return;
    }
    const fresh = await currentUser(req, deps);
    log("info", "deposit credited", { chain: verified.chain, token: verified.token });
    res.status(201).json({
      chain: verified.chain,
      txHash: verified.txHash,
      token: verified.token,
      amountUsd: formatUsd(verified.amountUsd),
      confirmations: verified.confirmations,
      balanceUsd: fresh?.balanceUsd ?? null,
      orangeCoins: fresh?.orangeCoins ?? null,
      nonRefundable: NON_REFUNDABLE,
    });
  }));

  app.post("/api/checkin", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "登录后才能打卡。榜上只留外号。");
      return;
    }
    const result = await checkIn(deps.pool, user.id);
    const fresh = await currentUser(req, deps);
    res.json({ ...result, nickname: fresh?.nickname ?? user.nickname, checkedInToday: true });
  }));

  app.post("/api/pass", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    try {
      assertAck(req.body);
    } catch (err) {
      if (err instanceof ProductError) {
        sendApiError(res, err.status, err.code, err.message);
        return;
      }
      throw err;
    }
    const key = typeof req.body?.key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(req.body.key)
      ? req.body.key
      : `auto-${user.id.slice(0, 8)}-${Date.now()}`;
    const paid = await purchasePass(deps.pool, user.id, key);
    if (!paid.ok) {
      sendApiError(res, 402, "insufficient_balance", `余额不够开通月卡。${NON_REFUNDABLE}。`, {
        balanceUsd: formatUsd(paid.balance),
        priceUsd: PRICE_USD.monthPass,
      });
      return;
    }
    const fresh = await currentUser(req, deps);
    res.json({
      chargedUsd: formatUsd(paid.charged),
      balanceUsd: fresh?.balanceUsd ?? formatUsd(paid.balance),
      via: paid.via,
      passUntil: fresh?.passUntil ?? null,
      passActive: fresh?.passActive ?? false,
      orangeCoins: fresh?.orangeCoins ?? null,
      deepCredits: fresh?.deepCredits ?? null,
      nonRefundable: NON_REFUNDABLE,
    });
  }));

  app.post("/api/share", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "登录后分享才记橙币。");
      return;
    }
    const granted = await grantShare(deps.pool, user.id, sgDay());
    const fresh = await currentUser(req, deps);
    res.json({
      granted,
      coinsAwarded: granted ? "5" : "0",
      orangeCoins: fresh?.orangeCoins ?? user.orangeCoins,
      deepCredits: fresh?.deepCredits ?? user.deepCredits,
    });
  }));

  app.get("/api/collection", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "登录后才能看见自己的图鉴。");
      return;
    }
    res.json(await collectionSnapshot(deps.pool, user.id));
  }));

  app.get("/api/checkins", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "登录后才能看见签到日历。");
      return;
    }
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : sgDay().slice(0, 7);
    const [yearText, monthText] = month.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
    const rows = await deps.pool.query<{ day: string; score: number; streak: number }>(
      `SELECT day::text, score, streak FROM checkins
       WHERE user_id = $1 AND day >= $2::date AND day < $3::date
       ORDER BY day`,
      [user.id, start, end],
    );
    res.json({
      month,
      streak: user.checkinStreak,
      days: rows.rows.map((row) => ({ day: row.day, score: row.score, streak: row.streak })),
    });
  }));

  app.get("/api/history", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "请先登录。");
      return;
    }
    res.json({ readings: await history(deps.pool, user.id) });
  }));
}

export async function currentUser(req: Request, deps: AccountDeps): Promise<SessionUser | null> {
  return userFromSession(deps.pool, readCookie(req.header("cookie"), "km_session"), deps.config.sessionSecret);
}

function parseChain(input: unknown): ChainId | null {
  if (input === "ethereum" || input === "eth") return "ethereum";
  if (input === "bsc" || input === "bnb") return "bsc";
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
