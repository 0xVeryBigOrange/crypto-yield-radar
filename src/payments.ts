import { formatUsd, mulDiv, parseDecimal, SCALE } from "./money.js";

/**
 * One deposit address on both Ethereum and BNB Smart Chain.
 * This constant is the only copy the server uses. Do not retype it in the UI.
 */
export const DEPOSIT_ADDRESS = "0xa18d1810C8457f7d09E3311DF8D2Faf1d9c2E19C";

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const BASE = 10n ** BigInt(SCALE);
const MAX_DEPOSIT = parseDecimal("1000000000");

export interface TokenSpec {
  symbol: "USDT" | "USDC";
  address: string;
  decimals: number;
}

export const CHAINS = {
  ethereum: {
    chainId: 1n,
    label: "Ethereum",
    tokens: [
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9EB0cE3606eB48", decimals: 6 },
    ] satisfies TokenSpec[],
  },
  bsc: {
    chainId: 56n,
    label: "BNB Smart Chain",
    tokens: [
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad70ADf3a8B0d", decimals: 18 },
    ] satisfies TokenSpec[],
  },
} as const;

export type ChainId = keyof typeof CHAINS;

export interface Rpc {
  call(method: string, params: unknown[]): Promise<unknown>;
}

export interface TransferBreakdown {
  symbol: string;
  amountUsd: bigint;
}

export type VerifyResult =
  | {
      ok: true;
      chain: ChainId;
      txHash: string;
      token: string;
      amountUsd: bigint;
      fromAddress: string;
      confirmations: number;
      breakdown: TransferBreakdown[];
    }
  | {
      ok: false;
      code:
        | "bad_tx"
        | "wrong_network"
        | "pending"
        | "failed"
        | "confirmations"
        | "no_transfer"
        | "below_minimum"
        | "amount_untrusted"
        | "bad_receipt";
      message: string;
      confirmations?: number;
      required?: number;
      amountUsd?: string;
      minimumUsd?: string;
    };

export function chainsPublic(): Array<{
  id: ChainId;
  label: string;
  chainId: number;
  tokens: TokenSpec[];
}> {
  return (Object.keys(CHAINS) as ChainId[]).map((id) => ({
    id,
    label: CHAINS[id].label,
    chainId: Number(CHAINS[id].chainId),
    tokens: CHAINS[id].tokens.map((token) => ({ ...token })),
  }));
}

export function addressToTopic(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error("bad address");
  return "0x" + hex.padStart(64, "0");
}

export function topicToAddress(topic: string): string | null {
  const hex = topic.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  if (!hex.startsWith("0".repeat(24))) return null;
  return "0x" + hex.slice(24);
}

export function tokenUnitsToUsd(raw: bigint, decimals: number): bigint {
  if (raw < 0n) return 0n;
  return mulDiv(raw, BASE, 10n ** BigInt(decimals));
}

export async function verifyDeposit(opts: {
  rpc: Rpc;
  chain: ChainId;
  txHash: string;
  minConfirmations: number;
  minDepositUsd: bigint;
}): Promise<VerifyResult> {
  const txHash = opts.txHash.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return fail("bad_tx", "Transaction hash must be 0x followed by 64 hex characters.");
  }
  const chain = CHAINS[opts.chain];
  const chainIdHex = await opts.rpc.call("eth_chainId", []);
  const chainId = hexToBigInt(chainIdHex);
  if (chainId == null || chainId !== chain.chainId) {
    return fail(
      "wrong_network",
      `RPC chain id does not match ${chain.label}. Check ETH_RPC_URL / BSC_RPC_URL.`,
    );
  }
  const receipt = await opts.rpc.call("eth_getTransactionReceipt", [txHash]);
  if (receipt == null) {
    return fail("pending", "Transaction is not mined yet. Submit it again after it is included.");
  }
  if (!isRecord(receipt) || !Array.isArray(receipt.logs)) {
    return fail("bad_receipt", "RPC returned a receipt this service could not read.");
  }
  const status = hexToBigInt(receipt.status);
  if (status == null) return fail("bad_receipt", "Transaction receipt has no status.");
  if (status !== 1n) return fail("failed", "Transaction reverted, so it cannot be credited.");
  const block = hexToBigInt(receipt.blockNumber);
  const head = hexToBigInt(await opts.rpc.call("eth_blockNumber", []));
  if (block == null || head == null || head < block) {
    return fail("confirmations", "Chain head is behind this transaction. Try again shortly.", {
      confirmations: 0,
      required: opts.minConfirmations,
    });
  }
  const depth = head - block + 1n;
  if (depth > 1_000_000n) return fail("bad_receipt", "Confirmation count is not usable.");
  const confirmations = Number(depth);
  if (confirmations < opts.minConfirmations) {
    return fail(
      "confirmations",
      `Need ${opts.minConfirmations} confirmations, have ${confirmations}.`,
      { confirmations, required: opts.minConfirmations },
    );
  }

  const wanted = addressToTopic(DEPOSIT_ADDRESS);
  const totals = new Map<string, bigint>();
  let fromAddress = "";
  for (const entry of receipt.logs) {
    if (!isRecord(entry)) continue;
    const token = chain.tokens.find(
      (item) => item.address.toLowerCase() === String(entry.address ?? "").toLowerCase(),
    );
    if (!token) continue;
    const topics = Array.isArray(entry.topics) ? entry.topics.map((topic) => String(topic)) : [];
    if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if ((topics[2] ?? "").toLowerCase() !== wanted) continue;
    if (typeof entry.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(entry.data)) continue;
    const raw = hexToBigInt(entry.data);
    if (raw == null) continue;
    const usd = tokenUnitsToUsd(raw, token.decimals);
    totals.set(token.symbol, (totals.get(token.symbol) ?? 0n) + usd);
    if (!fromAddress && topics[1]) fromAddress = topicToAddress(topics[1]) ?? "";
  }
  if (totals.size === 0) {
    return fail(
      "no_transfer",
      "No USDT or USDC transfer to the deposit address was found in this transaction.",
    );
  }
  const breakdown = [...totals.entries()].map(([symbol, amountUsd]) => ({ symbol, amountUsd }));
  const amountUsd = breakdown.reduce((sum, item) => sum + item.amountUsd, 0n);
  if (amountUsd > MAX_DEPOSIT) {
    return fail("amount_untrusted", "Transfer amount is outside the supported range.");
  }
  if (amountUsd < opts.minDepositUsd) {
    return fail("below_minimum", `Minimum deposit is ${formatUsd(opts.minDepositUsd)} USD.`, {
      amountUsd: formatUsd(amountUsd),
      minimumUsd: formatUsd(opts.minDepositUsd),
    });
  }
  return {
    ok: true,
    chain: opts.chain,
    txHash: txHash.toLowerCase(),
    token: breakdown.map((item) => item.symbol).join("+"),
    amountUsd,
    fromAddress,
    confirmations,
    breakdown,
  };
}

export function createRpc(url: string): Rpc {
  return {
    async call(method, params) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const json = (await response.json()) as { error?: { message?: string }; result?: unknown };
      if (json.error) throw new Error("RPC rejected the request");
      return json.result;
    },
  };
}

function fail(
  code: Extract<VerifyResult, { ok: false }>["code"],
  message: string,
  extra: Partial<Extract<VerifyResult, { ok: false }>> = {},
): VerifyResult {
  return { ok: false, code, message, ...extra };
}

function hexToBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value === "0x") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
