import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(databaseUrl: string): Db {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    options: "-c timezone=UTC -c statement_timeout=15000",
  });
}

export async function migrate(pool: Db): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(path.join(here, "db", "schema.sql"), "utf8");
  let last: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const client = await pool.connect().catch((err: unknown) => {
      last = err;
      return null;
    });
    if (!client) {
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
      try {
        await client.query("SELECT pg_advisory_unlock(81421337)");
      } catch {
        /* lock disappears with the session */
      }
      if (attempt === 30) break;
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
