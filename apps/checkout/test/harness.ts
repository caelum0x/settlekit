/**
 * Shared test harness for the multi-chain checkout tests: the real store,
 * payments lifecycle and entitlements over in-memory repositories, with
 * injectable EVM RPCs (fake receipts) and a fake Zcash explorer + price
 * sources. No network.
 */
import { InMemoryEntitlementRepository } from "@settlekit/entitlements";
import {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  createCheckoutSession,
} from "@settlekit/payments";
import { TRANSFER_EVENT_TOPIC, type ArcLog, type FullEvmRpc } from "@settlekit/arc";
import { TRANSFER_WITH_MEMO_TOPIC, type EvmChainKey, type Hex } from "@settlekit/chains";
import type {
  CheckoutSession,
  DeliveryAction,
  PaymentNetwork,
  Price,
  Product,
  SettlementQuote,
} from "@settlekit/common";
import type { PriceSource, ZcashAddressActivity, ZcashExplorer, ZcashTransaction } from "@settlekit/zcash";

import type { CheckoutBackend } from "../lib/backend";
import { verifyOnChainPayment } from "../lib/arc";
import { loadEvmRuntime, type EvmRuntimeResult } from "../lib/evm";
import type { SolanaRuntimeResult } from "../lib/solana";
import type { StoreDeps } from "../lib/store";
import type { ZcashRuntime, ZcashRuntimeResult } from "../lib/zcash";

export const ORG = "org_test";
export const MERCHANT_EVM = "0x3333333333333333333333333333333333333333" as Hex;
export const BUYER_EVM = "0x2222222222222222222222222222222222222222" as Hex;
export const OTHER_EVM = "0x4444444444444444444444444444444444444444" as Hex;
export const ZEC_PAY_TO = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";
export const ZEC_PAYER = "t1gH8kwDu1euQky74m2CS15vtopntebdKX5";
export const SESSION_CREATED = new Date("2026-09-29T10:00:00.000Z");

export const product: Product = {
  id: "prod_license",
  merchantId: "mch_test",
  organizationId: ORG,
  name: "Atlas Desktop Pro",
  description: "License",
  type: "license_key",
  status: "active",
  deliveryMode: "license_key",
  metadata: {},
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

export const price: Price = {
  id: "price_license",
  productId: product.id,
  amount: "25",
  currency: "USDC",
  interval: "one_time",
  usageBased: false,
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
};

export const action: DeliveryAction = { type: "license_key_create", policyId: "pol_pro" };

export const FIELDS = { email: "buyer@example.com" };

export interface Harness {
  deps: StoreDeps;
  payments: InMemoryPaymentRepository;
  checkouts: InMemoryCheckoutRepository;
  entitlements: InMemoryEntitlementRepository;
}

const UNCONFIGURED_SOLANA: SolanaRuntimeResult = {
  ok: false,
  error: "Solana payments are not configured on this checkout (SOLANA_CLUSTER is unset).",
};

export function harness(options: { evm?: EvmRuntimeResult; zcash?: ZcashRuntimeResult; solana?: SolanaRuntimeResult } = {}): Harness {
  const payments = new InMemoryPaymentRepository();
  const checkouts = new InMemoryCheckoutRepository();
  const entitlements = new InMemoryEntitlementRepository();
  const backend: CheckoutBackend = {
    checkouts,
    payments,
    entitlements,
    persistent: false,
    findProduct: async (id) => (id === product.id ? product : undefined),
    findPrice: async (id) => (id === price.id ? price : undefined),
    merchantName: async () => "Acme Dev Tools",
    deliveryActionForProduct: () => action,
    seededSessionIds: () => [],
  };
  return {
    deps: {
      backend,
      verify: {
        solana: options.solana ?? UNCONFIGURED_SOLANA,
        verifyArc: verifyOnChainPayment,
        ...(options.evm ? { evm: options.evm } : {}),
        ...(options.zcash ? { zcash: options.zcash } : {}),
      },
      fulfillment: { entitlements, github: () => ({ ok: false, error: "GitHub App not configured." }) },
    },
    payments,
    checkouts,
    entitlements,
  };
}

export async function openSession(
  h: Harness,
  network: PaymentNetwork,
  overrides: Partial<CheckoutSession> = {},
  now: Date = SESSION_CREATED,
): Promise<CheckoutSession> {
  const draft = createCheckoutSession(
    {
      organizationId: ORG,
      merchantId: product.merchantId,
      items: [{ lineItem: { productId: product.id, priceId: price.id, quantity: 1 }, price }],
      payToAddress: network === "zcash" ? ZEC_PAY_TO : MERCHANT_EVM,
      network,
    },
    now,
  );
  return h.checkouts.save({ ...draft, collectedFields: { ...FIELDS }, ...overrides });
}

// --- EVM ------------------------------------------------------------------------

export const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").padStart(64, "0")}` as Hex;
export const txHash = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

export interface FakeTransfer {
  from?: Hex;
  to?: Hex;
  amountBase: bigint;
  /** bytes32 memo → TIP-20 TransferWithMemo log. */
  memo?: Hex;
  token?: Hex;
}

export interface FakeTx {
  transfers: FakeTransfer[];
  blockNumber?: bigint;
  /** Seconds since epoch. */
  blockTime?: number;
  status?: "success" | "reverted";
}

export interface FakeChainState {
  chainId: number;
  token: Hex;
  head: bigint;
  txs: Record<string, FakeTx>;
}

function logFor(transfer: FakeTransfer, token: Hex, index: number): ArcLog {
  const from = pad(transfer.from ?? BUYER_EVM);
  const to = pad(transfer.to ?? MERCHANT_EVM);
  const data = pad(transfer.amountBase.toString(16));
  const address = transfer.token ?? token;
  return transfer.memo !== undefined
    ? { address, topics: [TRANSFER_WITH_MEMO_TOPIC, from, to, transfer.memo], data, logIndex: index }
    : { address, topics: [TRANSFER_EVENT_TOPIC, from, to], data, logIndex: index };
}

/** A FullEvmRpc over mutable fake chain state. */
export function fakeEvmRpc(state: FakeChainState): FullEvmRpc {
  return {
    getChainId: async () => state.chainId,
    getBlockNumber: async () => state.head,
    getBlockTimestamp: async (block) => {
      const tx = Object.values(state.txs).find((entry) => (entry.blockNumber ?? 100n) === block);
      return BigInt(tx?.blockTime ?? Math.floor(SESSION_CREATED.getTime() / 1000) + 60);
    },
    estimateFeesPerGas: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
    getTransactionReceipt: async (hash) => {
      const tx = state.txs[hash];
      if (tx === undefined) return null;
      return {
        transactionHash: hash,
        blockNumber: tx.blockNumber ?? 100n,
        status: tx.status ?? "success",
        from: tx.transfers[0]?.from ?? BUYER_EVM,
        to: state.token,
        logs: tx.transfers.map((transfer, index) => logFor(transfer, state.token, index)),
      };
    },
  };
}

/** EVM runtime from env with fake RPCs for the given chains. */
export function evmRuntime(env: Record<string, string>, rpcs: Partial<Record<EvmChainKey, FullEvmRpc>>): EvmRuntimeResult {
  return loadEvmRuntime(env, { rpcs });
}

// --- Zcash ----------------------------------------------------------------------

export interface FakeExplorerState {
  txs: Record<string, Partial<ZcashTransaction>>;
  activity: ZcashAddressActivity[];
  down?: boolean;
  calls: string[];
}

export function fakeExplorer(state: FakeExplorerState): ZcashExplorer {
  return {
    async getTransaction(txid) {
      state.calls.push(`tx:${txid}`);
      if (state.down) return { ok: false, retryLater: true, status: 429, reason: "explorer responded HTTP 429" };
      const tx = state.txs[txid];
      if (tx === undefined) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          txid,
          blockHeight: 3_500_000,
          blockTime: new Date(SESSION_CREATED.getTime() + 120_000),
          confirmations: 5,
          outputs: [],
          inputAddresses: [ZEC_PAYER],
          ...tx,
        },
      };
    },
    async getAddressActivity(address) {
      state.calls.push(`addr:${address}`);
      if (state.down) return { ok: false, retryLater: true, status: 429, reason: "explorer responded HTTP 429" };
      return { ok: true, value: state.activity };
    },
  };
}

/** A price source that always answers `rate` (USD per ZEC). */
export function fixedPrice(rate: string, name = "coinbase", now: () => Date = () => new Date()): PriceSource {
  return { name, fetchUsdPrice: async () => ({ rate, source: name, observedAt: now() }) };
}

export function zcashRuntime(explorer: ZcashExplorer, sources: PriceSource[] = [fixedPrice("50")]): ZcashRuntimeResult {
  const runtime: ZcashRuntime = {
    config: { network: "mainnet", explorerUrl: "https://api.blockchair.com/zcash", minConfirmations: 3, quoteTtlSec: 900 },
    explorer,
    priceSources: sources,
  };
  return { ok: true, runtime };
}

export function lockedQuote(amountBase: string, lockedAt: Date, ttlMs = 900_000): SettlementQuote {
  return {
    asset: "ZEC",
    amountBase,
    decimals: 8,
    rate: "50",
    source: "coinbase",
    lockedAt: lockedAt.toISOString(),
    expiresAt: new Date(lockedAt.getTime() + ttlMs).toISOString(),
  };
}
