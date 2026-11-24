import type { Express, Request, Response } from "express";
import { profileByCode } from "../accounts.js";
import type { AppDeps } from "../app.js";
import { PRICE_USD } from "../catalog.js";
import { allowAttempt, asyncRoute, sendApiError } from "../http.js";
import { renderPngCached, renderSvg, type PosterLayout } from "../image.js";
import { log } from "../log.js";
import {
  home,
  loadBySlug,
  openCompat,
  openOmen,
  openTarot,
  openTicker,
  openWallet,
  present,
  ProductError,
  unlockOmen,
  assertAck,
  type ReadingView,
  type UnlockBody,
} from "../product.js";
import { shareHtml } from "../sharePage.js";
import { parseSymbol } from "../text.js";
import { currentUser } from "./account.js";

export function registerReadRoutes(app: Express, deps: AppDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get("/api/home", asyncRoute(async (req, res) => {
    res.json(await home(deps.pool, deps.llm, await currentUser(req, deps)));
  }));

  app.get("/api/omen", asyncRoute(async (req, res) => {
    const edition = editionOf(req.query.edition);
    if (!edition) {
      sendApiError(res, 400, "bad_edition", "版本只能是 sg 或 us。");
      return;
    }
    res.json(await openOmen(deps.pool, deps.llm, await currentUser(req, deps), edition));
  }));

  app.post("/api/omen/unlock", productRoute(async (req, res) => {
    assertAck(req.body);
    const user = await requireUser(req, deps);
    const edition = editionOf(req.body?.edition);
    if (!edition) throw new ProductError(400, "bad_edition", "版本只能是 sg 或 us。");
    res.json(await unlockOmen(deps.pool, deps.llm, user, edition));
  }));

  app.post("/api/wallet", productRoute(async (req, res) => {
    const tier = tierOf(req.body?.tier);
    const user = await currentUser(req, deps);
    if (tier === "full") {
      assertAck(req.body);
      if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整命盘。");
    }
    if (!allowAttempt(`wallet:${req.ip}`, 30, 10 * 60 * 1000)) {
      throw new ProductError(429, "rate_limited", "地址查得太勤了，等一会儿。");
    }
    const address = typeof req.body?.address === "string" ? req.body.address : "";
    res.json(await openWallet(deps.pool, deps.llm, user, address, tier, fetchImpl));
  }));

  app.post("/api/ask", productRoute(async (req, res) => {
    const user = await requireUser(req, deps);
    const tier = tierOf(req.body?.tier);
    if (tier === "full") assertAck(req.body);
    if (!allowAttempt(`ask:${user.id}`, 30, 60 * 60 * 1000)) {
      throw new ProductError(429, "rate_limited", "提问太密了，这个小时先看到这里。");
    }
    const question = typeof req.body?.question === "string" ? req.body.question : "";
    res.json(await openTarot(deps.pool, deps.llm, user, question, tier));
  }));

  app.post("/api/yuan", productRoute(async (req, res) => {
    const parsed = parseSymbol(typeof req.body?.symbol === "string" ? req.body.symbol : "");
    if (!parsed.ok) {
      throw new ProductError(
        400,
        parsed.code === "secret" ? "private_key" : "bad_symbol",
        parsed.code === "secret" ? "不要把私钥发过来。这里只要代号或公开合约。" : "代号用 1 到 12 位字母数字，或一个公开合约。",
      );
    }
    const tier = tierOf(req.body?.tier);
    const user = await currentUser(req, deps);
    if (tier === "full") {
      assertAck(req.body);
      if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整币缘。");
    }
    res.json(await openTicker(deps.pool, deps.llm, user, parsed.value.symbol, parsed.value.masked, tier));
  }));

  app.post("/api/hepan", productRoute(async (req, res) => {
    const mode = req.body?.mode;
    if (mode !== "orange" && mode !== "code" && mode !== "wallets") {
      throw new ProductError(400, "bad_mode", "合盘要选大橙子、邀请码，或两个地址。");
    }
    const tier = tierOf(req.body?.tier);
    const user = await currentUser(req, deps);
    if (tier === "full") {
      assertAck(req.body);
      if (!user) throw new ProductError(401, "unauthorized", "登录后才能打开完整合盘。");
    }
    res.json(
      await openCompat(deps.pool, deps.llm, user, {
        mode,
        code: typeof req.body?.code === "string" ? req.body.code : undefined,
        left: typeof req.body?.left === "string" ? req.body.left : undefined,
        right: typeof req.body?.right === "string" ? req.body.right : undefined,
        tier,
        nicknames: { byId: async () => null, byCode: (code) => profileByCode(deps.pool, code) },
      }),
    );
  }));

  app.get("/api/leaderboard", asyncRoute(async (_req, res) => {
    const payload = await home(deps.pool, deps.llm, null);
    res.json({ day: payload.day, leaderboard: payload.leaderboard, disclaimer: payload.disclaimer });
  }));

  app.get("/i/:code", (req, res) => {
    const code = String(req.params.code ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
    res.redirect(302, `/hepan?with=${encodeURIComponent(code)}`);
  });

  app.get("/og/today.png", asyncRoute(async (_req, res) => {
    await sendOmenPng(res, deps, "sg");
  }));
  app.get("/og/us.png", asyncRoute(async (_req, res) => {
    await sendOmenPng(res, deps, "us");
  }));

  app.get("/s/:slug", asyncRoute(async (req, res) => {
    const raw = String(req.params.slug ?? "");
    const wantsPng = raw.endsWith(".png");
    const slug = slugOf(wantsPng ? raw.slice(0, -4) : raw);
    if (!slug) {
      res.status(404).type("text/plain").send("没有这张牌");
      return;
    }
    const loaded = await loadBySlug(deps.pool, slug);
    if (!loaded) {
      res.status(404).type("text/plain").send("没有这张牌");
      return;
    }
    const view = present(loaded.stored, loaded.access, loaded.access === "full" ? null : priceFor(loaded.stored.kind));
    if (wantsPng) {
      sendPoster(res, deps, view, layoutOf(req.query.layout, loaded.access));
      return;
    }
    const pageUrl = absolute(deps, view.sharePath);
    const imageUrl = absolute(deps, view.imagePath);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(shareHtml(view, pageUrl, imageUrl));
  }));
}

function productRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return asyncRoute(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ProductError) {
        sendApiError(res, err.status, err.code, err.message, err.extra);
        return;
      }
      throw err;
    }
  });
}

async function requireUser(req: Request, deps: AppDeps) {
  const user = await currentUser(req, deps);
  if (!user) throw new ProductError(401, "unauthorized", "请先登录。");
  return user;
}

function editionOf(value: unknown): "sg" | "us" | null {
  if (value === "sg" || value === "us") return value;
  return null;
}

function tierOf(value: unknown): "free" | "full" {
  return value === "full" ? "full" : "free";
}

function slugOf(value: unknown): string | null {
  const slug = String(value ?? "");
  if (!/^[a-z0-9_-]{6,80}$/i.test(slug)) return null;
  return slug;
}

function priceFor(kind: string): string | null {
  if (kind === "omen") return PRICE_USD.omenFull;
  if (kind === "wallet") return PRICE_USD.walletFull;
  if (kind === "tarot") return PRICE_USD.tarotFull;
  if (kind === "ticker") return PRICE_USD.tickerFull;
  if (kind === "compat") return PRICE_USD.compatFull;
  return null;
}

function layoutOf(value: unknown, access: "free" | "full"): PosterLayout {
  if (value === "story" || value === "card") return value;
  return access === "full" ? "story" : "card";
}

function absolute(deps: AppDeps, path: string): string {
  const base = deps.config.appPublicUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function sendOmenPng(res: Response, deps: AppDeps, edition: "sg" | "us"): Promise<void> {
  const view = await openOmen(deps.pool, deps.llm, null, edition);
  sendPoster(res, deps, { ...view, sections: [], quote: view.summary }, "card");
}

function sendPoster(res: Response, deps: AppDeps, view: ReadingView, layout: PosterLayout): void {
  const pageUrl = absolute(deps, view.sharePath);
  const svg = renderSvg(view, layout, pageUrl);
  try {
    const png = renderPngCached(`${pageUrl}:${layout}`, svg);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(png);
  } catch (err) {
    log("error", "png render failed", { name: err instanceof Error ? err.name : "error" });
    res.status(500).type("text/plain").send("分享图没有画出来");
  }
}

export type { UnlockBody };
