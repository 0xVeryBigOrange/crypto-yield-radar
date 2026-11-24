import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
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
  publicStick,
  publicTarot,
} from "../src/builders.js";
import { PRICE_USD, checkinBonusUsd } from "../src/catalog.js";
import { lifePath, signByMonthDay, yearAnimal } from "../src/content/astro.js";
import { HEXAGRAMS, hexFromLines, parseLines } from "../src/content/iching.js";
import { LENORMAND, RUNES } from "../src/content/lexicon.js";
import { allSticks } from "../src/content/sticks.js";
import { TAROT_DECK } from "../src/content/tarotDeck.js";
import { loadConfig } from "../src/config.js";
import { violation } from "../src/guard.js";
import { formatCoins, formatUsd, parseDecimal } from "../src/money.js";
import { present, previewDeep } from "../src/product.js";
import { buildOmen, readingText, type Reading } from "../src/reading.js";
import { DISCLAIMER } from "../src/text.js";

const day = "2026-11-24";

function texts(reading: Reading): string[] {
  return readingText(reading).split("\n");
}

describe("free-first plays", () => {
  test("prices stay inside the cheap deep-reading band", () => {
    expect(formatCoins(parseDecimal(PRICE_USD.tarotDeep))).toBe("20");
    expect(formatCoins(parseDecimal(PRICE_USD.tarotCeltic))).toBe("50");
    expect(formatCoins(parseDecimal(PRICE_USD.ichingDeep))).toBe("30");
    expect(formatCoins(parseDecimal(PRICE_USD.astroDeep))).toBe("10");
    expect(formatCoins(parseDecimal(PRICE_USD.monthPass))).toBe("299");
    for (const [key, value] of Object.entries(PRICE_USD)) {
      const amount = Number(value);
      if (key === "monthPass") expect(amount).toBe(2.99);
      else expect(amount).toBeGreaterThanOrEqual(0.1);
      if (key !== "monthPass") expect(amount).toBeLessThanOrEqual(0.5);
    }
    expect(checkinBonusUsd(1)).toBe("0.02");
    expect(checkinBonusUsd(8)).toBe("0.09");
    const config = loadConfig({
      DATABASE_URL: "postgres://keymint@127.0.0.1/keymint",
      SESSION_SECRET: "1234567890123456",
      NODE_ENV: "test",
      UPSTREAM_PROVIDER: "openrouter",
    });
    expect(formatUsd(config.minDepositUsd)).toBe("1.00");
  });

  test("the free omen keeps a full basic reading and only blurs the deep layer", () => {
    const omen = buildOmen("sg", day);
    const view = present(
      {
        cacheKey: "omen",
        kind: "omen",
        day,
        title: omen.title,
        summary: omen.summary,
        payload: omen,
        source: "template",
        slug: "s",
        fullSlug: "f",
      },
      "free",
      PRICE_USD.omenDeep,
    );
    expect(view.locked).toBe(true);
    expect(view.sections).toEqual([]);
    expect(view.basics.length).toBeGreaterThan(0);
    expect(view.deepPreview.length).toBeGreaterThan(8);
    expect(view.priceCoins).toBe("20");
    expect(previewDeep(omen.sections).endsWith("…") || previewDeep(omen.sections).length > 0).toBe(true);
  });

  test("decks, sticks, and hexagrams are complete and original enough to scan", () => {
    expect(TAROT_DECK).toHaveLength(78);
    expect(new Set(TAROT_DECK.map((card) => card.id)).size).toBe(78);
    expect(TAROT_DECK.filter((card) => card.arcana === "major")).toHaveLength(22);
    const sticks = allSticks();
    expect(sticks).toHaveLength(100);
    const poems = sticks.map((stick) => stick.poem.join("|"));
    expect(new Set(poems).size).toBe(100);
    expect(poems.join("\n")).not.toContain("开天辟地作良缘");
    expect(HEXAGRAMS).toHaveLength(64);
    expect(HEXAGRAMS[0]?.name).toBe("乾");
    expect(HEXAGRAMS[0]?.bits).toBe("111111");
    expect(HEXAGRAMS[1]?.bits).toBe("000000");
    expect(RUNES).toHaveLength(24);
    expect(LENORMAND).toHaveLength(36);
    const samples = [
      buildTarotDraw({ day, spread: "celtic", question: "要不要换工作", nonce: "n", cut: 3, picks: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] }),
      buildTarotDraw({ day, spread: "yesno", question: "", nonce: "n2", cut: 0, picks: null }),
      publicTarot(day),
      publicStick(day),
      buildStickDraw(day, "other"),
      buildIchingDraw(day, "coins", parseLines([7, 7, 7, 7, 7, 7])!),
      buildIchingDraw(day, "coins", parseLines([9, 9, 9, 9, 9, 9])!),
      buildAstro("狮子", day)!,
      buildMatch("白羊", "天秤", day)!,
      buildZodiac("马", day)!,
      buildAlmanac(day),
      buildNumber("1990-01-01", day)!,
      buildDream("梦见桥上的水和一只猫", day, "d"),
      buildRuneDraw(day, "r", 3),
      buildLenormandDraw(day, "l", 3),
    ];
    for (const reading of samples) {
      expect(reading.disclaimer).toBe(DISCLAIMER);
      expect(reading.basics?.length).toBeGreaterThan(0);
      for (const line of texts(reading)) expect(violation(line)).toBeNull();
    }
    expect(samples[5]?.title.startsWith("乾")).toBe(true);
    const changed = hexFromLines(parseLines([9, 9, 9, 9, 9, 9])!);
    expect(changed.primary.name).toBe("乾");
    expect(changed.changed?.name).toBe("坤");
    expect(lifePath("1990-01-01")).toBe(3);
    expect(lifePath("2000-09-29")).toBe(22);
    expect(lifePath("2026-02-31")).toBeNull();
    expect(signByMonthDay(8, 10)?.name).toBe("狮子");
    expect(yearAnimal("2026-11-24")).toBe("马");
    expect(buildNumber("1990-01-01", day)?.summary).toContain("3");
  });

  test("public play pages exist and carry the disclaimer", () => {
    const pages = readdirSync("public").filter((name) => name.endsWith(".html"));
    for (const name of ["/play", "/tarot", "/stick", "/iching", "/astro", "/zodiac", "/almanac", "/number", "/dream", "/rune", "/collection"]) {
      expect(pages).toContain(`${name.slice(1)}.html`);
    }
    const tarot = readFileSync("public/tarot.html", "utf8");
    expect(tarot).toContain(DISCLAIMER);
    expect(tarot).toContain("洗牌");
  });
});
