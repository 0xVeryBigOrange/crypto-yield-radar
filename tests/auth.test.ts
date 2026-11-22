import { describe, expect, test } from "vitest";
import { generateApiKey, hashApiKey, hashPassword, verifyPassword } from "../src/auth.js";

describe("auth", () => {
  test("scrypt password hashes verify and reject a wrong password", async () => {
    const stored = await hashPassword("correct-horse");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
  });

  test("api keys are shown once and stored as a hash", () => {
    const key = generateApiKey();
    expect(key.token.startsWith("sk-")).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.token));
    expect(key.hash).not.toContain(key.token);
    expect(key.prefix.length).toBe(11);
    expect(key.last4).toBe(key.token.slice(-4));
  });
});
