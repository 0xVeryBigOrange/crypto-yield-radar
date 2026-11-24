export interface WalletBirth {
  firstSeen: string | null;
  chain: "ethereum" | "bsc" | null;
  source: string;
}

const EXPLORERS: Array<{ chain: "ethereum" | "bsc"; url: (address: string) => string }> = [
  {
    chain: "ethereum",
    url: (address) =>
      `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
  },
  {
    chain: "bsc",
    url: (address) =>
      `https://bsc.blockscout.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
  },
];

export function parseExplorerBody(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const result = (json as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0 || !result[0] || typeof result[0] !== "object") return null;
  const stamp = (result[0] as { timeStamp?: unknown }).timeStamp;
  const unix = typeof stamp === "string" || typeof stamp === "number" ? Number(stamp) : Number.NaN;
  if (!Number.isFinite(unix) || unix < 1_000_000_000 || unix > 10_000_000_000) return null;
  return unix;
}

export function unixToDay(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** Best-effort first-transaction day from public explorers. Failure leaves the birthday blank. */
export async function lookupWalletBirth(address: string, fetchImpl: typeof fetch = fetch): Promise<WalletBirth> {
  const hits = await Promise.all(
    EXPLORERS.map(async (explorer) => {
      try {
        const response = await fetchImpl(explorer.url(address), {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) return null;
        const unix = parseExplorerBody(await response.json());
        if (unix == null) return null;
        return { chain: explorer.chain, unix };
      } catch {
        return null;
      }
    }),
  );
  const found = hits.filter((hit): hit is { chain: "ethereum" | "bsc"; unix: number } => hit != null);
  found.sort((a, b) => a.unix - b.unix);
  const earliest = found[0];
  if (!earliest) return { firstSeen: null, chain: null, source: "miss" };
  return { firstSeen: unixToDay(earliest.unix), chain: earliest.chain, source: "found" };
}
