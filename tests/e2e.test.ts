import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyMarkup } from "../src/billing.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { parseDecimal } from "../src/money.js";
import { clearPriceCache } from "../src/pricing.js";
import {
  CHAINS,
  DEPOSIT_ADDRESS,
  TRANSFER_TOPIC,
  addressToTopic,
} from "../src/payments.js";
import { createProvider } from "../src/upstream.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const dbName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, "") : "";
const enabled = Boolean(databaseUrl) && dbName.includes("test");

describe.skipIf(!enabled)("http ledger", () => {
  let pool: Db;
  let appServer: Server;
  let upstreamServer: Server;
  let rpcServer: Server;
  let base: string;
  let cookie = "";
  let receipt = makeReceipt(10_000_000n);
  let seenUpstreamAuth = "";

  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await migrate(pool);
    await pool.query(`TRUNCATE TABLE users, model_prices, daily_summaries RESTART IDENTITY CASCADE`);
    clearPriceCache();

    rpcServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const message = JSON.parse(body) as { id?: number; method?: string };
        let result: unknown = null;
        if (message.method === "eth_chainId") result = "0x1";
        else if (message.method === "eth_blockNumber") result = "0x10";
        else if (message.method === "eth_getTransactionReceipt") result = receipt;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id ?? 1, result }));
      });
    });
    upstreamServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        seenUpstreamAuth = String(req.headers.authorization ?? "");
        if (seenUpstreamAuth !== "Bearer test-upstream-key") {
          res.writeHead(401).end("{}");
          return;
        }
        if (req.method === "GET" && req.url?.includes("/models")) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              data: [
                {
                  id: "openai/gpt-4o-mini",
                  name: "GPT-4o mini",
                  context_length: 128000,
                  pricing: { prompt: "0.000001", completion: "0.001", request: "0" },
                },
              ],
            }),
          );
          return;
        }
        const payload = body ? (JSON.parse(body) as { stream?: boolean; stream_options?: { include_usage?: boolean } }) : {};
        if (payload.stream) {
          if (payload.stream_options?.include_usage !== true) {
            res.writeHead(400).end(JSON.stringify({ error: { message: "include_usage missing" } }));
            return;
          }
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"index":0,"delta":{"content":"pon"}}]}\n\n');
          res.write('data: {"choices":[{"index":0,"delta":{"content":"g"},"finish_reason":"stop"}]}\n\n');
          res.write(
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":"0.001"}}\n\n',
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "cmpl",
            choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 4, cost: "0.001" },
          }),
        );
      });
    });

    const rpcPort = await listen(rpcServer);
    const upstreamPort = await listen(upstreamServer);
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_SECRET = "test-session-secret-value";
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.UPSTREAM_API_KEY = "test-upstream-key";
    process.env.UPSTREAM_PROVIDER = "openai-compatible";
    process.env.UPSTREAM_BASE_URL = `http://127.0.0.1:${upstreamPort}/v1`;
    process.env.ETH_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.BSC_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.MIN_CONFIRMATIONS_ETH = "1";
    process.env.MIN_CONFIRMATIONS_BSC = "1";
    process.env.MIN_DEPOSIT_USD = "5";
    process.env.MARKUP = "1.3";
    process.env.NODE_ENV = "test";
    process.env.APP_PUBLIC_URL = "http://127.0.0.1";
    const config = loadConfig();
    const provider = createProvider({
      provider: config.upstreamProvider,
      baseUrl: config.upstreamBaseUrl,
      apiKey: config.upstreamApiKey ?? "",
      appPublicUrl: config.appPublicUrl,
      appName: config.appName,
    });
    appServer = buildApp({ config, pool, provider }).listen(0, "127.0.0.1");
    const appPort = await ready(appServer);
    base = `http://127.0.0.1:${appPort}`;
  });

  afterAll(async () => {
    await close(appServer);
    await close(upstreamServer);
    await close(rpcServer);
    await pool?.end();
  });

  test("deposits, bills streamed and buffered calls, and lets an admin adjust the balance", async () => {
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    const configRes = await fetch(`${base}/api/public-config`);
    const configBody = (await configRes.json()) as { depositAddress: string };
    expect(configBody.depositAddress).toBe(DEPOSIT_ADDRESS);

    const signup = await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dev@example.com", password: "correct-horse" }),
    });
    expect(signup.status).toBe(201);
    cookie = cookieHeader(signup);

    receipt = makeReceipt(1_000_000n);
    const dust = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash: `0x${"44".repeat(32)}` }),
    });
    expect(dust.status).toBe(400);
    expect(((await dust.json()) as { error: { code: string } }).error.code).toBe("below_minimum");

    receipt = makeReceipt(10_000_000n);
    const txHash = `0x${"55".repeat(32)}`;
    const credited = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash }),
    });
    expect(credited.status).toBe(201);
    const duplicate = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash }),
    });
    expect(duplicate.status).toBe(409);

    const created = await fetch(`${base}/api/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "laptop" }),
    });
    expect(created.status).toBe(201);
    const key = ((await created.json()) as { token: string }).token;
    expect(key.startsWith("sk-")).toBe(true);

    const completion = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(completion.status).toBe(200);
    const completionBody = (await completion.json()) as { choices: Array<{ message: { content: string } }>; usage: { cost?: unknown } };
    expect(completionBody.choices[0]?.message.content).toBe("pong");
    expect(completionBody.usage.cost).toBeUndefined();
    expect(seenUpstreamAuth).toBe("Bearer test-upstream-key");

    const stream = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(stream.status).toBe(200);
    const streamed = await stream.text();
    expect(streamed).toContain("pon");
    expect(streamed).toContain("[DONE]");
    expect(streamed).not.toContain("cost");

    const charge = applyMarkup(parseDecimal("0.001"), parseDecimal("1.3"));
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as { balanceUsd: string };
    expect(parseDecimal(me.balanceUsd)).toBe(parseDecimal("10") - charge - charge);

    const tooBig = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        max_tokens: 128000,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(tooBig.status).toBe(402);
    const afterReject = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as { balanceUsd: string };
    expect(afterReject.balanceUsd).toBe(me.balanceUsd);

    const keys = (await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json()) as {
      keys: Array<{ id: string }>;
    };
    const revoked = await fetch(`${base}/api/keys/${keys.keys[0]?.id}/revoke`, {
      method: "POST",
      headers: { cookie },
    });
    expect(revoked.status).toBe(200);
    const denied = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
    expect(denied.status).toBe(401);

    const adjusted = await fetch(`${base}/api/admin/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "test-admin-token" },
      body: JSON.stringify({ email: "dev@example.com", deltaUsd: "1.5", reason: "goodwill credit" }),
    });
    expect(adjusted.status).toBe(200);
    const overview = await fetch(`${base}/api/admin/overview`, { headers: { "x-admin-token": "test-admin-token" } });
    expect(overview.status).toBe(200);
    const overviewBody = (await overview.json()) as { markupRevenueUsd: string; depositsUsd: string };
    expect(parseDecimal(overviewBody.depositsUsd)).toBe(parseDecimal("10"));
    expect(parseDecimal(overviewBody.markupRevenueUsd)).toBe(charge + charge - parseDecimal("0.001") - parseDecimal("0.001"));

    const refreshed = await fetch(`${base}/api/admin/refresh`, {
      method: "POST",
      headers: { "x-admin-token": "test-admin-token" },
    });
    expect(refreshed.status).toBe(200);
    const limitedKey = await fetch(`${base}/api/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "limited" }),
    });
    const limitedBody = (await limitedKey.json()) as { id: string; token: string };
    await pool.query(`UPDATE api_keys SET rpm_limit = 1 WHERE id = $1`, [limitedBody.id]);
    const withinLimit = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${limitedBody.token}` },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(withinLimit.status).toBe(200);
    await withinLimit.arrayBuffer();
    const overLimit = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${limitedBody.token}` },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(overLimit.status).toBe(429);

    const summaries = await fetch(`${base}/api/admin/summaries`, { headers: { "x-admin-token": "test-admin-token" } });
    const summaryBody = (await summaries.json()) as { summaries: Array<{ requestCount: number }> };
    expect(summaryBody.summaries.some((row) => row.requestCount >= 2)).toBe(true);
  });
});

function makeReceipt(raw: bigint) {
  const token = CHAINS.ethereum.tokens[0];
  if (!token) throw new Error("missing token");
  return {
    status: "0x1",
    blockNumber: "0x10",
    logs: [
      {
        address: token.address,
        topics: [TRANSFER_TOPIC, `0x${"11".repeat(20).padStart(64, "0")}`, addressToTopic(DEPOSIT_ADDRESS)],
        data: `0x${raw.toString(16).padStart(64, "0")}`,
      },
    ],
  };
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie ? headers.getSetCookie() : [];
  return list.map((item) => item.split(";")[0] ?? "").join("; ");
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function ready(server: Server): Promise<number> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve((server.address() as AddressInfo).port);
      return;
    }
    server.on("listening", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
