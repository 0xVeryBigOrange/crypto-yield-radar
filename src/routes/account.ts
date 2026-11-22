import type { Express, Request } from "express";
import { userFromSession, closeSession, createKey, createUser, authenticate, listKeys, openSession, revokeKey } from "../accounts.js";
import { normalizeEmail, passwordOk } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { allowAttempt, asyncRoute, readCookie, sendApiError, sessionCookie } from "../http.js";
import { log } from "../log.js";
import { creditDeposit } from "../ledger.js";
import { formatFull, formatUsd, parseDecimal } from "../money.js";
import { chainsPublic, createRpc, DEPOSIT_ADDRESS, verifyDeposit, type ChainId } from "../payments.js";
import { listPrices } from "../pricing.js";

export interface AccountDeps {
  config: Config;
  pool: Db;
}

export function registerAccountRoutes(app: Express, deps: AccountDeps): void {
  app.get("/api/public-config", (_req, res) => {
    res.json({
      product: deps.config.appName,
      depositAddress: DEPOSIT_ADDRESS,
      minDepositUsd: formatUsd(deps.config.minDepositUsd),
      markup: formatFull(deps.config.markup),
      chains: chainsPublic(),
      confirmations: { ethereum: deps.config.minConfEth, bsc: deps.config.minConfBsc },
    });
  });

  app.get("/api/pricing", asyncRoute(async (_req, res) => {
    const models = await listPrices(deps.pool, deps.config.markup);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      markup: formatFull(deps.config.markup),
      updatedAt: models.reduce<string | null>((latest, model) => {
        if (!latest || model.updatedAt > latest) return model.updatedAt;
        return latest;
      }, null),
      models,
    });
  }));

  app.post("/api/auth/signup", asyncRoute(async (req, res) => {
    if (!allowAttempt(`signup:${req.ip}`, 10, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "Too many attempts. Try again later.");
      return;
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      sendApiError(res, 400, "bad_email", "Enter a valid email address.");
      return;
    }
    if (!passwordOk(req.body?.password)) {
      sendApiError(res, 400, "weak_password", "Password must be 10 to 200 characters.");
      return;
    }
    try {
      const user = await createUser(deps.pool, email, req.body.password);
      const token = await openSession(deps.pool, user.id, deps.config.sessionSecret);
      res.setHeader("Set-Cookie", sessionCookie(token, deps.config.nodeEnv === "production", 30 * 24 * 60 * 60));
      res.status(201).json(publicUser(user));
    } catch (err) {
      if (isUniqueViolation(err)) {
        sendApiError(res, 409, "email_taken", "That email is already registered.");
        return;
      }
      throw err;
    }
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    if (!allowAttempt(`login:${req.ip}`, 10, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "Too many attempts. Try again later.");
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== "string") {
      sendApiError(res, 401, "invalid_login", "Invalid email or password.");
      return;
    }
    const user = await authenticate(deps.pool, email, password);
    if (!user) {
      sendApiError(res, 401, "invalid_login", "Invalid email or password.");
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
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    res.json(publicUser(user));
  }));

  app.get("/api/deposits", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "Sign in required.");
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
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    if (!allowAttempt(`deposit:${user.id}`, 20, 10 * 60 * 1000)) {
      sendApiError(res, 429, "rate_limited", "Too many deposit checks. Try again later.");
      return;
    }
    const chain = parseChain(req.body?.chain);
    const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
    if (!chain) {
      sendApiError(res, 400, "bad_chain", "Chain must be ethereum or bsc.");
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
      log("error", "deposit verification failed", {
        chain,
        name: err instanceof Error ? err.name : "error",
      });
      sendApiError(res, 502, "rpc_error", "Could not reach the chain RPC.");
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
      sendApiError(res, 409, "already_credited", "This transaction was already credited.");
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
    });
  }));

  app.get("/api/usage", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    const rows = await deps.pool.query<{
      id: string;
      model: string;
      prompt_tokens: number;
      completion_tokens: number;
      upstream_cost_usd: string;
      charged_usd: string;
      status: string;
      settlement: string;
      created_at: Date;
    }>(
      `SELECT id, model, prompt_tokens, completion_tokens, upstream_cost_usd::text,
              charged_usd::text, status, settlement, created_at
       FROM usage_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [user.id],
    );
    res.json({
      usage: rows.rows.map((row) => ({
        id: row.id,
        model: row.model,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        upstreamCostUsd: formatUsd(parseDecimal(row.upstream_cost_usd)),
        chargedUsd: formatUsd(parseDecimal(row.charged_usd)),
        status: row.status,
        settlement: row.settlement,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }));

  app.get("/api/keys", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    res.json({ keys: await listKeys(deps.pool, user.id) });
  }));

  app.post("/api/keys", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    const name = keyName(req.body?.name);
    if (!name) {
      sendApiError(res, 400, "bad_name", "Key name must be 1 to 40 characters.");
      return;
    }
    const created = await createKey(deps.pool, user.id, name, deps.config.defaultRpm);
    res.status(201).json(created);
  }));

  app.post("/api/keys/:id/revoke", asyncRoute(async (req, res) => {
    const user = await currentUser(req, deps);
    if (!user) {
      sendApiError(res, 401, "unauthorized", "Sign in required.");
      return;
    }
    const ok = await revokeKey(deps.pool, user.id, req.params.id);
    if (!ok) {
      sendApiError(res, 404, "not_found", "API key not found.");
      return;
    }
    res.json({ ok: true });
  }));
}

async function currentUser(req: Request, deps: AccountDeps) {
  return userFromSession(deps.pool, readCookie(req.header("cookie"), "km_session"), deps.config.sessionSecret);
}

function publicUser(user: { email: string; balanceUsd: string; reservedUsd: string; createdAt: string }) {
  return {
    email: user.email,
    balanceUsd: user.balanceUsd,
    reservedUsd: user.reservedUsd,
    createdAt: user.createdAt,
  };
}

function parseChain(input: unknown): ChainId | null {
  if (input === "ethereum" || input === "eth") return "ethereum";
  if (input === "bsc" || input === "bnb") return "bsc";
  return null;
}

function keyName(input: unknown): string | null {
  if (input == null || input === "") return "default";
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (name.length < 1 || name.length > 40) return null;
  return name;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}
