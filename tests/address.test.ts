import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CHAINS, DEPOSIT_ADDRESS } from "../src/payments.js";

const allowed = new Set<string>([
  DEPOSIT_ADDRESS.toLowerCase(),
  ...Object.values(CHAINS).flatMap((chain) => chain.tokens.map((token) => token.address.toLowerCase())),
]);

describe("address source of truth", () => {
  test("README repeats the canonical deposit address and token contracts", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain(DEPOSIT_ADDRESS);
    for (const chain of Object.values(CHAINS)) {
      for (const token of chain.tokens) expect(readme).toContain(token.address);
    }
  });

  test("pages and server code do not contain a mistyped 20-byte address", () => {
    const offenders: string[] = [];
    for (const file of walk("src").concat(walk("public"), ["README.md", "render.yaml"])) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g)) {
        if (!allowed.has(match[0].toLowerCase())) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the marketing pages do not hardcode the deposit address", () => {
    for (const file of walk("public")) {
      expect(readFileSync(file, "utf8").includes(DEPOSIT_ADDRESS.slice(2, 10))).toBe(false);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|html|css|md|svg|yml|yaml)$/.test(entry)) out.push(full);
  }
  return out;
}
