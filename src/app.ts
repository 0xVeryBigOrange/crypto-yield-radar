import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { log } from "./log.js";
import type { Llm } from "./llm.js";
import { DEPOSIT_ADDRESS } from "./payments.js";
import { ProductError } from "./product.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerPlayRoutes } from "./routes/plays.js";
import { registerReadRoutes } from "./routes/read.js";

export interface AppDeps {
  config: Config;
  pool: Db;
  llm: Llm | null;
  fetchImpl?: typeof fetch;
}

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/play": "play.html",
  "/tarot": "tarot.html",
  "/stick": "stick.html",
  "/iching": "iching.html",
  "/astro": "astro.html",
  "/zodiac": "zodiac.html",
  "/almanac": "almanac.html",
  "/number": "number.html",
  "/dream": "dream.html",
  "/rune": "rune.html",
  "/collection": "collection.html",
  "/wallet": "wallet.html",
  "/ask": "ask.html",
  "/yuan": "yuan.html",
  "/hepan": "hepan.html",
  "/account": "account.html",
  "/admin": "admin.html",
};

export function buildApp(deps: AppDeps): Express {
  const app = express();
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  app.get("/healthz", async (_req, res) => {
    try {
      await deps.pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.get("/api/deposit-qr.svg", async (_req, res, next) => {
    try {
      const svg = await QRCode.toString(DEPOSIT_ADDRESS, {
        type: "svg",
        margin: 1,
        width: 280,
        color: { dark: "#f3d7a1", light: "#00000000" },
      });
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(svg);
    } catch (err) {
      next(err);
    }
  });

  registerAccountRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerInternalRoutes(app, deps);
  registerReadRoutes(app, deps);
  registerPlayRoutes(app, deps);

  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (_req, res) => sendPage(res, publicDir, file, deps.config.appPublicUrl));
  }
  app.use(express.static(publicDir, { index: false, maxAge: "1h" }));

  app.use((req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/internal") || req.path.startsWith("/s/")) {
      res.status(404).json({ error: { code: "not_found", message: "没有这一页。" } });
      return;
    }
    res.status(404).type("text/plain").send("没有这一页");
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ProductError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
      return;
    }
    const record = err as { type?: string; name?: string };
    if (record?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "bad_json", message: "请求不是有效的 JSON。" } });
      return;
    }
    if (record?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "too_large", message: "请求太大了。" } });
      return;
    }
    log("error", "request failed", { path: req.path, method: req.method, name: record?.name ?? "error" });
    if (res.headersSent) return;
    res.status(500).json({ error: { code: "internal", message: "牌桌这边出了点问题。" } });
  });

  return app;
}

function sendPage(res: Response, publicDir: string, file: string, origin: string): void {
  const html = readFileSync(path.join(publicDir, file), "utf8").replaceAll("__ORIGIN__", origin.replace(/\/$/, ""));
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(html);
}
