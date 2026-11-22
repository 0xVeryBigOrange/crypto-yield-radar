import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import type { Db } from "../src/db.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("POST /internal/daily", () => {
  test("stays disabled until CRON_SECRET is set", async () => {
    const { base, queries } = await start(configFor({}), stubPool());
    const response = await fetch(`${base}/internal/daily`, {
      method: "POST",
      headers: { "x-cron-secret": "anything" },
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("cron_disabled");
    expect(queries).toEqual([]);
  });

  test("rejects a missing or wrong secret and accepts the matching one", async () => {
    const pool = stubPool();
    const { base, queries } = await start(configFor({ CRON_SECRET: "correct-secret" }), pool);

    const missing = await fetch(`${base}/internal/daily`, { method: "POST" });
    expect(missing.status).toBe(401);

    const wrong = await fetch(`${base}/internal/daily`, {
      method: "POST",
      headers: { "x-cron-secret": "correct-secreT" },
    });
    expect(wrong.status).toBe(401);
    expect(queries).toEqual([]);

    const ok = await fetch(`${base}/internal/daily`, {
      method: "POST",
      headers: { "x-cron-secret": "correct-secret" },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; day: string; models: number | null; priceRefresh: string };
    expect(body.ok).toBe(true);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.models).toBeNull();
    expect(body.priceRefresh).toBe("skipped");
    expect(queries.some((sql) => sql.includes("daily_summaries"))).toBe(true);
    expect(queries.some((sql) => sql.includes("rate_buckets"))).toBe(true);

    const get = await fetch(`${base}/internal/daily`);
    expect(get.status).toBe(404);
  });
});

function configFor(extra: Record<string, string>): Config {
  return loadConfig({
    DATABASE_URL: "postgres://unused@127.0.0.1:9/none",
    SESSION_SECRET: "test-session-secret-value",
    NODE_ENV: "test",
    UPSTREAM_PROVIDER: "openrouter",
    ...extra,
  });
}

function stubPool(): Db & { queries: string[] } {
  const queries: string[] = [];
  const pool = {
    queries,
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  return pool as unknown as Db & { queries: string[] };
}

async function start(config: Config, pool: Db & { queries: string[] }): Promise<{ base: string; queries: string[] }> {
  const app = buildApp({ config, pool, provider: null });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, queries: pool.queries };
}
