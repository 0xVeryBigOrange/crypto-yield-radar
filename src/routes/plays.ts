import type { Express, Request, Response } from "express";
import type { AppDeps } from "../app.js";
import {
  buildAlmanac,
  buildAstro,
  buildDream,
  buildIchingDraw,
  buildLenormandDraw,
  buildMatch,
  buildNumber,
  buildRuneDraw,
  buildStickDraw,
  buildTarotDraw,
  buildZodiac,
  priceKeyForSpread,
  rollLines,
} from "../builders.js";
import { PRICE_USD } from "../catalog.js";
import { animalOf, signByName } from "../content/astro.js";
import { parseLines } from "../content/iching.js";
import { spreadOf, type SpreadId } from "../content/tarotDeck.js";
import { allowAttempt } from "../http.js";
import { assertAck, openPlay, ProductError } from "../product.js";
import { sgDay } from "../time.js";
import { currentUser } from "./account.js";

function productRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function registerPlayRoutes(app: Express, deps: AppDeps): void {
  app.get("/api/plays", (_req, res) => {
    res.json({
      disclaimer: "仅供娱乐，不构成投资、法律、医疗或心理建议",
      plays: [
        { id: "tarot", name: "塔罗", href: "/tarot", priceUsd: PRICE_USD.tarotDeep, note: "78 张，七种牌阵。凯尔特十字另计。" },
        { id: "stick", name: "求签", href: "/stick", priceUsd: PRICE_USD.stickDeep, note: "原创 100 签。" },
        { id: "iching", name: "易经", href: "/iching", priceUsd: PRICE_USD.ichingDeep, note: "三枚铜钱，六次。" },
        { id: "astro", name: "星座", href: "/astro", priceUsd: PRICE_USD.astroDeep, note: "每日运势与配对。" },
        { id: "zodiac", name: "生肖", href: "/zodiac", priceUsd: PRICE_USD.zodiacDeep, note: "十二生肖今日语气。" },
        { id: "almanac", name: "黄历", href: "/almanac", priceUsd: PRICE_USD.almanacDeep, note: "宜忌免费，详批另计。" },
        { id: "number", name: "灵数", href: "/number", priceUsd: PRICE_USD.numberDeep, note: "按生日。" },
        { id: "dream", name: "解梦", href: "/dream", priceUsd: PRICE_USD.dreamDeep, note: "关键词词库。" },
        { id: "rune", name: "符文", href: "/rune", priceUsd: PRICE_USD.runeDeep, note: "北欧符文，附雷诺曼。" },
        { id: "wallet", name: "钱包命盘", href: "/wallet", priceUsd: PRICE_USD.walletDeep, note: "只要公开地址。" },
        { id: "yuan", name: "币缘", href: "/yuan", priceUsd: PRICE_USD.tickerDeep, note: "代号或公开合约。" },
        { id: "hepan", name: "合盘", href: "/hepan", priceUsd: PRICE_USD.compatDeep, note: "和大橙子，或朋友。" },
      ],
    });
  });

  app.post("/api/tarot", productRoute(async (req, res) => {
    const spread = spreadOf(typeof req.body?.spread === "string" ? req.body.spread : "");
    if (!spread) throw new ProductError(400, "bad_spread", "牌阵不对。");
    await play(req, res, deps, (day, nonce, tier) => {
      const question = clip(req.body?.question, 80);
      const cut = clampInt(req.body?.cut, 0, 77);
      const picks = picksOf(req.body?.picks, spread.count);
      return {
        key: `tarot:${nonce}:${day}:${spread.id}:${cut}:${(picks ?? ["auto"]).join(".")}:${question}`,
        kind: "tarot",
        day,
        price: priceKeyForSpread(spread.id),
        tier,
        build: () => buildTarotDraw({ day, spread: spread.id as SpreadId, question, nonce, cut, picks }),
      };
    });
  }));

  app.post("/api/stick", productRoute(async (req, res) => {
    await play(req, res, deps, (day, nonce, tier) => ({
      key: `stick:${nonce}:${day}`,
      kind: "stick",
      day,
      price: "stickDeep" as const,
      tier,
      build: () => buildStickDraw(day, nonce),
    }));
  }));

  app.get("/api/stick", productRoute(async (req, res) => {
    const day = sgDay();
    const user = await currentUser(req, deps);
    res.json(await openPlay(deps.pool, deps.llm, user, {
      key: `stick:public:${day}`,
      kind: "stick",
      day,
      price: "stickDeep",
      tier: "free",
      build: () => buildStickDraw(day, "public"),
    }));
  }));

  app.post("/api/iching", productRoute(async (req, res) => {
    await play(req, res, deps, (day, nonce, tier) => {
      const parsed = Array.isArray(req.body?.lines) ? parseLines(req.body.lines.map(Number)) : null;
      if (Array.isArray(req.body?.lines) && !parsed) throw new ProductError(400, "bad_lines", "每一爻只能是 6、7、8 或 9，共六爻。");
      const lines = parsed ?? rollLines(`${day}|${nonce}`);
      return {
        key: `iching:${day}:${lines.map((line) => line.value).join("")}:${nonce}`,
        kind: "iching",
        day,
        price: "ichingDeep" as const,
        tier,
        build: () => buildIchingDraw(day, nonce, lines),
      };
    });
  }));

  app.get("/api/astro", productRoute(async (req, res) => {
    const sign = signByName(typeof req.query.sign === "string" ? req.query.sign : "");
    if (!sign) throw new ProductError(400, "bad_sign", "请选十二星座之一。");
    const day = sgDay();
    const user = await currentUser(req, deps);
    res.json(await openPlay(deps.pool, deps.llm, user, {
      key: `astro:${sign.name}:${day}`,
      kind: "astro",
      day,
      price: "astroDeep",
      tier: "free",
      build: () => {
        const reading = buildAstro(sign.name, day);
        if (!reading) throw new ProductError(400, "bad_sign", "请选十二星座之一。");
        return reading;
      },
    }));
  }));

  app.post("/api/astro", productRoute(async (req, res) => {
    const sign = signByName(typeof req.body?.sign === "string" ? req.body.sign : "");
    if (!sign) throw new ProductError(400, "bad_sign", "请选十二星座之一。");
    await play(req, res, deps, (day, _nonce, tier) => ({
      key: `astro:${sign.name}:${day}`,
      kind: "astro",
      day,
      price: "astroDeep" as const,
      tier,
      build: () => {
        const reading = buildAstro(sign.name, day);
        if (!reading) throw new ProductError(400, "bad_sign", "请选十二星座之一。");
        return reading;
      },
    }), sign.name);
  }));

  app.post("/api/astro/match", productRoute(async (req, res) => {
    const left = signByName(typeof req.body?.left === "string" ? req.body.left : "");
    const right = signByName(typeof req.body?.right === "string" ? req.body.right : "");
    if (!left || !right) throw new ProductError(400, "bad_sign", "两边都要是星座名。");
    await play(req, res, deps, (day, _nonce, tier) => ({
      key: `match:${[left.name, right.name].sort().join(":")}:${day}`,
      kind: "astro",
      day,
      price: "matchDeep" as const,
      tier,
      build: () => {
        const reading = buildMatch(left.name, right.name, day);
        if (!reading) throw new ProductError(400, "bad_sign", "两边都要是星座名。");
        return reading;
      },
    }));
  }));

  app.get("/api/zodiac", productRoute(async (req, res) => {
    const animal = animalOf(typeof req.query.animal === "string" ? req.query.animal : "");
    if (!animal) throw new ProductError(400, "bad_animal", "请选十二生肖之一。");
    const day = sgDay();
    const user = await currentUser(req, deps);
    res.json(await openPlay(deps.pool, deps.llm, user, {
      key: `zodiac:${animal}:${day}`,
      kind: "zodiac",
      day,
      price: "zodiacDeep",
      tier: "free",
      build: () => {
        const reading = buildZodiac(animal, day);
        if (!reading) throw new ProductError(400, "bad_animal", "请选十二生肖之一。");
        return reading;
      },
    }));
  }));

  app.post("/api/zodiac", productRoute(async (req, res) => {
    const animal = animalOf(typeof req.body?.animal === "string" ? req.body.animal : "");
    if (!animal) throw new ProductError(400, "bad_animal", "请选十二生肖之一。");
    await play(req, res, deps, (day, _nonce, tier) => ({
      key: `zodiac:${animal}:${day}`,
      kind: "zodiac",
      day,
      price: "zodiacDeep" as const,
      tier,
      build: () => {
        const reading = buildZodiac(animal, day);
        if (!reading) throw new ProductError(400, "bad_animal", "请选十二生肖之一。");
        return reading;
      },
    }));
  }));

  app.get("/api/almanac", productRoute(async (req, res) => {
    const day = sgDay();
    const user = await currentUser(req, deps);
    res.json(await openPlay(deps.pool, deps.llm, user, {
      key: `almanac:${day}`,
      kind: "almanac",
      day,
      price: "almanacDeep",
      tier: "free",
      build: () => buildAlmanac(day),
    }));
  }));

  app.post("/api/almanac", productRoute(async (req, res) => {
    await play(req, res, deps, (day, _nonce, tier) => ({
      key: `almanac:${day}`,
      kind: "almanac",
      day,
      price: "almanacDeep" as const,
      tier,
      build: () => buildAlmanac(day),
    }));
  }));

  app.post("/api/number", productRoute(async (req, res) => {
    const birthday = typeof req.body?.birthday === "string" ? req.body.birthday.trim() : "";
    await play(req, res, deps, (day, _nonce, tier) => ({
      key: `number:${birthday}:${day.slice(0, 4)}`,
      kind: "number",
      day,
      price: "numberDeep" as const,
      tier,
      build: () => {
        const reading = buildNumber(birthday, day);
        if (!reading) throw new ProductError(400, "bad_birthday", "生日用 YYYY-MM-DD。");
        return reading;
      },
    }));
  }));

  app.post("/api/dream", productRoute(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().replace(/\s+/g, " ") : "";
    if (text.length < 2 || text.length > 200) throw new ProductError(400, "bad_dream", "梦请写 2 到 200 个字。");
    await play(req, res, deps, (day, nonce, tier) => ({
      key: `dream:${day}:${nonce}:${text}`,
      kind: "dream",
      day,
      price: "dreamDeep" as const,
      tier,
      build: () => buildDream(text, day, nonce),
    }));
  }));

  app.post("/api/rune", productRoute(async (req, res) => {
    const count = req.body?.count === 3 ? 3 : 1;
    await play(req, res, deps, (day, nonce, tier) => ({
      key: `rune:${day}:${nonce}:${count}`,
      kind: "rune",
      day,
      price: "runeDeep" as const,
      tier,
      build: () => buildRuneDraw(day, nonce, count),
    }));
  }));

  app.post("/api/lenormand", productRoute(async (req, res) => {
    const count = req.body?.count === 5 ? 5 : 3;
    await play(req, res, deps, (day, nonce, tier) => ({
      key: `lenormand:${day}:${nonce}:${count}`,
      kind: "lenormand",
      day,
      price: "lenormandDeep" as const,
      tier,
      build: () => buildLenormandDraw(day, nonce, count),
    }));
  }));
}

async function play(
  req: Request,
  res: Response,
  deps: AppDeps,
  specFor: (day: string, nonce: string, tier: "free" | "full") => Parameters<typeof openPlay>[3],
  nonceOverride?: string,
): Promise<void> {
  const tier = req.body?.tier === "full" ? "full" : "free";
  const user = await currentUser(req, deps);
  if (tier === "full") {
    assertAck(req.body);
    if (!user) throw new ProductError(401, "unauthorized", "登录后才能解锁深度解读。新用户送 3 次。");
  }
  const seed = user?.id ?? `guest:${req.ip ?? "local"}`;
  if (!allowAttempt(`play:${seed}`, 60, 10 * 60 * 1000)) {
    throw new ProductError(429, "rate_limited", "抽得太勤了，休息一会儿。");
  }
  const nonce = nonceOverride ?? cleanNonce(req.body?.nonce) ?? `${seed}:${Date.now().toString(36)}`;
  const day = sgDay();
  res.json(await openPlay(deps.pool, deps.llm, user, specFor(day, nonce, tier)));
}

function cleanNonce(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return clean || null;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

function picksOf(value: unknown, count: number): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== count) {
    throw new ProductError(400, "bad_picks", `请选 ${count} 张牌。`);
  }
  const nums = value.map((item) => Number(item));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 77) || new Set(nums).size !== nums.length) {
    throw new ProductError(400, "bad_picks", "选牌超出牌堆了。");
  }
  return nums;
}
