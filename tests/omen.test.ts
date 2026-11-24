import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { violation } from "../src/guard.js";
import { applyPolish } from "../src/llm.js";
import { renderPng, renderSvg } from "../src/image.js";
import {
  BIRTHDAY_LINES,
  CARDS,
  COMPAT_BITS,
  COMPAT_FREE,
  LINES,
  NO_BIRTHDAY,
  OWNER_BITS,
  PAST,
  PRESENT,
  QUOTES,
  REFUSALS,
  RHYTHM,
  TAROT_BITS,
  TAROT_SHORT,
  TEMPERAMENTS,
  TICKER_BITS,
  TICKER_FREE,
  WALLET_FREE,
  WALLET_SECTIONS,
} from "../src/copy.js";
import { decideSpend } from "../src/spend.js";
import { buildOmen, buildTarot, buildWallet, readingText } from "../src/reading.js";
import { parseExplorerBody } from "../src/walletLookup.js";
import { sgDay, usSessionDate } from "../src/time.js";
import { DISCLAIMER, classifySecret, maskAddress, soulNumber } from "../src/text.js";
import { parseDecimal } from "../src/money.js";

const bank = [
  ...CARDS.flatMap((card) => [card.name, card.epithet]),
  ...Object.values(LINES).flat(),
  ...Object.values(PAST).flat(),
  ...Object.values(PRESENT).flat(),
  ...Object.values(RHYTHM).flat(),
  ...QUOTES,
  ...TEMPERAMENTS,
  ...BIRTHDAY_LINES,
  ...NO_BIRTHDAY,
  ...WALLET_FREE,
  ...WALLET_SECTIONS,
  ...REFUSALS,
  ...TAROT_SHORT,
  ...TAROT_BITS,
  ...TICKER_FREE,
  ...TICKER_BITS,
  ...COMPAT_FREE,
  ...COMPAT_BITS,
  ...OWNER_BITS,
];

describe("omen templates", () => {
  test("the copy bank does not instruct, target, or promise luck", () => {
    for (const line of bank) expect(violation(line)).toBeNull();
  });

  test("the same day replays the same omen, and the mood is only a mood", () => {
    const first = buildOmen("sg", "2026-03-21");
    const second = buildOmen("sg", "2026-03-21");
    expect(second).toEqual(first);
    expect(buildOmen("sg", "2026-03-22").summary).not.toBe(first.summary);
    expect(["观望", "防守", "进取"]).toContain(first.mood);
    expect(first.moodNote).toContain("不是操作建议");
    expect(first.disclaimer).toBe(DISCLAIMER);
    expect(violation(readingText(first))).toBeNull();
    expect(first.weekCandles).toHaveLength(7);
  });

  test("a wallet reading is deterministic, masked, and refuses a private key", () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";
    const reading = buildWallet(address, "2026-03-21", "2019-01-01", "ethereum");
    expect(reading.subject).toBe(maskAddress(address));
    expect(readingText(reading)).not.toContain(address);
    expect(buildWallet(address, "2026-03-21", "2019-01-01", "ethereum")).toEqual(reading);
    expect(soulNumber(address)).toBeGreaterThan(0);
    expect(classifySecret(address)).toBe("address");
    expect(classifySecret(`0x${"ab".repeat(32)}`)).toBe("key");
    expect(classifySecret("legal winner thank year wave sausage worth useful legal winner thank yellow")).toBe("mnemonic");
    const trade = buildTarot("user", "2026-03-21", "现在可以买入吗", true);
    expect(violation(readingText(trade))).toBeNull();
    expect(trade.summary).not.toMatch(/建议买入/);
  });

  test("singapore midnight and the US session roll on calendar boundaries", () => {
    expect(sgDay(new Date("2026-03-20T15:59:00Z"))).toBe("2026-03-20");
    expect(sgDay(new Date("2026-03-20T16:00:00Z"))).toBe("2026-03-21");
    expect(usSessionDate(new Date("2026-03-20T13:00:00Z"))).toBe("2026-03-20");
    expect(usSessionDate(new Date("2026-03-20T20:15:00Z"))).toBe("2026-03-23");
    expect(usSessionDate(new Date("2026-01-16T14:29:00Z"))).toBe("2026-01-16");
    expect(usSessionDate(new Date("2026-01-15T21:15:00Z"))).toBe("2026-01-16");
  });

  test("llm prose that gives a target is discarded", () => {
    const base = buildOmen("sg", "2026-04-01");
    const kept = applyPolish(base, JSON.stringify({ summary: "今天只是想喝茶。", quote: "牌不带路。", sections: ["甲", "乙", "丙"] }));
    expect(kept?.summary).toBe("今天只是想喝茶。");
    expect(kept?.mood).toBe(base.mood);
    expect(kept?.weekCandles).toEqual(base.weekCandles);
    const rejected = applyPolish(base, JSON.stringify({ summary: "目标价 100。", quote: "冲。", sections: ["甲", "乙", "丙"] }));
    expect(rejected).toBeNull();
  });

  test("spend decisions do not let a pass purchase ride for free, and readings can", () => {
    const balance = parseDecimal("9.9");
    expect(decideSpend({ balance, passActive: true, already: false, amount: parseDecimal("0.2"), coverWithPass: true, credits: 3 }).via).toBe("pass");
    expect(decideSpend({ balance: 0n, passActive: false, already: false, amount: parseDecimal("0.2"), coverWithPass: true, credits: 2 }).via).toBe("credit");
    expect(decideSpend({ balance, passActive: true, already: false, amount: parseDecimal("9.9"), coverWithPass: false }).via).toBe("balance");
    expect(decideSpend({ balance: parseDecimal("1"), passActive: false, already: false, amount: parseDecimal("2"), coverWithPass: true }).via).toBe("insufficient");
    expect(decideSpend({ balance, passActive: false, already: true, amount: parseDecimal("1"), coverWithPass: true }).via).toBe("replay");
  });

  test("explorer payloads and the poster stay inside the entertainment frame", () => {
    expect(parseExplorerBody({ status: "1", result: [{ timeStamp: "1546300800" }] })).toBe(1546300800);
    expect(parseExplorerBody({ result: "No transactions found" })).toBeNull();
    const svg = renderSvg(buildOmen("us", "2026-04-02"), "card", "https://keymint-1106.onrender.com/s/omen-us-2026-04-02");
    expect(svg).toContain(DISCLAIMER);
    expect(svg).toContain("心情刻度");
    expect(svg).not.toContain("目标价");
    const png = renderPng(svg);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("every public page carries the entertainment line", () => {
    const pages = readdirSync("public").filter((name) => name.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(4);
    for (const name of pages) {
      expect(readFileSync(`public/${name}`, "utf8")).toContain(DISCLAIMER);
    }
  });
});
