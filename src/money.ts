/** Fixed-point USD. 1 USD = 10^12 units so per-token prices survive. */

export const SCALE = 12;
const BASE = 10n ** BigInt(SCALE);

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function parseDecimal(input: string | number): bigint {
  const expanded = expand(input);
  if (expanded.length > 80) throw new MoneyError("decimal is too long");
  const match = expanded.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!match) throw new MoneyError("invalid decimal");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  if (whole.length > 18) throw new MoneyError("decimal is too large");
  const keep = frac.slice(0, SCALE).padEnd(SCALE, "0");
  let value = BigInt(whole + keep);
  const next = frac[SCALE];
  if (next !== undefined && next >= "5") value += 1n;
  return sign * value;
}

export function formatFull(value: bigint): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const whole = v / BASE;
  const frac = (v % BASE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  const body = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return neg && v !== 0n ? `-${body}` : body;
}

export function formatDecimal(value: bigint, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > SCALE) {
    throw new MoneyError("invalid places");
  }
  const neg = value < 0n;
  let v = neg ? -value : value;
  const factor = 10n ** BigInt(SCALE - places);
  v = (v + factor / 2n) / factor;
  const pbase = 10n ** BigInt(places);
  const whole = v / pbase;
  const body =
    places === 0
      ? whole.toString()
      : `${whole.toString()}.${(v % pbase).toString().padStart(places, "0")}`;
  return neg && v !== 0n ? `-${body}` : body;
}

/** Currency display: at least two fraction digits, no trailing-zero padding beyond that. */
/** 1 USD = 100 橙币. Display is a whole number of coins. */
export function formatCoins(value: bigint): string {
  const unit = 10n ** BigInt(SCALE - 2);
  const neg = value < 0n;
  let v = neg ? -value : value;
  v = (v + unit / 2n) / unit;
  const body = v.toString();
  return neg && v !== 0n ? `-${body}` : body;
}

export function formatUsd(value: bigint): string {
  const neg = value < 0n;
  const full = formatFull(neg ? -value : value);
  let body: string;
  if (!full.includes(".")) body = `${full}.00`;
  else {
    const [whole, frac] = full.split(".");
    body = (frac ?? "").length < 2 ? `${whole}.${(frac ?? "").padEnd(2, "0")}` : full;
  }
  return neg && value !== 0n ? `-${body}` : body;
}

export function formatPrice(value: bigint): string {
  if (value === 0n) return "0";
  for (const places of [4, 6, 8, 12]) {
    const rendered = formatDecimal(value, places);
    if (!/^0(?:\.0+)?$/.test(rendered)) return rendered;
  }
  return formatFull(value);
}

/** Round-half-up (a * b) / denom. */
export function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  if (denom <= 0n) throw new MoneyError("denominator must be positive");
  const neg = (a < 0n) !== (b < 0n);
  const prod = (a < 0n ? -a : a) * (b < 0n ? -b : b);
  const rounded = (prod + denom / 2n) / denom;
  return neg ? -rounded : rounded;
}

export function applyRatio(value: bigint, ratio: bigint): bigint {
  if (value < 0n) return 0n;
  return mulDiv(value, ratio, BASE);
}

function expand(input: string | number): string {
  const raw = typeof input === "number" ? plainFromNumber(input) : String(input).trim();
  const sci = raw.match(/^([+-])?(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!sci) return raw;
  const sign = sci[1] === "-" ? "-" : "";
  const digits = (sci[2] ?? "") + (sci[3] ?? "");
  const shift = Number(sci[4]) - (sci[3]?.length ?? 0);
  if (!Number.isFinite(shift) || Math.abs(shift) > 40) throw new MoneyError("exponent out of range");
  if (shift >= 0) return sign + digits + "0".repeat(shift);
  const index = digits.length + shift;
  if (index > 0) return sign + digits.slice(0, index) + "." + digits.slice(index);
  return sign + "0." + "0".repeat(-index) + digits;
}

function plainFromNumber(value: number): string {
  if (!Number.isFinite(value)) throw new MoneyError("not a finite number");
  return value.toFixed(SCALE);
}
