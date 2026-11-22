import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { log } from "./log.js";
import { DEPOSIT_ADDRESS } from "./payments.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerV1Routes } from "./routes/v1.js";
import type { UpstreamProvider } from "./upstream.js";

export interface AppDeps {
  config: Config;
  pool: Db;
  provider: UpstreamProvider | null;
}

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
      "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    next();
  });
  app.use("/v1", (req, res, next) => {
    const origin = req.header("origin");
    const allowed = deps.config.corsOrigins;
    if (allowed.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
    else if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));

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
        color: { dark: "#14211b", light: "#00000000" },
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
  registerV1Routes(app, deps);

  app.get("/", (_req, res) => sendPage(res, publicDir, "index.html"));
  app.get("/dashboard", (_req, res) => sendPage(res, publicDir, "dashboard.html"));
  app.get("/admin", (_req, res) => sendPage(res, publicDir, "admin.html"));
  app.use(express.static(publicDir, { index: false, maxAge: 0 }));

  app.use((req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/v1") || req.path.startsWith("/internal")) {
      res.status(404).json({ error: { code: "not_found", message: "Not found." } });
      return;
    }
    res.status(404).type("text/plain").send("Not found");
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const record = err as { type?: string; name?: string; status?: number };
    if (record?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "bad_json", message: "Invalid JSON." } });
      return;
    }
    if (record?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "too_large", message: "Request body is too large." } });
      return;
    }
    log("error", "request failed", { path: req.path, method: req.method, name: record?.name ?? "error" });
    if (res.headersSent) return;
    res.status(500).json({ error: { code: "internal", message: "Internal error." } });
  });

  return app;
}

function sendPage(res: Response, publicDir: string, file: string): void {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(publicDir, file));
}
