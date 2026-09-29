/**
 * Chain doubles for the multi-chain API tests (no network): an EvmRpc that
 * serves receipts registered by the test, a jsonParsed Solana transaction
 * store, and a fetch serving recorded Coinbase/Kraken prices plus Blockchair
 * transactions registered by the test.
 */
import type { ArcTransactionReceipt, FullEvmRpc, Hex } from "@settlekit/arc";
import { TRANSFER_EVENT_TOPIC } from "@settlekit/arc";
import { USDC_MINT_MAINNET, type ParsedTransaction, type SolanaRpc } from "@settlekit/solana";
import type { FetchLike } from "@settlekit/zcash";

const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;

export interface EvmLedger {
  rpc: FullEvmRpc;
  /** Record a mined USDC transfer of `amountBase` to `to`, timestamped now. */
  pay(args: { txHash: Hex; token: Hex; from: Hex; to: Hex; amountBase: bigint }): void;
}

export function evmLedger(chainId: number): EvmLedger {
  const receipts = new Map<string, { receipt: ArcTransactionReceipt; time: bigint }>();
  const head = 1_000n;
  return {
    rpc: {
      getChainId: async () => chainId,
      getBlockNumber: async () => head,
      getTransactionReceipt: async (hash) => receipts.get(hash.toLowerCase())?.receipt ?? null,
      getBlockTimestamp: async (block) => {
        const match = [...receipts.values()].find((entry) => entry.receipt.blockNumber === block);
        if (!match) throw new Error(`no block ${block}`);
        return match.time;
      },
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    },
    pay({ txHash, token, from, to, amountBase }) {
      const blockNumber = 900n + BigInt(receipts.size);
      receipts.set(txHash.toLowerCase(), {
        time: BigInt(Math.floor(Date.now() / 1000)),
        receipt: {
          transactionHash: txHash,
          blockNumber,
          status: "success",
          from,
          to: token,
          logs: [{ address: token, topics: [TRANSFER_EVENT_TOPIC, pad(from), pad(to)], data: pad(amountBase.toString(16)), logIndex: 0 }],
        },
      });
    },
  };
}

export interface SolanaLedger {
  rpc: SolanaRpc;
  pay(args: { signature: string; payer: string; merchant: string; reference: string; amountBase: bigint }): void;
}

export function solanaLedger(): SolanaLedger {
  const txs = new Map<string, ParsedTransaction>();
  const unused = async (): Promise<never> => {
    throw new Error("not used by verification");
  };
  return {
    rpc: {
      getTransaction: async (signature) => txs.get(signature) ?? null,
      getSignaturesForAddress: unused,
      getLatestBlockhash: unused,
      sendTransaction: unused,
      getSignatureStatuses: unused,
    },
    pay({ signature, payer, merchant, reference, amountBase }) {
      const bal = (accountIndex: number, owner: string, value: bigint) => ({
        accountIndex,
        mint: USDC_MINT_MAINNET,
        owner,
        uiTokenAmount: { amount: value.toString(), decimals: 6 },
      });
      const key = (pubkey: string, signer = false, writable = false) => ({ pubkey, signer, writable });
      txs.set(signature, {
        slot: 1,
        blockTime: Math.floor(Date.now() / 1000),
        meta: {
          err: null,
          preTokenBalances: [bal(1, payer, 100_000_000n), bal(2, merchant, 0n)],
          postTokenBalances: [bal(1, payer, 100_000_000n - amountBase), bal(2, merchant, amountBase)],
        },
        transaction: {
          signatures: [signature],
          message: { accountKeys: [key(payer, true, true), key("FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B", false, true), key(merchant), key(reference)] },
        },
      } as ParsedTransaction);
    },
  };
}

export interface ZcashLedger {
  fetch: FetchLike;
  pay(args: { txid: string; payTo: string; zats: bigint }): void;
}

/** Blockchair renders UTC times as "YYYY-MM-DD HH:MM:SS". */
function blockchairTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function zcashLedger(): ZcashLedger {
  const txs = new Map<string, unknown>();
  const tip = 3_500_300;
  const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  return {
    fetch: async (url) => {
      if (url.startsWith("https://api.coinbase.com/")) return respond({ data: { amount: "1438.25", base: "ZEC", currency: "USD" } });
      if (url.startsWith("https://api.kraken.com/")) return respond({ error: [], result: { XZECZUSD: { c: ["1439.25000", "0.1"] } } });
      const match = /\/dashboards\/transaction\/([0-9a-f]{64})/.exec(url);
      if (match) {
        const txid = match[1] as string;
        const tx = txs.get(txid);
        return respond({ data: tx ? { [txid]: tx } : [], context: { code: 200, state: tip } });
      }
      throw new Error(`unexpected request ${url}`);
    },
    pay({ txid, payTo, zats }) {
      const time = blockchairTime(new Date());
      txs.set(txid, {
        transaction: { block_id: tip - 4, hash: txid, time },
        inputs: [{ recipient: "t1gH8kwDu1euQky74m2CS15vtopntebdKX5", value: Number(zats) + 10_000 }],
        outputs: [{ recipient: payTo, value: Number(zats), type: "pubkeyhash" }],
      });
    },
  };
}

export interface HyperCoreLedger {
  transport: import("@settlekit/hyperliquid").HyperliquidTransport;
  pay(input: { hash: string; from: string; to: string; usdc: string }): void;
}

/** A Hyperliquid info transport serving usdSend credits registered by the test. */
export function hyperCoreLedger(): HyperCoreLedger {
  const ledger: Array<{ time: number; hash: string; delta: Record<string, unknown> & { type: string } }> = [];
  return {
    transport: {
      isTestnet: false,
      async request<T>(_endpoint: "info" | "exchange", payload: unknown): Promise<T> {
        const { user, startTime } = payload as { user: string; startTime: number };
        return ledger.filter((entry) => entry.time >= startTime && (entry.delta.destination === user || entry.delta.user === user)) as T;
      },
    },
    pay({ hash, from, to, usdc }) {
      ledger.push({ time: Date.now(), hash, delta: { type: "internalTransfer", usdc, user: from.toLowerCase(), destination: to.toLowerCase(), fee: "0.0" } });
    },
  };
}
