import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db.js";

let server: Server;
let base: string;
const previous = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
};

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://keymint:keymint@127.0.0.1:5432/keymint";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-value";
  process.env.NODE_ENV = "test";
  process.env.APP_PUBLIC_URL = "http://127.0.0.1";
  const pool = { query: async () => { throw new Error("no db"); } } as unknown as Db;
  server = buildApp({ config: loadConfig(), pool, llm: null }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  restore("DATABASE_URL", previous.DATABASE_URL);
  restore("SESSION_SECRET", previous.SESSION_SECRET);
  restore("NODE_ENV", previous.NODE_ENV);
  restore("APP_PUBLIC_URL", previous.APP_PUBLIC_URL);
});

function restore(name: "DATABASE_URL" | "SESSION_SECRET" | "NODE_ENV" | "APP_PUBLIC_URL", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("scripts and styles revalidate, other static files can stay cached", async () => {
  const script = await fetch(`${base}/ui.js`);
  expect(script.status).toBe(200);
  expect(script.headers.get("cache-control")).toBe("no-cache");
  const css = await fetch(`${base}/styles.css`);
  expect(css.headers.get("cache-control")).toBe("no-cache");
  const icon = await fetch(`${base}/favicon.svg`);
  expect(icon.status).toBe(200);
  expect(icon.headers.get("cache-control")).toContain("max-age=3600");
});
