import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { loadEnvFile } from "./env.js";
import { log } from "./log.js";
import { refreshPrices } from "./pricing.js";
import { utcDay, writeDailySummary } from "./summary.js";
import { createProvider } from "./upstream.js";

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    if (config.upstreamApiKey) {
      try {
        const provider = createProvider({
          provider: config.upstreamProvider,
          baseUrl: config.upstreamBaseUrl,
          apiKey: config.upstreamApiKey,
          appPublicUrl: config.appPublicUrl,
          appName: config.appName,
        });
        const models = await refreshPrices(pool, provider);
        log("info", "daily price refresh", { models });
      } catch (err) {
        log("error", "daily price refresh failed", { name: err instanceof Error ? err.name : "error" });
      }
    } else {
      log("warn", "UPSTREAM_API_KEY is not set; skipped the price refresh");
    }
    const day = utcDay(-1);
    await writeDailySummary(pool, day);
    await pool.query(`DELETE FROM rate_buckets WHERE window_start < now() - INTERVAL '2 days'`);
    log("info", "daily summary stored", { day });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    log("error", "daily job failed", { name: err instanceof Error ? err.name : "error" });
    process.exit(1);
  });
}
