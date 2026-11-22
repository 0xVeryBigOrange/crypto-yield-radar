import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { loadEnvFile } from "./env.js";
import { log } from "./log.js";
import { refreshPrices } from "./pricing.js";
import { createProvider } from "./upstream.js";

loadEnvFile();
const config = loadConfig();
const pool = createPool(config.databaseUrl);
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

if (!provider) {
  log("warn", "UPSTREAM_API_KEY is not set; chat completions are disabled until it is");
} else {
  refreshPrices(pool, provider)
    .then((models) => log("info", "startup price refresh", { models }))
    .catch((err: unknown) =>
      log("error", "startup price refresh failed", { name: err instanceof Error ? err.name : "error" }),
    );
}

const app = buildApp({ config, pool, provider });
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
