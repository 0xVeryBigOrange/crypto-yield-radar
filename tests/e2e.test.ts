import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { parseDecimal } from "../src/money.js";
import { CHAINS, DEPOSIT_ADDRESS, TRANSFER_TOPIC, addressToTopic } from "../src/payments.js";
import { DISCLAIMER } from "../src/text.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const dbName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, "") : "";
const enabled = Boolean(databaseUrl) && dbName.includes("test");

describe.skipIf(!enabled)("orange omens http", () => {
  let pool: Db;
  let appServer: Server;
  let rpcServer: Server;
  let base: string;
  let cookie = "";
  const receipt = makeReceipt(10_000_000n);

  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await migrate(pool);
    await pool.query(
      `TRUNCATE TABLE users, reading_cache, charges, user_readings, checkins, wallet_birthdays, daily_summaries RESTART IDENTITY CASCADE`,
    );
    rpcServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const message = JSON.parse(body || "{}") as { id?: number; method?: string };
        let result: unknown = null;
        if (message.method === "eth_chainId") result = "0x1";
        else if (message.method === "eth_blockNumber") result = "0x10";
        else if (message.method === "eth_getTransactionReceipt") result = receipt;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id ?? 1, result }));
      });
    });
    const rpcPort = await listen(rpcServer);
    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_SECRET = "test-session-secret-value";
    process.env.ADMIN_TOKEN = "test-admin-token";
    process.env.UPSTREAM_API_KEY = "";
    process.env.UPSTREAM_PROVIDER = "openrouter";
    process.env.ETH_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.BSC_RPC_URL = `http://127.0.0.1:${rpcPort}`;
    process.env.MIN_CONFIRMATIONS_ETH = "1";
    process.env.MIN_CONFIRMATIONS_BSC = "1";
    process.env.MIN_DEPOSIT_USD = "5";
    process.env.NODE_ENV = "test";
    process.env.APP_PUBLIC_URL = "http://127.0.0.1";
    process.env.CRON_SECRET = "test-cron-secret";
    delete process.env.UPSTREAM_API_KEY;
    const config = loadConfig();
    appServer = buildApp({
      config,
      pool,
      llm: null,
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "1", result: [{ timeStamp: "1546300800" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }).listen(0, "127.0.0.1");
    const appPort = await ready(appServer);
    base = `http://127.0.0.1:${appPort}`;
  });

  afterAll(async () => {
    await close(appServer);
    await close(rpcServer);
    await pool?.end();
  });

  test("serves a shared omen, credits a deposit once, and unlocks the full card", async () => {
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    const configRes = await fetch(`${base}/api/public-config`);
    const configBody = (await configRes.json()) as { depositAddress: string; disclaimer: string };
    expect(configBody.depositAddress).toBe(DEPOSIT_ADDRESS);
    expect(configBody.disclaimer).toBe(DISCLAIMER);

    const home = await fetch(`${base}/api/home`);
    const homeBody = (await home.json()) as { sg: { summary: string; locked: boolean; sections: unknown[] } };
    expect(homeBody.sg.locked).toBe(true);
    expect(homeBody.sg.sections).toEqual([]);
    const again = await fetch(`${base}/api/home`);
    const againBody = (await again.json()) as { sg: { summary: string } };
    expect(againBody.sg.summary).toBe(homeBody.sg.summary);

    const signup = await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "reader@example.com", password: "correct-horse", nickname: "小橙" }),
    });
    expect(signup.status).toBe(201);
    cookie = cookieHeader(signup);

    const missingAck = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash: `0x${"ab".repeat(32)}` }),
    });
    expect(missingAck.status).toBe(400);

    const deposited = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash: `0x${"ab".repeat(32)}`, ack: true }),
    });
    expect(deposited.status).toBe(201);
    const depositBody = (await deposited.json()) as { balanceUsd: string };
    expect(parseDecimal(depositBody.balanceUsd)).toBe(parseDecimal("10"));
    const duplicate = await fetch(`${base}/api/deposits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ chain: "ethereum", txHash: `0x${"ab".repeat(32)}`, ack: true }),
    });
    expect(duplicate.status).toBe(409);

    const unlocked = await fetch(`${base}/api/omen/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ edition: "sg", ack: true }),
    });
    expect(unlocked.status).toBe(200);
    const unlockedBody = (await unlocked.json()) as {
      reading: { locked: boolean; sections: unknown[]; sharePath: string };
      balanceUsd: string;
    };
    expect(unlockedBody.reading.locked).toBe(false);
    expect(unlockedBody.reading.sections.length).toBe(3);
    expect(parseDecimal(unlockedBody.balanceUsd)).toBe(parseDecimal("9"));
    const replay = await fetch(`${base}/api/omen/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ edition: "sg", ack: true }),
    });
    const replayBody = (await replay.json()) as { balanceUsd: string; via: string };
    expect(replayBody.via).toBe("replay");
    expect(parseDecimal(replayBody.balanceUsd)).toBe(parseDecimal("9"));

    const secret = await fetch(`${base}/api/wallet`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ address: `0x${"11".repeat(32)}`, tier: "free" }),
    });
    expect(secret.status).toBe(400);
    expect(((await secret.json()) as { error: { code: string } }).error.code).toBe("private_key");

    const wallet = await fetch(`${base}/api/wallet`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ address: "0x1234567890abcdef1234567890abcdef12345678", tier: "free" }),
    });
    expect(wallet.status).toBe(200);
    const walletBody = (await wallet.json()) as { subject: string; summary: string };
    expect(walletBody.subject).toBe("0x1234…5678");
    expect(walletBody.summary).not.toContain("1234567890abcdef");

    const card = await fetch(`${base}${unlockedBody.reading.sharePath}`);
    const html = await card.text();
    expect(html).toContain(DISCLAIMER);
    const png = await fetch(`${base}${unlockedBody.reading.sharePath}.png`);
    expect(png.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await png.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const adjusted = await fetch(`${base}/api/admin/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "test-admin-token" },
      body: JSON.stringify({ email: "reader@example.com", deltaUsd: "-0.10", reason: "courtesy trim" }),
    });
    expect(adjusted.status).toBe(200);

    const daily = await fetch(`${base}/internal/daily`, {
      method: "POST",
      headers: { "x-cron-secret": "test-cron-secret" },
    });
    expect(daily.status).toBe(200);
    const dailyBody = (await daily.json()) as { ok: boolean; omen: string; priceRefresh: string };
    expect(dailyBody.ok).toBe(true);
    expect(dailyBody.omen).toBe("ready");
    expect(dailyBody.priceRefresh).toBe("skipped");
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
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
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
