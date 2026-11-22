import { describe, expect, test } from "vitest";
import {
  applyAdjust,
  applyMarkup,
  applyRelease,
  applyReserve,
  applySettle,
  costFromTokens,
  quote,
} from "../src/billing.js";
import { formatFull, parseDecimal } from "../src/money.js";

const price = {
  promptPerToken: parseDecimal("0.000002"),
  completionPerToken: parseDecimal("0.000008"),
  request: 0n,
};
const markup = parseDecimal("1.3");

describe("billing math", () => {
  test("token cost times markup", () => {
    const upstream = costFromTokens({ promptTokens: 1000, completionTokens: 500 }, price);
    expect(formatFull(upstream)).toBe("0.006");
    expect(formatFull(applyMarkup(upstream, markup))).toBe("0.0078");
  });

  test("includes a per-request fee before markup", () => {
    const upstream = costFromTokens(
      { promptTokens: 1000, completionTokens: 500 },
      { ...price, request: parseDecimal("0.001") },
    );
    expect(formatFull(upstream)).toBe("0.007");
    expect(formatFull(applyMarkup(upstream, markup))).toBe("0.0091");
  });

  test("reservation refunds the unused hold", () => {
    const quoted = quote({
      promptTokens: 1000,
      completionTokens: 500,
      price,
      markup,
      buffer: parseDecimal("1.25"),
    });
    expect(formatFull(quoted.hold)).toBe("0.00975");
    const reserved = applyReserve({ balance: parseDecimal("5"), reserved: 0n }, quoted.hold);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const settled = applySettle(reserved.state, quoted.hold, parseDecimal("0.0078"));
    expect(formatFull(settled.charged)).toBe("0.0078");
    expect(settled.shortfall).toBe(0n);
    expect(formatFull(settled.state.balance)).toBe("4.9922");
    expect(settled.state.reserved).toBe(0n);
  });

  test("release restores the full hold", () => {
    const reserved = applyReserve({ balance: parseDecimal("5"), reserved: parseDecimal("1") }, parseDecimal("1.25"));
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const released = applyRelease(reserved.state, parseDecimal("1.25"));
    expect(formatFull(released.balance)).toBe("5");
    expect(formatFull(released.reserved)).toBe("1");
  });

  test("rejects a hold the balance cannot cover", () => {
    expect(applyReserve({ balance: parseDecimal("1"), reserved: 0n }, parseDecimal("1.01")).ok).toBe(false);
  });

  test("settle takes the extra from the remaining balance, then stops at zero", () => {
    const state = { balance: parseDecimal("0.10"), reserved: parseDecimal("1") };
    const covered = applySettle(state, parseDecimal("1"), parseDecimal("1.05"));
    expect(formatFull(covered.charged)).toBe("1.05");
    expect(formatFull(covered.state.balance)).toBe("0.05");
    const short = applySettle(state, parseDecimal("1"), parseDecimal("1.50"));
    expect(formatFull(short.charged)).toBe("1.1");
    expect(formatFull(short.shortfall)).toBe("0.4");
    expect(short.state.balance).toBe(0n);
    expect(short.state.reserved).toBe(0n);
  });

  test("manual adjustment cannot drive the available balance negative", () => {
    expect(applyAdjust(parseDecimal("2"), parseDecimal("-0.5")).ok).toBe(true);
    expect(applyAdjust(parseDecimal("2"), parseDecimal("-2.01")).ok).toBe(false);
  });
});
