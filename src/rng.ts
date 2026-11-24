import { createHash } from "node:crypto";

export type Rng = () => number;

/** Deterministic float in [0, 1). The same seed always replays the same sequence. */
export function rngFrom(seed: string): Rng {
  let x = createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  return () => {
    x |= 0;
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("empty pick");
  return items[Math.floor(rng() * items.length)] as T;
}

export function take<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) out.push(item);
  }
  return out;
}
