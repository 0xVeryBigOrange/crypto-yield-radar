import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { runDailyJob } from "./dailyJob.js";
import { loadEnvFile } from "./env.js";
import { log } from "./log.js";
import { createProvider } from "./upstream.js";

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    const provider = config.upstreamApiKey
      ? createProvider({
          provider: config.upstreamProvider,
          baseUrl: config.upstreamBaseUrl,
          apiKey: config.upstreamApiKey,
          appPublicUrl: config.appPublicUrl,
          appName: config.appName,
        })
      : null;
    await runDailyJob(pool, provider);
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
