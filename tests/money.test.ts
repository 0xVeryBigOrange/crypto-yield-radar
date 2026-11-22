import { describe, expect, test } from "vitest";
import { formatDecimal, formatFull, formatUsd, parseDecimal } from "../src/money.js";

describe("money", () => {
  test("parses and formats fixed decimals", () => {
    expect(formatFull(parseDecimal("1.3"))).toBe("1.3");
    expect(formatFull(parseDecimal("0.0000025"))).toBe("0.0000025");
    expect(formatFull(parseDecimal("10"))).toBe("10");
    expect(formatUsd(parseDecimal("10"))).toBe("10.00");
    expect(formatUsd(parseDecimal("0.0013"))).toBe("0.0013");
    expect(formatUsd(parseDecimal("-1.5"))).toBe("-1.50");
  });

  test("rounds half up past the stored scale", () => {
    expect(formatFull(parseDecimal("0.0000000000015"))).toBe("0.000000000002");
    expect(formatDecimal(parseDecimal("1.23456"), 4)).toBe("1.2346");
    expect(formatDecimal(parseDecimal("1.005"), 2)).toBe("1.01");
  });

  test("accepts scientific notation", () => {
    expect(formatFull(parseDecimal("1.5e-7"))).toBe("0.00000015");
    expect(formatFull(parseDecimal("2e3"))).toBe("2000");
  });
});
