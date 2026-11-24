export const DISCLAIMER = "仅供娱乐，不构成投资、法律、医疗或心理建议";
export const NON_REFUNDABLE = "虚拟服务一经交付不予退款";
export const MOOD_NOTE = "这是心情标签，不是操作建议";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");
}

/** Soul number: digital root of the hex digits. 11 and 22 stay. An all-zero address is 0. */
export function soulNumber(address: string): number {
  const hex = address.toLowerCase().replace(/^0x/, "");
  let sum = 0;
  for (const char of hex) {
    const digit = Number.parseInt(char, 16);
    if (Number.isNaN(digit)) continue;
    sum += digit;
  }
  if (sum === 0) return 0;
  let value = sum;
  while (value > 9 && value !== 11 && value !== 22) {
    value = String(value)
      .split("")
      .reduce((total, digit) => total + Number(digit), 0);
  }
  return value;
}

export function maskAddress(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "");
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export type SecretKind = "address" | "key" | "mnemonic" | "invalid";

export function classifySecret(input: string): SecretKind {
  const raw = input.trim();
  if (/^[a-z]+(?:\s+[a-z]+){11,23}$/i.test(raw)) return "mnemonic";
  const compact = raw.replace(/\s+/g, "");
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(compact)) return "key";
  if (/^0x[0-9a-fA-F]{40}$/.test(compact)) return "address";
  return "invalid";
}

export function normalizeAddress(input: string): string | null {
  if (classifySecret(input) !== "address") return null;
  return input.trim().toLowerCase();
}

export interface SymbolParse {
  symbol: string;
  masked: string;
  contract: boolean;
}

export function parseSymbol(input: string): { ok: true; value: SymbolParse } | { ok: false; code: "secret" | "bad_symbol" } {
  const raw = input.trim().replace(/^\$/, "");
  const kind = classifySecret(raw);
  if (kind === "key" || kind === "mnemonic") return { ok: false, code: "secret" };
  if (kind === "address") {
    const symbol = raw.toLowerCase();
    return { ok: true, value: { symbol, masked: maskAddress(symbol), contract: true } };
  }
  if (!/^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(raw)) return { ok: false, code: "bad_symbol" };
  const symbol = raw.toUpperCase();
  return { ok: true, value: { symbol, masked: symbol, contract: false } };
}

export function normalizeNickname(input: unknown, fallback: string): string {
  const source = typeof input === "string" && input.trim() ? input.trim() : fallback;
  const cleaned = source.replace(/\s+/g, "").slice(0, 16);
  if (/^[\p{L}\p{N}_\-·]{1,16}$/u.test(cleaned)) return cleaned;
  const rescued = fallback.replace(/[^\p{L}\p{N}_\-·]/gu, "").slice(0, 16);
  return rescued || "橙友";
}

export function nicknameFromEmail(email: string): string {
  return normalizeNickname(null, email.split("@")[0] ?? "橙友");
}

export function asksForTrade(text: string): boolean {
  return /(买入|卖出|做多|做空|目标价|止盈|止损|梭哈|加仓|减仓|开多|开空|能涨|会跌|多少钱|价格|点位|all[\s-]?in|\blong\b|\bshort\b)/i.test(
    text,
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
