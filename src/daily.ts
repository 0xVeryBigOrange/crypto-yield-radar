import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { runDailyJob } from "./dailyJob.js";
import { loadEnvFile } from "./env.js";
import { createLlm } from "./llm.js";
import { log } from "./log.js";

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    const llm = config.upstreamApiKey ? createLlm(config) : null;
    const result = await runDailyJob(pool, llm);
    log("info", "daily job finished", { day: result.day, omen: result.omen, priceRefresh: result.priceRefresh });
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
