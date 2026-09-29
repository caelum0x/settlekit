/**
 * Env-driven assembly of onchain billing, shared by the API and the worker.
 *
 *   ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY  EVM operator hot key (Permit2 spender,
 *                                         spend-permission spender, escrow operator,
 *                                         refund sender). Absent -> no EVM pulls.
 *   ONCHAIN_BILLING_SOLANA_SECRET         Solana operator keypair (SPL delegate,
 *                                         refund sender); base58 or JSON bytes.
 *   ONCHAIN_BILLING_NETWORKS              comma list to bill on (default: every
 *                                         enabled EVM chain + solana + invoice networks)
 *   ONCHAIN_BILLING_CHECKOUT_URL          public checkout origin for renewal links
 *   ONCHAIN_BILLING_ESCROW=off            disable Base commerce-payments escrow
 *
 * EVM chains, RPCs and tokens come from `@settlekit/chains` (ENABLED_EVM_CHAINS,
 * <KEY>_NETWORK, <KEY>_RPC_URL); Solana from SOLANA_CLUSTER / SOLANA_RPC_URL /
 * SOLANA_USDC_MINT. Nothing here spends money at boot.
 */
import type { TransactionSigner } from "@solana/kit";
import { loadEvmChains, readEnv, type Env, type Hex } from "@settlekit/chains";
import {
  SolanaSettlementProvider,
  createKitSolanaRpc,
  createSolanaSignerFromSecret,
  getSolanaCluster,
  parseSolanaCluster,
} from "@settlekit/solana";
import type { CheckoutRepository } from "@settlekit/payments";
import type { EmailClient } from "@settlekit/notifications";
import type { DunningService } from "@settlekit/dunning";
import { hasPermit2, hasSpendPermissionManager, commercePaymentsFor } from "./addresses.js";
import { SubscriptionChargeEngine, type ChargeEngineHooks, type EngineLogger } from "./charge-engine.js";
import { CommerceEscrowClient } from "./commerce-escrow.js";
import { EscrowPaymentService } from "./escrow-records.js";
import { createViemOperator, type EvmOperator } from "./evm.js";
import { Permit2Billing } from "./permit2-allowance.js";
import { RefundDispatcher, type EvmRefundRoute, type HyperCoreRefundSender, type SolanaRefundSender } from "./refund-dispatch.js";
import { RenewalInvoiceBilling } from "./renewal-invoice.js";
import { SpendPermissionBilling } from "./spend-permission.js";
import { SplDelegateBilling, createKitSplDelegateRpc, type SplDelegateRpc } from "./spl-delegate.js";
import type { OnchainBillingStore } from "./store.js";
import { OnchainSubscriptionService, type BillingAsset } from "./subscription-service.js";
import type { BillingNetwork } from "./types.js";

export interface OnchainBillingDeps {
  env: Env;
  store: OnchainBillingStore;
  dunning: DunningService;
  checkouts: Pick<CheckoutRepository, "save" | "findById">;
  email: EmailClient | null;
  merchantId: string;
  hooks?: ChargeEngineHooks;
  logger?: EngineLogger;
  now?: () => Date;
  /** Tests: build operators without RPC. */
  evmOperatorFactory?: (chainId: number, rpcUrl: string, privateKey: Hex, token: Hex) => EvmOperator;
  splRpc?: SplDelegateRpc;
  solanaSigner?: TransactionSigner;
  /** Tests: Solana refund sender without RPC. */
  solanaRefunds?: SolanaRefundSender;
  /** HyperCore usdSend for refunds, once @settlekit/hyperliquid is wired. */
  hypercoreRefunds?: HyperCoreRefundSender;
}

export interface OnchainBillingRuntime {
  assets: Partial<Record<BillingNetwork, BillingAsset>>;
  subscriptions: OnchainSubscriptionService;
  engine: SubscriptionChargeEngine;
  refunds: RefundDispatcher;
  /** Base commerce-payments escrow, when Base is enabled with an operator key. */
  escrow: EscrowPaymentService | null;
  store: OnchainBillingStore;
  operatorAddress: Hex | null;
  solanaDelegate: string | null;
  notes: readonly string[];
}

const INVOICE_ONLY: readonly BillingNetwork[] = ["hypercore", "zcash"];

function wantedNetworks(env: Env): Set<string> | null {
  const raw = readEnv(env, "ONCHAIN_BILLING_NETWORKS");
  if (raw === undefined) return null;
  return new Set(raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean));
}

/** Build the runtime; null when nothing is configured to bill with. */
export async function buildOnchainBilling(deps: OnchainBillingDeps): Promise<OnchainBillingRuntime | null> {
  const { env } = deps;
  const notes: string[] = [];
  const wanted = wantedNetworks(env);
  const allow = (network: string) => wanted === null || wanted.has(network);
  const assets: Partial<Record<BillingNetwork, BillingAsset>> = {};
  const privateKey = readEnv(env, "ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY") as Hex | undefined;
  if (privateKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }

  const permit2Operators: EvmOperator[] = [];
  const spendOperators: EvmOperator[] = [];
  const evmRefunds: Record<string, EvmRefundRoute> = {};
  let escrowOperator: EvmOperator | null = null;
  let operatorAddress: Hex | null = null;

  for (const chain of Object.values(loadEvmChains(env).enabled)) {
    if (!chain || !allow(chain.key)) continue;
    assets[chain.key] = { network: chain.key, chainId: chain.spec.chainId, token: chain.tokenAddress, decimals: 6, symbol: chain.spec.token.symbol };
    if (privateKey === undefined) continue;
    const operator =
      deps.evmOperatorFactory?.(chain.spec.chainId, chain.rpcUrl, privateKey, chain.tokenAddress) ??
      createViemOperator({ chainId: chain.spec.chainId, rpcUrl: chain.rpcUrl, privateKey, feeToken: chain.tokenAddress });
    operatorAddress = operator.address;
    evmRefunds[chain.key] = { operator, token: chain.tokenAddress };
    if (hasPermit2(chain.spec.chainId)) permit2Operators.push(operator);
    if (hasSpendPermissionManager(chain.spec.chainId)) spendOperators.push(operator);
    if (chain.key === "base" && commercePaymentsFor(chain.spec.chainId) && readEnv(env, "ONCHAIN_BILLING_ESCROW") !== "off") {
      escrowOperator = operator;
    }
  }
  if (privateKey === undefined && Object.keys(assets).length > 0) {
    notes.push("EVM pulls disabled: set ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY");
  }

  let splDelegate: SplDelegateBilling | undefined;
  let solanaRefunds: SolanaRefundSender | undefined;
  const clusterRaw = readEnv(env, "SOLANA_CLUSTER");
  const cluster = clusterRaw ? parseSolanaCluster(clusterRaw) : undefined;
  if (cluster && allow("solana")) {
    const info = getSolanaCluster(cluster);
    const mint = readEnv(env, "SOLANA_USDC_MINT") ?? info.usdcMint;
    const rpcUrl = readEnv(env, "SOLANA_RPC_URL") ?? info.rpcUrl;
    assets.solana = { network: "solana", token: mint, decimals: 6, symbol: "USDC", cluster };
    const secret = readEnv(env, "ONCHAIN_BILLING_SOLANA_SECRET");
    const signer = deps.solanaSigner ?? (secret ? await createSolanaSignerFromSecret(secret) : undefined);
    if (signer) {
      const rpc = deps.splRpc ?? createKitSplDelegateRpc(rpcUrl);
      splDelegate = new SplDelegateBilling({ rpc, signer, cluster });
      solanaRefunds =
        deps.solanaRefunds ??
        (deps.splRpc ? undefined : new SolanaSettlementProvider({ rpc: createKitSolanaRpc(rpcUrl), signer, mint }));
    } else {
      notes.push("Solana SPL delegate billing disabled: set ONCHAIN_BILLING_SOLANA_SECRET");
    }
  }
  for (const network of INVOICE_ONLY) {
    if (allow(network)) assets[network] = { network, token: "", decimals: network === "zcash" ? 8 : 6, symbol: network === "zcash" ? "ZEC" : "USDC" };
  }

  const checkoutBaseUrl = readEnv(env, "ONCHAIN_BILLING_CHECKOUT_URL") ?? readEnv(env, "CHECKOUT_BASE_URL");
  const renewalInvoice = checkoutBaseUrl
    ? new RenewalInvoiceBilling({
        checkouts: deps.checkouts,
        email: deps.email,
        checkoutBaseUrl,
        merchantId: deps.merchantId,
        ...(deps.now ? { now: deps.now } : {}),
      })
    : undefined;
  if (!renewalInvoice) notes.push("renewal invoices disabled: set ONCHAIN_BILLING_CHECKOUT_URL");

  const permit2 = permit2Operators.length > 0 ? new Permit2Billing(permit2Operators) : undefined;
  const spendPermission = spendOperators.length > 0 ? new SpendPermissionBilling(spendOperators) : undefined;
  if (!permit2 && !spendPermission && !splDelegate && !renewalInvoice) return null;

  const now = deps.now ?? (() => new Date());
  const escrow = escrowOperator ? new EscrowPaymentService(new CommerceEscrowClient(escrowOperator), deps.store, now) : null;
  const subscriptions = new OnchainSubscriptionService(
    deps.store,
    assets,
    {
      ...(permit2 ? { permit2 } : {}),
      ...(spendPermission ? { spendPermission } : {}),
      ...(splDelegate ? { splDelegate } : {}),
      ...(renewalInvoice ? { renewalInvoice } : {}),
    },
    now,
  );
  const engine = new SubscriptionChargeEngine({
    store: deps.store,
    providers: {
      ...(permit2 ? { permit2 } : {}),
      ...(spendPermission ? { spend_permission: spendPermission } : {}),
      ...(splDelegate ? { spl_delegate: splDelegate } : {}),
      ...(renewalInvoice ? { renewal_invoice: renewalInvoice } : {}),
    },
    dunning: deps.dunning,
    ...(deps.hooks ? { hooks: deps.hooks } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
    now,
  });
  const refunds = new RefundDispatcher({
    ...(escrow ? { escrow } : {}),
    evm: evmRefunds,
    ...(solanaRefunds ? { solana: solanaRefunds } : {}),
    ...(deps.hypercoreRefunds ? { hypercore: deps.hypercoreRefunds } : {}),
  });
  if (!deps.hypercoreRefunds) notes.push("HyperCore refunds are manual until @settlekit/hyperliquid usdSend is wired");

  return {
    assets,
    subscriptions,
    engine,
    refunds,
    escrow,
    store: deps.store,
    operatorAddress,
    solanaDelegate: splDelegate?.delegate ?? null,
    notes,
  };
}
