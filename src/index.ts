import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { loadEnvFile } from "./env.js";
import { createLlm } from "./llm.js";
import { log } from "./log.js";
import { ensureOmen } from "./product.js";
import { sgDay, usSessionDate } from "./time.js";

loadEnvFile();
const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);

const llm = config.upstreamApiKey ? createLlm(config) : null;
if (!llm) {
  log("warn", "UPSTREAM_API_KEY is not set; readings use the template bank");
} else {
  void ensureOmen(pool, llm, "sg", sgDay())
    .then(() => ensureOmen(pool, llm, "us", usSessionDate()))
    .catch((err: unknown) => log("error", "startup omen failed", { name: err instanceof Error ? err.name : "error" }));
}

const app = buildApp({ config, pool, llm });
const server = app.listen(config.port, config.host, () => {
  log("info", "listening", { host: config.host, port: config.port });
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
