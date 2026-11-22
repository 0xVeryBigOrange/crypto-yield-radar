import { applyRatio, mulDiv, SCALE } from "./money.js";

const BASE = 10n ** BigInt(SCALE);

export interface TokenPrice {
  promptPerToken: bigint;
  completionPerToken: bigint;
  request: bigint;
}

export interface TokenCounts {
  promptTokens: number;
  completionTokens: number;
}

export interface Ledger {
  balance: bigint;
  reserved: bigint;
}

export function costFromTokens(usage: TokenCounts, price: TokenPrice): bigint {
  const prompt = BigInt(clampTokens(usage.promptTokens)) * price.promptPerToken;
  const completion = BigInt(clampTokens(usage.completionTokens)) * price.completionPerToken;
  const request = price.request > 0n ? price.request : 0n;
  return prompt + completion + request;
}

export function applyMarkup(upstreamCost: bigint, markup: bigint): bigint {
  return applyRatio(upstreamCost, markup);
}

export function holdFor(markedCost: bigint, buffer: bigint): bigint {
  return applyRatio(markedCost, buffer);
}

/** Invert a markup so an estimated charge still books a matching upstream cost. */
export function impliedUpstream(charged: bigint, markup: bigint): bigint {
  if (charged <= 0n) return 0n;
  if (markup <= 0n) return charged;
  return mulDiv(charged, BASE, markup);
}

export function estimatePromptTokens(messages: unknown): number {
  let text = "";
  try {
    text = JSON.stringify(messages ?? "");
  } catch {
    text = "";
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function completionCap(body: Record<string, unknown>, fallback: number): number {
  const raw = body.max_completion_tokens ?? body.max_tokens ?? fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 128_000);
}

export function quote(opts: {
  promptTokens: number;
  completionTokens: number;
  price: TokenPrice;
  markup: bigint;
  buffer: bigint;
}): { upstream: bigint; marked: bigint; hold: bigint } {
  const upstream = costFromTokens(
    { promptTokens: opts.promptTokens, completionTokens: opts.completionTokens },
    opts.price,
  );
  const marked = applyMarkup(upstream, opts.markup);
  return { upstream, marked, hold: holdFor(marked, opts.buffer) };
}

export function applyReserve(state: Ledger, amount: bigint): { ok: true; state: Ledger } | { ok: false } {
  if (amount < 0n) throw new Error("reserve amount must be >= 0");
  if (state.balance < amount) return { ok: false };
  return {
    ok: true,
    state: { balance: state.balance - amount, reserved: state.reserved + amount },
  };
}

export function applyRelease(state: Ledger, amount: bigint): Ledger {
  if (amount < 0n || state.reserved < amount) throw new Error("release exceeds reserved funds");
  return { balance: state.balance + amount, reserved: state.reserved - amount };
}

export function applySettle(
  state: Ledger,
  reservedAmount: bigint,
  actual: bigint,
): { state: Ledger; charged: bigint; shortfall: bigint } {
  if (reservedAmount < 0n || actual < 0n) throw new Error("settle amounts must be >= 0");
  if (state.reserved < reservedAmount) throw new Error("settle exceeds reserved funds");
  const reserved = state.reserved - reservedAmount;
  if (actual <= reservedAmount) {
    return {
      state: { balance: state.balance + (reservedAmount - actual), reserved },
      charged: actual,
      shortfall: 0n,
    };
  }
  const extra = actual - reservedAmount;
  if (state.balance >= extra) {
    return {
      state: { balance: state.balance - extra, reserved },
      charged: actual,
      shortfall: 0n,
    };
  }
  const charged = reservedAmount + state.balance;
  return {
    state: { balance: 0n, reserved },
    charged,
    shortfall: actual - charged,
  };
}

export function applyAdjust(balance: bigint, delta: bigint): { ok: true; balance: bigint } | { ok: false } {
  const next = balance + delta;
  if (next < 0n) return { ok: false };
  return { ok: true, balance: next };
}

function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
