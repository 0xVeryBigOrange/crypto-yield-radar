import { parseDecimal } from "./money.js";

export interface Config {
  host: string;
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  sessionSecret: string;
  adminToken: string | null;
  upstreamProvider: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string | null;
  appPublicUrl: string;
  appName: string;
  llmModel: string;
  llmTimeoutMs: number;
  minDepositUsd: bigint;
  minConfEth: number;
  minConfBsc: number;
  ethRpcUrl: string;
  bscRpcUrl: string;
  cronSecret: string | null;
}

const DEV_SESSION_SECRET = "dev-only-session-secret-not-for-production";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const databaseUrl = required(env, "DATABASE_URL");
  let sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  if (!sessionSecret) {
    if (nodeEnv === "production") throw new Error("SESSION_SECRET is required in production");
    sessionSecret = DEV_SESSION_SECRET;
  }
  if (nodeEnv === "production" && sessionSecret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters");
  }

  const provider = (env.UPSTREAM_PROVIDER?.trim() || "openrouter").toLowerCase();
  if (provider !== "openrouter" && provider !== "openai-compatible") {
    throw new Error("UPSTREAM_PROVIDER must be openrouter or openai-compatible");
  }
  const defaultBase = provider === "openrouter" ? "https://openrouter.ai/api/v1" : "";
  const upstreamBaseUrl = (env.UPSTREAM_BASE_URL?.trim() || defaultBase).replace(/\/$/, "");
  if (!upstreamBaseUrl) throw new Error("UPSTREAM_BASE_URL is required");
  assertHttpUrl(upstreamBaseUrl, "UPSTREAM_BASE_URL");

  const minDepositUsd = parseDecimal(env.MIN_DEPOSIT_USD?.trim() || "5");
  if (minDepositUsd < 0n) throw new Error("MIN_DEPOSIT_USD must be >= 0");

  const ethRpcUrl = env.ETH_RPC_URL?.trim() || "https://ethereum.publicnode.com";
  const bscRpcUrl = env.BSC_RPC_URL?.trim() || "https://bsc.publicnode.com";
  assertHttpUrl(ethRpcUrl, "ETH_RPC_URL");
  assertHttpUrl(bscRpcUrl, "BSC_RPC_URL");
  const appPublicUrl = (blank(env.APP_PUBLIC_URL) || blank(env.RENDER_EXTERNAL_URL) || "http://localhost:3000").replace(/\/$/, "");
  assertHttpUrl(appPublicUrl, "APP_PUBLIC_URL");

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: intEnv(env, "PORT", 3000, 1, 65535),
    nodeEnv,
    databaseUrl,
    sessionSecret,
    adminToken: blank(env.ADMIN_TOKEN),
    upstreamProvider: provider,
    upstreamBaseUrl,
    upstreamApiKey: blank(env.UPSTREAM_API_KEY),
    appPublicUrl,
    appName: env.APP_NAME?.trim() || "橙签",
    llmModel: env.LLM_MODEL?.trim() || "openai/gpt-4o-mini",
    llmTimeoutMs: intEnv(env, "LLM_TIMEOUT_MS", 12_000, 1_000, 60_000),
    minDepositUsd,
    minConfEth: intEnv(env, "MIN_CONFIRMATIONS_ETH", 12, 1, 10_000),
    minConfBsc: intEnv(env, "MIN_CONFIRMATIONS_BSC", 15, 1, 10_000),
    ethRpcUrl,
    bscRpcUrl,
    cronSecret: blank(env.CRON_SECRET),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function assertHttpUrl(value: string, name: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an http(s) URL`);
  }
}
