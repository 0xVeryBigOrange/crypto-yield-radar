import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { log } from "./log.js";

const { Pool } = pg;
export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): Db {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 10_000,
    options: "-c timezone=UTC -c statement_timeout=20000",
  });
}

const MIGRATE_ATTEMPTS = 45;

/** Apply schema.sql. Every statement is IF NOT EXISTS, so a cold start can run this again safely. */
export async function migrate(pool: Db): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(path.join(here, "db", "schema.sql"), "utf8");
  let last: unknown;
  for (let attempt = 1; attempt <= MIGRATE_ATTEMPTS; attempt += 1) {
    const client = await pool.connect().catch((err: unknown) => {
      last = err;
      return null;
    });
    if (!client) {
      log("warn", "database not ready", { attempt, name: errorName(last) });
      await delay(1000);
      continue;
    }
    try {
      await client.query("SELECT pg_advisory_lock(81421337)");
      await client.query(schema);
      await client.query("SELECT pg_advisory_unlock(81421337)");
      return;
    } catch (err) {
      last = err;
      log("warn", "database migration attempt failed", { attempt, name: errorName(err) });
      try {
        await client.query("SELECT pg_advisory_unlock(81421337)");
      } catch {
        /* lock disappears with the session */
      }
      if (attempt === MIGRATE_ATTEMPTS) break;
      await delay(1000);
    } finally {
      client.release();
    }
  }
  throw last instanceof Error ? last : new Error("database migration failed");
}

export async function withTx<T>(pool: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection is already unusable */
    }
    throw err;
  } finally {
    client.release();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "error";
}
