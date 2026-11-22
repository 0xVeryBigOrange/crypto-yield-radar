import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, test } from "vitest";
import { formatUsd, parseDecimal } from "../src/money.js";
import {
  CHAINS,
  DEPOSIT_ADDRESS,
  TRANSFER_TOPIC,
  addressToTopic,
  tokenUnitsToUsd,
  verifyDeposit,
  type ChainId,
  type Rpc,
} from "../src/payments.js";

const MIN = parseDecimal("5");

describe("deposit constants", () => {
  test("deposit address matches the operator address character for character", () => {
    const expected = "0xa18d1810C8457f7d09E3311DF8D2Faf1d9c2E19C";
    expect(DEPOSIT_ADDRESS).toBe(expected);
    expect([...DEPOSIT_ADDRESS]).toEqual([...expected]);
    expect(addressToTopic(DEPOSIT_ADDRESS)).toBe(
      "0x000000000000000000000000a18d1810c8457f7d09e3311df8d2faf1d9c2e19c",
    );
  });

  test("token contracts and decimals are the mainnet contracts", () => {
    expect(CHAINS.ethereum.tokens).toEqual([
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9EB0cE3606eB48", decimals: 6 },
    ]);
    expect(CHAINS.bsc.tokens).toEqual([
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad70ADf3a8B0d", decimals: 18 },
    ]);
  });

  test("transfer topic is keccak256 of the ERC-20 event", () => {
    const hash = Buffer.from(keccak_256(new TextEncoder().encode("Transfer(address,address,uint256)"))).toString("hex");
    expect(`0x${hash}`).toBe(TRANSFER_TOPIC);
  });
});

describe("token decimals", () => {
  test("6-decimal and 18-decimal stablecoins convert 1:1 to USD", () => {
    expect(formatUsd(tokenUnitsToUsd(10_000_000n, 6))).toBe("10.00");
    expect(formatUsd(tokenUnitsToUsd(55n * 10n ** 17n, 18))).toBe("5.50");
  });
});

describe("verifyDeposit", () => {
  test("credits an Ethereum USDT transfer after enough confirmations", async () => {
    const result = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x1b", receipt: receipt("ethereum", "USDT", 10_000_000n) }),
      chain: "ethereum",
      txHash: `0x${"ab".repeat(32)}`,
      minConfirmations: 12,
      minDepositUsd: MIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatUsd(result.amountUsd)).toBe("10.00");
    expect(result.token).toBe("USDT");
    expect(result.confirmations).toBe(12);
    expect(result.txHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("credits BNB Smart Chain USDC using 18 decimals", async () => {
    const result = await verifyDeposit({
      rpc: rpc({ chainId: "0x38", block: "0x20", receipt: receipt("bsc", "USDC", 55n * 10n ** 17n) }),
      chain: "bsc",
      txHash: `0x${"cd".repeat(32)}`,
      minConfirmations: 15,
      minDepositUsd: MIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatUsd(result.amountUsd)).toBe("5.50");
    expect(result.token).toBe("USDC");
  });

  test("rejects the wrong recipient, a fake token, a revert, and a short confirmation window", async () => {
    const tx = `0x${"11".repeat(32)}`;
    const wrongTo = await verifyDeposit({
      rpc: rpc({
        chainId: "0x1",
        block: "0x20",
        receipt: receipt("ethereum", "USDT", 10_000_000n, "0x1111111111111111111111111111111111111111"),
      }),
      chain: "ethereum",
      txHash: tx,
      minConfirmations: 12,
      minDepositUsd: MIN,
    });
    expect(wrongTo).toMatchObject({ ok: false, code: "no_transfer" });

    const fake = receipt("ethereum", "USDT", 10_000_000n);
    fake.logs[0]!.address = "0x0000000000000000000000000000000000000001";
    const fakeToken = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x20", receipt: fake }),
      chain: "ethereum",
      txHash: tx,
      minConfirmations: 12,
      minDepositUsd: MIN,
    });
    expect(fakeToken).toMatchObject({ ok: false, code: "no_transfer" });

    const reverted = receipt("ethereum", "USDT", 10_000_000n);
    reverted.status = "0x0";
    const failed = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x20", receipt: reverted }),
      chain: "ethereum",
      txHash: tx,
      minConfirmations: 12,
      minDepositUsd: MIN,
    });
    expect(failed).toMatchObject({ ok: false, code: "failed" });

    const young = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x1a", receipt: receipt("ethereum", "USDT", 10_000_000n, DEPOSIT_ADDRESS, "0x10") }),
      chain: "ethereum",
      txHash: tx,
      minConfirmations: 12,
      minDepositUsd: MIN,
    });
    expect(young).toMatchObject({ ok: false, code: "confirmations", confirmations: 11, required: 12 });
  });

  test("rejects a pending tx, the wrong network, a bad hash, and a dust amount", async () => {
    const tx = `0x${"22".repeat(32)}`;
    expect(
      await verifyDeposit({
        rpc: rpc({ chainId: "0x1", block: "0x20", receipt: null }),
        chain: "ethereum",
        txHash: tx,
        minConfirmations: 1,
        minDepositUsd: MIN,
      }),
    ).toMatchObject({ ok: false, code: "pending" });

    expect(
      await verifyDeposit({
        rpc: rpc({ chainId: "0x38", block: "0x20", receipt: receipt("ethereum", "USDT", 10_000_000n) }),
        chain: "ethereum",
        txHash: tx,
        minConfirmations: 1,
        minDepositUsd: MIN,
      }),
    ).toMatchObject({ ok: false, code: "wrong_network" });

    expect(
      await verifyDeposit({
        rpc: rpc({ chainId: "0x1", block: "0x20", receipt: null }),
        chain: "ethereum",
        txHash: "0x1234",
        minConfirmations: 1,
        minDepositUsd: MIN,
      }),
    ).toMatchObject({ ok: false, code: "bad_tx" });

    const dust = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x20", receipt: receipt("ethereum", "USDT", 4_990_000n) }),
      chain: "ethereum",
      txHash: tx,
      minConfirmations: 1,
      minDepositUsd: MIN,
    });
    expect(dust).toMatchObject({ ok: false, code: "below_minimum" });
  });

  test("sums every supported transfer in the same transaction", async () => {
    const combined = receipt("ethereum", "USDT", 4_000_000n);
    combined.logs.push(receipt("ethereum", "USDC", 2_000_000n).logs[0]!);
    const result = await verifyDeposit({
      rpc: rpc({ chainId: "0x1", block: "0x20", receipt: combined }),
      chain: "ethereum",
      txHash: `0x${"33".repeat(32)}`,
      minConfirmations: 1,
      minDepositUsd: MIN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatUsd(result.amountUsd)).toBe("6.00");
    expect(result.token).toBe("USDT+USDC");
  });
});

function rpc(opts: { chainId: string; block: string; receipt: unknown }): Rpc {
  return {
    async call(method) {
      if (method === "eth_chainId") return opts.chainId;
      if (method === "eth_blockNumber") return opts.block;
      if (method === "eth_getTransactionReceipt") return opts.receipt;
      throw new Error(`unexpected ${method}`);
    },
  };
}

function receipt(
  chain: ChainId,
  symbol: "USDT" | "USDC",
  raw: bigint,
  to = DEPOSIT_ADDRESS,
  blockNumber = "0x10",
) {
  const token = CHAINS[chain].tokens.find((item) => item.symbol === symbol);
  if (!token) throw new Error("missing token");
  return {
    status: "0x1",
    blockNumber,
    logs: [
      {
        address: token.address,
        topics: [
          TRANSFER_TOPIC,
          `0x${"11".repeat(20).padStart(64, "0")}`,
          addressToTopic(to),
        ],
        data: `0x${raw.toString(16).padStart(64, "0")}`,
      },
    ],
  };
}
